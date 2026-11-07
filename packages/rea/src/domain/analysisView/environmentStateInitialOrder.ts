import { parseUrlQueryParameterNames } from "../recordedTransportUrl.js";
import type { ObservedEntity } from "./environmentStateMerge.js";
import { appliesOrder } from "./environmentStateOrderParameters.js";

/** Query parameters that ask for a random order. */
const RANDOM = new Set(["random", "rand", "shuffle", "seed"]);

/** Whether a recorded query leaves the order to the application: no sort, direction or random parameter. */
const defaultOrder = (query: string | null | undefined): boolean => {
  for (const name of parseUrlQueryParameterNames(query ?? ""))
    if (appliesOrder(name) || RANDOM.has(name.toLowerCase())) return false;
  return true;
};

/**
 * Order each collection's entities as the earliest whole list line in the application's own order
 * shows them: a line that lists every entity any initial read shows in the collection and applies no
 * sort, direction or random parameter. A collection without such a line keeps its earliest sightings.
 */
export const orderByWholeLines = (
  entities: Iterable<ObservedEntity>,
  queryOf: (ordinal: number) => string | null | undefined,
): void => {
  const collections = new Map<string, ObservedEntity[]>();
  for (const entity of entities) {
    const key = `${entity.type}\u0000${entity.collection}`;
    const members = collections.get(key);
    if (members === undefined) collections.set(key, [entity]);
    else members.push(entity);
  }
  for (const members of collections.values()) {
    const lines = new Map<number, { position: number; listed: number }>();
    for (const entity of members)
      for (const observation of entity.observations) {
        if (observation.item) continue;
        const line = lines.get(observation.ordinal);
        if (line === undefined)
          lines.set(observation.ordinal, {
            position: observation.position,
            listed: 1,
          });
        else line.listed += 1;
      }
    let first: [number, number] | undefined;
    for (const [ordinal, line] of lines)
      if (
        line.listed === members.length &&
        (first === undefined || line.position < first[1]) &&
        defaultOrder(queryOf(ordinal))
      )
        first = [ordinal, line.position];
    if (first === undefined) continue;
    for (const entity of members) {
      const sighting = entity.observations.find(
        (observation) => !observation.item && observation.ordinal === first[0],
      )!;
      entity.order = [sighting.position, sighting.index];
    }
  }
};
