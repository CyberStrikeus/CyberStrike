import type { ExtractedState } from "./environmentStateRules.js";
import { EnvironmentStateWriteSimulation } from "./EnvironmentStateWriteSimulation.js";
import type { WriteSimulationInput } from "./environmentStateWriteEffects.js";
import { usesWriteClock } from "./environmentStateWriteRules.js";

/** The latest end a record can have and still round up to a whole second a date can hold. */
const LATEST_END_MS = 8_640_000_000_000_000 - 1000;

/** The instant a served clock starts from: the end of the last timed record a date can hold, to the next whole second. */
const clockStart = (
  records: WriteSimulationInput["records"],
): string | null => {
  // The clock is global: any unknown completion may extend beyond every known end.
  if (records.some((record) => record.timing.endMs === undefined)) return null;
  // A record timed past the range of a date carries no usable time, so the clock starts from the others.
  const end = records.reduce(
    (latest, record) =>
      record.timing.endMs !== undefined &&
      Math.abs(record.timing.endMs) <= LATEST_END_MS
        ? Math.max(latest, record.timing.endMs)
        : latest,
    Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(end)
    ? new Date(Math.ceil(end / 1000) * 1000).toISOString()
    : null;
};

/**
 * The write plans a capture's own timeline confirms against an extracted state, the served clock's
 * start, and the final views with their initial entities' applicable view-specific values.
 */
export const extractWrites = (
  state: Pick<ExtractedState, "views" | "types" | "entities" | "documents">,
  input: Omit<
    WriteSimulationInput,
    "views" | "types" | "entities" | "documents"
  >,
): Pick<
  ExtractedState,
  "writes" | "write_clock" | "views" | "types" | "entities"
> => {
  const simulation = new EnvironmentStateWriteSimulation({
    ...input,
    views: new Map(state.views.map((view) => [view.tool, view])),
    types: state.types,
    entities: state.entities,
    documents: state.documents,
  });
  const writeClock =
    input.chronology.timeline === "recorded-start-time"
      ? clockStart(input.records)
      : null;
  const writes = simulation
    .run()
    .map((plan) =>
      plan.served && writeClock === null && usesWriteClock(plan)
        ? { ...plan, served: false, reason: "unknown-clock" as const }
        : plan,
    );
  const views = simulation.views(state.views);
  const backed = new Set<string>();
  const backedTypes = new Set<string>();
  for (const view of views)
    if (view.shape === "item" || view.shape === "list") {
      backed.add(view.tool);
      backedTypes.add(view.type);
    }
  return {
    writes,
    write_clock: writeClock,
    views,
    types: state.types.filter((type) =>
      backedTypes.has(type.collection_template),
    ),
    // Simulation can retire a view after initial extraction admitted its overrides.
    entities: state.entities
      .filter((entity) => backedTypes.has(entity.type))
      .map((entity) => ({
        ...entity,
        view_fields: entity.view_fields.filter((view) => backed.has(view.tool)),
      })),
  };
};
