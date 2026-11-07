# Implementation plan

1. Move response-body decoding from the environment source into
   `recordedResponseBody.ts` with the caller's byte limit, and exact JSON
   parsing into `exactJsonNumber.ts`, so replay and state extraction share one
   owner each.
2. Add `environmentStateRules.ts` as pure helpers: write classification, API
   bases and roots, entity location, identity names, JSON pointers of depth one,
   value bytes and the entity and list renderers.
3. Add `EnvironmentStateExtraction.ts` for planning item and list tools,
   observing entities and assembling the result, `environmentStateMerge.ts` for
   merging observations, and `environmentStateGate.ts` for reproducing each
   plan's recordings; every body is parsed through a budget callback and
   released before the next.
4. Add `EnvironmentStateAccumulator.ts`, extending the manifest accumulator so
   grouping is shared, retaining record lines and references to the admitted
   records, and charging bodies and kept values.
5. Add `environmentStateView.ts` with the request schema (sharing the
   manifest's `template_rules` schema), the result fields and the projector;
   share capture admission and record grouping with the manifest view; register
   the kind and pass accumulators to `projectAnalysisView` as one object;
   always seal the result inferred.
6. Cover domain, service, MCP, CLI, catalog and acceptance behavior; document
   the view in the capture guide, the agent environments guide, the contracts
   reference and the authored skill.

No new tool, provider, side effect or network activity is introduced. The state
is a projection of already retained Evidence; serving it is deferred.
