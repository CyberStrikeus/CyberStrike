import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { err, ok, type Result } from "../domain/result.js";

interface LoadSegment {
  readonly vaddr: number;
  readonly offset: number;
  readonly filesz: number;
}

/** Normalize overlapping file-backed interpretations once, before any lookups. */
export const createElfLoadMap = async (
  segments: readonly LoadSegment[],
  signal?: AbortSignal,
): Promise<
  (address: number, size: number) => Result<number, { reason: string }>
> => {
  const events = segments
    .filter((segment) => segment.filesz > 0)
    .flatMap((segment) => [
      { at: segment.vaddr, delta: segment.offset - segment.vaddr, change: 1 },
      {
        at: segment.vaddr + segment.filesz,
        delta: segment.offset - segment.vaddr,
        change: -1,
      },
    ])
    .sort((left, right) => left.at - right.at);
  const active = new Map<number, number>();
  const spans: { start: number; end: number; delta: number | null }[] = [];
  let previous = 0;
  for (let index = 0; index < events.length; index += 1) {
    if (index % 4096 === 0) {
      await yieldToEventLoop();
      signal?.throwIfAborted();
    }
    const event = events[index]!;
    if (event.at > previous && active.size > 0) {
      const delta = active.size === 1 ? active.keys().next().value! : null;
      const last = spans.at(-1);
      if (last?.end === previous && last.delta === delta) last.end = event.at;
      else spans.push({ start: previous, end: event.at, delta });
    }
    const count = (active.get(event.delta) ?? 0) + event.change;
    if (count === 0) active.delete(event.delta);
    else active.set(event.delta, count);
    previous = event.at;
  }
  // Prefix counts keep growing GNU-hash range checks logarithmic even with
  // many load segments. Null denotes conflicting interpretations, not a hole.
  const conflicts = [0];
  for (const span of spans)
    conflicts.push(conflicts.at(-1)! + Number(span.delta === null));
  const locate = (address: number): number => {
    let low = 0,
      high = spans.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (spans[middle]!.start <= address) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  };
  signal?.throwIfAborted();
  return (address, size) => {
    const missing = () =>
      err({ reason: "has no contiguous file-backed PT_LOAD range" });
    const ambiguous = () => err({ reason: "has conflicting PT_LOAD mappings" });
    if (
      !Number.isSafeInteger(address) ||
      !Number.isSafeInteger(size) ||
      address < 0 ||
      size < 0 ||
      !Number.isSafeInteger(address + size)
    )
      return missing();
    const first = locate(address);
    const span = spans[first];
    if (span === undefined || (size > 0 && address >= span.end))
      return missing();
    if (size === 0) {
      // A zero-width symbol at a shared endpoint still needs one file offset.
      if (address > span.end) return missing();
      const left = spans[first - 1];
      if (
        span.delta === null ||
        (span.start === address &&
          left?.end === address &&
          left.delta !== span.delta)
      )
        return ambiguous();
      return ok(address + span.delta);
    }
    const last = locate(address + size - 1);
    if (conflicts[last + 1]! !== conflicts[first]!) return ambiguous();
    return span.delta !== null &&
      address < span.end &&
      size <= span.end - address
      ? ok(address + span.delta)
      : missing();
  };
};
