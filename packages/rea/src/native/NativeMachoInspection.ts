import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { EvidenceLocation } from "../domain/evidence.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisOutputError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  inspectMachoSchema,
  type NativeCommandInvocation,
} from "../domain/native/nativeInspection.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { machoRuntimeSymbolName } from "../domain/native/machoSymbolName.js";
import { err, ok, type Result } from "../domain/result.js";
import type { NativeCommandCapture } from "./CommandRunner.js";
import {
  MACHO_ARCHITECTURE_POLICIES,
  machoToolArchitectureName,
  selectMachoArchitecture,
} from "./MachoArchitectureSelection.js";
import {
  parseDyldExportAddressRow,
  parseDyldExports,
  parseDyldImports,
} from "./parsers/dyldInfo.js";
import { parseLipoCapture, type LipoArchitecture } from "./parsers/lipo.js";
import { withoutEchoedPathHeader } from "./parsers/echoedPath.js";
import {
  projectMachoBinary,
  type BinaryMachoProjection,
} from "./MachoBinaryProjection.js";
import type { MachoCommandNames } from "./MachoCommandNames.js";
import type { ResolvedMachoSlice } from "./NativeMachoSelectedSlice.js";
import { reconcileMachoUuid } from "./parsers/machoUuid.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { machoCpuSubtypeBase } from "../domain/apple/machoCpuIdentity.js";
import type {
  MachoEncryptionFacts,
  MachoSliceEncryption,
} from "../domain/apple/machoEncryption.js";
import {
  conflictingUuidCommandEvidence,
  isMissingUuidDyldFailure,
  isUnbackedTextDyldFailure,
  isVtoolContainerRefusal,
  nativeCommandOperand,
  nativeMachoCapturedOutput,
  missingUuidLimitation,
  parseDyldFileTypeRefusal,
  unusableNativeCommandOutput,
} from "./NativeMachoCommandDiagnostics.js";

interface NativeMachoObservation {
  readonly result: JsonValue;
  readonly limitations: readonly string[];
  readonly locations: readonly EvidenceLocation[];
}

/** Structural encryption facts, or why the target bytes were not read. */
export type MachoEncryptionRead =
  | MachoEncryptionFacts
  | { readonly status: "unread"; readonly reason: string };

interface NativeMachoInspectionContext {
  readonly target: BinaryTarget;
  readonly signal?: AbortSignal;
  /** Read load-command encryption facts from the bytes the tools inspect. */
  readonly readEncryption: (
    signal?: AbortSignal,
  ) => Promise<MachoEncryptionRead>;
  readonly run: (
    tool: string,
    arguments_: readonly string[],
    signal?: AbortSignal,
    acceptNonZeroIf?: (capture: NativeCommandCapture) => boolean,
  ) => Promise<Result<NativeCommandCapture, AnalysisError>>;
  readonly invocation: (
    capture: NativeCommandCapture,
  ) => NativeCommandInvocation;
  readonly resolveSlice?: (
    selected: LipoArchitecture,
  ) => Promise<ResolvedMachoSlice>;
  /** Borrow binary framing from the same identity-bound target as the tools. */
  readonly readCommandNames: (
    offset: number,
    size: number | null,
    selected: ResolvedMachoSlice | undefined,
  ) => Promise<MachoCommandNames>;
}

const DISCOVERY_COMMANDS = [["lipo", ["-detailed_info"]]] as const;

// llvm-nm's default dyld-info pass fakes up symbols the symbol table lacks
// from dyld metadata. It takes seconds on large apps (Keynote arm64: 5.8 s
// versus 0.01 s without it), and under -gU it can only add export-trie names.
const SYMBOL_TABLE_EXPORTS = ["nm", ["-gjU", "--no-dyldinfo"]] as const;
const SYMBOL_TABLE_IMPORTS = ["nm", ["-gju", "--no-dyldinfo"]] as const;
const DYLD_INFO_EXPORTS = ["nm", ["-gjU"]] as const;

const REQUIRED_SLICE_COMMANDS = [
  SYMBOL_TABLE_EXPORTS,
  ["dyld_info", ["-imports"]],
  ["dyld_info", ["-exports"]],
  ["dwarfdump", ["--uuid"]],
] as const;

const OPTIONAL_VTOOL_COMMAND = ["vtool", ["-show-build"]] as const;
const VTOOL_UNAVAILABLE_LIMITATION =
  "vtool is unavailable; build metadata is normalized from binary load commands.";
/** Recorded when vtool refuses the universal container and slice facts remain. */
export const VTOOL_CONTAINER_REFUSAL_LIMITATION =
  "vtool declined the universal container as not Mach-O; build metadata is normalized from binary load commands.";
/** Inspect one Mach-O with the required native commands and normalized output. */
export const inspectNativeMacho = async (
  context: NativeMachoInspectionContext,
): Promise<Result<NativeMachoObservation, AnalysisError>> => {
  const captures: NativeCommandCapture[] = [];
  for (const [tool, prefix] of DISCOVERY_COMMANDS) {
    const captured = await context.run(
      tool,
      [...prefix, context.target.path],
      context.signal,
    );
    if (!captured.ok) return err(captured.error);
    captures.push(captured.value);
  }
  const lipo = captures.find(({ tool }) => tool === "lipo");
  if (lipo === undefined) throw new TypeError("Missing lipo capture");
  const parsedLipo = parseLipoCapture(
    lipo,
    "inspect_macho",
    nativeCommandOperand(lipo) ?? context.target.path,
  );
  if (!parsedLipo.ok) return parsedLipo;
  const { format, architectures } = parsedLipo.value;
  const selection = selectArchitecture(context.target, architectures);
  if (selection.status === "absent")
    return err(
      new AnalysisOutputError(
        "inspect_macho",
        `lipo did not list ${selection.architecture}; refusing to read another slice`,
      ),
    );
  if (selection.status === "ambiguous")
    return err(
      new AnalysisOutputError(
        "inspect_macho",
        `lipo listed multiple slices addressable as ${selection.architecture}; refusing to associate a slice offset with an ambiguous tool selection`,
      ),
    );
  const selectedArchitecture =
    selection.status === "selected" ? selection.toolName : null;
  const runSliceCommand = ([tool, prefix]: readonly [
    string,
    readonly string[],
  ]) =>
    context.run(
      tool,
      [
        ...prefix,
        ...selectedArchitectureArguments(tool, selectedArchitecture),
        context.target.path,
      ],
      context.signal,
      tool === "dyld_info"
        ? (capture) =>
            isMissingUuidDyldFailure(capture) ||
            isUnbackedTextDyldFailure(capture) ||
            parseDyldFileTypeRefusal(capture) !== null
        : tool === "vtool" && format === "fat"
          ? (capture) => isVtoolContainerRefusal(capture)
          : undefined,
    );
  // vtool knows no variant subtypes, so no spelling selects an arm64e.x1 slice.
  const vtoolSelectsSlice =
    selectedArchitecture === null ||
    !toolArchitectureName("vtool", selectedArchitecture).includes(".");
  // Slice commands only read the selected artifact, so launch them together.
  // Every launch settles before return; declared order fixes provenance and
  // which failure is reported.
  const [required, optional] = await Promise.all([
    Promise.all(
      REQUIRED_SLICE_COMMANDS.map((command) => runSliceCommand(command)),
    ),
    vtoolSelectsSlice ? runSliceCommand(OPTIONAL_VTOOL_COMMAND) : null,
  ]);
  for (const captured of required) {
    if (!captured.ok) return err(captured.error);
    if (
      (captured.value.exitCode !== 0 || captured.value.signal !== null) &&
      !isMissingUuidDyldFailure(captured.value) &&
      !isUnbackedTextDyldFailure(captured.value) &&
      parseDyldFileTypeRefusal(captured.value) === null
    )
      return err(unusableNativeCommandOutput(captured.value));
    captures.push(captured.value);
  }
  const limitations = architectures.flatMap(
    (architecture) => architecture.limitations,
  );
  if (optional === null)
    limitations.push(
      `vtool cannot select the ${selectedArchitecture} slice; build metadata is normalized from binary load commands.`,
    );
  else if (optional.ok) {
    captures.push(optional.value);
    if (isVtoolContainerRefusal(optional.value))
      limitations.push(VTOOL_CONTAINER_REFUSAL_LIMITATION);
  } else if (optional.error._tag === "AnalysisCapabilityUnavailableError")
    limitations.push(VTOOL_UNAVAILABLE_LIMITATION);
  else return err(optional.error);
  const nmIndex = captures.findIndex(({ tool }) => tool === "nm");
  const dyldExports = captures.filter(({ tool }) => tool === "dyld_info")[1];
  if (nmIndex < 0 || dyldExports === undefined)
    throw new TypeError("Missing nm or dyld_info export capture");
  const selected =
    selection.status === "selected"
      ? selection.architecture
      : architectures.length === 1
        ? architectures[0]
        : undefined;
  if (format === "fat" && selected === undefined)
    return err(
      new AnalysisOutputError(
        "inspect_macho",
        "The selected binary slice is unavailable",
      ),
    );
  const range =
    format === "thin"
      ? { offset: 0, size: null }
      : context.resolveSlice !== undefined
        ? await context.resolveSlice(selected!)
        : { offset: selected!.file_offset, size: selected!.size };
  if (range.offset === null || (format === "fat" && range.size === null))
    return err(
      new AnalysisOutputError(
        "inspect_macho",
        "The selected binary slice range is unavailable",
      ),
    );
  if (
    format === "fat" &&
    (selected!.file_offset === null || selected!.size === null)
  )
    limitations.push(
      "Selected slice range was derived from the Mach-O FAT table because lipo did not provide an interpretable complete range.",
    );
  const { offset, size } = range;
  const binary = await context.readCommandNames(
    offset,
    size,
    "declaration" in range ? range : undefined,
  );
  const load = projectMachoBinary(binary);
  const unbackedTextFailure = captures.find(isUnbackedTextDyldFailure);
  if (unbackedTextFailure !== undefined) {
    if (!["10", "DSYM", "MH_DSYM"].includes(load.fileType ?? ""))
      return err(unusableNativeCommandOutput(unbackedTextFailure));
    return err(
      new AnalysisUnsupportedTargetError(
        "inspect_macho",
        context.target.path,
        "The selected Mach-O is a dSYM companion whose unbacked text sections are unsupported by dyld_info inspection",
        {
          capturedOutput: nativeMachoCapturedOutput(unbackedTextFailure),
          remediationAction:
            "Select the matching linked Mach-O executable for native inspection; this operation does not inspect dSYM companions with unbacked text sections.",
        },
      ),
    );
  }
  for (const fileTypeFailure of captures) {
    const refusal = parseDyldFileTypeRefusal(fileTypeFailure);
    if (refusal === null) continue;
    const { fileType, diagnostic } = refusal;
    const typeName = fileType === "4" ? "CORE" : "FVMLIB";
    if (![fileType, typeName, `MH_${typeName}`].includes(load.fileType ?? ""))
      return err(unusableNativeCommandOutput(fileTypeFailure));
    return err(
      new AnalysisUnsupportedTargetError(
        "inspect_macho",
        context.target.path,
        `dyld_info refused the selected Mach-O file type MH_${typeName} (${fileType}): ${diagnostic}`,
        {
          capturedOutput: nativeMachoCapturedOutput(fileTypeFailure),
          remediationAction:
            "Select a linked Mach-O executable or relocatable object for native inspection; dyld_info refused the selected file type.",
        },
      ),
    );
  }
  const uuidlessDyldFailure = captures.find(isMissingUuidDyldFailure);
  if (
    uuidlessDyldFailure !== undefined &&
    load.commands.some(({ kind }) => kind === "LC_UUID")
  )
    return err(conflictingUuidCommandEvidence(uuidlessDyldFailure));
  // A stripped symbol table (strip -T) can omit names the export trie keeps.
  // Only then does llvm-nm's dyld-info pass add names, and its exact names
  // disambiguate dyld_info rows. Refusals above are not export rows.
  if (
    !isMissingUuidDyldFailure(dyldExports) &&
    !namesEveryExport(captures[nmIndex]!.stdout, dyldExports)
  ) {
    const withDyldInfo = await runSliceCommand(DYLD_INFO_EXPORTS);
    if (!withDyldInfo.ok) return err(withDyldInfo.error);
    captures[nmIndex] = withDyldInfo.value;
  }
  const dyldImports = captures.find(
    ({ tool, arguments: arguments_ }) =>
      tool === "dyld_info" && arguments_[0] === "-imports",
  );
  if (dyldImports === undefined)
    throw new TypeError("Missing dyld_info import capture");
  const hasChainedFixups = load.commands.some(
    ({ kind }) => kind === "LC_DYLD_CHAINED_FIXUPS",
  );
  let parsedImports = parseDyldImports(
    sliceOutput(dyldImports),
    hasChainedFixups,
  );
  if (
    !isMissingUuidDyldFailure(dyldImports) &&
    parsedImports.needsNameInventory
  ) {
    const importNames = await runSliceCommand(SYMBOL_TABLE_IMPORTS);
    if (!importNames.ok) return err(importNames.error);
    captures.push(importNames.value);
    parsedImports = parseDyldImports(
      sliceOutput(dyldImports),
      hasChainedFixups,
      new Set(parseNmSymbolNames(importNames.value.stdout)),
    );
  }
  const encryption = await context.readEncryption(context.signal);
  const selectedArchitectureName =
    (selection.status === "selected" ? selection.architecture.name : null) ??
    (architectures.length === 1 ? (architectures[0]?.name ?? null) : null);
  const containerOffset =
    selectedArchitectureName === null ? undefined : offset;
  const observed = normalizeMacho(
    captures,
    format,
    context.invocation,
    limitations,
    load,
    binary.sliceSize,
    parsedImports.items,
    captures[nmIndex]!,
    { format, architectures, encryption },
    {
      name: selectedArchitectureName,
      container_file_offset: containerOffset ?? null,
    },
  );
  const outsideEntrypoint = observed.entrypoints.items.some(
    ({ file_offset }) => file_offset >= binary.sliceSize,
  );
  const normalized = outsideEntrypoint
    ? inspectMachoSchema.parse({
        ...observed,
        entrypoints: {
          ...observed.entrypoints,
          exhaustive: false,
          total: null,
          limitations: [
            ...observed.entrypoints.limitations,
            "An entrypoint lies outside the selected Mach-O slice.",
          ],
        },
      })
    : observed;
  const locationLimitations =
    containerOffset === undefined
      ? []
      : [
          ...(normalized.entrypoints.items.some(
            ({ file_offset }) =>
              file_offset >= binary.sliceSize ||
              !Number.isSafeInteger(containerOffset + file_offset),
          )
            ? [
                "Some entrypoint file locations are outside the selected slice or exceed the supported integer range.",
              ]
            : []),
          ...(normalized.segments.items.some(
            ({ file_offset, file_size }) =>
              file_offset === null ||
              file_size === null ||
              file_offset + file_size > binary.sliceSize ||
              !Number.isSafeInteger(containerOffset + file_offset + file_size),
          )
            ? [
                "Some segment file locations are unavailable, outside the selected slice, or exceed the supported integer range.",
              ]
            : []),
        ];
  const result =
    containerOffset === undefined
      ? inspectMachoSchema.parse({
          ...normalized,
          limitations: [
            ...normalized.limitations,
            selectedArchitectureName === null
              ? "The selected Mach-O slice is unknown; slice-based evidence locations are unavailable."
              : "The selected Mach-O slice's container file offset was not observed; slice-based evidence locations are unavailable.",
          ],
        })
      : locationLimitations.length === 0
        ? normalized
        : inspectMachoSchema.parse({
            ...normalized,
            limitations: [...normalized.limitations, ...locationLimitations],
          });
  return ok({
    result: jsonValueSchema.parse(result),
    limitations: result.limitations,
    locations: fileOffsetLocations(result, containerOffset, binary.sliceSize),
  });
};

const normalizeMacho = (
  captures: readonly NativeCommandCapture[],
  containerFormat: "thin" | "fat",
  toInvocation: (capture: NativeCommandCapture) => NativeCommandInvocation,
  additionalLimitations: readonly string[],
  load: BinaryMachoProjection,
  sliceSize: number,
  parsedImports: ReturnType<typeof parseDyldImports>["items"],
  exportNames: NativeCommandCapture,
  slices: {
    readonly format: "thin" | "fat";
    readonly architectures: readonly LipoArchitecture[];
    readonly encryption: MachoEncryptionRead;
  },
  selectedArchitecture: {
    readonly name: string | null;
    readonly container_file_offset: number | null;
  },
) => {
  const { architectures } = slices;
  const encryption = encryptionCoverage(slices);
  const byTool = captureLookup(captures);
  const dyldImportsCapture = byTool("dyld_info", 0);
  const dyldExportsCapture = byTool("dyld_info", 1);
  const missingImportsUuid = isMissingUuidDyldFailure(dyldImportsCapture);
  const missingExportsUuid = isMissingUuidDyldFailure(dyldExportsCapture);
  const imports = missingImportsUuid ? [] : parsedImports.map(withRuntimeName);
  const imageBase =
    load.segments.find(
      (segment) =>
        segment.file_offset === 0 &&
        segment.file_size !== null &&
        segment.file_size > 0 &&
        segment.file_size <= sliceSize,
    )?.vm_address ?? null;
  const nmExports = parseNmExports(exportNames.stdout);
  const dyldExports = missingExportsUuid
    ? []
    : parseDyldExports(
        sliceOutput(dyldExportsCapture),
        imageBase,
        new Set(nmExports.map(({ name }) => name)),
      );
  const exports = uniqueSymbols([...dyldExports, ...nmExports]).map(
    withRuntimeName,
  );
  const dwarfdump = byTool("dwarfdump");
  const uuid = reconcileMachoUuid(
    load.commands,
    dwarfdump.stdout,
    nativeCommandOperand(dwarfdump) ?? "",
    selectedArchitecture.name === null
      ? null
      : {
          name: selectedArchitecture.name,
          dwarfdumpName: toolArchitectureName(
            "dwarfdump",
            selectedArchitecture.name,
          ),
        },
  );
  const provenance = captures.map(toInvocation);
  const limitations = [
    "Imports and exports combine dyld_info and nm; stripped or toolchain-hidden symbols may be absent.",
    ...(captures.some(
      ({ tool, exitCode, signal }) =>
        tool === "vtool" && exitCode === 0 && signal === null,
    )
      ? [
          "vtool output is retained as provenance; build metadata is normalized from binary load commands.",
        ]
      : []),
    ...additionalLimitations,
    ...(missingImportsUuid ? [missingUuidLimitation("imports")] : []),
    ...(missingExportsUuid ? [missingUuidLimitation("exports")] : []),
    ...uuid.limitations,
    ...(imageBase === null &&
    /^\s*offset\s+symbol\s*$/mu.test(sliceOutput(byTool("dyld_info", 1)))
      ? [
          "Export virtual addresses are unavailable because no file-backed image base was observed.",
        ]
      : []),
    ...encryption.limitations,
    ...encryption.items.flatMap(encryptionLimitation),
  ];
  return inspectMachoSchema.parse({
    format: containerFormat === "fat" ? "mach-o-universal" : "mach-o",
    selected_architecture: selectedArchitecture,
    endian: load.endian,
    word_size: load.wordSize,
    file_type: load.fileType,
    flags: load.flags,
    uuid: uuid.value,
    entrypoints: covered(
      load.entrypoints,
      load.entrypointLimitations.length === 0,
      load.entrypointLimitations,
    ),
    architectures: covered(architectures, true),
    build_metadata: covered(
      load.builds,
      load.buildLimitations.length === 0,
      load.buildLimitations,
    ),
    load_commands: covered(load.commands, true, load.commandLimitations),
    dependencies: covered(
      load.dependencies,
      load.dependencyLimitations.length === 0,
      load.dependencyLimitations,
    ),
    imports: covered(imports, false, [
      "dyld_info textual imports may omit chained or toolchain-unsupported metadata.",
      ...(missingImportsUuid ? [missingUuidLimitation("imports")] : []),
      ...(imports.some(({ name_status }) => name_status === "ambiguous")
        ? [
            "Import text contains name, flags, library, or addend boundaries whose split is ambiguous.",
          ]
        : []),
    ]),
    exports: covered(exports, false, [
      ...(missingExportsUuid
        ? [missingUuidLimitation("exports")]
        : [
            "Merged nm/dyld_info results may be incomplete for stripped binaries.",
          ]),
      ...(dyldExports.some(({ sourceSymbol }) => sourceSymbol !== undefined)
        ? [
            "Renamed re-exports are listed under their exported name; the source library's symbol name is not reported.",
          ]
        : []),
    ]),
    segments: covered(
      load.segments.map((segment) => ({
        ...segment,
        sections: covered(
          segment.sections,
          load.segmentLimitations.length === 0,
          load.segmentLimitations,
        ),
      })),
      load.segmentLimitations.length === 0,
      load.segmentLimitations,
    ),
    encryption,
    provenance,
    limitations,
  });
};

/** Label each slice with the one lipo record sharing its physical identity. */
const encryptionCoverage = ({
  format,
  architectures,
  encryption,
}: {
  readonly format: "thin" | "fat";
  readonly architectures: readonly LipoArchitecture[];
  readonly encryption: MachoEncryptionRead;
}) => {
  if (encryption.status !== "parsed")
    return {
      items: [],
      total: null,
      exhaustive: false,
      limitations: [
        encryption.status === "not-mach-o"
          ? "Encryption load commands were not read: the structural reader did not recognize a Mach-O image."
          : `Encryption load commands were not read: ${encryption.reason}`,
      ],
    };
  const items = encryption.slices.map((slice) => {
    const matches = architectures.filter((architecture) =>
      lipoDescribesSlice(architecture, slice, format),
    );
    return {
      ...slice,
      architecture: matches.length === 1 ? (matches[0]?.name ?? null) : null,
    };
  });
  return covered(items, true);
};

const lipoDescribesSlice = (
  architecture: LipoArchitecture,
  slice: MachoSliceEncryption,
  format: "thin" | "fat",
): boolean =>
  (architecture.file_offset === null
    ? format === "thin" && slice.container_file_offset === 0
    : architecture.file_offset === slice.container_file_offset) &&
  (architecture.size === null || architecture.size === slice.size) &&
  (architecture.cpu_type_code === null ||
    slice.cpu_type === null ||
    architecture.cpu_type_code === slice.cpu_type) &&
  (slice.cpu_subtype === null ||
    (architecture.cpu_subtype_code === null
      ? architecture.cpu_subtype_base === null ||
        architecture.cpu_subtype_base === machoCpuSubtypeBase(slice.cpu_subtype)
      : architecture.cpu_subtype_code === slice.cpu_subtype));

const encryptionLimitation = (slice: MachoSliceEncryption): string[] => {
  const name =
    slice.architecture === null
      ? `slice at offset ${slice.container_file_offset}`
      : `${slice.architecture} slice`;
  if (slice.status === "malformed" || slice.status === "unknown")
    return [
      `Encryption status of the ${name} is ${slice.status}: ${slice.reason ?? "no reason recorded"}.`,
    ];
  const { range } = slice;
  if (slice.status !== "encrypted" || range === null) return [];
  const cryptid = slice.commands[0]?.cryptid ?? null;
  return range.container_start === range.container_end
    ? [
        `The ${name} declares encryption (cryptid ${cryptid}) over an empty range; no bytes are marked as ciphertext.`,
      ]
    : [
        `Bytes ${range.container_start}-${range.container_end} (input file offsets, end exclusive) of the ${name} are ciphertext (cryptid ${cryptid}); disassembly, decompilation, strings and references derived from them do not describe program code.`,
      ];
};

/** Slice output without the echoed operand path, which can contain any text. */
const sliceOutput = (capture: NativeCommandCapture): string =>
  withoutEchoedPathHeader(capture.stdout, capture.arguments.at(-1));

const captureLookup =
  (captures: readonly NativeCommandCapture[]) =>
  (tool: string, occurrence = 0): NativeCommandCapture => {
    const capture = captures.filter((item) => item.tool === tool)[occurrence];
    if (capture === undefined) throw new TypeError(`Missing ${tool} capture`);
    return capture;
  };

/**
 * Whether every dyld_info export row names a symbol-table export. A row this
 * parser cannot read counts as uncovered, so an unfamiliar format falls back.
 */
const namesEveryExport = (
  nmOutput: string,
  dyldExports: NativeCommandCapture,
): boolean => {
  const names = new Set(parseNmSymbolNames(nmOutput));
  return sliceOutput(dyldExports)
    .split("\n")
    .every((rawLine, index) => {
      // Keep a trailing carriage return: it belongs to the exported name.
      const line = rawLine.trimStart();
      if (
        line.length === 0 ||
        (index === 0 && line.endsWith(":")) ||
        /^-?exports:$/u.test(line) ||
        /^offset\s+symbol$/u.test(line)
      )
        return true;
      const rows = parseDyldExports(line, null, names);
      // The parser withholds a row only when nm names both of its readings.
      if (rows.length === 0)
        return names.has(parseDyldExportAddressRow(line)?.text ?? "");
      return rows.length === 1 && names.has(rows[0]!.name);
    });
};

// nm -j ends each name with LF; a carriage return before it is part of the name.
const parseNmSymbolNames = (output: string): string[] =>
  output.split("\n").filter((name) => name.length > 0);

const parseNmExports = (output: string) =>
  parseNmSymbolNames(output).map((name) => ({
    name,
    address: null,
    weak: null,
    reexport: null,
    source: "nm",
  }));

const covered = <Value>(
  items: readonly Value[],
  exhaustive: boolean,
  limitations: readonly string[] = [],
) => ({
  items: [...items],
  total: exhaustive ? items.length : null,
  exhaustive,
  limitations: [...limitations],
});

const withRuntimeName = <Value extends { readonly name: string | null }>(
  symbol: Value,
): Value & { readonly runtime_name: string | null } => ({
  ...symbol,
  runtime_name: machoRuntimeSymbolName(symbol.name),
});

const uniqueSymbols = <Value extends { readonly name: string }>(
  items: readonly Value[],
): Value[] => {
  const unique = new Map<string, Value>();
  for (const item of items)
    if (!unique.has(item.name)) unique.set(item.name, item);
  return [...unique.values()].sort((left, right) =>
    compareUnicodeCodePoints(left.name, right.name),
  );
};

const fileOffsetLocations = (
  macho: ReturnType<typeof inspectMachoSchema.parse>,
  containerOffset: number | undefined,
  sliceSize: number,
): EvidenceLocation[] => {
  const locations = architectureLocations(macho.architectures.items);
  if (containerOffset === undefined) return locations;
  for (const entrypoint of macho.entrypoints.items)
    if (
      entrypoint.file_offset < sliceSize &&
      Number.isSafeInteger(containerOffset + entrypoint.file_offset)
    )
      locations.push({
        kind: "file-offset",
        offset: containerOffset + entrypoint.file_offset,
      });
  for (const segment of macho.segments.items) {
    if (
      segment.file_offset === null ||
      segment.file_size === null ||
      segment.file_size === 0 ||
      segment.file_offset + segment.file_size > sliceSize ||
      !Number.isSafeInteger(
        containerOffset + segment.file_offset + segment.file_size,
      )
    )
      continue;
    locations.push({
      kind: "file-offset-range",
      start: containerOffset + segment.file_offset,
      end: containerOffset + segment.file_offset + segment.file_size,
    });
  }
  return locations;
};

/** Project architecture slices into evidence file-offset locations. */
export const architectureLocations = (
  architectures: readonly {
    readonly file_offset: number | null;
    readonly size: number | null;
  }[],
): EvidenceLocation[] => {
  const locations: EvidenceLocation[] = [];
  for (const { file_offset: offset, size } of architectures) {
    if (
      offset === null ||
      (size !== null && !Number.isSafeInteger(offset + size))
    )
      continue;
    locations.push(
      size === null
        ? { kind: "file-offset", offset }
        : { kind: "file-offset-range", start: offset, end: offset + size },
    );
  }
  return locations;
};

/**
 * lipo appends the pointer-auth ABI version to arm64e (`arm64e.v1`). Only
 * dyld_info accepts that spelling; the other Apple tools select the slice by
 * its CPU-family name. Other variants are distinct subtypes (`arm64e.x1`)
 * that the tools address only by their exact name.
 */
const architectureBaseName = (architecture: string): string =>
  architecture.replace(/\.v\d+$/u, "");

const toolArchitectureName = (tool: string, architecture: string): string =>
  tool === "dyld_info" ? architecture : architectureBaseName(architecture);

const selectedArchitectureArguments = (
  tool: string,
  architecture: string | null,
): string[] => {
  if (architecture === null) return [];
  const toolArchitecture = toolArchitectureName(tool, architecture);
  return tool === "dwarfdump"
    ? [`--arch=${toolArchitecture}`]
    : ["-arch", toolArchitecture];
};

type ArchitectureSelection =
  | { readonly status: "unfiltered" }
  | {
      readonly status: "selected";
      readonly architecture: LipoArchitecture;
      readonly toolName: string;
    }
  | { readonly status: "ambiguous"; readonly architecture: string }
  | { readonly status: "absent"; readonly architecture: string };

const selectArchitecture = (
  target: BinaryTarget,
  available: readonly LipoArchitecture[],
): ArchitectureSelection => {
  // BinaryTarget lists CPU families and lipo lists slices. A universal file
  // can hold several slices of one family (arm64e and arm64e.x1), and slice
  // tools without -arch print every slice.
  if (
    target.kind !== "executable" ||
    (target.availableArchitectures.length < 2 && available.length < 2)
  )
    return { status: "unfiltered" };
  const normalized =
    target.architecture === "x86" ? "i386" : target.architecture;
  const policy = MACHO_ARCHITECTURE_POLICIES[target.architecture];
  const selected =
    policy === undefined
      ? available.find(({ name }) => name === normalized)
      : selectMachoArchitecture(policy, available);
  if (selected !== undefined) {
    const toolName =
      policy === undefined
        ? selected.name
        : machoToolArchitectureName(policy, selected);
    const selector = architectureBaseName(toolName);
    if (
      available.some((candidate) => {
        if (candidate === selected) return false;
        const candidateName =
          policy === undefined
            ? candidate.name
            : machoToolArchitectureName(policy, candidate);
        return architectureBaseName(candidateName) === selector;
      })
    )
      return { status: "ambiguous", architecture: selector };
    return { status: "selected", architecture: selected, toolName };
  }
  return { status: "absent", architecture: normalized };
};
