import { err, ok, type Result } from "../result.js";

/** Bytes written at consecutive addresses, held at `offset` in a decoder arena. */
export interface ArenaRun {
  readonly address: number;
  readonly offset: number;
  readonly length: number;
}

/** One address-contiguous range and the runs that wrote it, in address order. */
export interface MergedRuns<Run extends ArenaRun> {
  readonly start: number;
  /** The range's bytes; its inclusive end is `start + bytes.length - 1`. */
  readonly bytes: Uint8Array;
  readonly runs: readonly Run[];
}

/** The first address two overlapping runs write with different values. */
export interface RunConflict<Run extends ArenaRun> {
  readonly address: number;
  /** The earlier covering run in address order, which supplied the kept byte. */
  readonly writer: Run;
  readonly run: Run;
  readonly existing: number;
  readonly incoming: number;
}

const runEnd = (run: ArenaRun | undefined): number =>
  run === undefined ? 0 : run.address + run.length;

/**
 * Merge runs into address-contiguous ranges, never filling gaps. Runs in
 * different address spaces never merge; `space` orders them before address.
 * Overlapping runs must repeat the same bytes, which count as duplicates.
 */
export const mergeArenaRuns = <Run extends ArenaRun>(
  runs: readonly Run[],
  arena: Uint8Array,
  space: (run: Run) => number = () => 0,
): Result<
  { readonly ranges: MergedRuns<Run>[]; readonly duplicateBytes: number },
  RunConflict<Run>
> => {
  const ordered = [...runs].sort(
    (left, right) => space(left) - space(right) || left.address - right.address,
  );
  const ranges: MergedRuns<Run>[] = [];
  let duplicateBytes = 0;
  let first = 0;
  while (first < ordered.length) {
    const head = ordered[first];
    if (head === undefined) break;
    let next = first + 1;
    let end = runEnd(head);
    while (next < ordered.length) {
      const candidate = ordered[next];
      if (
        candidate === undefined ||
        space(candidate) !== space(head) ||
        candidate.address > end
      )
        break;
      end = Math.max(end, runEnd(candidate));
      next += 1;
    }
    const range = mergeRange(ordered.slice(first, next), end, arena);
    if (!range.ok) return range;
    ranges.push(range.value.range);
    duplicateBytes += range.value.duplicateBytes;
    first = next;
  }
  return ok({ ranges, duplicateBytes });
};

/** Copy one contiguous group; written addresses always form [start, written). */
const mergeRange = <Run extends ArenaRun>(
  group: readonly Run[],
  end: number,
  arena: Uint8Array,
): Result<
  { readonly range: MergedRuns<Run>; readonly duplicateBytes: number },
  RunConflict<Run>
> => {
  const start = group[0]?.address ?? 0;
  const bytes = new Uint8Array(end - start);
  let written = start;
  let duplicateBytes = 0;
  for (const run of group) {
    const overlapEnd = Math.min(written, runEnd(run));
    for (let address = run.address; address < overlapEnd; address += 1) {
      const existing = bytes[address - start] ?? 0;
      const incoming = arena[run.offset + address - run.address] ?? 0;
      if (existing !== incoming)
        return err({
          address,
          writer:
            group.find(
              (candidate) =>
                candidate !== run &&
                candidate.address <= address &&
                address < runEnd(candidate),
            ) ?? run,
          run,
          existing,
          incoming,
        });
    }
    duplicateBytes += Math.max(overlapEnd - run.address, 0);
    if (runEnd(run) > written) {
      bytes.set(
        arena.subarray(
          run.offset + written - run.address,
          run.offset + run.length,
        ),
        written - start,
      );
      written = runEnd(run);
    }
  }
  return ok({ range: { start, bytes, runs: group }, duplicateBytes });
};
