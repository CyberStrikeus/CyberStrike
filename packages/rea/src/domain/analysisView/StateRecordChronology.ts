import type {
  StateRecordFacts,
  StateTimeline,
} from "./environmentStateRules.js";

/** Own recorded interval facts separately from the explicit ordinal fallback policy. */
export class StateRecordChronology {
  readonly positions: ReadonlyMap<number, number>;

  constructor(
    records: readonly StateRecordFacts[],
    readonly timeline: StateTimeline,
  ) {
    this.positions = new Map(
      records.map((record, index) => [record.ordinal, index]),
    );
  }

  startMs(record: StateRecordFacts): number | undefined {
    return this.timeline === "record-order"
      ? this.positions.get(record.ordinal)
      : record.timing.start?.ms;
  }

  endMs(record: StateRecordFacts): number | undefined {
    return this.timeline === "record-order"
      ? this.positions.get(record.ordinal)
      : record.timing.endMs;
  }

  completedBefore(left: StateRecordFacts, right: StateRecordFacts): boolean {
    const end = this.endMs(left);
    const start = this.startMs(right);
    return end !== undefined && start !== undefined && end <= start;
  }
}
