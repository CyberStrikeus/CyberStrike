# Verification

Executed on macOS with Node v24.22.1 (the checkout's `.nvmrc`) on main `3d4f5565`, and on Ubuntu 24.04 VMs for the
end-to-end runs.

## Gates

- `npm run -s check:fast`, `npm run -s format:check`, `npx knip`, `npm run -s scan:todos`, `npm run -s docs:check`,
  `npm run -s verify:test-discovery` and `npm run -s mcp-catalog:check`: passed.
- `npm run jscpd`: 3.52% duplicated lines over 4348 files, as on main (3.52% over 4341).
- `npx vitest run --project domain --project services`: 9537 passed, 6 skipped and 151 failed. The same 151 fail on main
  `3d4f5565` in this environment (9513 passed there); none is new.
- `npm run -s test:prepare`, then `npm run -s test:focused --` the environment build, export, export-inputs and serve CLI
  boundaries, the analysis-view CLI and MCP boundaries and the environment serve MCP boundary: 7 files, 67 passed and 1
  failed, "projects portable artifact inventory after the original ZIP is removed", which fails the same way on main.
- `npm run verify:agentenv:environment` (the `real-agentenv` lane) passed on Ubuntu 24.04 with `agent-env 0.9.1334`.

## Equivalence and coverage over the published captures

Each of the 50 published capture-built environments' captures (capture Evidence JSON) and four scoped HAR recordings
(EspoCRM, Ghost, NocoDB, Sonarr) was built twice: once with `rea environment-build <capture> <dir> --json`, and once
with the three CLI steps, `inspect-web-network-capture --format json` (HAR only), `inspect-analysis-view` with an
`evidence-file` source and the four default rules, and `environment-export --name <the build's name>`. Every file of
every bundle was compared by SHA-256.

| Inputs                    | Bundles identical | State served | Read tools from state / replayed | Write tools served / withheld | Build / three steps |
| ------------------------- | ----------------- | ------------ | -------------------------------- | ----------------------------- | ------------------- |
| 50 capture Evidence files | 50 of 50          | 50           | 1,100 / 290                      | 50 / 143                      | 32.9 s / 59.2 s     |
| 4 scoped HARs             | 4 of 4            | 4            | 166 / 21                         | 5 / 12                        | 8.3 s / 12.4 s      |

- The coverage of every capture equals an independent census of the environment-state view with the same rules (read
  views by shape, write plans by verdict and reason).
- 43 of the 50 captures have a loopback origin and are named after their file (`grafana.capture.json` becomes `grafana`)
  with a `name-from-file` warning. 20 carry a `credential-named-members` warning; the published captures were scrubbed by
  their pipeline, whose placeholder strings still count.
- The withheld writes' reasons: no-state-target 86, contradicted 16, unconfirmed 14, no-observation 13,
  unexplained-change 8, side-effect 4, body-unusable 1, incomplete-entities 1.

## End to end

Five environments last rebuilt on 10-23 were built again with this branch's packed CLI on disposable Ubuntu VMs, four
from their scoped HAR recordings and Metabase from its capture Evidence, with `rea environment-build <capture> <dir>
--name <app> --package-tarball <tarball>`. Each bundle then ran its smoke task, a retrieval eval generated from the
bundle's own manifest and capture, and the write eval from its recorded write spec, with two models through a LiteLLM
proxy (`fireworks_ai/gpt-oss-120b`, `fireworks_ai/glm-5p3-flash`), one run per task.

| App      | Input    | Served tools of manifest | Served writes (build report)                       | Smoke  | Retrieval gpt-oss / GLM | Writes gpt-oss / GLM |
| -------- | -------- | ------------------------ | -------------------------------------------------- | ------ | ----------------------- | -------------------- |
| Ghost    | HAR      | 35 of 38                 | 0 (3 no-state-target)                              | passed | 12/12 / 8/12            | 0/2 / 0/2            |
| Metabase | Evidence | 40 of 42                 | 1 (create contradicted, update unexplained-change) | passed | 12/12 / 12/12           | 1/2 / 1/2            |
| EspoCRM  | HAR      | 85 of 88                 | 0 (2 contradicted, 1 unexplained-change)           | passed | 12/12 / 10/12           | 0/2 / 0/2            |
| NocoDB   | HAR      | 23 of 28                 | 0 (4 no-state-target, 1 unconfirmed)               | passed | 6/6 / 5/6               | 0/3 / 0/3            |
| Sonarr   | HAR      | 49 of 50                 | 5 (1 side-effect)                                  | passed | 12/12 / 12/12           | 3/3 / 3/3            |

- Every write task passed with both models when the build report listed its tool as served (Metabase's card delete and
  Sonarr's release-profile create, update and delete), and failed when it listed it as withheld: 8 of 24 write episodes
  passed, exactly the served ones. On main these apps' other writes are withheld; the published v0.2.0 versions were
  built with the state-target and write-rule changes, which serve more of them.
- The retrieval misses are GLM answers on bundles byte-identical to the three-step path's; gpt-oss passed all 54.
- The `real-agentenv` lane, switched to `environment-build`, passed from a fresh checkout on Ubuntu with
  `agent-env 0.9.1334` and the host's Docker: five public cases, the smoke task passed in 26.6 s, no new containers.

## Review

An independent review rebuilt the branch and tried to refute it. It confirmed byte-equality for pretty-printed,
CRLF and newline-free Evidence, Unicode HARs across output part boundaries, inline and file view sources, browser
scenario Evidence and relative or symlinked paths, and that the refactored export answers 16 success and refusal cases
exactly as main does. Its findings, all addressed:

- The credential scan recursed and a 4 KB body nested 5,000 deep crashed the build; it now walks with its own stack, and
  also scans header names, query names and form bodies.
- SIGINT after the capture was read was ignored; the build now checks the signal between stages and writes nothing when
  cancelled before the bundle stage.
- The coverage view does not apply the serve-time catalog and state admission checks; a limitation and the docs now say
  so.
- A dry run accepted a tarball the build refuses; it now opens it for reading.
- Repeated `--template-rule` values were deduplicated; they are refused as the views refuse them. A HAR saved as `.json`
  gets a hint, file-derived names follow the bundle name rules, `localhost.` is anonymous, and the next command is
  shell-quoted.
- The `no-observation` hint now covers updates and deletes of entities the state never held; the docs no longer claim
  the build launches no process, state the conditions of byte-equality, and name the headers inspection excludes; the
  MCP tool description names the view.

## Review round on main `584120e8`

The branch merged main `584120e8`: the export's file read now returns permission refusals through `Result`, as main
does, under the build's operation name, and the `environment-coverage` sentence sits in main's `inspect_analysis_view`
description. Four automated review findings were fixed, each with a test that fails on the merge:

- A browser scenario's retained header values and the query parameters of its recorded URLs are scanned for credential
  names as a HAR's are; the manifest and replay record projections are unchanged.
- `--dry-run --package-tarball` admits and releases the tarball through the export's own regular-file scope, so a close
  it cannot confirm is retried and then reported as incomplete cleanup that keeps its owner.
- A dry run checks for cancellation after reading the tarball, before it reports a plan.
- Evidence is serialized into one exactly sized buffer instead of chunks joined by a copy. Those bytes are still parsed
  and sealed before authentication, so authentication reads exactly what ships.

On macOS with Node v22.23.1: the static gates passed (`npm run jscpd`: 3.53%), `npx vitest run --project domain
--project services` passed (9753, 6 skipped), the environment boundary projects passed (102), and the focused build,
export, export-inputs, serve and analysis-view boundaries with tool schema validity passed (9 files, 96). Rebuilt over
the same 50 captures and four HARs, all 54 bundles are byte-identical to the three-step path's, with the same coverage,
served writes and warnings as before the round.

## Review round on main `3d84215b`

The branch merged main through `3d84215b`: #6946, which carries this builder, in `27a4e3986`, then #7008. Integrating
#6946 took main's event-based credential scan, which also answers the review finding that a scenario transaction with
duplicate responses or content events hid their credential names; a test that both content events of a transaction
recorded twice are scanned fails on `0895c89bc`. The integration had dropped `0895c89bc`'s tests for form text recorded
without a media type and its `body-unusable` hint; both are restored, and main's scan passes the tests.

Rebuilt at `05566419e` over the same 50 captures and four HARs, all 54 bundles are byte-identical to the three-step
path's, and their warnings and credential counts equal the previous round's.
