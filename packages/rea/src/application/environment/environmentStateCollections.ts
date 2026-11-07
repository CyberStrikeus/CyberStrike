import {
  collectionPathOf,
  selectedCollection,
} from "../../domain/analysisView/environmentStateRules.js";
import type { StateServing } from "./environmentStateAnswer.js";
import { callSegments } from "./environmentStateCallLines.js";
import type { ReplayArguments } from "./environmentReplay.js";
import type { EnvironmentManifestTool } from "./environmentSource.js";

/** The collections a create may go to: those the store knows, held ones first, then those the type's checked list lines read, so an empty one keeps its spelling. */
const creatableCollectionsOf = (
  serving: StateServing,
  type: string,
): readonly string[] => {
  const listed: string[] = [];
  for (const view of serving.store.state.views.values())
    if (view.shape === "list" && view.type === type)
      for (const ordinal of view.checked_record_ordinals) {
        const exchange = serving.source.exchanges.get(ordinal);
        if (exchange !== undefined)
          listed.push(collectionPathOf(exchange, false));
      }
  return [...new Set([...serving.store.knownCollectionsOf(type), ...listed])];
};

/** The collection a create writes to: a known collection the call's path matches, else the path as supplied. */
export const createdCollection = (
  serving: StateServing,
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
  type: string,
): string | undefined => {
  const segments = callSegments(tool, args);
  // A supplied path argument may not be empty; an empty literal segment, from a
  // repeated separator in the route, is part of the collection's spelling.
  if (
    segments === undefined ||
    segments.some(({ text, supplied }) => supplied && text.length === 0)
  )
    return undefined;
  // The spelling the call supplies verbatim wins, as item calls choose their entity, then the first known: held ones lead.
  return selectedCollection(segments, creatableCollectionsOf(serving, type));
};
