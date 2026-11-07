import { readFieldDefinitionRow } from "./ManagedFieldDefinitionRows.js";
import {
  readMethodDefinitionRow,
  type ManagedMethodImplementationFlags,
} from "./ManagedMethodDefinitionRows.js";
import {
  admitManagedProjection,
  managedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  managedNativeBoundaryInspectionSchema,
  type ManagedNativeBoundaryInspection,
  type ManagedParseIssue,
} from "../domain/managed/managedArtifact.js";
import {
  MANAGED_CODED_INDEXES,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import {
  metadataRowCursor,
  decodeMetadataCodedIndex,
  metadataToken,
  readMetadataString,
} from "./ManagedMetadataHeaps.js";
import { managedPeInspectionEnvelope } from "./ManagedPeInspectionEnvelope.js";
import type { ManagedMetadataInventory } from "./ManagedMetadataInventory.js";
import {
  managedCli32BitRequirement,
  managedCliIsMixedClrNative,
  type ManagedCliHeader,
  type ManagedPeLayout,
} from "./ManagedPeReader.js";
import { readManagedValue } from "./ManagedReaderFailure.js";

type ModuleRef = ManagedNativeBoundaryInspection["module_refs"][number];
type NativeImport = ManagedNativeBoundaryInspection["pinvoke_imports"][number];
type NativeImplementation =
  ManagedNativeBoundaryInspection["native_implementations"][number];

type MemberCore = {
  readonly token: string;
  readonly rowOffset: number;
  readonly name: string;
  readonly flags: number;
} & (
  | {
      readonly kind: "field";
      readonly implFlags: null;
      readonly rva: null;
    }
  | {
      readonly kind: "method";
      readonly implFlags: number;
      readonly rva: number;
      readonly implementation: ManagedMethodImplementationFlags;
    }
);

const flagsHex = (value: number): string =>
  `0x${value.toString(16).padStart(4, "0")}`;

export const parseModuleRefs = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  heapExtent: number,
  issues: ManagedParseIssue[],
): readonly ModuleRef[] => {
  const refs: ModuleRef[] = [];
  const table = layout.table(26);
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const cursor = metadataRowCursor(bytes, layout, 26, row);
      refs.push({
        token: metadataToken(26, row),
        row_offset: cursor.start,
        name: readMetadataString(
          bytes,
          layout,
          cursor.readIndex(layout.stringIndexSize),
          heapExtent,
        ),
      });
    }, issues);
  }
  return refs;
};

export const parseFields = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  heapExtent: number,
  issues: ManagedParseIssue[],
): ReadonlyMap<string, MemberCore> => {
  const fields = new Map<string, MemberCore>();
  const table = layout.table(4);
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const { token, rowOffset, flags, nameIndex } = readFieldDefinitionRow(
        bytes,
        layout,
        row,
      );
      const name = readMetadataString(bytes, layout, nameIndex, heapExtent);
      fields.set(token, {
        token,
        rowOffset,
        kind: "field",
        name,
        flags,
        implFlags: null,
        rva: null,
      });
    }, issues);
  }
  return fields;
};

export const parseMethods = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  heapExtent: number,
  issues: ManagedParseIssue[],
): ReadonlyMap<string, MemberCore> => {
  const methods = new Map<string, MemberCore>();
  const table = layout.table(6);
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const {
        token,
        rowOffset,
        rva,
        implFlags,
        flags,
        nameIndex,
        implementation,
      } = readMethodDefinitionRow(bytes, layout, row);
      const name = readMetadataString(bytes, layout, nameIndex, heapExtent);
      methods.set(token, {
        token,
        rowOffset,
        kind: "method",
        name,
        flags,
        implFlags,
        rva,
        implementation,
      });
    }, issues);
  }
  return methods;
};

interface ParseImplMapsContext {
  readonly bytes: Buffer;
  readonly layout: ManagedMetadataLayout;
  readonly heapExtent: number;
  readonly modules: readonly ModuleRef[];
  readonly members: ReadonlyMap<string, MemberCore>;
  readonly issues: ManagedParseIssue[];
}

export const parseImplMaps = ({
  bytes,
  layout,
  heapExtent,
  modules,
  members,
  issues,
}: ParseImplMapsContext): readonly NativeImport[] => {
  const moduleNames = new Map(modules.map((module) => [module.token, module]));
  const imports: NativeImport[] = [];
  const table = layout.table(28);
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const cursor = metadataRowCursor(bytes, layout, 28, row);
      const mappingFlags = cursor.readUInt16();
      const memberForwardedOffset = cursor.offset;
      const memberForwardedRaw = cursor.readIndex(
        layout.codedIndexSize("MemberForwarded"),
      );
      const memberForwarded = decodeMetadataCodedIndex(
        memberForwardedRaw,
        MANAGED_CODED_INDEXES.MemberForwarded.bits,
        MANAGED_CODED_INDEXES.MemberForwarded.tables,
        layout.rowCounts,
      );
      if (memberForwarded.kind !== "valid")
        issues.push({
          code: "invalid-row",
          scope: `metadata.ImplMap:${metadataToken(28, row)}`,
          offset: memberForwardedOffset,
          detail:
            memberForwarded.kind === "null"
              ? "ImplMap MemberForwarded coded index 0x0 is null, but the column must reference a Field or MethodDef row"
              : `ImplMap MemberForwarded coded index 0x${memberForwardedRaw.toString(16)} is invalid: ${memberForwarded.reason}`,
        });
      const memberToken =
        memberForwarded.kind === "valid" ? memberForwarded.token : null;
      const importName = readMetadataString(
        bytes,
        layout,
        cursor.readIndex(layout.stringIndexSize),
        heapExtent,
      );
      const importScopeOffset = cursor.offset;
      const importScopeRow = cursor.readIndex(layout.tableIndexSize(26));
      const moduleCount = layout.table(26)?.rowCount ?? 0;
      const validImportScope =
        importScopeRow > 0 && importScopeRow <= moduleCount;
      if (!validImportScope)
        issues.push({
          code: "invalid-row",
          scope: `metadata.ImplMap:${metadataToken(28, row)}`,
          offset: importScopeOffset,
          detail: `ImplMap ImportScope row ${String(importScopeRow)} must reference a ModuleRef row between 1 and ${String(moduleCount)}`,
        });
      const importScopeToken = validImportScope
        ? metadataToken(26, importScopeRow)
        : null;
      const member =
        memberToken === null ? undefined : members.get(memberToken);
      imports.push({
        token: metadataToken(28, row),
        row_offset: cursor.start,
        mapping_flags: mappingFlags,
        mapping_flags_hex: flagsHex(mappingFlags),
        member_token: memberToken,
        member_kind:
          memberForwarded.kind !== "valid"
            ? "unknown"
            : memberForwarded.table === 4
              ? "field"
              : "method",
        member_name: member?.name ?? null,
        import_name: importName,
        import_scope_token: importScopeToken,
        import_scope_name:
          importScopeToken === null
            ? null
            : (moduleNames.get(importScopeToken)?.name ?? null),
        no_mangle: (mappingFlags & 0x0001) !== 0,
        char_set: charSet(mappingFlags),
        call_convention: callConvention(mappingFlags),
        supports_last_error: (mappingFlags & 0x0040) !== 0,
        best_fit: bestFit(mappingFlags),
        throw_on_unmappable_char: throwOnUnmappable(mappingFlags),
        verification: "managed-declaration-only",
      });
    }, issues);
  }
  return imports;
};

const charSet = (flags: number): NativeImport["char_set"] => {
  switch (flags & 0x0006) {
    case 0x0000:
      return "not-specified";
    case 0x0002:
      return "ansi";
    case 0x0004:
      return "unicode";
    case 0x0006:
      return "auto";
    default:
      return "unknown";
  }
};

const callConvention = (flags: number): NativeImport["call_convention"] => {
  switch (flags & 0x0700) {
    case 0x0000:
      return "not-specified";
    case 0x0100:
      return "winapi";
    case 0x0200:
      return "cdecl";
    case 0x0300:
      return "stdcall";
    case 0x0400:
      return "thiscall";
    case 0x0500:
      return "fastcall";
    default:
      return "unknown";
  }
};

const bestFit = (flags: number): NativeImport["best_fit"] => {
  switch (flags & 0x0030) {
    case 0x0000:
      return "assembly-default";
    case 0x0010:
      return "enabled";
    case 0x0020:
      return "disabled";
    default:
      return "unknown";
  }
};

const throwOnUnmappable = (
  flags: number,
): NativeImport["throw_on_unmappable_char"] => {
  switch (flags & 0x3000) {
    case 0x0000:
      return "assembly-default";
    case 0x1000:
      return "enabled";
    case 0x2000:
      return "disabled";
    default:
      return "unknown";
  }
};

export const nativeImplementations = (
  methods: Iterable<MemberCore>,
  pinvokeTokens: ReadonlySet<string>,
): readonly NativeImplementation[] => {
  const implementations: NativeImplementation[] = [];
  for (const method of methods) {
    if (method.kind !== "method") continue;
    const { codeType, managedKind, pinvokeFlag } = method.implementation;
    const pinvokeDeclared = pinvokeTokens.has(method.token) || pinvokeFlag;
    if (!pinvokeDeclared && codeType === "il" && managedKind === "managed")
      continue;
    implementations.push({
      token: method.token,
      row_offset: method.rowOffset,
      name: method.name,
      rva: method.rva,
      flags: method.flags,
      impl_flags: method.implFlags,
      code_type: codeType,
      managed_kind: managedKind,
      pinvoke_declared: pinvokeDeclared,
      boundary_kind: boundaryKind(pinvokeDeclared, codeType, managedKind),
      body_interpretation:
        method.rva === 0 ? "not-file-backed" : "native-or-runtime",
    });
  }
  return implementations;
};

const boundaryKind = (
  pinvokeDeclared: boolean,
  codeType: ManagedMethodImplementationFlags["codeType"],
  managedKind: ManagedMethodImplementationFlags["managedKind"],
): NativeImplementation["boundary_kind"] => {
  if (pinvokeDeclared) return "pinvoke";
  if (codeType === "native") return "native-body";
  if (codeType === "runtime") return "runtime-provided";
  if (managedKind === "unmanaged") return "unmanaged-method";
  return "mixed-or-unknown";
};

export const cliNative = (
  cli: ManagedCliHeader | null,
): ManagedNativeBoundaryInspection["cli_native"] => {
  if (cli === null) return null;
  return {
    il_only: (cli.flags & 0x0000_0001) !== 0,
    requires_32bit: managedCli32BitRequirement(cli.flags) === "required",
    strong_name_signed: (cli.flags & 0x0000_0008) !== 0,
    native_entry_point: (cli.flags & 0x0000_0010) !== 0,
    ready_to_run_signature: cli.readyToRunSignature,
    managed_native_header_rva: cli.managedNativeHeader.rva,
    managed_native_header_size: cli.managedNativeHeader.size,
  };
};

/** Summarize declaration counts with the native facets of the CLI header. */
export const nativeBoundarySummary = (
  cli: ManagedCliHeader | null,
  counts: Pick<
    ManagedNativeBoundaryInspection["summary"],
    "module_ref_count" | "pinvoke_import_count" | "native_implementation_count"
  >,
): ManagedNativeBoundaryInspection["summary"] => ({
  ...counts,
  ready_to_run: cli?.readyToRunSignature ?? null,
  mixed_mode_or_native_header:
    cli === null
      ? null
      : managedCliIsMixedClrNative(cli) ||
        cli.managedNativeHeader.rva !== 0 ||
        cli.managedNativeHeader.size !== 0 ||
        (cli.flags & 0x0000_0010) !== 0,
});

interface BoundaryInspectionContext {
  readonly target: BinaryTarget;
  readonly bytes: Buffer;
  readonly pe: ManagedPeLayout;
  readonly layout: ManagedMetadataLayout;
  readonly inventory: ManagedMetadataInventory;
  readonly moduleRefs: readonly ModuleRef[];
  readonly imports: readonly NativeImport[];
  readonly implementations: readonly NativeImplementation[];
  readonly issues: readonly ManagedParseIssue[];
}

export const buildNativeBoundaryInspection = ({
  target,
  bytes,
  pe,
  layout,
  inventory,
  moduleRefs,
  imports,
  implementations,
  issues,
}: BoundaryInspectionContext): ManagedNativeBoundaryInspection =>
  managedNativeBoundaryInspectionSchema.parse(
    admitManagedProjection(
      {
        ...managedPeInspectionEnvelope(
          target,
          bytes.length,
          layout,
          inventory.module,
          issues,
        ),
        cli_native: cliNative(pe.cli),
        module_refs: moduleRefs,
        pinvoke_imports: imports,
        native_implementations: implementations,
        summary: nativeBoundarySummary(pe.cli, {
          module_ref_count: moduleRefs.length,
          pinvoke_import_count: imports.length,
          native_implementation_count: implementations.length,
        }),
        coverage: {
          state: issues.length === 0 ? "complete" : "partial",
          issues,
        },
        limitations: [
          "P/Invoke rows prove managed import declarations only; this inspection does not verify that a native library, export, thunk, or provider-qualified function exists.",
          "Managed metadata tokens are build-local coordinates and are only meaningful with the reported artifact SHA-256 and MVID.",
          "ReadyToRun, NativeAOT, C++/CLI, and IL2CPP native semantics require separately selected native-provider evidence; this tool does not translate managed tokens into native addresses.",
        ],
      },
      managedDecodeBudget(layout),
    ),
  );
