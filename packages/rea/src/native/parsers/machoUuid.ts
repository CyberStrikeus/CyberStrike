import type { BinaryMachoProjection } from "../MachoBinaryProjection.js";

const MACHO_UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;

type UuidObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "valid"; readonly value: string }
  | { readonly kind: "invalid" | "conflict"; readonly reason: string };

interface UuidArchitectureSelection {
  readonly name: string;
  readonly dwarfdumpName: string;
}

/** Reconcile the selected slice's UUID observations from binary load commands and dwarfdump. */
export const reconcileMachoUuid = (
  commands: BinaryMachoProjection["commands"],
  dwarfdumpOutput: string,
  artifactPath: string,
  selectedArchitecture: UuidArchitectureSelection | null,
): {
  readonly value: string | null;
  readonly limitations: readonly string[];
} =>
  reconcileObservations(
    loadCommandUuid(commands),
    parseDwarfdumpUuid(dwarfdumpOutput, artifactPath, selectedArchitecture),
  );

const parseDwarfdumpUuid = (
  output: string,
  artifactPath: string,
  selectedArchitecture: UuidArchitectureSelection | null,
): UuidObservation => {
  const parsed = parseDwarfdumpRows(output, artifactPath);
  return parsed.kind === "invalid"
    ? parsed
    : selectDwarfdumpRow(parsed.rows, selectedArchitecture);
};

interface DwarfdumpUuidRow {
  readonly value: string;
  readonly architecture: string;
}

type DwarfdumpRows =
  | { readonly kind: "rows"; readonly rows: readonly DwarfdumpUuidRow[] }
  | { readonly kind: "invalid"; readonly reason: string };

const parseDwarfdumpRows = (
  output: string,
  artifactPath: string,
): DwarfdumpRows => {
  if (output.trim().length === 0) return { kind: "rows", rows: [] };

  // Frame the documented row header, then consume the exact operand path.
  // Paths may contain newlines and text that resembles another UUID row.
  const header = /UUID:[ \t]*([^\s]+)[ \t]+\(([^)\r\n]+)\) /uy;
  const rows: DwarfdumpUuidRow[] = [];
  let offset = 0;
  while (offset < output.length) {
    if (output.startsWith("\r\n", offset)) {
      offset += 2;
      continue;
    }
    if (output[offset] === "\n") {
      offset += 1;
      continue;
    }
    header.lastIndex = offset;
    const match = header.exec(output);
    if (match === null)
      return {
        kind: "invalid",
        reason: "dwarfdump --uuid output contains an unrecognized row",
      };
    const value = match[1] ?? "";
    const architecture = match[2] ?? "";
    offset = header.lastIndex;
    if (!output.startsWith(artifactPath, offset))
      return {
        kind: "invalid",
        reason: `dwarfdump --uuid row does not match the selected artifact path (UUID ${JSON.stringify(value)})`,
      };
    offset += artifactPath.length;
    if (offset < output.length && output.startsWith("\r\n", offset))
      offset += 2;
    else if (output[offset] === "\n") offset += 1;
    else if (offset !== output.length)
      return {
        kind: "invalid",
        reason: `dwarfdump --uuid returned malformed UUID row ${JSON.stringify(value)}`,
      };
    rows.push({ value, architecture });
  }

  return { kind: "rows", rows };
};

const selectDwarfdumpRow = (
  rows: readonly DwarfdumpUuidRow[],
  selectedArchitecture: UuidArchitectureSelection | null,
): UuidObservation => {
  if (rows.length === 0) return { kind: "absent" };
  const selectedRows =
    selectedArchitecture === null
      ? rows
      : rows.filter(
          ({ architecture }) =>
            architecture === selectedArchitecture.dwarfdumpName,
        );
  const validRows = selectedRows.filter(({ value }) => MACHO_UUID.test(value));
  const distinctValid = new Set(
    validRows.map(({ value }) => value.toLowerCase()),
  );
  if (distinctValid.size > 1)
    return {
      kind: "conflict",
      reason: `dwarfdump --uuid returned conflicting UUIDs for selected architecture ${selectedArchitecture?.name ?? "unknown"}`,
    };
  if (selectedRows.length !== 1)
    return {
      kind: "invalid",
      reason:
        selectedRows.length > 1
          ? `dwarfdump --uuid returned multiple rows for selected architecture ${selectedArchitecture?.name ?? "unknown"}`
          : `dwarfdump --uuid returned no row for selected architecture ${selectedArchitecture?.name ?? "unknown"}`,
    };
  const [row] = selectedRows;
  if (row === undefined) return { kind: "absent" };
  if (!MACHO_UUID.test(row.value))
    return {
      kind: "invalid",
      reason: `dwarfdump --uuid returned malformed UUID ${JSON.stringify(row.value)}`,
    };
  return { kind: "valid", value: row.value };
};

const loadCommandUuid = (
  commands: BinaryMachoProjection["commands"],
): UuidObservation => {
  const loadCommands = commands.filter(({ kind }) => kind === "LC_UUID");
  if (loadCommands.length === 0) return { kind: "absent" };
  if (loadCommands.length > 1) {
    const observed = loadCommands
      .map(({ fields }) => fields.uuid)
      .filter(
        (value): value is string =>
          typeof value === "string" && MACHO_UUID.test(value),
      );
    const distinct = new Set(observed.map((value) => value.toLowerCase()));
    return {
      kind: distinct.size > 1 ? "conflict" : "invalid",
      reason:
        distinct.size > 1
          ? `binary load commands returned conflicting LC_UUID values ${observed.map((value) => JSON.stringify(value)).join(" and ")}`
          : `binary load commands returned ${String(loadCommands.length)} LC_UUID commands`,
    };
  }
  const value = loadCommands[0]?.fields.uuid;
  return typeof value === "string" && MACHO_UUID.test(value)
    ? { kind: "valid", value }
    : {
        kind: "invalid",
        reason: `binary load commands LC_UUID contains malformed UUID ${JSON.stringify(value ?? null)}`,
      };
};

const reconcileObservations = (
  loadUuid: UuidObservation,
  dwarfdump: UuidObservation,
): {
  readonly value: string | null;
  readonly limitations: readonly string[];
} => {
  if (dwarfdump.kind === "valid" && loadUuid.kind === "valid") {
    if (dwarfdump.value.toLowerCase() === loadUuid.value.toLowerCase())
      return { value: dwarfdump.value, limitations: [] };
    return {
      value: null,
      limitations: [
        `dwarfdump --uuid (${dwarfdump.value}) conflicts with binary load commands LC_UUID (${loadUuid.value}); the image UUID is unknown.`,
      ],
    };
  }
  if (dwarfdump.kind === "valid" && loadUuid.kind === "conflict")
    return { value: null, limitations: [loadUuid.reason] };
  if (loadUuid.kind === "valid" && dwarfdump.kind === "conflict")
    return { value: null, limitations: [dwarfdump.reason] };
  if (dwarfdump.kind === "valid")
    return {
      value: dwarfdump.value,
      limitations:
        loadUuid.kind === "invalid"
          ? [`${loadUuid.reason}; using the unambiguous dwarfdump UUID.`]
          : [],
    };
  if (loadUuid.kind === "valid")
    return {
      value: loadUuid.value,
      limitations:
        dwarfdump.kind === "invalid"
          ? [
              `${dwarfdump.reason}; using the unambiguous binary load commands LC_UUID.`,
            ]
          : [],
    };

  return {
    value: null,
    limitations: [
      ...(dwarfdump.kind === "invalid" || dwarfdump.kind === "conflict"
        ? [dwarfdump.reason]
        : []),
      ...(loadUuid.kind === "invalid" || loadUuid.kind === "conflict"
        ? [loadUuid.reason]
        : []),
    ],
  };
};
