import type { ManagedExceptionRegion } from "./ManagedMemberInspectorCore.js";
import type { ExceptionRegionParseResult } from "./ManagedMemberInstructionDecoder.js";

const clauseFlagsIssue = (region: ManagedExceptionRegion): string | null =>
  [0, 1, 2, 4].includes(region.flags)
    ? null
    : `Exception clause has unsupported flags 0x${region.flags.toString(16)}`;

const methodExtentIssue = (
  start: number,
  length: number,
  ilSize: number,
  name: "try" | "handler",
): string | null =>
  start <= ilSize && length <= ilSize - start
    ? null
    : `Exception clause ${name} range leaves the method IL body`;

const instructionBoundaryIssue = (
  start: number,
  length: number,
  boundaries: ReadonlySet<number>,
  name: "try" | "handler" | "filter",
): string | null => {
  const end = start + length;
  return boundaries.has(start) && boundaries.has(end)
    ? null
    : `Exception clause ${name} range does not align with CIL instruction boundaries`;
};

const filterOrderingIssue = (
  region: ManagedExceptionRegion,
  ilSize: number,
): string | null => {
  if (region.flags !== 1) return null;
  const offset = region.filter_offset;
  return offset !== null && offset < ilSize && offset < region.handler_offset
    ? null
    : "Exception clause filter must start before its handler within the method IL body";
};

const clauseIssue = (
  region: ManagedExceptionRegion,
  ilSize: number,
  boundaries: ReadonlySet<number>,
): string | null =>
  clauseFlagsIssue(region) ??
  methodExtentIssue(region.try_offset, region.try_length, ilSize, "try") ??
  instructionBoundaryIssue(
    region.try_offset,
    region.try_length,
    boundaries,
    "try",
  ) ??
  methodExtentIssue(
    region.handler_offset,
    region.handler_length,
    ilSize,
    "handler",
  ) ??
  instructionBoundaryIssue(
    region.handler_offset,
    region.handler_length,
    boundaries,
    "handler",
  ) ??
  (region.flags === 1 && region.filter_offset !== null
    ? instructionBoundaryIssue(region.filter_offset, 0, boundaries, "filter")
    : null) ??
  filterOrderingIssue(region, ilSize);

/** Validate EH extents and instruction boundaries while retaining each clause. */
export const validateExceptionRegionRanges = (
  parsed: ExceptionRegionParseResult,
  ilSize: number,
  instructionOffsets: readonly number[],
): ExceptionRegionParseResult => {
  if (parsed.status === "malformed") return parsed;
  const boundaries = new Set([...instructionOffsets, ilSize]);
  for (const region of parsed.regions) {
    const issue = clauseIssue(region, ilSize, boundaries);
    if (issue !== null) return { ...parsed, status: "malformed", issue };
  }
  return parsed;
};
