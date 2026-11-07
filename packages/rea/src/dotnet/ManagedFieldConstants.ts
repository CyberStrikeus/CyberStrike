import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import type { ManagedFieldConstant } from "../domain/managed/managedFieldConstant.js";
import {
  admitManagedProjection,
  managedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import {
  MANAGED_CODED_INDEXES,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import {
  metadataRowCursor,
  metadataToken,
  readMetadataBlob,
  decodeMetadataCodedIndex,
} from "./ManagedMetadataHeaps.js";
import {
  managedFailure,
  ManagedReaderFailure,
} from "./ManagedReaderFailure.js";
import {
  decodeManagedConstantValue,
  managedConstantType,
} from "./ManagedConstantValue.js";

type Declaration = ManagedFieldConstant["declarations"][number];

/** Index physical declarations once; only selected fields decode their blobs. */
const fieldConstantDeclarations = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
): ReadonlyMap<number, Declaration[]> => {
  const result = new Map<number, Declaration[]>();
  const budget = managedDecodeBudget(layout);
  for (let row = 1; row <= (layout.table(11)?.rowCount ?? 0); row++) {
    const cursor = metadataRowCursor(bytes, layout, 11, row);
    const typeAndPadding = cursor.readUInt16();
    const parentRaw = cursor.readIndex(layout.codedIndexSize("HasConstant"));
    const blobIndex = cursor.readIndex(layout.blobIndexSize);
    const definition = MANAGED_CODED_INDEXES.HasConstant;
    const parent = decodeMetadataCodedIndex(
      parentRaw,
      definition.bits,
      definition.tables,
      layout.rowCounts,
    );
    budget.reserveRow(11, row, cursor.start);
    if (parent.kind !== "valid") {
      budget.reserve(512, cursor.start);
      issues.push({
        code: "invalid-row",
        scope: "metadata.Constant",
        offset: cursor.start,
        detail:
          parent.kind === "invalid"
            ? parent.reason
            : "Constant parent is null.",
      });
      continue;
    }
    if (parent.table !== 4) continue;
    const declaration: Declaration = {
      row_offset: cursor.start,
      type_code: typeAndPadding & 255,
      padding: typeAndPadding >>> 8,
      blob_index: blobIndex,
    };
    const previous = result.get(parent.row);
    if (previous === undefined) result.set(parent.row, [declaration]);
    else previous.push(declaration);
  }
  return result;
};

/** The shared metadata budget owns both decoding allocations and retained values. */
export const createManagedFieldConstantReader = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
): ((row: number, flags: number) => ManagedFieldConstant | null) => {
  let declarations: ReadonlyMap<number, Declaration[]> | undefined;
  return (row, flags) => {
    declarations ??= fieldConstantDeclarations(bytes, layout, issues);
    const rows = declarations.get(row) ?? [];
    const hasDefault = (flags & 0x8000) !== 0;
    if (rows.length === 0 && !hasDefault) return null;
    const budget = managedDecodeBudget(layout);
    const result: ManagedFieldConstant = {
      state: "unavailable",
      declarations: rows,
      element_type: null,
      raw_hex: null,
      value: null,
      limitation: null,
    };
    const scope = `metadata.Constant:${metadataToken(4, row)}`;
    const first = rows[0];
    const offset =
      first?.row_offset ?? metadataRowCursor(bytes, layout, 4, row).start;
    try {
      if (!hasDefault || rows.length !== 1 || first === undefined)
        throw managedFailure(
          "invalid-row",
          scope,
          "A field default requires HasDefault and exactly one Constant row.",
          offset,
        );
      if (first.padding !== 0)
        throw managedFailure(
          "invalid-row",
          scope,
          "Constant row padding must be zero.",
          offset,
        );
      const value = readMetadataBlob(
        bytes,
        layout,
        first.blob_index,
        layout.blob?.size ?? 0,
      );
      budget.admitTransient(value.length * 8 + 1024, offset);
      result.raw_hex = value.toString("hex");
      result.element_type = managedConstantType(first.type_code);
      result.value = decodeManagedConstantValue(
        first.type_code,
        value,
        scope,
        offset,
      );
      result.state = "decoded";
    } catch (cause: unknown) {
      if (
        !(cause instanceof ManagedReaderFailure) ||
        cause.issue.code === "resource-limit"
      )
        throw cause;
      issues.push(cause.issue);
      result.limitation = cause.issue.detail;
    } finally {
      budget.releaseTransient();
    }
    return admitManagedProjection(result, budget);
  };
};
