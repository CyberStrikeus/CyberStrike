import { Client, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Help } from "incur";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { createCatalogIdentity } from "./catalogIdentity.js";
import { jsonLinesErrorRecord } from "./cli/jsonLines.js";
import {
  CLI_DOCUMENT_OUTPUT_FORMATS,
  missingCliOutputValueMessage,
  renderCliDocument,
} from "./cliOutput.js";
import {
  compactPresentationForMcpInputSchemaProfile,
  parseMcpInputSchemaProfile,
} from "./config/mcpInputSchemaProfile.js";
import { parseMcpOutputSchemaProfile } from "./config/mcpOutputSchemaProfile.js";
import { parseMcpToolFamilies } from "./config/mcpToolFamilies.js";
import { contractsForToolFamilies } from "./contracts/toolFamilies.js";
import { promptsForToolFamilies } from "./contracts/promptToolFamilyScope.js";
import { err, ok } from "./domain/result.js";
import { PRODUCT_IDENTITY } from "./identity.js";
import {
  parseMcpStartupBudgets,
  type McpPhaseBudget,
} from "./config/mcpStartupBudgets.js";
import {
  MCP_STARTUP_POLICY,
  mcpDoctorDeadlineRecovery,
} from "./mcpStartupPolicy.js";
import { MCP_DOCTOR_ALIAS, MCP_DOCTOR_OPTIONS } from "./mcpDoctorOptions.js";

const OUTPUT_FORMATS = CLI_DOCUMENT_OUTPUT_FORMATS;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const MCP_DOCTOR_COMMAND = "rea mcp doctor";
const MCP_DOCTOR_DESCRIPTION = "Validate MCP adapter startup and tool listing";
const MCP_DOCTOR_SCOPE =
  "Checks this REA adapter using the current runtime; does not verify a client's registered command or launch environment.";

/** Help flags derived from `MCP_DOCTOR_OPTIONS` plus its alias. */
const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);

/**
 * Answer an advertised help request without starting a diagnostic session.
 * Global options are hidden because this dispatcher entry accepts only the
 * options above; the hint says so explicitly instead of implying full
 * Incur parity.
 */
const renderMcpDoctorHelp = (): string =>
  Help.formatCommand(MCP_DOCTOR_COMMAND, {
    description: MCP_DOCTOR_DESCRIPTION,
    hideGlobalOptions: true,
    options: MCP_DOCTOR_OPTIONS,
    alias: MCP_DOCTOR_ALIAS,
    hint: `${MCP_DOCTOR_SCOPE} This entry accepts only the options above.`,
  });

interface McpDoctorOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly deadlineMs?: number;
}

interface InventoryComparison {
  readonly expected: number;
  readonly observed: number;
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
  readonly duplicates: readonly string[];
}

interface McpDoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Diagnose the actual production stdio adapter with one startup-bounded SDK session. */
export const runProductionMcpDoctor = async (options: McpDoctorOptions) => {
  const parsedBudgets = parseMcpStartupBudgets(options.environment);
  if (!parsedBudgets.ok)
    return {
      healthy: false as const,
      adapter: "production-stdio" as const,
      server: null,
      inventory: null,
      identity: null,
      request_flow: {
        tool: "binary_session" as const,
        ok: false as const,
      },
      checks: parsedBudgets.error.settings.map((issue) => ({
        name: issue.setting,
        ok: false as const,
        detail: issue.constraint,
      })),
      diagnostics: {
        stderr: "",
        stderr_bytes: 0,
        stderr_truncated: false,
      },
    };
  const expectation = doctorExpectationForEnvironment(options.environment);
  const budget = appliedDoctorBudget(
    parsedBudgets.value.doctor,
    options.deadlineMs,
  );
  const budgetMs = budget.milliseconds;
  const deadline = performance.now() + budgetMs;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Production MCP doctor deadline expired")),
    Math.max(1, Math.ceil(deadline - performance.now())),
  );
  const stderr = captureStderr();
  const transport = new OwnedStdioClientTransport({
    command: options.command,
    args: [...options.args],
    cwd: options.cwd,
    env: targetFreeEnvironment(options.environment),
    stderr: "pipe",
  });
  transport.stderr?.on("data", stderr.append);
  const client = new Client({ name: "rea-mcp-doctor", version: "1" });
  let result: ProductionMcpDoctorResult;
  let cleanupFailure: { readonly cause: unknown } | undefined;
  try {
    await client.connect(
      transport,
      requestOptions(deadline, controller.signal),
    );
    result = await inspectProductionMcpSession(
      client,
      deadline,
      controller.signal,
      expectation,
      budget,
    );
  } catch (cause: unknown) {
    result = {
      healthy: false,
      adapter: "production-stdio" as const,
      server: null,
      inventory: null,
      identity: null,
      request_flow: { tool: "binary_session", ok: false },
      checks: [
        {
          name: "transport",
          ok: false,
          detail: doctorTransportDetail(cause, budget, controller.signal),
        },
      ],
    };
  } finally {
    clearTimeout(timer);
    try {
      await client.close();
    } catch (cause: unknown) {
      cleanupFailure = { cause };
    }
    try {
      // An interrupted connect can clear the client's transport reference
      // before its startup child is closed. The transport retains that child.
      await transport.close();
    } catch (cause: unknown) {
      cleanupFailure = {
        cause:
          cleanupFailure === undefined || cleanupFailure.cause === cause
            ? cause
            : new AggregateError(
                [cleanupFailure.cause, cause],
                `MCP client and transport cleanup failed: ${errorMessage(cleanupFailure.cause)}; ${errorMessage(cause)}`,
              ),
      };
    }
  }
  if (cleanupFailure !== undefined)
    result = {
      ...result,
      healthy: false,
      checks: [
        ...result.checks,
        {
          name: "cleanup",
          ok: false,
          detail: `MCP stdio cleanup failed: ${errorMessage(cleanupFailure.cause)}`,
        },
      ],
    };
  return { ...result, diagnostics: stderr.value() };
};

type ProductionMcpDoctorResult =
  | Awaited<ReturnType<typeof inspectProductionMcpSession>>
  | {
      readonly healthy: false;
      readonly adapter: "production-stdio";
      readonly server: null;
      readonly inventory: null;
      readonly identity: null;
      readonly request_flow: {
        readonly tool: "binary_session";
        readonly ok: false;
      };
      readonly checks: readonly McpDoctorCheck[];
    };

/** Join SDK-triggered and caller-triggered close calls for the same child. */
class OwnedStdioClientTransport extends StdioClientTransport {
  #closePromise: Promise<void> | undefined;

  override close(): Promise<void> {
    this.#closePromise ??= super.close();
    return this.#closePromise;
  }
}

/** A valid scope can intentionally omit the target-free session request. */
export const MCP_DOCTOR_SESSION_SCOPE_DETAIL =
  "binary_session is outside the selected tool families; include the session family for request-flow and identity checks";

/** Doctor expectations derived from the same environment the child inherits. */
interface DoctorCatalogExpectation {
  readonly catalog: ReturnType<typeof createCatalogIdentity>;
  readonly expectedToolNames: readonly string[];
  readonly expectedPromptNames: readonly string[];
}

const inspectProductionMcpSession = async (
  client: Client,
  deadline: number,
  signal: AbortSignal,
  expectation: DoctorCatalogExpectation,
  budget: McpPhaseBudget,
) => {
  const request = requestOptions(deadline, signal);
  const [tools, prompts] = await Promise.all([
    client.listTools(undefined, request),
    client.listPrompts(undefined, request),
  ]);
  const sessionTool = tools.tools.find(({ name }) => name === "binary_session");
  // A scope without the session family cannot serve request flow at all;
  // every other case still probes the call so the report names the real cause.
  const requestFlow = expectation.expectedToolNames.includes("binary_session")
    ? await client
        .callTool(
          { name: "binary_session", arguments: {} },
          {
            ...requestOptions(deadline, signal),
            ...(sessionTool === undefined
              ? {}
              : { toolDefinition: sessionTool }),
          },
        )
        .then(ok, (cause: unknown) =>
          err({
            kind: "request-flow" as const,
            detail: doctorTransportDetail(cause, budget, signal),
          }),
        )
    : err({
        kind: "request-flow" as const,
        detail: MCP_DOCTOR_SESSION_SCOPE_DETAIL,
      });
  const inventory = {
    tools: compareInventory(
      expectation.expectedToolNames,
      tools.tools.map(({ name }) => name),
    ),
    prompts: compareInventory(
      expectation.expectedPromptNames,
      prompts.prompts.map(({ name }) => name),
    ),
  };
  const observedIdentity = parseIdentityToolResult(
    requestFlow.ok ? requestFlow.value.structuredContent : undefined,
  );
  const { catalog } = expectation;
  const serverVersion = client.getServerVersion();
  const protocolVersion = client.getNegotiatedProtocolVersion();
  const checks: McpDoctorCheck[] = [
    {
      name: "initialize",
      ok:
        serverVersion?.name === PRODUCT_IDENTITY.mcpServerKey &&
        serverVersion.version === PRODUCT_IDENTITY.packageVersion &&
        protocolVersion !== undefined,
      detail: `${serverVersion?.name ?? "unknown"}@${serverVersion?.version ?? "unknown"}; protocol=${protocolVersion ?? "unknown"}`,
    },
    ...Object.entries(inventory).map(([name, comparison]) =>
      inventoryCheck(name, comparison),
    ),
    {
      name: "server-identity",
      ok:
        observedIdentity.packageVersion === PRODUCT_IDENTITY.packageVersion &&
        observedIdentity.catalogDigest === catalog.digests.combined_sha256,
      detail: `package=${observedIdentity.packageVersion ?? "missing"}; catalog=${observedIdentity.catalogDigest ?? "missing"}`,
    },
    {
      name: "request-flow",
      ok: requestFlow.ok && requestFlow.value.isError !== true,
      detail: requestFlow.ok
        ? "binary_session target-free request"
        : requestFlow.error.detail,
    },
  ];
  return {
    healthy: checks.every(({ ok }) => ok),
    adapter: "production-stdio" as const,
    server: {
      name: serverVersion?.name ?? null,
      version: serverVersion?.version ?? null,
      protocol_version: protocolVersion ?? null,
    },
    inventory,
    identity: {
      expected_package_version: PRODUCT_IDENTITY.packageVersion,
      observed_package_version: observedIdentity.packageVersion,
      expected_catalog_digest: catalog.digests.combined_sha256,
      observed_catalog_digest: observedIdentity.catalogDigest,
    },
    request_flow: {
      tool: "binary_session",
      ok: requestFlow.ok && requestFlow.value.isError !== true,
    },
    checks,
  };
};

/**
 * Dispatcher entry for `rea mcp doctor`, kept separate from Incur MCP setup.
 * @public
 */
export const runProductionMcpDoctorCli = async (
  arguments_: readonly string[],
  input: {
    readonly dispatcherPath: string;
    readonly packageRoot: string;
    readonly stdoutIsTerminal: boolean;
  },
): Promise<{ readonly output: string; readonly exitCode: number }> => {
  const started = performance.now();
  const parsed = parseOutputArguments(arguments_);
  if (!parsed.ok) {
    if (parsed.help)
      return { output: `${renderMcpDoctorHelp()}\n`, exitCode: 0 };
    return {
      output: renderCliDocument(
        parsed.format === "jsonl"
          ? jsonLinesErrorRecord({ code: parsed.code, message: parsed.message })
          : { code: parsed.code, message: parsed.message },
        parsed.format,
        input.stdoutIsTerminal,
      ),
      exitCode: 1,
    };
  }
  const report = await runProductionMcpDoctor({
    command: process.execPath,
    args: [resolve(input.dispatcherPath), "mcp"],
    cwd: input.packageRoot,
    environment: process.env,
  });
  const result = { ...report, scope: MCP_DOCTOR_SCOPE };
  const outputValue = parsed.fullOutput
    ? {
        ok: result.healthy,
        ...(result.healthy ? { data: result } : { error: result }),
        meta: {
          command: MCP_DOCTOR_COMMAND,
          duration: `${Math.round(performance.now() - started)}ms`,
        },
      }
    : result;
  return {
    output: renderCliDocument(
      parsed.format === "jsonl" && !result.healthy
        ? jsonLinesErrorRecord(outputValue)
        : outputValue,
      parsed.format,
      input.stdoutIsTerminal,
    ),
    exitCode: result.healthy ? 0 : 1,
  };
};

/** Compare exact names while retaining actionable mismatch locations. */
export const compareInventory = (
  expectedNames: readonly string[],
  observedNames: readonly string[],
): InventoryComparison => {
  const expected = new Set(expectedNames);
  const observed = new Set(observedNames);
  return {
    expected: expectedNames.length,
    observed: observedNames.length,
    missing: [...expected].filter((name) => !observed.has(name)).sort(),
    unexpected: [...observed].filter((name) => !expected.has(name)).sort(),
    duplicates: [...observed]
      .filter(
        (name) =>
          observedNames.filter((candidate) => candidate === name).length > 1,
      )
      .sort(),
  };
};

const inventoryCheck = (
  name: string,
  comparison: InventoryComparison,
): McpDoctorCheck => ({
  name: `inventory:${name}`,
  ok:
    comparison.expected === comparison.observed &&
    comparison.missing.length === 0 &&
    comparison.unexpected.length === 0 &&
    comparison.duplicates.length === 0,
  detail: `expected=${String(comparison.expected)} observed=${String(comparison.observed)} missing=${comparison.missing.join(",") || "none"} unexpected=${comparison.unexpected.join(",") || "none"} duplicates=${comparison.duplicates.join(",") || "none"}`,
});

const parseIdentityToolResult = (
  input: unknown,
): {
  readonly packageVersion: string | null;
  readonly catalogDigest: string | null;
} => {
  if (!isRecord(input) || !isRecord(input.result))
    return { packageVersion: null, catalogDigest: null };
  const identity = input.result.server_identity;
  if (!isRecord(identity)) return { packageVersion: null, catalogDigest: null };
  const packageIdentity = identity.package;
  const catalog = identity.catalog;
  const digests = isRecord(catalog) ? catalog.digests : undefined;
  return {
    packageVersion:
      isRecord(packageIdentity) && typeof packageIdentity.version === "string"
        ? packageIdentity.version
        : null,
    catalogDigest:
      isRecord(digests) && typeof digests.combined_sha256 === "string"
        ? digests.combined_sha256
        : null,
  };
};

/**
 * Parsed `rea mcp doctor` arguments, including a help request. The `help`
 * variant is the only success-independent early return; every other accepted
 * flag is an output selector declared in `MCP_DOCTOR_OPTIONS`.
 */
type McpDoctorArguments =
  | {
      readonly ok: true;
      readonly format: OutputFormat;
      readonly fullOutput: boolean;
    }
  | { readonly ok: false; readonly help: true }
  | {
      readonly ok: false;
      readonly help: false;
      readonly format: OutputFormat;
      readonly code: "MISSING_OUTPUT_VALUE" | "VALIDATION_ERROR";
      readonly message: string;
    };

const parseOutputArguments = (
  arguments_: readonly string[],
): McpDoctorArguments => {
  // Help wins over output selection and validation errors, but only when it
  // appears in option position. A token consumed as `--format`'s value is
  // not a flag, so `--format --help` reports an invalid format instead of
  // masking the typo with usage.
  if (hasHelpInOptionPosition(arguments_)) return { ok: false, help: true };
  let format: OutputFormat = "toon";
  let fullOutput = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--json") {
      format = "json";
      continue;
    }
    const inline = argument?.startsWith("--format=")
      ? argument.slice("--format=".length)
      : undefined;
    if (argument === "--format" || inline !== undefined) {
      const candidate = inline ?? arguments_[index + 1];
      if (inline === undefined) index += 1;
      if (candidate === undefined || candidate === "")
        return {
          ok: false,
          help: false,
          format,
          code: "MISSING_OUTPUT_VALUE",
          message: missingCliOutputValueMessage("--format"),
        };
      if (!isOutputFormat(candidate))
        return {
          ok: false,
          help: false,
          format,
          code: "VALIDATION_ERROR",
          message: `Invalid output format: ${candidate}`,
        };
      format = candidate;
      continue;
    }
    if (argument === "--full-output") {
      fullOutput = true;
      continue;
    }
    if (HELP_FLAGS.has(argument ?? "")) return { ok: false, help: true };
    return {
      ok: false,
      help: false,
      format,
      code: "VALIDATION_ERROR",
      message: `Unknown mcp doctor option: ${argument ?? "missing"}`,
    };
  }
  return { ok: true, format, fullOutput };
};

/**
 * Report whether `--help`/`-h` appears in option position. Tokens consumed
 * as `--format`'s value are skipped so `--format --help` stays an invalid
 * format error instead of silently becoming a help request.
 */
const hasHelpInOptionPosition = (arguments_: readonly string[]): boolean => {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--format") {
      index += 1;
      continue;
    }
    if (HELP_FLAGS.has(argument ?? "")) return true;
  }
  return false;
};

const isOutputFormat = (value: string | undefined): value is OutputFormat =>
  OUTPUT_FORMATS.some((candidate) => candidate === value);

const requestOptions = (deadline: number, signal: AbortSignal) => ({
  signal,
  timeout: Math.max(1, Math.ceil(deadline - performance.now())),
});

const targetFreeEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const result = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  for (const name of [
    "HOPPER_TARGET_PATH",
    "HOPPER_TARGET_KIND",
    "HOPPER_LOADER_ARGS_JSON",
  ])
    delete result[name];
  return result;
};

const doctorExpectationForEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): DoctorCatalogExpectation => {
  const inputProfile = parseMcpInputSchemaProfile(
    environment.REA_MCP_INPUT_SCHEMA_PROFILE,
  );
  const outputProfile = parseMcpOutputSchemaProfile(
    environment.REA_MCP_OUTPUT_SCHEMA_PROFILE,
  );
  // An invalid selection fails child startup, which the transport check
  // reports with the server's diagnostics; expect the complete catalog so a
  // failed start is never mistaken for a scope mismatch.
  const families = parseMcpToolFamilies(environment.REA_MCP_TOOL_FAMILIES);
  const selection =
    families.ok && families.value !== undefined
      ? new Set(families.value)
      : undefined;
  const contracts = contractsForToolFamilies(selection);
  const promptContracts = promptsForToolFamilies(selection);
  return {
    catalog: createCatalogIdentity({
      compactPresentation: compactPresentationForMcpInputSchemaProfile(
        inputProfile.ok ? inputProfile.value : undefined,
      ),
      contracts,
      outputSchemaProfile: outputProfile.ok
        ? (outputProfile.value ?? "full")
        : "full",
      promptContracts,
    }),
    expectedToolNames: contracts.map(({ name }) => name),
    expectedPromptNames: promptContracts.map(({ name }) => name),
  };
};

const captureStderr = () => {
  const retained = Buffer.allocUnsafe(MCP_STARTUP_POLICY.doctorStderrBytes);
  let retainedBytes = 0;
  let bytes = 0;
  let truncated = false;
  return {
    append(chunk: unknown) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), "utf8");
      bytes += buffer.byteLength;
      const remaining = retained.byteLength - retainedBytes;
      const copied = Math.min(remaining, buffer.byteLength);
      if (copied > 0) {
        buffer.copy(retained, retainedBytes, 0, copied);
        retainedBytes += copied;
      }
      if (copied < buffer.byteLength) truncated = true;
    },
    value: () => ({
      stderr: truncated
        ? new StringDecoder("utf8").write(retained.subarray(0, retainedBytes))
        : retained.toString("utf8", 0, retainedBytes),
      stderr_bytes: bytes,
      stderr_truncated: truncated,
    }),
  };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Name the applied doctor deadline when an owned abort or SDK request timeout
 * fires. Remote failure text is not a deadline. Codex's 30 second startup
 * figure stays client guidance and is not this deadline.
 */
const doctorTransportDetail = (
  cause: unknown,
  budget: McpPhaseBudget,
  signal: AbortSignal,
): string => {
  const message = errorMessage(cause);
  const timedOut =
    (signal.aborted && cause === signal.reason) ||
    (cause instanceof SdkError && cause.code === SdkErrorCode.RequestTimeout);
  return timedOut ? `${message} ${mcpDoctorDeadlineRecovery(budget)}` : message;
};

/**
 * `deadlineMs` is a caller-selected applied deadline, used by tests. Omitted
 * means the budget resolved from `REA_MCP_DOCTOR_DEADLINE_MS`.
 */
const appliedDoctorBudget = (
  resolved: McpPhaseBudget,
  deadlineMs: number | undefined,
): McpPhaseBudget =>
  deadlineMs === undefined
    ? resolved
    : {
        ...resolved,
        milliseconds: deadlineMs,
        source:
          deadlineMs === resolved.defaultMilliseconds &&
          resolved.source === "default"
            ? "default"
            : "setting",
      };
