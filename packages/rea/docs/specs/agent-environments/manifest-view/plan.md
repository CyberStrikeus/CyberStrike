# Implementation plan

1. Lift the api-surface accumulator's shared pieces into
   `webNetworkRouteTemplates.ts` (format rules, media-type essence, request-line
   and query-name readers, route scanning, byte allowances) and an abstract
   `WebNetworkProjectionAccumulator` (retained/temporary budget, admission,
   limitations) with `admitHarCaptureParent` for the shared parent guards, so
   both grouping views own one interpretation.
2. Add `environmentManifestRules.ts` as pure functions: the opt-in template
   rules, re-bucketing and sibling merging, parameter naming, path templates and
   deterministic tool names.
3. Add `EnvironmentManifestAccumulator.ts`: per-record pointers, group state,
   primary-origin selection, body-shape parsing through `parseJsonObject` with
   top-level key types only, without walking nested values, exclusion reasons,
   fixed unknowns and the finished manifest fields.
4. Add `environmentManifestView.ts` with the strict request schema (defaults
   applied in the echoed view), the result fields and the projector; register
   the kind first in `projectAnalysisView`, extend the result union and
   `UnsignedAnalysisView`, and wire the accumulator and confidence rule in
   `AnalysisViewService`.
5. Publish the `inspect_analysis_view` description and a fixture-generated
   example; port the Grafana-shaped HAR into a source-owned TypeScript builder.
6. Cover domain, accumulator budget, service, MCP boundary, CLI boundary and
   acceptance behavior; extend the real-capture verifier; document the view in
   the capture guide, the contracts reference and the authored skill.

No new tool, provider, side effect or network activity is introduced. The
manifest is a projection of already retained Evidence; replaying or serving it
is deferred.
