import { createHash } from "node:crypto";
import type { z } from "zod";
import type { functionBodySchema } from "../native/functionBody.js";
import type { nativeByteReadSchema } from "./nativeByteRead.js";
import { addressCoordinate } from "./addressCoordinate.js";

export type NativeMatchingCheckpoint = (bytes?: number) => Promise<void>;
interface Interval {
  start: bigint;
  end: bigint;
}
interface Piece extends Interval {
  readonly hex: string;
  readonly links: readonly string[];
}
interface Fingerprint {
  readonly sha256: string;
  readonly key: string;
  readonly links: readonly string[];
}
const slice = (piece: Piece, start: bigint, end: bigint): Piece => ({
  ...piece,
  start,
  end,
  hex:
    start === piece.start && end === piece.end
      ? piece.hex
      : piece.hex.slice(
          Number(start - piece.start) * 2,
          Number(end - piece.start) * 2,
        ),
});
const firstOverlapping = (pieces: readonly Piece[], start: bigint): number => {
  let lower = 0,
    upper = pieces.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (pieces[middle]!.end <= start) lower = middle + 1;
    else upper = middle;
  }
  return lower;
};
const mergeIntervals = (intervals: Interval[]): Interval[] => {
  intervals.sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
  );
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      if (interval.end > previous.end) previous.end = interval.end;
    } else merged.push({ ...interval });
  }
  return merged;
};
const excludeConflicts = (
  pieces: readonly Piece[],
  conflicts: readonly Interval[],
): Piece[] => {
  const safe: Piece[] = [];
  let first = 0;
  for (const piece of pieces) {
    while (first < conflicts.length && conflicts[first]!.end <= piece.start)
      first++;
    let cursor = piece.start;
    for (
      let index = first;
      index < conflicts.length && conflicts[index]!.start < piece.end;
      index++
    ) {
      const conflict = conflicts[index]!;
      if (conflict.start > cursor)
        safe.push(slice(piece, cursor, conflict.start));
      if (conflict.end > cursor) cursor = conflict.end;
      if (cursor >= piece.end) break;
    }
    if (cursor < piece.end) safe.push(slice(piece, cursor, piece.end));
  }
  return safe;
};

/** Own exact observed byte intervals, their conflicts and whole-body hashing. */
export class FunctionByteCoverage {
  readonly #pieces = new Map<string | null, Piece[]>();
  #prepared = false;
  constructor(readonly checkpoint: NativeMatchingCheckpoint) {}
  async add(
    read: z.output<typeof nativeByteReadSchema>,
    evidenceId: string,
  ): Promise<void> {
    if (this.#prepared)
      throw new TypeError(
        "Cannot append byte observations after fingerprinting",
      );
    if (read.returned_bytes === 0) return;
    const coordinate = addressCoordinate(read.address)!;
    let group = this.#pieces.get(coordinate.space);
    if (group === undefined) this.#pieces.set(coordinate.space, (group = []));
    await this.checkpoint(192 + read.bytes_hex.length * 2);
    group.push({
      start: coordinate.offset,
      end: coordinate.offset + BigInt(read.returned_bytes),
      hex: read.bytes_hex,
      links: [evidenceId],
    });
  }
  async #conflict(left: Piece, right: Piece): Promise<Interval | undefined> {
    const start = left.start > right.start ? left.start : right.start;
    const end = left.end < right.end ? left.end : right.end;
    for (let cursor = start; cursor < end;) {
      const next = cursor + 65536n < end ? cursor + 65536n : end;
      await this.checkpoint();
      if (slice(left, cursor, next).hex !== slice(right, cursor, next).hex)
        return { start, end };
      cursor = next;
    }
    return undefined;
  }
  async #prepareSpace(source: Piece[]): Promise<Piece[]> {
    source.sort((a, b) =>
      a.start < b.start
        ? -1
        : a.start > b.start
          ? 1
          : a.end > b.end
            ? -1
            : a.end < b.end
              ? 1
              : 0,
    );
    const admitted: Piece[] = [],
      conflicts: Interval[] = [];
    for (const incoming of source) {
      await this.checkpoint();
      for (
        let index = firstOverlapping(admitted, incoming.start);
        index < admitted.length && admitted[index]!.start < incoming.end;
        index++
      ) {
        const conflict = await this.#conflict(admitted[index]!, incoming);
        if (conflict !== undefined) conflicts.push(conflict);
      }
      const end = admitted.at(-1)?.end;
      if (end === undefined || incoming.start >= end) admitted.push(incoming);
      else if (incoming.end > end)
        admitted.push(slice(incoming, end, incoming.end));
    }
    return excludeConflicts(admitted, mergeIntervals(conflicts));
  }
  async fingerprint(
    body: z.output<typeof functionBodySchema> | undefined,
  ): Promise<Fingerprint | null> {
    if (!body?.available || !body.contains_entry || body.total_bytes === 0)
      return null;
    if (!this.#prepared) {
      for (const [space, pieces] of this.#pieces)
        this.#pieces.set(space, await this.#prepareSpace(pieces));
      this.#prepared = true;
    }
    const hash = createHash("sha256"),
      lengths: string[] = [],
      links = new Set<string>();
    for (const range of body.ranges) {
      const start = addressCoordinate(range.start)!,
        end = addressCoordinate(range.end)!;
      const pieces = this.#pieces.get(start.space) ?? [];
      lengths.push(String(end.offset - start.offset + 1n));
      let index = firstOverlapping(pieces, start.offset),
        cursor = start.offset;
      while (cursor <= end.offset) {
        const piece = pieces[index++];
        if (piece === undefined || piece.start > cursor || piece.end <= cursor)
          return null;
        const stop = piece.end < end.offset + 1n ? piece.end : end.offset + 1n;
        for (let chunk = cursor; chunk < stop;) {
          const next = chunk + 65536n < stop ? chunk + 65536n : stop;
          await this.checkpoint();
          hash.update(Buffer.from(slice(piece, chunk, next).hex, "hex"));
          chunk = next;
        }
        for (const link of piece.links) links.add(link);
        cursor = stop;
      }
    }
    const sha256 = hash.digest("hex");
    return {
      sha256,
      key: JSON.stringify([lengths, sha256]),
      links: [...links],
    };
  }
}
