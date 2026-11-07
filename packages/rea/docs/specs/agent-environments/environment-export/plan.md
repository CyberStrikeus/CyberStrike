# Implementation plan

1. Extend `src/application/environment/environmentSource.ts` so
   `loadEnvironmentSource` takes the reporting operation and retains the
   capture artifact's SHA-256, letting the export reuse the serve command's
   authentication and cross-check unchanged.
2. Add `environmentBundle.ts` to plan the bundle from the source alone: the
   name rule, the Dockerfile for the registry and tarball package sources, the
   verifier, the smoke task, the README and the copy targets.
3. Add `environmentExport.ts` to read each input once through the
   regular-file reader, refuse an occupied directory, a missing tarball or an
   unreadable input before writing, then write the planned files with
   exclusive creation and copy the authenticated bytes and the tarball
   byte-exact.
4. Register `environment-export` in `src/cli/environmentCommands.ts` beside
   `environment-serve`, sharing the argument descriptions, and in
   `CLI_COMMANDS`.
5. Add the `agentenv` scope, `real-agentenv.yml`, the package script and
   `scripts/verify-agentenv-environment.mjs`, wire `ci.yml` and extend the
   `ciRequiredLanes` and `ciChangeScope` tables.
6. Add services, conformance and cli-boundary tests; document the command in
   `docs/cli.md`, the bundle and lane in `docs/agent-environments.md` and
   `docs/testing.md`; record the spec.

No new dependency is introduced; the CLI inventory gains one command.
