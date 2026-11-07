import { functionStructuralCandidate } from "./functionStructuralCandidate.js";
import { z } from "zod";
import type { Evidence } from "../evidence.js";
import { EvidenceIntegrityError } from "../evidenceErrors.js";
import { readEvidencePayload } from "../evidenceValidation.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { functionDossierSchema } from "../native/functionDossier.js";
import {
  availableFunctionBodySchema,
  functionBodySchema,
  functionBodyEntryAgrees,
} from "../native/functionBody.js";
import { unavailableNativeFactSchema } from "./nativeFactAvailability.js";
import { nativeSymbolOrigin } from "./nativeSymbol.js";
import {
  addressedValueSchema,
  nativeInventoryRowsSchemas,
} from "./nativeInventory.js";
import { nativeAddressInputSchema } from "./nativeAddress.js";
import { nativeByteReadSchema } from "./nativeByteRead.js";
import { procedureInfoSchema } from "./procedureInfo.js";
import type { NativeFunctionMatchMember } from "./functionMatching.js";
import {
  FunctionByteCoverage,
  type NativeMatchingCheckpoint,
} from "./functionByteCoverage.js";

const matchingRowsSchema = nativeInventoryRowsSchemas.names.element
  .extend({ address: nativeAddressInputSchema })
  .array();
const matchingBodySchema = z.discriminatedUnion("available", [
  unavailableNativeFactSchema,
  availableFunctionBodySchema.safeExtend({
    ranges: availableFunctionBodySchema.shape.ranges.element
      .extend({
        start: nativeAddressInputSchema,
        end: nativeAddressInputSchema,
      })
      .array(),
  }),
]);
const matchingProcedureInfoSchema = procedureInfoSchema
  .safeExtend({
    entrypoint: nativeAddressInputSchema,
    body: matchingBodySchema,
  })
  .transform(({ entrypoint, body, name, symbol }) => ({
    address: entrypoint,
    body,
    name,
    symbol,
  }));
const matchingFunctionDossierSchema = functionDossierSchema.safeExtend({
  procedure: functionDossierSchema.shape.procedure.safeExtend({
    address: nativeAddressInputSchema,
    body: matchingBodySchema,
  }),
});
const sourcePayload = <Output>(
  schema: z.ZodType<Output>,
  input: unknown,
): Output => {
  const result = readEvidencePayload(schema, input);
  if (!result.ok) throw result.error;
  return result.value;
};

type Body = z.infer<typeof functionBodySchema>;
type AddressedValue = z.infer<typeof addressedValueSchema>;

export interface MatchingFunction {
  readonly member: NativeFunctionMatchMember;
  readonly symbol: string | null;
  readonly fingerprint: string | null;
}
interface Detail {
  body: Body;
  dossier?: string | null;
  candidate?: string | null;
  conflict: boolean;
  readonly links: string[];
}
interface Symbols {
  readonly values: AddressedValue[];
  readonly links: Set<string>;
}
interface Facts {
  readonly details: Map<string, Detail>;
  readonly symbols: Map<string, Symbols>;
  readonly bytes: FunctionByteCoverage;
}

const addBody = (
  observation: Evidence,
  details: Facts["details"],
  symbols: Facts["symbols"],
): void => {
  const dossier =
    observation.operation === "analyze_function"
      ? sourcePayload(
          matchingFunctionDossierSchema,
          observation.normalized_result,
        )
      : undefined;
  const procedure =
    dossier?.procedure ??
    sourcePayload(matchingProcedureInfoSchema, observation.normalized_result);
  const address = procedure.address;
  if (procedure.symbol != null)
    addSymbol(
      { address, value: procedure.name, symbol: procedure.symbol },
      observation.evidence_id,
      symbols,
    );
  if (!functionBodyEntryAgrees(procedure.body, address))
    throw new EvidenceIntegrityError(
      "Procedure body entry membership contradicts its address",
    );
  let detail = details.get(address);
  if (detail === undefined) {
    details.set(
      address,
      (detail = { body: procedure.body, conflict: false, links: [] }),
    );
  } else if (
    digestCanonicalValue(detail.body) !== digestCanonicalValue(procedure.body)
  ) {
    detail.conflict = true;
  }
  detail.body = procedure.body;
  if (observation.operation === "analyze_function") {
    const candidate = functionStructuralCandidate(observation, dossier!);
    if (detail.dossier === undefined) {
      detail.dossier = observation.evidence_id;
      detail.candidate = candidate;
    } else {
      // Request identity and dossier selection are independent of body agreement.
      if (detail.dossier !== observation.evidence_id) detail.dossier = null;
      if (detail.candidate !== candidate) detail.candidate = null;
    }
  }
  detail.links.push(observation.evidence_id);
};
const addSymbol = (
  symbol: AddressedValue,
  evidenceId: string,
  symbols: Facts["symbols"],
): void => {
  const address = symbol.address;
  let group = symbols.get(address);
  if (group === undefined)
    symbols.set(address, (group = { values: [], links: new Set() }));
  group.values.push(symbol);
  group.links.add(evidenceId);
};
const addNames = async (
  observation: Evidence,
  symbols: Facts["symbols"],
  checkpoint: NativeMatchingCheckpoint,
): Promise<void> => {
  for (const symbol of sourcePayload(
    matchingRowsSchema,
    observation.normalized_result,
  )) {
    await checkpoint(128 + symbol.value.length * 2);
    addSymbol(symbol, observation.evidence_id, symbols);
  }
};
const addBytes = async (
  observation: Evidence,
  bytes: FunctionByteCoverage,
): Promise<void> => {
  const parsed = sourcePayload(
    nativeByteReadSchema,
    observation.normalized_result,
  );
  const requestAddress =
    typeof observation.parameters.address === "string"
      ? sourcePayload(nativeAddressInputSchema, observation.parameters.address)
      : undefined;
  const read = {
    ...parsed,
    address:
      requestAddress !== undefined || parsed.returned_bytes > 0
        ? sourcePayload(nativeAddressInputSchema, parsed.address)
        : parsed.address,
  };
  if (
    (requestAddress !== undefined && requestAddress !== read.address) ||
    (typeof observation.parameters.length === "number" &&
      observation.parameters.length !== read.requested_bytes)
  )
    throw new EvidenceIntegrityError(
      "Read-byte coordinates contradict the selected request",
    );
  await bytes.add(read, observation.evidence_id);
};
const reportedSymbol = (
  row: AddressedValue,
  known: Symbols | undefined,
): {
  readonly value: string | null;
  readonly origin: "known" | "unknown" | "conflicting";
} => {
  const names = [
    ...(row.symbol === undefined ? [] : [row]),
    ...(known?.values.filter((symbol) => symbol.value === row.value) ?? []),
  ];
  const generated = names.some(
    (symbol) => nativeSymbolOrigin(symbol.symbol) === "generated",
  );
  const named = names.some(
    (symbol) => nativeSymbolOrigin(symbol.symbol) === "named",
  );
  return {
    value: row.value.length === 0 || generated || !named ? null : row.value,
    origin:
      generated && named
        ? "conflicting"
        : names.some((symbol) => symbol.symbol !== undefined)
          ? "known"
          : "unknown",
  };
};
const functionFact = async (
  {
    inventory,
    row,
    sourceIndex,
  }: { inventory: Evidence; row: AddressedValue; sourceIndex: number },
  facts: Facts,
  checkpoint: NativeMatchingCheckpoint,
): Promise<MatchingFunction> => {
  const address = row.address,
    detail = facts.details.get(address),
    symbols = facts.symbols.get(address);
  // Bound expansion before creating per-occurrence sets, arrays and subsequent
  // schema/Evidence serialization copies. Same-address aliases repeat these links.
  for (const link of detail?.links ?? [])
    await checkpoint(256 + 8 * link.length);
  for (const link of symbols?.links ?? [])
    await checkpoint(256 + 8 * link.length);
  const links = new Set([inventory.evidence_id]);
  for (const link of detail?.links ?? []) links.add(link);
  for (const link of symbols?.links ?? []) links.add(link);
  const body = detail?.conflict ? undefined : detail?.body;
  const fingerprint = await facts.bytes.fingerprint(body);
  for (const link of fingerprint?.links ?? []) {
    await checkpoint(256 + 8 * link.length);
    links.add(link);
  }
  const limitations: string[] = [];
  const symbol = reportedSymbol(row, symbols);
  if (fingerprint === null)
    limitations.push(
      detail?.conflict
        ? "Conflicting procedure observations; body and dossier remain unknown."
        : "No complete unambiguous bytes for the observed function body.",
    );
  if (symbol.origin === "unknown")
    limitations.push(
      "Symbol origin unavailable; exact-name matching is unavailable. Independent complete body bytes remain eligible.",
    );
  if (symbol.origin === "conflicting")
    limitations.push(
      "Conflicting generated and named symbol-origin observations; exact-name matching is unavailable. Independent complete body bytes remain eligible.",
    );
  if (detail?.dossier === null)
    limitations.push(
      "Multiple supplied dossiers describe this address; no dossier is selected automatically. Agreed body bytes and structural facts remain usable.",
    );
  return {
    member: {
      function_id: `${inventory.evidence_id}/${sourceIndex}`,
      inventory_evidence_id: inventory.evidence_id,
      source_index: sourceIndex,
      address,
      name: row.value,
      body_sha256: fingerprint?.sha256 ?? null,
      structural_candidate_sha256: detail?.conflict
        ? null
        : (detail?.candidate ?? null),
      body_bytes: body?.available ? body.total_bytes : null,
      dossier_evidence_id: detail?.conflict ? null : (detail?.dossier ?? null),
      evidence_links: [...links].sort(),
      limitations,
    },
    symbol: symbol.value,
    fingerprint: fingerprint?.key ?? null,
  };
};

const textLength = (value: unknown): number =>
  typeof value === "string" ? value.length : 0;
/**
 * Every row becomes exactly one emitted member: its parsed row and member
 * (768 bytes), then the report validation and Evidence normalization copies
 * that serialization digests (1280 bytes). Names and addresses are shared
 * strings, charged for UTF-16 storage and serialized copies.
 */
const rowBytes = (row: unknown): number =>
  typeof row === "object" && row !== null
    ? 2048 +
      4 *
        (textLength((row as { address?: unknown }).address) +
          textLength((row as { value?: unknown }).value))
    : 2048;

/** Consume application-admitted normalized facts; never infer body extents from neighbor entries. */
export const readFunctionInventory = async (
  inventory: Evidence,
  observations: readonly Evidence[],
  checkpoint: NativeMatchingCheckpoint,
): Promise<MatchingFunction[]> => {
  // Charge each row's member before parsing clones it, so a borrowed retained
  // inventory is bounded without walking the resident record and an oversized
  // side is refused before allocation. Members share one inventory ID string.
  const source = inventory.normalized_result;
  if (Array.isArray(source))
    for (const row of source as unknown[]) await checkpoint(rowBytes(row));
  await checkpoint(256 + 8 * inventory.evidence_id.length);
  const rows = sourcePayload(matchingRowsSchema, source);
  const facts: Facts = {
    details: new Map(),
    symbols: new Map(),
    bytes: new FunctionByteCoverage(checkpoint),
  };
  for (const observation of observations) {
    await checkpoint();
    switch (observation.operation) {
      case "list_names":
        await addNames(observation, facts.symbols, checkpoint);
        break;
      case "read_bytes":
        await addBytes(observation, facts.bytes);
        break;
      case "procedure_info":
      case "analyze_function":
        addBody(observation, facts.details, facts.symbols);
        break;
    }
  }
  const functions: MatchingFunction[] = [];
  for (let sourceIndex = 0; sourceIndex < rows.length; sourceIndex++) {
    const row = rows[sourceIndex]!;
    await checkpoint();
    functions.push(
      await functionFact({ inventory, row, sourceIndex }, facts, checkpoint),
    );
  }
  return functions;
};
