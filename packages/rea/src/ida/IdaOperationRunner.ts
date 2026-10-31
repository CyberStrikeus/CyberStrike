import type { RegexMatchingDeadline } from "../config/regexMatchingDeadline.js";
import type { RegexWorkerHeapRequest } from "../config/regexWorkerHeapRequest.js";
import { z } from "zod";
import {
  nativeDecompileSchema,
  nativeDisassemblySchema,
  nativeCalleesSchema,
  nativeXrefsSchema,
  nativeLiteralSearchPattern,
} from "./IdaNativeProtocol.js";
import {
  analysisSearchPredicate,
  analysisSearchQuerySchema,
  type AnalysisSearchQuery,
} from "../domain/analysisSearch.js";
import {
  matchRegexValues,
  launchRegexMatchingLimitation,
} from "../process/RegexMatcher.js";
import {
  AnalysisInputError,
  AnalysisCancelledError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import {
  functionDossierSchema,
  functionInstructionWindowSchema,
} from "../domain/native/functionDossier.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { RelationshipCoverage } from "../domain/relationshipCoverage.js";
import { combineFunctionRelationshipCoverage } from "../domain/functionCallCoverage.js";
import { readCallGraphCallees, unavailableCallGraph } from "./IdaCallGraph.js";
import type { IdaMcpConnection } from "./IdaMcpConnection.js";
import type { IdaOperation } from "./IdaProviderCapabilities.js";
import {
  IDA_LIMITATIONS,
  IDA_NATIVE_STRING_LIMITATION,
} from "./IdaProviderCapabilities.js";
import type { EvidenceLocation } from "../domain/evidence.js";
import {
  disassemblySchema,
  idaAddressSchema,
  idaFunctionSchema,
  idaStringsPageSchema,
  legacyCalleesSchema,
  legacyPageSchema,
  legacyStringSchema,
  legacyXrefsSchema,
  modernCalleesSchema,
  modernDecompileSchema,
  modernDisassemblySchema,
  modernLookupSchema,
  modernLookupBatchSchema,
  modernPageSchema,
  modernXrefsSchema,
  nextOffset,
  nextPageOffset,
  surveySegmentsSchema,
  type IdaDisassembly,
  type IdaFunction,
} from "./IdaProtocolValues.js";

/** One operation's raw source observations, retained alongside normalized results. */
export interface IdaRawObservation {
  readonly tool: string;
  readonly arguments: Readonly<Record<string, JsonValue>>;
  readonly result: JsonValue;
}

const unknownBody = {
  available: false,
  reason: "IDA MCP does not report complete function body ranges.",
} as const;
const identity = (fn: IdaFunction) => ({
  address: fn.address,
  name: fn.name,
  symbol: null,
  classification: null,
  body: unknownBody,
});
interface IdaRelationships {
  readonly items: ReturnType<typeof identity>[];
  readonly coverage: RelationshipCoverage;
  readonly availability:
    | { readonly available: true }
    | { readonly available: false; readonly reason: string };
}

/** The only lookup answers upstream reports for a name or address that is not a function. */
const MISSING_PROCEDURE_ANSWERS: ReadonlySet<string> = new Set([
  "Not found",
  "Not a function",
]);
const lines = (asm: IdaDisassembly) =>
  asm.lines.map(({ address, instruction }) => `${address}: ${instruction}`);

/** Translate explicit analyst questions into a closed set of read-only upstream requests. */
export class IdaOperationRunner {
  readonly raw: IdaRawObservation[] = [];
  readonly locations: EvidenceLocation[] = [];
  readonly limitations: string[] = [];
  relationshipCoverage: RelationshipCoverage | undefined;
  /** The upstream cap flag of the last `xrefs_to` read, when the producer reported one. */
  referencesTruncated: boolean | undefined;
  constructor(
    private readonly connection: IdaMcpConnection,
    private readonly protocol: "legacy" | "modern" | "native",
    private readonly database?: string,
    private readonly options: {
      readonly signal?: AbortSignal | undefined;
      readonly regexMatchingDeadline?: RegexMatchingDeadline | undefined;
      readonly regexWorkerHeapRequest?: RegexWorkerHeapRequest | undefined;
      readonly selectorOrigin?: "provider" | undefined;
      /** False when the loaded processor may not be x86, so `callees` cannot be trusted alone. */
      readonly x86Only?: boolean;
      /** False when the upstream server does not advertise `callgraph`. */
      readonly callGraphAvailable?: boolean;
      /** False when the upstream server does not advertise `survey_binary`. */
      readonly surveyAvailable?: boolean;
      /** The program identity REA admitted, reported by `list_documents`. */
      readonly admittedDocument?: string;
    } = {},
  ) {}

  async call(
    tool: string,
    args: Readonly<Record<string, JsonValue>>,
  ): Promise<JsonValue> {
    if (this.options.signal?.aborted)
      throw new AnalysisCancelledError(tool, {
        cause: this.options.signal.reason,
      });
    const scoped =
      this.database === undefined ? args : { ...args, database: this.database };
    const result = await this.connection.call(tool, scoped, {
      signal: this.options.signal,
    });
    this.raw.push({ tool, arguments: scoped, result });
    if (this.options.signal?.aborted)
      throw new AnalysisCancelledError(tool, {
        cause: this.options.signal.reason,
      });
    return result;
  }

  async functions(): Promise<IdaFunction[]> {
    const result: IdaFunction[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const current: number = offset;
      const value: z.infer<typeof legacyPageSchema> | undefined =
        this.protocol === "legacy"
          ? legacyPageSchema.parse(
              await this.call("list_functions", { offset, count: 100 }),
            )
          : modernPageSchema.parse(
              await this.call("list_funcs", {
                queries: { offset, count: 100 },
              }),
            )[0];
      if (value === undefined)
        throw new AnalysisProtocolError("IDA MCP omitted its function page.");
      result.push(...value.data.map((fn) => idaFunctionSchema.parse(fn)));
      offset = nextPageOffset(value.next_offset, current);
    }
    return result;
  }

  /**
   * Resolves a procedure. When `requestedBy` names the caller's operation, an
   * upstream "not found" or "not a function" answer is reported as invalid
   * input; every other failed lookup stays a producer fault. `run()` passes
   * `requestedBy` only for caller-supplied selectors. Provider-derived
   * selectors, such as the addresses composed workflows revisit, and the
   * callee resolution inside `relationships()` pass none, because those
   * addresses were reported by IDA itself.
   */
  async resolve(query: string, requestedBy?: string): Promise<IdaFunction> {
    if (query.startsWith("file-offset:"))
      throw new AnalysisInputError(
        requestedBy ?? "procedure_address",
        undefined,
        [
          {
            path: ["procedure"],
            reason: "invalid_value",
            message:
              "IDA does not support file-offset: procedure selectors. Select Ghidra for source-file coordinates or supply an IDA analysis address or exact procedure name.",
          },
        ],
      );
    if (this.protocol !== "legacy") {
      const item = modernLookupSchema.parse(
        await this.call("lookup_funcs", { queries: [query] }),
      )[0];
      return this.lookupFunction(query, item, requestedBy);
    }
    const address = idaAddressSchema.safeParse(
      /^0x/iu.test(query) ? query : undefined,
    );
    const found = idaFunctionSchema.parse(
      await this.call(
        address.success ? "get_function_by_address" : "get_function_by_name",
        address.success ? { address: address.data } : { name: query },
      ),
    );
    // Legacy producers may echo an interior query or call site in address.
    // Resolve the reported symbol again to obtain its actual entry, never infer from size.
    const entry = idaFunctionSchema.parse(
      await this.call("get_function_by_name", { name: found.name }),
    );
    if (entry.name !== found.name)
      throw new AnalysisProtocolError(
        "IDA function identity changed during lookup.",
      );
    return entry;
  }

  /** Parse one lookup row: a function, an expected "missing" answer, or a producer failure. */
  private lookupOutcome(
    query: string,
    item: z.infer<typeof modernLookupBatchSchema>[number] | undefined,
  ): { readonly fn: IdaFunction } | { readonly missing: string } {
    if (item?.query !== query)
      throw new AnalysisProtocolError(
        `IDA function lookup answered for a different query than ${JSON.stringify(query)}.`,
      );
    if (
      item.fn === null &&
      item.error !== null &&
      MISSING_PROCEDURE_ANSWERS.has(item.error)
    )
      return { missing: item.error };
    if (item.fn === null || item.error !== null)
      throw new AnalysisProtocolError(
        `IDA function lookup failed for ${query}: ${item.error ?? "missing function"}`,
      );
    return { fn: item.fn };
  }

  private lookupFunction(
    query: string,
    item: z.infer<typeof modernLookupBatchSchema>[number] | undefined,
    requestedBy?: string,
  ): IdaFunction {
    const outcome = this.lookupOutcome(query, item);
    if ("fn" in outcome) return outcome.fn;
    if (requestedBy === undefined)
      throw new AnalysisProtocolError(
        `IDA function lookup failed for ${query}: ${outcome.missing}`,
      );
    throw new AnalysisInputError(
      requestedBy,
      {
        cause: new AnalysisProtocolError(
          `IDA function lookup failed for ${query}: ${outcome.missing}`,
        ),
      },
      [
        {
          path: [],
          reason: "invalid_value",
          message: `IDA could not resolve procedure ${JSON.stringify(query)}: ${outcome.missing}.`,
        },
      ],
    );
  }

  /** The containing function of an address, or why none contains it. */
  private async containingProcedure(address: string): Promise<JsonValue> {
    const item = modernLookupSchema.parse(
      await this.call("lookup_funcs", { queries: [address] }),
    )[0];
    const outcome = this.lookupOutcome(address, item);
    if ("fn" in outcome)
      return {
        query_address: address,
        found: true,
        procedure: identity(outcome.fn),
      };
    return {
      query_address: address,
      found: false,
      procedure: null,
      reason: (await this.addressInSegment(address))
        ? "not_in_procedure"
        : "outside_segments",
    };
  }

  /** Segment membership from the database-scoped minimal survey; a missing fact is a failure. */
  private async addressInSegment(address: string): Promise<boolean> {
    if (this.options.surveyAvailable === false)
      throw new AnalysisProtocolError(
        "The upstream server does not advertise survey_binary, so segment membership cannot be established.",
      );
    const { segments } = surveySegmentsSchema.parse(
      await this.call("survey_binary", { detail_level: "minimal" }),
    );
    const value = BigInt(address);
    return segments.some(({ start, end }) => start <= value && value < end);
  }

  /** True only for modern callee reads on targets not proven x86-only; x86 reads never reach the graph code. */
  private readsCallGraph(direction: "callers" | "callees"): boolean {
    return (
      this.protocol === "modern" &&
      direction === "callees" &&
      this.options.x86Only === false
    );
  }

  /** Add processor-neutral function callees on targets where upstream `callees` is unsound. */
  private async addCallGraphCallees(
    fn: IdaFunction,
    result: Map<string, ReturnType<typeof identity>>,
  ): Promise<RelationshipCoverage> {
    const graph =
      this.options.callGraphAvailable === false
        ? unavailableCallGraph("the upstream server does not advertise it")
        : await readCallGraphCallees(
            (tool, args) => this.call(tool, args),
            fn.address,
          );
    this.limitations.push(...graph.limitations);
    for (const callee of graph.callees)
      if (!result.has(callee.address))
        result.set(callee.address, identity(callee));
    return graph.coverage;
  }

  async strings(
    nativePattern?: string,
  ): Promise<{ address: string; value: string }[]> {
    if (this.protocol === "native")
      this.limitations.push(IDA_NATIVE_STRING_LIMITATION);
    const result: { address: string; value: string }[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const current: number = offset;
      if (this.protocol === "legacy") {
        const page = legacyPageSchema.parse(
          await this.call("list_strings", { offset, count: 0 }),
        );
        for (const item of page.data) {
          const s = legacyStringSchema.parse(item);
          result.push({ address: s.address, value: s.string });
        }
        offset = nextPageOffset(page.next_offset, current);
      } else {
        const page = idaStringsPageSchema.parse(
          await this.call("find_regex", {
            pattern:
              this.protocol === "native"
                ? (nativePattern ?? "[\\s\\S]*")
                : "(?s).*",
            offset,
            limit: 100,
          }),
        );
        if (page.error !== undefined && page.error !== null)
          throw new AnalysisProtocolError(
            `${this.protocol === "native" ? "Native IDA" : "IDA"} string search failed: ${page.error}`,
          );
        result.push(
          ...page.matches.map((s) => ({ address: s.addr, value: s.string })),
        );
        offset = nextOffset(page.cursor, current);
      }
    }
    return result;
  }

  async assembly(fn: IdaFunction): Promise<IdaDisassembly> {
    if (this.protocol === "legacy") {
      const result = disassemblySchema.parse(
        await this.call("disassemble_function", { start_address: fn.address }),
      );
      this.verifyAssembly(fn, result);
      return result;
    }
    let result: IdaDisassembly | undefined;
    let offset: number | null = 0;
    while (offset !== null) {
      const page = (
        this.protocol === "native"
          ? nativeDisassemblySchema
          : modernDisassemblySchema
      ).parse(
        await this.call("disasm", {
          addr: fn.address,
          offset,
          max_instructions: 100,
        }),
      );
      if (page.asm === null || page.error !== undefined)
        throw new AnalysisProtocolError(
          `IDA disassembly failed: ${page.error ?? "missing assembly"}`,
        );
      this.verifyAssembly(fn, page.asm);
      if (result === undefined) result = page.asm;
      else result.lines.push(...page.asm.lines);
      offset = nextOffset(page.cursor, offset);
    }
    if (result === undefined)
      throw new AnalysisProtocolError("IDA omitted assembly.");
    return result;
  }

  private verifyAssembly(fn: IdaFunction, asm: IdaDisassembly): void {
    if (asm.start_ea !== fn.address || asm.name !== fn.name)
      throw new AnalysisProtocolError(
        "IDA disassembly identifies a different function than the resolved entry.",
      );
  }

  async pseudocode(fn: IdaFunction): Promise<string | null> {
    if (this.protocol === "legacy")
      return z
        .string()
        .nullable()
        .parse(await this.call("decompile_function", { address: fn.address }));
    if (this.protocol === "native") {
      const page = nativeDecompileSchema.parse(
        await this.call("decompile", { addr: fn.address }),
      );
      if (page.addr !== fn.address)
        throw new AnalysisProtocolError(
          "Native IDA pseudocode identifies a different function than the resolved entry.",
        );
      if (!page.ok || page.error !== undefined || page.pseudocode === undefined)
        throw new AnalysisProtocolError(
          `Native IDA decompilation failed: ${page.error ?? "missing pseudocode"}`,
        );
      this.limitations.push(
        "Native pseudocode is rendered GUI text; the upstream viewer traversal is bounded and does not establish complete source recovery.",
      );
      return page.pseudocode;
    }
    const result: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = modernDecompileSchema.parse(
        await this.call("decompile", {
          addr: fn.address,
          offset,
          max_lines: 100,
        }),
      );
      if (page.code === null || page.error !== undefined)
        throw new AnalysisProtocolError(
          `IDA decompilation failed: ${page.error ?? "missing code"}`,
        );
      result.push(page.code);
      offset = nextOffset(page.cursor, offset);
    }
    return result.join("\n");
  }

  async xrefs(
    address: string,
  ): Promise<
    { address: string; type: string; function: IdaFunction | null }[]
  > {
    if (this.protocol === "legacy")
      return legacyXrefsSchema.parse(
        await this.call("get_xrefs_to", { address }),
      );
    const page = (
      this.protocol === "native" ? nativeXrefsSchema : modernXrefsSchema
    ).parse(await this.call("xrefs_to", { addrs: [address], limit: 1000 }))[0];
    if (page?.xrefs == null || page.error !== undefined)
      throw new AnalysisProtocolError(
        `IDA xrefs failed: ${page?.error ?? "missing references"}`,
      );
    if (page.more !== undefined) this.referencesTruncated = page.more;
    if (page.more === true)
      this.limitations.push(
        "Upstream xrefs_to capped results at 1000 references; additional references remain unknown.",
      );
    return page.xrefs.map((xref) => ({
      address: xref.addr,
      type: xref.type,
      function: xref.fn,
    }));
  }

  async relationships(
    fn: IdaFunction,
    direction: "callers" | "callees",
  ): Promise<IdaRelationships> {
    const queries: string[] = [];
    const result = new Map<string, ReturnType<typeof identity>>();
    let coverage: RelationshipCoverage = {
      status: "unknown",
      reason: "The legacy relationship response does not report coverage.",
    };
    if (this.readsCallGraph(direction)) {
      coverage = await this.addCallGraphCallees(fn, result);
      return {
        items: [...result.values()],
        coverage,
        availability:
          coverage.status === "unknown"
            ? { available: false, reason: coverage.reason }
            : { available: true },
      };
    }
    if (this.protocol === "legacy") {
      const value = await this.call(
        direction === "callers" ? "get_callers" : "get_callees",
        { function_address: fn.address },
      );
      const items =
        direction === "callers"
          ? z.array(idaFunctionSchema).parse(value)
          : legacyCalleesSchema.parse(value);
      for (const item of items) {
        if ("type" in item && item.type === "external")
          result.set(item.address, identity(item));
        else queries.push(item.name);
      }
    } else if (direction === "callers") {
      this.limitations.push(
        "Upstream xrefs classify references as code or data, without proving call edges. Direct callers are unavailable in this profile.",
      );
      return {
        items: [],
        availability: {
          available: false,
          reason:
            "Upstream xrefs do not establish direct caller relationships.",
        },
        coverage: {
          status: "unknown",
          reason:
            "Upstream xrefs do not establish direct caller relationships.",
        },
      };
    } else {
      const page = (
        this.protocol === "native" ? nativeCalleesSchema : modernCalleesSchema
      ).parse(
        await this.call("callees", { addrs: [fn.address], limit: 500 }),
      )[0];
      if (page?.callees == null || page.error !== undefined)
        throw new AnalysisProtocolError(
          `IDA callees failed: ${page?.error ?? "missing callees"}`,
        );
      if (page.more === true)
        this.limitations.push(
          "Upstream callees capped results at 500; additional callees remain unknown.",
        );
      coverage =
        page.more === true
          ? {
              status: "partial",
              limitations: [
                "Upstream callees capped results at 500; additional callees remain unknown.",
              ],
            }
          : page.more === false
            ? { status: "complete" }
            : {
                status: "unknown",
                reason:
                  "Upstream callees omitted an explicit truncation marker; additional callees remain unknown.",
              };
      for (const item of page.callees) {
        if ("type" in item && item.type === "external")
          result.set(
            item.addr,
            identity({ address: item.addr, name: item.name }),
          );
        else queries.push(item.addr);
      }
    }
    const querySet = new Set(queries);
    if (this.protocol !== "legacy" && querySet.size > 0) {
      const rows = modernLookupBatchSchema.parse(
        await this.call("lookup_funcs", { queries: [...querySet] }),
      );
      const byQuery = new Map(rows.map((row) => [row.query, row]));
      if (
        rows.length !== querySet.size ||
        byQuery.size !== rows.length ||
        rows.some((row) => !querySet.has(row.query))
      )
        throw new AnalysisProtocolError(
          "IDA returned an inconsistent callee lookup batch.",
        );
      for (const query of querySet) {
        const resolved = identity(
          this.lookupFunction(query, byQuery.get(query)),
        );
        result.set(resolved.address, resolved);
      }
    } else {
      for (const query of querySet) {
        const resolved = identity(await this.resolve(query));
        result.set(resolved.address, resolved);
      }
    }
    return {
      items: [...result.values()],
      coverage,
      availability: { available: true },
    };
  }

  private async searchItems<T extends { readonly value: string }>(
    operation: IdaOperation,
    items: T[],
    query: AnalysisSearchQuery | undefined,
  ): Promise<T[]> {
    if (query === undefined) return items;
    if (query.mode === "literal") {
      const matches = analysisSearchPredicate(query);
      return items.filter(({ value }) => matches(value));
    }
    this.limitations.push(
      launchRegexMatchingLimitation(
        this.options.regexMatchingDeadline,
        this.options.regexWorkerHeapRequest,
      ),
    );
    const matched = await matchRegexValues({
      operation,
      pattern: query.pattern,
      caseSensitive: query.case_sensitive,
      values: items.map(({ value }) => value),
      deadline: this.options.regexMatchingDeadline,
      heapRequest: this.options.regexWorkerHeapRequest,
      signal: this.options.signal,
    });
    if (!matched.ok) throw matched.error;
    const indices = new Set(matched.value);
    return items.filter((_, index) => indices.has(index));
  }

  async run(
    operation: IdaOperation,
    parameters: Readonly<Record<string, JsonValue>>,
  ): Promise<JsonValue> {
    const query =
      operation === "search_procedures" || operation === "search_strings"
        ? analysisSearchQuerySchema.parse(parameters)
        : undefined;
    if (operation === "list_procedures" || operation === "search_procedures") {
      const items = (await this.functions()).map((fn) => ({
        address: fn.address,
        value: fn.name,
      }));
      return this.searchItems(operation, items, query);
    }
    if (operation === "list_strings" || operation === "search_strings") {
      const selectedAddress =
        query === undefined && parameters.address !== undefined
          ? idaAddressSchema.parse(parameters.address)
          : undefined;
      const nativePattern =
        this.protocol === "native" && query?.mode === "literal"
          ? nativeLiteralSearchPattern(query.pattern, query.case_sensitive)
          : undefined;
      const items = await this.strings(nativePattern);
      return query !== undefined
        ? this.searchItems(operation, items, query)
        : selectedAddress === undefined
          ? items
          : items.filter(({ address }) => address === selectedAddress);
    }
    if (operation === "list_documents") {
      if (this.options.admittedDocument === undefined)
        throw new AnalysisProtocolError("The admitted IDA program is unknown.");
      return [this.options.admittedDocument];
    }
    if (operation === "resolve_containing_procedure") {
      const queried = idaAddressSchema.parse(parameters.address);
      this.locations.push({ kind: "address", address: queried });
      return this.containingProcedure(queried);
    }
    if (operation === "xrefs") {
      const inspectedAddress = idaAddressSchema.parse(parameters.address);
      this.locations.push({ kind: "address", address: inspectedAddress });
      return (await this.xrefs(inspectedAddress)).map(({ address }) => address);
    }
    const fn = await this.resolve(
      z.string().min(1).parse(parameters.procedure),
      this.options.selectorOrigin === "provider" ? undefined : operation,
    );
    this.locations.push({ kind: "address", address: fn.address });
    switch (operation) {
      case "procedure_address":
        return fn.address;
      case "procedure_pseudo_code":
        return this.pseudocode(fn);
      case "procedure_assembly":
        return lines(await this.assembly(fn)).join("\n");
      case "procedure_callers":
      case "procedure_callees": {
        if (operation === "procedure_callers" && this.protocol !== "legacy")
          throw new AnalysisProtocolError(
            "This IDA MCP profile cannot distinguish direct callers from other code references.",
          );
        const relationships = await this.relationships(
          fn,
          operation === "procedure_callers" ? "callers" : "callees",
        );
        this.relationshipCoverage = relationships.coverage;
        return relationships.items.map(({ address }) => address);
      }
      case "read_function_instructions":
        return functionInstructionWindowSchema.parse({
          procedure: identity(fn),
          instructions: lines(await this.assembly(fn)),
          limitations: IDA_LIMITATIONS,
        });
      case "analyze_function":
        return this.dossier(fn);
    }
  }

  private async dossier(fn: IdaFunction): Promise<JsonValue> {
    const asm = await this.assembly(fn);
    const pseudocode = await this.pseudocode(fn);
    const callers = await this.relationships(fn, "callers");
    const callees = await this.relationships(fn, "callees");
    this.relationshipCoverage = combineFunctionRelationshipCoverage(
      callers.coverage,
      callees.coverage,
    );
    const signature =
      asm.return_type == null || asm.arguments == null
        ? null
        : `${asm.return_type} ${fn.name}(${asm.arguments.map((arg) => `${arg.type} ${arg.name}`).join(", ")})`;
    return functionDossierSchema.parse({
      procedure: { ...identity(fn), signature, locals: [] },
      pseudocode: pseudocode ?? "",
      assembly: lines(asm),
      comments: [],
      callers: callers.items,
      callees: callees.items,
      incoming_references: [],
      outgoing_references: [],
      referenced_strings: [],
      referenced_names: [],
      basic_blocks: [],
      native_api: null,
      native_value_flow: null,
      facet_availability: {
        pseudocode:
          pseudocode === null
            ? { available: false, reason: "IDA did not supply pseudocode." }
            : { available: true },
        assembly: { available: true },
        comments: {
          available: false,
          reason: "IDA adapter does not expose typed comments.",
        },
        callers: callers.availability,
        callees: callees.availability,
        references: {
          available: false,
          reason: "IDA adapter does not expose typed reference edges.",
        },
        strings_names: {
          available: false,
          reason:
            "IDA adapter does not expose function-referenced strings and names.",
        },
        cfg: {
          available: false,
          reason: "IDA adapter does not expose basic blocks.",
        },
      },
      limitations: [
        ...IDA_LIMITATIONS,
        ...this.limitations,
        "Stack frame records are not evidence of source locals. Rendered comments do not identify regular versus inline origin.",
        ...(pseudocode === null ? ["Pseudocode is unavailable."] : []),
      ],
    });
  }
}
