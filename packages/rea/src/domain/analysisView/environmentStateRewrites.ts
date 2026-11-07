import {
  writeSpanIndex,
  type StateRecordFacts,
} from "./environmentStateRules.js";
import type { StateRecordChronology } from "./StateRecordChronology.js";

/** Two recordings of a type that disagree across a write. */
export interface RewriteSpan {
  readonly type: string;
  readonly earlier: number;
  readonly later: number;
}

/**
 * Per type whose reads disagree, the earliest write that may intersect the span.
 * Unknown interval bounds cannot establish that the observations were independent
 * of a write; choosing a conservative cutoff does not prove the write caused a change.
 */
export const rewriteCuts = (
  spans: readonly RewriteSpan[],
  writes: readonly StateRecordFacts[],
  byOrdinal: ReadonlyMap<number, StateRecordFacts>,
  chronology: StateRecordChronology,
): Map<string, StateRecordFacts> => {
  const possibleWrite = writeSpanIndex(writes, chronology);
  const cuts = new Map<string, number>();
  for (const span of spans) {
    const earlier = byOrdinal.get(span.earlier);
    const later = byOrdinal.get(span.later);
    if (earlier === undefined || later === undefined) continue;
    const index = possibleWrite(earlier, later);
    if (index !== undefined)
      cuts.set(span.type, Math.min(index, cuts.get(span.type) ?? index));
  }
  return new Map([...cuts].map(([type, index]) => [type, writes[index]!]));
};
