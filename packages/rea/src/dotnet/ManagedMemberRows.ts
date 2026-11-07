import { readFieldDefinitionRow } from "./ManagedFieldDefinitionRows.js";
import { createManagedFieldConstantReader } from "./ManagedFieldConstants.js";
import { readMemberReferenceRowFacts } from "./ManagedMemberReferenceRows.js";
import { readMethodDefinitionRow } from "./ManagedMethodDefinitionRows.js";
import { jsonStringByteLength } from "../domain/jsonStringByteLength.js";
import { isManagedMemberReferenceInstruction } from "../domain/managed/managedMemberInstructionFacts.js";
import {
  admitManagedProjection,
  managedDecodeBudget,
  type ManagedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import type { ManagedPeLayout } from "./ManagedPeReader.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import {
  MANAGED_CODED_INDEXES,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import {
  metadataSignature,
  memberTargetIdentity,
  signatureGenericArity,
  type ManagedCallEdge,
  type ManagedExportedType,
  type ManagedField,
  type ManagedFieldAccess,
  type ManagedMemberRef,
  type ManagedMethod,
  type DecodedMethod,
  type MemberCore,
  type SignatureTypeName,
  type SignatureDisplayTypeName,
  type DeclarationTypeName,
  type TypeRange,
} from "./ManagedMemberInspectorCore.js";
import {
  metadataToken,
  type MetadataTokenFact,
  metadataRowCursor,
  decodeMetadataCodedIndex,
  readMetadataBlob,
  readMetadataString,
} from "./ManagedMetadataHeaps.js";
import {
  appendManagedParseIssues,
  readManagedValue,
} from "./ManagedReaderFailure.js";
import { methodBody } from "./ManagedMethodBodyReader.js";
import { memberDeclaringTypeRowLookup } from "./ManagedMemberOwnership.js";
import type { TypeMemberListFacts } from "./ManagedTypeMemberLists.js";

/**
 * Declaring-type tokens whose members are decoded in full; null selects every
 * type. Unselected members keep only their name so edges stay labelled.
 */
export type SelectedTypeTokens = ReadonlySet<string> | null;

const isSelected = (
  selected: SelectedTypeTokens,
  declared: { readonly token: string } | undefined,
): boolean =>
  selected === null || (declared !== undefined && selected.has(declared.token));

export const parseFields = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  ranges: readonly TypeRange[],
  memberLists: TypeMemberListFacts,
  {
    signatureTypeName,
    displayTypeName,
    declarationTypeName,
    selected = null,
  }: {
    readonly signatureTypeName: SignatureTypeName;
    readonly displayTypeName: SignatureDisplayTypeName;
    readonly declarationTypeName: DeclarationTypeName;
    readonly selected?: SelectedTypeTokens;
  },
): {
  readonly fields: readonly ManagedField[];
  readonly core: ReadonlyMap<string, MemberCore>;
  readonly issues: readonly ManagedParseIssue[];
} => {
  const fields: ManagedField[] = [];
  const core = new Map<string, MemberCore>();
  const issues: ManagedParseIssue[] = [];
  const constant = createManagedFieldConstantReader(bytes, layout, issues);
  const table = layout.table(4);
  const ownerRow = readManagedValue(
    () => memberDeclaringTypeRowLookup(bytes, layout, 4, memberLists),
    issues,
  );
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const { token, rowOffset, flags, nameIndex, signatureIndex } =
        readFieldDefinitionRow(bytes, layout, row);
      const name = readMetadataString(
        bytes,
        layout,
        nameIndex,
        layout.strings.size,
      );
      const owner =
        ownerRow === undefined
          ? 0
          : (readManagedValue(() => ownerRow(row), issues) ?? 0);
      const declared = ranges[owner - 1];
      core.set(token, {
        token,
        name,
        declaringType: declared?.fullName ?? null,
        kind: "field",
      });
      if (!isSelected(selected, declared)) return;
      const sig = readMetadataBlob(
        bytes,
        layout,
        signatureIndex,
        layout.blob?.size ?? 0,
      );
      const decoded = budgetedSignature(
        sig,
        layout,
        signatureTypeName,
        displayTypeName,
        issues,
        { scope: `Field:${token}.signature`, kind: "field", artifact: bytes },
      );
      core.set(token, {
        token,
        name,
        declaringType: declared?.fullName ?? null,
        kind: "field",
        identitySha256: memberTargetIdentity(
          name,
          declared === undefined ? null : { table: 2, row: owner },
          decoded,
          declarationTypeName,
        ),
      });
      fields.push({
        token,
        row_offset: rowOffset,
        declaring_type_token: declared?.token ?? null,
        declaring_type: declared?.fullName ?? null,
        name,
        flags,
        signature: decoded,
        constant: constant(row, flags),
      });
    }, issues);
  }
  return { fields, core, issues };
};

const TYPE_FORWARDER_FLAG = 0x0020_0000;

/** Read ExportedType rows, including type forwarders, as declared. */
export const parseExportedTypes = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
): {
  readonly exportedTypes: readonly ManagedExportedType[];
  readonly issues: readonly ManagedParseIssue[];
} => {
  const exportedTypes: ManagedExportedType[] = [];
  const issues: ManagedParseIssue[] = [];
  const table = layout.table(39);
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const cursor = metadataRowCursor(bytes, layout, 39, row);
      const flags = cursor.readUInt32();
      const typeDefId = cursor.readUInt32();
      const name = readMetadataString(
        bytes,
        layout,
        cursor.readIndex(layout.stringIndexSize),
        layout.strings.size,
      );
      const namespace = readMetadataString(
        bytes,
        layout,
        cursor.readIndex(layout.stringIndexSize),
        layout.strings.size,
      );
      const implementationOffset = cursor.offset;
      const implementationRaw = cursor.readIndex(
        layout.codedIndexSize("Implementation"),
      );
      const token = metadataToken(39, row);
      const implementation = decodeMetadataCodedIndex(
        implementationRaw,
        MANAGED_CODED_INDEXES.Implementation.bits,
        MANAGED_CODED_INDEXES.Implementation.tables,
        layout.rowCounts,
      );
      if (implementation.kind !== "valid")
        issues.push({
          code: "invalid-row",
          scope: `metadata.ExportedType:${token}`,
          offset: implementationOffset,
          detail:
            implementation.kind === "null"
              ? "ExportedType implementation coded index 0x0 is null, but the Implementation column must reference a row"
              : `ExportedType implementation coded index 0x${implementationRaw.toString(16)} is invalid: ${implementation.reason}`,
        });
      exportedTypes.push({
        token,
        row_offset: cursor.start,
        namespace,
        name,
        flags,
        forwarder: (flags & TYPE_FORWARDER_FLAG) !== 0,
        type_def_id: typeDefId,
        implementation_token:
          implementation.kind === "valid" ? implementation.token : null,
      });
    }, issues);
  }
  return { exportedTypes, issues };
};

export const parseMemberRefs = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  {
    typeName,
    signatureTypeName,
    displayTypeName,
    declarationTypeName,
  }: {
    readonly typeName: (
      reference: Pick<MetadataTokenFact, "table" | "row" | "token"> | null,
    ) => string | null;
    readonly signatureTypeName: SignatureTypeName;
    readonly displayTypeName: SignatureDisplayTypeName;
    readonly declarationTypeName: DeclarationTypeName;
  },
): {
  readonly refs: readonly ManagedMemberRef[];
  readonly core: ReadonlyMap<string, MemberCore>;
  readonly issues: readonly ManagedParseIssue[];
} => {
  const refs: ManagedMemberRef[] = [];
  const core = new Map<string, MemberCore>();
  const issues: ManagedParseIssue[] = [];
  const table = layout.table(10);
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const { token, rowOffset, parentRaw, parent, nameIndex, signatureIndex } =
        readMemberReferenceRowFacts(bytes, layout, row);
      const name = readMetadataString(
        bytes,
        layout,
        nameIndex,
        layout.strings.size,
      );
      const sig = readMetadataBlob(
        bytes,
        layout,
        signatureIndex,
        layout.blob?.size ?? 0,
      );
      if (parent.kind !== "valid")
        issues.push({
          code: "invalid-row",
          scope: `metadata.MemberRef:${token}`,
          offset: rowOffset,
          detail:
            parent.kind === "null"
              ? "MemberRef parent coded index 0x0 is null, but the Class column must reference a row"
              : `MemberRef parent coded index 0x${parentRaw.toString(16)} is invalid: ${parent.reason}`,
        });
      const parentToken = parent.kind === "valid" ? parent.token : null;
      const parentName = typeName(parent.kind === "valid" ? parent : null);
      const decoded = budgetedSignature(
        sig,
        layout,
        signatureTypeName,
        displayTypeName,
        issues,
        { scope: `MemberRef:${token}.signature`, artifact: bytes },
      );
      refs.push({
        token,
        row_offset: rowOffset,
        parent_token: parentToken,
        parent_name: parentName,
        name,
        signature: decoded,
      });
      core.set(token, {
        token,
        name,
        declaringType: parentName,
        kind: decoded.kind,
        genericArity: signatureGenericArity(decoded),
        identitySha256: memberTargetIdentity(
          name,
          parent.kind === "valid" ? parent : null,
          decoded,
          declarationTypeName,
        ),
      });
    }, issues);
  }
  return { refs, core, issues };
};

interface ParseMethodsInput {
  readonly bytes: Buffer;
  readonly layout: ManagedMetadataLayout;
  readonly pe: ManagedPeLayout;
  readonly ranges: readonly TypeRange[];
  readonly signatureTypeName: SignatureTypeName;
  readonly displayTypeName: SignatureDisplayTypeName;
  readonly declarationTypeName: DeclarationTypeName;
  readonly memberRefKinds: ReadonlyMap<string, "field" | "method">;
  readonly memberLists: TypeMemberListFacts;
  readonly selected?: SelectedTypeTokens;
  readonly methodOffset?: number;
  readonly methodLimit?: number;
}

export const parseMethods = ({
  bytes,
  layout,
  pe,
  ranges,
  signatureTypeName,
  displayTypeName,
  declarationTypeName,
  memberRefKinds,
  memberLists,
  selected = null,
  methodOffset = 0,
  methodLimit = Number.MAX_SAFE_INTEGER,
}: ParseMethodsInput): {
  readonly methods: readonly DecodedMethod[];
  readonly core: ReadonlyMap<string, MemberCore>;
  readonly issues: readonly ManagedParseIssue[];
  /**
   * Methods that may belong to a selected type but whose CIL was not fully
   * scanned: rows that produced no method, or bodies whose decoding stopped.
   */
  readonly unscannedMethods: number;
} => {
  const methods: DecodedMethod[] = [];
  const core = new Map<string, MemberCore>();
  const issues: ManagedParseIssue[] = [];
  let unscannedMethods = 0;
  const table = layout.table(6);
  const ownerRow = readManagedValue(
    () => memberDeclaringTypeRowLookup(bytes, layout, 6, memberLists),
    issues,
  );
  for (let row = 1; row <= (table?.rowCount ?? 0); row += 1) {
    // The owner is read first: a row that produced no method hides a selected
    // body only when its owner is selected, unknown, or unreadably named.
    const owner =
      ownerRow === undefined
        ? undefined
        : readManagedValue(() => ownerRow(row), issues);
    const declared = owner === undefined ? undefined : ranges[owner - 1];
    const inPage = row > methodOffset && row - methodOffset <= methodLimit;
    const mayBeSelected =
      inPage &&
      (selected === null ||
        owner === undefined ||
        owner === 0 ||
        isSelected(selected, declared) ||
        // A type whose name is unreadable may be one the caller requested.
        declared?.fullName === null);
    const produced = methods.length;
    readManagedValue(() => {
      const {
        token,
        rowOffset,
        rva,
        implFlags,
        flags,
        nameIndex,
        signatureIndex,
        implementation,
      } = readMethodDefinitionRow(bytes, layout, row);
      const name = readMetadataString(
        bytes,
        layout,
        nameIndex,
        layout.strings.size,
      );
      const member = {
        token,
        name,
        declaringType: declared?.fullName ?? null,
        kind: "method",
      } as const;
      core.set(token, member);
      if (!inPage) return;
      if (!isSelected(selected, declared)) return;
      const sig = readMetadataBlob(
        bytes,
        layout,
        signatureIndex,
        layout.blob?.size ?? 0,
      );
      const decoded = budgetedSignature(
        sig,
        layout,
        signatureTypeName,
        displayTypeName,
        issues,
        {
          scope: `MethodDef:${token}.signature`,
          kind: "method",
          artifact: bytes,
        },
      );
      core.set(token, {
        ...member,
        genericArity: signatureGenericArity(decoded),
        identitySha256: memberTargetIdentity(
          name,
          declared === undefined || owner === undefined
            ? null
            : { table: 2, row: owner },
          decoded,
          declarationTypeName,
        ),
      });
      const read = methodBody(bytes, pe, rva, {
        implementation,
        budget: managedDecodeBudget(layout),
        metadataLayout: layout,
        methodToken: token,
        memberRefKinds,
      });
      appendManagedParseIssues(issues, read.issues);
      if (!read.scanned) unscannedMethods += 1;
      managedDecodeBudget(layout).reserve(128, rowOffset);
      methods.push({
        tokenInstructions: read.tokenInstructions,
        catchTokens: read.catchTokens,
        method: {
          token,
          row_offset: rowOffset,
          declaring_type_token: declared?.token ?? null,
          declaring_type: declared?.fullName ?? null,
          name,
          rva,
          impl_flags: implFlags,
          flags,
          signature: decoded,
          body: read.body,
        },
      });
    }, issues);
    if (mayBeSelected && methods.length === produced) unscannedMethods += 1;
  }
  return { methods, core, issues, unscannedMethods };
};

/**
 * Member kinds each operand kind may name. A MemberRef whose signature does
 * not decode keeps its name on calls, as before, but is never named a field.
 */
const NAMEABLE_KINDS = new Map<string, ReadonlySet<MemberCore["kind"]>>([
  ["method", new Set(["method", "unknown"])],
  ["field", new Set(["field"])],
]);

const targetKind = (table: number): ManagedCallEdge["target_kind"] =>
  table === 6
    ? "method-def"
    : table === 0x0a
      ? "member-ref"
      : table === 0x2b
        ? "method-spec"
        : "unknown";

/** The member an operand names, if the operand kind can name that member's kind. */
const namedTarget = (
  members: ReadonlyMap<string, MemberCore>,
  operandKind: string,
  operand: string,
): MemberCore | undefined => {
  const member = members.get(operand);
  return member !== undefined &&
    NAMEABLE_KINDS.get(operandKind)?.has(member.kind) === true
    ? member
    : undefined;
};

export const edges = (
  methods: readonly DecodedMethod[],
  members: ReadonlyMap<string, MemberCore>,
  budget: ManagedDecodeBudget,
): {
  readonly callEdges: readonly ManagedCallEdge[];
  readonly fieldAccesses: readonly ManagedFieldAccess[];
} => {
  const callEdges: ManagedCallEdge[] = [];
  const fieldAccesses: ManagedFieldAccess[] = [];
  for (const { method, tokenInstructions } of methods) {
    const derives = tokenInstructions.some((instruction) =>
      isManagedMemberReferenceInstruction({
        opcode: instruction.opcode,
        operand_kind: instruction.operandKind,
        operand: instruction.operand,
      }),
    );
    if (derives) budget.admitTransient(callerNameBytes(method), null);
    // Built once per method, only after its exact size was admitted.
    const caller = derives ? callerName(method) : method.name;
    for (const instruction of tokenInstructions) {
      const anchor = {
        opcode: instruction.opcode,
        operand_kind: instruction.operandKind,
        operand: instruction.operand,
      };
      if (!isManagedMemberReferenceInstruction(anchor)) continue;
      const { operand } = anchor;
      const target = namedTarget(members, anchor.operand_kind, operand);
      if (anchor.operand_kind === "method") {
        // Each derived record is admitted before the graph grows further.
        callEdges.push(
          admitManagedProjection(
            {
              caller_token: method.token,
              il_offset: instruction.offset,
              target_identity_sha256: target?.identitySha256 ?? null,
              caller,
              opcode: anchor.opcode,
              target_token: operand,
              target_kind: targetKind(instruction.reference.table),
              target_name: target?.name ?? null,
              target_declaring_type: target?.declaringType ?? null,
            },
            budget,
          ),
        );
      }
      if (anchor.operand_kind === "field") {
        fieldAccesses.push(
          admitManagedProjection(
            {
              method_token: method.token,
              il_offset: instruction.offset,
              target_identity_sha256: target?.identitySha256 ?? null,
              method: caller,
              opcode: anchor.opcode,
              field_token: operand,
              field_name: target?.name ?? null,
              field_declaring_type: target?.declaringType ?? null,
            },
            budget,
          ),
        );
      }
    }
    // Every record now reserves the name it carries.
    if (derives) budget.releaseTransient();
  }
  return { callEdges, fieldAccesses };
};

const callerName = (method: ManagedMethod): string =>
  method.declaring_type === null
    ? method.name
    : `${method.declaring_type}.${method.name}`;

/** JSON bytes of `callerName`, from its parts: the joining dot adds one byte. */
const callerNameBytes = (method: ManagedMethod): number =>
  method.declaring_type === null
    ? jsonStringByteLength(method.name)
    : jsonStringByteLength(method.declaring_type) +
      jsonStringByteLength(method.name) -
      1;

const budgetedSignature = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  signatureTypeName: SignatureTypeName,
  displayTypeName: SignatureDisplayTypeName,
  issues: ManagedParseIssue[],
  owner: {
    readonly scope: string;
    readonly kind?: "field" | "method";
    /** The artifact the blob was read from, for artifact issue offsets. */
    readonly artifact: Buffer;
  },
): ReturnType<typeof metadataSignature> => {
  const budget = managedDecodeBudget(layout);
  budget.admitTransient(
    bytes.length * 256,
    layout.blob?.offset ?? layout.rootOffset,
  );
  try {
    return admitManagedProjection(
      metadataSignature(bytes, {
        rawSha256: budget.digest(bytes, "sha256"),
        typeName: signatureTypeName,
        displayTypeName: (operand, copies) => {
          const name = displayTypeName(operand, copies);
          if (name !== null)
            budget.admitTransient(
              (name.length * 6 + 2) * copies,
              layout.blob?.offset ?? layout.rootOffset,
            );
          return name;
        },
        layout,
        issues,
        scope: owner.scope,
        blobOffset: bytes.byteOffset - owner.artifact.byteOffset,
        ...(owner.kind === undefined ? {} : { expectedKind: owner.kind }),
      }),
      budget,
    );
  } finally {
    budget.releaseTransient();
  }
};
