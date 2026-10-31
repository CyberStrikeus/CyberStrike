type Range = { readonly offset: string; readonly bytes: string };
type Segment = {
  readonly index: number;
  readonly type_id: number;
  readonly offset: string;
  readonly file_size: string;
};
type Note = {
  readonly segment_index: number;
  readonly location: Range;
  readonly owner_location: Range;
  readonly descriptor_location: Range;
};
type Padding = {
  readonly segment_index: number;
  readonly location: Range;
  readonly bytes_base64: string;
};
const align = (size: bigint) => ((size + 3n) / 4n) * 4n;
const layoutMatches = (note: Note): boolean => {
  const start = BigInt(note.location.offset);
  const owner = BigInt(note.owner_location.bytes);
  const descriptor = BigInt(note.descriptor_location.bytes);
  return (
    BigInt(note.owner_location.offset) === start + 12n &&
    BigInt(note.descriptor_location.offset) === start + 12n + align(owner) &&
    BigInt(note.location.bytes) === 12n + align(owner) + align(descriptor)
  );
};
const paddingMatches = (
  item: Padding,
  segment: Segment | undefined,
): boolean => {
  const bytes = BigInt(item.location.bytes);
  const decodedLength = Buffer.byteLength(item.bytes_base64, "base64");
  return (
    bytes > 0n &&
    bytes < 12n &&
    BigInt(decodedLength) === bytes &&
    /^A*={0,2}$/.test(item.bytes_base64) &&
    segment !== undefined &&
    BigInt(item.location.offset) + bytes ===
      BigInt(segment.offset) + BigInt(segment.file_size)
  );
};

/** Require exact aligned note layouts and one complete, nonoverlapping physical coverage. */
export function recordedNoteCoverageIssues(
  segments: readonly Segment[],
  notes: readonly Note[],
  padding: readonly Padding[],
): readonly string[] {
  const issues: string[] = [];
  const bySegment = new Map<number, Range[]>();
  const all: Range[] = [];
  const add = (segment: number, range: Range) => {
    const ranges = bySegment.get(segment) ?? [];
    ranges.push(range);
    bySegment.set(segment, ranges);
    all.push(range);
  };
  for (const note of notes) {
    if (!layoutMatches(note))
      issues.push(
        "Recorded note layout differs from its aligned header/owner/descriptor ranges.",
      );
    add(note.segment_index, note.location);
  }
  for (const item of padding) {
    if (!paddingMatches(item, segments[item.segment_index]))
      issues.push(
        "Recorded note padding must be a short zero-filled segment tail.",
      );
    add(item.segment_index, item.location);
  }
  const compare = (left: Range, right: Range) =>
    BigInt(left.offset) < BigInt(right.offset)
      ? -1
      : BigInt(left.offset) > BigInt(right.offset)
        ? 1
        : 0;
  let end = 0n;
  for (const range of all.sort(compare)) {
    const start = BigInt(range.offset);
    if (start < end)
      issues.push("Physical recorded note/padding ranges overlap or repeat.");
    if (start + BigInt(range.bytes) > end) end = start + BigInt(range.bytes);
  }
  for (const segment of segments) {
    if (segment.type_id !== 4) continue;
    let cursor = BigInt(segment.offset);
    for (const range of (bySegment.get(segment.index) ?? []).sort(compare)) {
      if (BigInt(range.offset) !== cursor)
        issues.push(
          "Recorded note/padding ranges leave a gap or overlap in their segment.",
        );
      cursor = BigInt(range.offset) + BigInt(range.bytes);
    }
    if (cursor !== BigInt(segment.offset) + BigInt(segment.file_size))
      issues.push(
        "Recorded note/padding ranges do not completely cover their segment.",
      );
  }
  return issues;
}
