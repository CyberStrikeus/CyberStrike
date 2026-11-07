# Export an environment manifest as an agent environment bundle

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

`rea environment-export <manifest.json> --evidence <capture.json> <dir>
[--package-tarball <path>] [--name <override>]` writes the manifest and
capture pair that `environment-serve` serves as a bundle folder the agentenv
framework runs with `agent-env run <dir>`: a README with provenance, an env
folder whose Dockerfile installs this exact `rea-agents` version and serves the
copied pair, a Python replay verifier and a smoke task. The hosted
`real-agentenv` lane exports such a bundle from the source-owned Grafana-shaped
capture through the built CLI, packs the checkout into the image and runs it
with the pinned framework release on the runner's Docker. This increment
completes the agent-environment work of the issue; serving came in the
previous increment.

## Requirements

- Read each of the two files once through the regular-file reader, parse it
  from those bytes and authenticate and cross-check the pair with
  `loadEnvironmentSource` as `environment-serve` does, so the bytes copied into
  the bundle are the bytes that were authenticated; every refusal reports
  operation `environment-export`, and a manifest projected from a different
  capture is refused before anything is written.
- Refuse a bundle directory that exists and is not empty, or that names a file,
  with an `invalid_request` whose issue path is `directory`; an absent or empty
  directory is accepted. Write every file with the exclusive-create flag so
  nothing is ever overwritten.
- Write `README.md`, `envs/<name>/Dockerfile`, `envs/<name>/env.toml`,
  `envs/<name>/manifest.json` and `envs/<name>/evidence.json` as byte-exact
  copies of the inputs (mode `0600` on POSIX; Windows retains inherited ACLs
  and does not provide an owner-only guarantee), `artifacts/check_<name>/verify.py` and
  `tasks/smoke.json`, where `<name>` defaults to the manifest's kebab-case name
  and `--name` must be a kebab-case label of at most 63 characters for its DNS label that is not a
  device name Windows reserves (`con`, `prn`, `aux`, `nul`, `com1`–`com9`,
  `lpt1`–`lpt9`). Its HTTP hostname identity must remain unchanged, so numeric
  labels interpreted as IP addresses are refused before planning.
- The Dockerfile uses the Node version pinned in `.nvmrc` with the
  `bookworm-slim` variant, sets
  `MCP_HOST=0.0.0.0`, `MCP_PORT=18765`, and
  `MCP_ALLOWED_HOSTS=127.0.0.1,localhost,<name>`, installs Debian's `python3` for the
  framework's readiness probe, installs
  `rea-agents@<PRODUCT_IDENTITY.packageVersion>` from the registry or, with
  `--package-tarball`, copies the tarball as `rea-agents.tgz`, installs it
  from `/tmp/` and removes it in the same layer, copies the pair to `/env/`,
  switches to the image's `node` user
  and runs `rea environment-serve /env/manifest.json --evidence
  /env/evidence.json`.
- `verify.py` mirrors the framework's echo example: `async def verify(mcp_url)`
  over `mcp.client.streamable_http`, lists the tools and checks the count
  equals the manifest's, calls the first `GET` tool without path parameters
  with no arguments and checks the replayed `status` equals the recorded status
  of that tool's first cited record, prints the description and returns
  `[{"id": "replay", "result": <bool>, "description": <both checks>}]`; with no
  such tool it checks the count only and says so.
- `tasks/smoke.json` is `deploy_env` of `<name>` on the local sandbox followed
  by `env_outcome_verifier` with `file_artifact_id` `check_<name>` and
  `verifier_id` `replay`. The README records the capture artifact SHA-256, both
  Evidence ids, the manifest view digest, the tool count and the package
  source, states what replay does and does not establish, names the run
  command as `agent-env run .` from the bundle root (the folder it sits in,
  whatever the caller named it), and carries the rights note.
- Print one JSON document with `status: "exported"`, the directory, name, tool
  count, both Evidence ids, the pinned `package_source` and the written files
  with sizes. Register the flat `environment-export` command in the CLI
  inventory; no MCP tool is added.
- Add the `agentenv` CI scope, the reusable `real-agentenv.yml` workflow
  (`workflow_dispatch` and `workflow_call` with `build_cache_artifact`,
  `ubuntu-24.04`, SHA-pinned actions, `setup-python` 3.12, a virtual
  environment with `agentenv-framework==0.9.1334`, the runner's Docker, 30
  minutes), the `verify:agentenv:environment` script and
  `scripts/verify-agentenv-environment.mjs`, which requires absolute
  `REA_AGENT_ENV_COMMAND` and `REA_DOCKER_COMMAND` like every other lane
  verifier, runs `agent-env run <dir> --sandbox local` bounded to 15 minutes
  and resolves nothing from `PATH`; wire `ci.yml` at the four spots and extend
  the two CI guard tests.

## Acceptance and limits

Services tests cover the planned file set, the Dockerfile for both package
sources, the verifier text, the smoke task, the README, the name override and
its refusals, writing into an absent and an empty directory with byte-exact
copies and correct sizes, the tarball copy, and the refusals of a non-empty
directory, a file path, a missing tarball and an inline manifest. The
conformance test pins the registry install to the `package.json` version. The
cli-boundary test writes the folder from the fixture pair through the built
CLI, refuses a non-empty directory leaving it unchanged, and refuses a
mismatched pair without creating the directory. The CI guard tests enumerate
the new consumer, route and classification cases. The local end-to-end run
recorded in `verification.md` is the proof that one exported bundle runs under
`agent-env run` with the smoke task passed and no container left behind.

The export copies bytes and never inspects the tarball; it does not build or
run the image itself. Its writes are not transactional: a host failure after
the first file leaves the partial folder for inspection, as `docs/cli.md`
states. The verifier checks one replayed status and the tool count, not every
tool. The lane passes `--sandbox local` as designed although
`tasks/smoke.json` already pins `sandbox_type: local` on its deploy step, so
the flag restates what the task fixes. The lane verifier imports the
Grafana-shaped HAR builder from `tests/fixtures/historicalHar.ts` through
Node's type stripping rather than carrying a second copy under `scripts/`; the
`agentenv` scope lists that fixture so a change to it runs the lane. The lane
proves one framework release on one hosted runner and claims nothing about
any hosted platform. Three additions to the
designed Dockerfile and file set were needed by the framework, each found by
the local run: `MCP_PORT=18765` as the listener default for the port the
framework maps, Debian's `python3` because the framework's local sandbox
probes readiness with `python3 -c "import socket; …"` inside the container and
the slim Node image has none, and `env.toml` naming the environment, because
the framework otherwise reads the name from Python sources the Node image does
not have.

## Deferred issue criteria

This increment closes the agent-environment scope of #4933 together with the
previous three. Running the lane on the maintainer's CI and any follow-up on
hosted platforms are outside this PR.
