# Plan

1. Add the `evidence-file` source to `analysisViewSourceSchema`
   (`src/domain/analysisView/analysisView.ts`).
2. Add `inspectAnalysisViewWithFiles` / `inspectAnalysisViewValidatedWithFiles`
   to `AnalysisViewService`: read with `readJsonFile`, authenticate with
   `parseEvidence`, then project through the retained path with a lookup that
   returns the file's Evidence. The synchronous path refuses an unread file
   source.
3. Route the CLI command (with `source.path` resolved against the working
   directory) and the MCP tool through the file-aware entry point.
4. Add `sibling-pair-variance` to `TEMPLATE_RULES`, with its merge pass before
   `sibling-variance`, its parameter names and its segment-limit limitation.
5. Document both in the tool contract, `docs/cli.md` and
   `docs/web-network-captures.md`.
6. Tests: service (file equals inline; a capture refused inline is accepted
   from a file; refusals), CLI and MCP boundaries, and the pair rule's merges
   and non-merges.
