import {
  admitManagedProjection,
  managedDecodeBudget,
  ManagedRepresentationFailure,
} from "./ManagedDecodeBudget.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  managedMemberInspectionSchema,
  type ManagedMemberInspection,
  type ManagedParseIssue,
} from "../domain/managed/managedArtifact.js";
import {
  readManagedPeLayout,
  type ManagedPeLayout,
} from "./ManagedPeReader.js";
import {
  readManagedResourceDirectory,
  readManagedMetadataInventory,
  readManagedModuleIdentity,
} from "./ManagedMetadataInventory.js";
import { managedMetadataTypeNames } from "./ManagedMetadataInventoryRows.js";
import { managedPeInspectionEnvelope } from "./ManagedPeInspectionEnvelope.js";
import { readManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import {
  appendManagedParseIssues,
  ManagedReaderFailure,
  uniqueManagedParseIssues,
  managedMetadataFailureStatus,
  type ManagedMetadataHeaderFacts,
} from "./ManagedReaderFailure.js";
import {
  parseTypes,
  readTypeDefinitions,
  type DecodedTypeDefinition,
} from "./ManagedMemberInspectorCore.js";
import { edgeTargets } from "./ManagedMethodSpecs.js";
import { managedSignatureTypeNames } from "./ManagedSignatureTypeNames.js";
import { typeNameLookup } from "./ManagedTypeNames.js";
import { managedTypeReferences } from "./ManagedTypeReferences.js";
import { parseUserStrings } from "./ManagedUserStrings.js";
import { readTypeMemberListFacts } from "./ManagedTypeMemberLists.js";
import { prepareManagedMemberRecovery } from "./ManagedMemberRecovery.js";
import {
  edges,
  parseExportedTypes,
  parseFields,
  parseMemberRefs,
  parseMethods,
  type SelectedTypeTokens,
} from "./ManagedMemberRows.js";

const unavailable = (
  target: BinaryTarget,
  bytes: Buffer,
  typeNames: readonly string[] | undefined,
  {
    issue,
    metadataHeader,
  }: {
    readonly issue: ManagedParseIssue | null;
    readonly metadataHeader?: ManagedMetadataHeaderFacts | null;
  },
): ManagedMemberInspection =>
  managedMemberInspectionSchema.parse(
    admitManagedProjection({
      artifact: {
        path: target.path,
        sha256: target.sha256,
        byte_length: bytes.length,
        format: "pe",
      },
      module: null,
      metadata: {
        status: issue === null ? "absent" : managedMetadataFailureStatus(issue),
        version: metadataHeader?.version ?? null,
        table_row_counts: {},
      },
      identity_scope: {
        token_identity: "build-local",
        requires_artifact_sha256: target.sha256,
        requires_mvid: null,
      },
      types: [],
      signature_resolution: "type-names-v2",
      nesting_read: false,
      exported_types: null,
      user_strings: null,
      fields: [],
      methods: [],
      member_refs: [],
      call_edges: [],
      field_accesses: [],
      // Nothing was examined, so no requested name is known to be unmatched.
      selection:
        typeNames === undefined
          ? null
          : { type_names: [...typeNames], unmatched_type_names: [] },
      method_rows: null,
      coverage: {
        state: "unavailable",
        issues: issue === null ? [] : [issue],
      },
      limitations: [
        issue === null
          ? "The PE has no admitted CLI metadata; managed member inspection is unavailable."
          : "The CLI metadata could not be admitted; managed member inspection is unavailable.",
      ],
    }),
  );

const readMemberLayout = (bytes: Buffer, pe: ManagedPeLayout) => {
  const cli = pe.cli;
  if (cli === null)
    throw new TypeError("Managed inventory requires CLI metadata");
  const rootOffset = pe.rvaToOffset(
    cli.metadata.rva,
    cli.metadata.size,
    "cli.metadata",
  );
  const layout = readManagedMetadataLayout(
    bytes,
    rootOffset,
    cli.metadata.size,
  );
  const memberLists = readTypeMemberListFacts(bytes, layout);
  return { layout, memberLists };
};

const selectTypes = (
  types: readonly DecodedTypeDefinition[],
  typeNames: readonly string[] | undefined,
): {
  readonly tokens: SelectedTypeTokens;
  readonly selection: ManagedMemberInspection["selection"];
} => {
  if (typeNames === undefined) return { tokens: null, selection: null };
  const requested = new Set(typeNames);
  const tokens = new Set<string>();
  const matched = new Set<string>();
  for (const { type } of types) {
    const nested = (type.flags & 0x7) >= 2;
    const spellings = nested ? [type.full_name, type.name] : [type.full_name];
    for (const name of spellings) {
      if (!requested.has(name)) continue;
      tokens.add(type.token);
      matched.add(name);
    }
  }
  return {
    tokens,
    selection: {
      type_names: [...typeNames],
      unmatched_type_names: typeNames.filter((name) => !matched.has(name)),
    },
  };
};

/**
 * Inspect metadata members and method bodies without loading target code.
 * Selected type names restrict full decoding to members of those exact types.
 * A caller that never reads literals, such as member comparison, can skip
 * user strings; they are then reported as not examined.
 */
export const inspectManagedMembersBytes = (
  bytes: Buffer,
  target: BinaryTarget,
  {
    typeNames,
    methodOffset = 0,
    methodLimit = Number.MAX_SAFE_INTEGER,
    userStrings: readUserStrings = true,
  }: {
    readonly typeNames?: readonly string[];
    /** Zero-based offset into MethodDef rows. */
    readonly methodOffset?: number;
    readonly methodLimit?: number;
    readonly userStrings?: boolean;
  } = {},
): ManagedMemberInspection => {
  if (
    !Number.isSafeInteger(methodOffset) ||
    methodOffset < 0 ||
    !Number.isSafeInteger(methodLimit) ||
    methodLimit < 0
  )
    throw new RangeError(
      "methodOffset and methodLimit must be non-negative safe integers",
    );
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null)
    return unavailable(target, bytes, typeNames, { issue: pe.cliIssue });
  const issues: ManagedParseIssue[] = [];
  let recover: ReturnType<typeof prepareManagedMemberRecovery> | undefined;
  try {
    const { layout, memberLists } = readMemberLayout(bytes, pe);
    const methodTotal = layout.table(6)?.rowCount ?? 0;
    const methodRows = {
      offset: Math.min(methodOffset, methodTotal),
      count: Math.min(methodLimit, Math.max(0, methodTotal - methodOffset)),
      total: methodTotal,
    };
    const identity = readManagedModuleIdentity(bytes, layout);
    appendManagedParseIssues(issues, identity.issues);
    const ranges = readTypeDefinitions(bytes, layout, issues, memberLists);
    const parsedTypes = parseTypes(bytes, layout, ranges);
    const { tokens: selected, selection } = selectTypes(
      parsedTypes.types,
      typeNames,
    );
    const unreadableNames =
      typeNames === undefined ? 0 : ranges.length - parsedTypes.types.length;
    appendManagedParseIssues(issues, parsedTypes.issues);
    const typeReferences = managedTypeReferences(bytes, layout, issues);
    const {
      operand: signatureTypeName,
      declaration: declarationTypeName,
      displayName: displayTypeName,
    } = managedSignatureTypeNames(layout, issues, parsedTypes, typeReferences);
    const types = parsedTypes.types
      .filter(({ type }) => selected === null || selected.has(type.token))
      .map(({ row, type }) => {
        managedDecodeBudget(layout).reserve(512, type.row_offset);
        return {
          ...type,
          name_sha256: declarationTypeName(2, row)?.toString("hex") ?? null,
        };
      });
    const envelope = managedPeInspectionEnvelope(
      target,
      bytes.length,
      layout,
      identity.module,
      issues,
    );
    const unnamedTypes = types.reduce(
      (count, type) => count + Number(type.name_sha256 === null),
      0,
    );
    const typeIdentityLimitations =
      unnamedTypes === 0
        ? []
        : [
            `${String(unnamedTypes)} returned TypeDef name identity(s) remain unresolved; incomplete, missing, contradictory, cyclic or over-deep enclosing facts cannot be repaired by bare display names.`,
          ];
    const selectionLimitations = [
      ...(selection === null
        ? []
        : [
            "Types, fields, methods, call edges, field accesses, and user strings cover only the selected declaring types; coverage describes that selection. Edge targets outside it keep their names but are not described.",
          ]),
      ...(unreadableNames === 0
        ? []
        : [
            `${String(unreadableNames)} TypeDef name(s) could not be read; a name in selection.unmatched_type_names may belong to one of them, so its absence is not observed.`,
          ]),
    ];
    recover = prepareManagedMemberRecovery(
      {
        ...envelope,
        types,
        nesting_read: parsedTypes.nesting.complete,
        selection,
        method_rows: methodRows,
        limitations: [...typeIdentityLimitations, ...selectionLimitations],
      },
      uniqueManagedParseIssues(issues),
      managedDecodeBudget(layout),
    );
    const inventory = readManagedMetadataInventory(
      bytes,
      layout,
      readManagedResourceDirectory(pe, issues),
      memberLists,
      identity,
      managedMetadataTypeNames(
        bytes,
        layout,
        issues,
        parsedTypes,
        typeReferences,
      ),
    );
    appendManagedParseIssues(issues, inventory.issues);
    const exportedTypes = parseExportedTypes(bytes, layout);
    appendManagedParseIssues(issues, exportedTypes.issues);
    const fields = parseFields(bytes, layout, ranges, memberLists, {
      signatureTypeName,
      displayTypeName,
      declarationTypeName,
      selected,
    });
    const resolveTypeName = typeNameLookup(
      bytes,
      layout,
      ranges,
      issues,
      typeReferences,
    );
    const memberRefs = parseMemberRefs(bytes, layout, {
      typeName: resolveTypeName,
      signatureTypeName,
      displayTypeName,
      declarationTypeName,
    });
    appendManagedParseIssues(issues, memberRefs.issues);
    const methods = parseMethods({
      bytes,
      layout,
      pe,
      ranges,
      signatureTypeName,
      displayTypeName,
      declarationTypeName,
      memberRefKinds: new Map(
        memberRefs.refs.flatMap((memberRef) =>
          memberRef.signature.kind === "field" ||
          memberRef.signature.kind === "method"
            ? [[memberRef.token, memberRef.signature.kind] as const]
            : [],
        ),
      ),
      memberLists,
      selected,
      methodOffset,
      methodLimit,
    });
    appendManagedParseIssues(issues, fields.issues, methods.issues);
    const resolvedMethods = methods.methods.map(({ method, catchTokens }) => ({
      ...method,
      body: {
        ...method.body,
        exception_regions: method.body.exception_regions.map(
          (region, ordinal) => {
            const reference = catchTokens.get(ordinal) ?? null;
            const classType = resolveTypeName(reference);
            const identityResolved =
              reference === null
                ? null
                : classType !== null && reference.table === 2
                  ? declarationTypeName(2, reference.row) !== null
                  : false;
            return {
              ...region,
              class_type: classType,
              class_type_name_sha256:
                reference !== null &&
                (reference.table === 1 || reference.table === 2)
                  ? (declarationTypeName(
                      reference.table,
                      reference.row,
                    )?.toString("hex") ?? null)
                  : null,
              class_type_identity_resolved: identityResolved,
            };
          },
        ),
      },
    }));
    // #US literals sit beside the member inventory and carry their own
    // coverage, so their issues never make member facts partial.
    const userStrings = readUserStrings
      ? parseUserStrings(bytes, layout, {
          ...methods,
          unreadableSelectedTypes: unreadableNames,
        })
      : null;
    const targets = edgeTargets(
      bytes,
      layout,
      methods.methods,
      [fields.core, memberRefs.core, methods.core],
      signatureTypeName,
    );
    appendManagedParseIssues(issues, targets.issues);
    const incompleteMembers =
      [...fields.fields, ...memberRefs.refs].some(
        (member) => member.signature.parse_status !== "decoded",
      ) ||
      resolvedMethods.some(
        (method) => method.signature.parse_status !== "decoded",
      ) ||
      resolvedMethods.some(
        (method) =>
          method.body.status === "partial" ||
          method.body.status === "malformed",
      );
    const related = edges(
      methods.methods,
      targets.members,
      managedDecodeBudget(layout),
    );
    const coverageIssues = uniqueManagedParseIssues(issues);
    return managedMemberInspectionSchema.parse(
      admitManagedProjection(
        {
          ...envelope,
          metadata: {
            ...envelope.metadata,
            status: issues.length === 0 ? "complete" : "partial",
          },
          assembly: inventory.assembly,
          types,
          signature_resolution: "type-names-v2",
          nesting_read: parsedTypes.nesting.complete,
          exported_types: exportedTypes.exportedTypes,
          fields: fields.fields,
          methods: resolvedMethods,
          member_refs: memberRefs.refs,
          call_edges: related.callEdges,
          field_accesses: related.fieldAccesses,
          user_strings: userStrings,
          selection,
          method_rows: methodRows,
          coverage: {
            state:
              issues.length === 0 && !incompleteMembers
                ? "complete"
                : "partial",
            issues: coverageIssues,
          },
          limitations: [
            ...typeIdentityLimitations,
            "Metadata tokens are build-local coordinates and are only meaningful with the reported artifact SHA-256 and MVID.",
            "CIL instruction anchors are decoded from file-backed method bodies only; no target assembly is loaded or executed.",
            "Field constants are file-backed Constant-table declarations, not runtime field values. Parameter and property defaults and enum-name mappings are not decoded.",
            "Exported types are reported from ExportedType rows as declared; forwarded types are not resolved in their implementing assemblies.",
            "User strings are the #US literals loaded by ldstr in the inspected method bodies, with their own coverage; instruction anchors and normalized CIL digests keep their build-local tokens.",
            "Member signatures decode ECMA-335 primitive, class, valuetype, generic instantiation, generic variable, pointer, byref, single-dimension and general array, function pointer including VARARG sentinels, custom modifier, and typed reference forms; type operands keep their encoded TypeDefOrRefOrSpec values and append readable TypeDef/TypeRef names when resolved.",
            ...selectionLimitations,
          ],
        },
        managedDecodeBudget(layout),
      ),
    );
  } catch (cause: unknown) {
    if (cause instanceof ManagedReaderFailure) {
      if (
        recover !== undefined &&
        cause instanceof ManagedRepresentationFailure
      )
        return recover(cause.issue.offset);
      return unavailable(target, bytes, typeNames, cause);
    }
    throw cause;
  }
};
