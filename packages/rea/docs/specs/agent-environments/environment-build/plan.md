# Plan

1. Add `environmentCoverageView.ts`: the request schema, the result fields, the
   hint per write reason (`satisfies Record<WriteReason, string>`), a
   summarizer over state views and write plans, and the projector, which
   projects the environment-state view and summarizes it. Register the kind in
   the view unions, the grouping dispatch and the view service (state
   accumulator, inferred confidence).
2. Split the export's input read into `readEnvironmentExportFile` and
   `environmentExportFile` (parse and seal bytes), both naming the calling
   operation, and let the export take an already prepared state.
3. Add `environmentBuild.ts`: classify the capture, project the manifest from
   the in-memory Evidence, serialize it as `--format json` writes it to a file,
   authenticate the pair from those bytes, name the environment, prepare the
   state as the export does, summarize coverage, scan credential names, then
   plan (dry run) or export. `environmentBuildReport.ts` holds the scan and the
   naming helpers.
4. Register `environment-build` in the CLI: inspect a HAR through the capture
   service as `inspect-web-network-capture` does, or read Evidence once as the
   export does, and log stages at info.
5. Switch `scripts/verify-agentenv-environment.mjs` to the build command.
6. Document the command, the report, the hints, what ships, and the view.
7. Tests: coverage summary and hint completeness, the view against the state
   view, build equivalence with the three-step path in process and through the
   CLI, dry run, naming, refusals, the credential scan, and the view over MCP.
