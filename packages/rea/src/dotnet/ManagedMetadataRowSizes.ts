import { managedFailure } from "./ManagedReaderFailure.js";
import type { CodedIndexName } from "./ManagedMetadataLayout.js";

export interface RowSizeContext {
  readonly tableSize: (index: number) => number;
  readonly codedSize: (name: CodedIndexName) => number;
  readonly stringSize: 2 | 4;
  readonly guidSize: 2 | 4;
  readonly blobSize: 2 | 4;
}

type RowSizeFactory = (context: RowSizeContext) => number;

const ROW_SIZE_FACTORIES: readonly RowSizeFactory[] = [
  ({ stringSize: s, guidSize: g }) => 2 + s + g * 3,
  ({ codedSize: c, stringSize: s }) => c("ResolutionScope") + s * 2,
  ({ tableSize: t, codedSize: c, stringSize: s }) =>
    4 + s * 2 + c("TypeDefOrRef") + Math.max(t(3), t(4)) + Math.max(t(5), t(6)),
  ({ tableSize: t }) => t(4),
  ({ stringSize: s, blobSize: b }) => 2 + s + b,
  ({ tableSize: t }) => t(6),
  ({ tableSize: t, stringSize: s, blobSize: b }) => 8 + s + b + t(8),
  ({ tableSize: t }) => t(8),
  ({ stringSize: s }) => 4 + s,
  ({ tableSize: t, codedSize: c }) => t(2) + c("TypeDefOrRef"),
  ({ codedSize: c, stringSize: s, blobSize: b }) =>
    c("MemberRefParent") + s + b,
  ({ codedSize: c, blobSize: b }) => 2 + c("HasConstant") + b,
  ({ codedSize: c, blobSize: b }) =>
    c("HasCustomAttribute") + c("CustomAttributeType") + b,
  ({ codedSize: c, blobSize: b }) => c("HasFieldMarshal") + b,
  ({ codedSize: c, blobSize: b }) => 2 + c("HasDeclSecurity") + b,
  ({ tableSize: t }) => 6 + t(2),
  ({ tableSize: t }) => 4 + t(4),
  ({ blobSize: b }) => b,
  ({ tableSize: t }) => t(2) + t(20),
  ({ tableSize: t }) => t(20),
  ({ stringSize: s, codedSize: c }) => 2 + s + c("TypeDefOrRef"),
  ({ tableSize: t }) => t(2) + t(23),
  ({ tableSize: t }) => t(23),
  ({ stringSize: s, blobSize: b }) => 2 + s + b,
  ({ tableSize: t, codedSize: c }) => 2 + t(6) + c("HasSemantics"),
  ({ tableSize: t, codedSize: c }) => t(2) + c("MethodDefOrRef") * 2,
  ({ stringSize: s }) => s,
  ({ blobSize: b }) => b,
  ({ tableSize: t, codedSize: c, stringSize: s }) =>
    2 + c("MemberForwarded") + s + t(26),
  ({ tableSize: t }) => 4 + t(4),
  () => 8,
  () => 4,
  ({ blobSize: b, stringSize: s }) => 16 + b + s * 2,
  () => 4,
  () => 12,
  ({ blobSize: b, stringSize: s }) => 12 + b * 2 + s * 2,
  ({ tableSize: t }) => 4 + t(35),
  ({ tableSize: t }) => 12 + t(35),
  ({ stringSize: s, blobSize: b }) => 4 + s + b,
  ({ stringSize: s, codedSize: c }) => 8 + s * 2 + c("Implementation"),
  ({ stringSize: s, codedSize: c }) => 8 + s + c("Implementation"),
  ({ tableSize: t }) => t(2) * 2,
  ({ stringSize: s, codedSize: c }) => 4 + c("TypeOrMethodDef") + s,
  ({ codedSize: c, blobSize: b }) => c("MethodDefOrRef") + b,
  ({ tableSize: t, codedSize: c }) => t(42) + c("TypeDefOrRef"),
];

export const computeRowSize = (
  table: number,
  context: RowSizeContext,
): number => {
  const factory = ROW_SIZE_FACTORIES[table];
  if (factory === undefined)
    throw managedFailure(
      "invalid-tables",
      "metadata.tables",
      `Metadata table ${String(table)} is unsupported`,
    );
  return factory(context);
};
