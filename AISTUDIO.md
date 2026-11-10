# AI Studio / npm setup

This repository is a Bun monorepo, but the web app (`packages/app`) can also be
installed and served with plain npm, which is what Google AI Studio's build
environment requires.

## Run the web app (npm)

```
npm install
npm run dev
```

- Dev server: Vite, binds `0.0.0.0`, port `process.env.PORT` or 3000.
- Serves the CyberStrike web UI from `packages/app` (SolidJS + Tailwind).
- Requires Node >= 20.19 (Vite 7 requirement).

## What was changed for npm compatibility

- The root `package.json` no longer uses Bun-only fields
  (`catalog:`, `patchedDependencies`, `packageManager`, `trustedDependencies`).
- All `catalog:` versions in the 12 web-app workspace packages were inlined as
  concrete versions; `workspace:*` refs became `*`.
- The npm workspace list is explicit and intentionally limited to the web app's
  import closure: app, core, effect-drizzle-sqlite, effect-sqlite-node,
  http-recorder, llm, plugin, schema, sdk/js, session-ui, ui, util.
- `@cyberstrike-io/client` resolves from the prebuilt vendored tarball
  (`packages/app/vendor/cyberstrike-io-client-1.17.13-v2.tgz`), which has no
  dependencies of its own.

## Bun development (server / CLI)

The full Bun workspace setup (CLI in `packages/cyberstrike`, desktop,
console, etc.) was narrowed in the root `package.json` to the packages above.
To restore the Bun CLI/server development flow, re-add the previous workspace
globs to the root `package.json` and reinstall with Bun:

```json
"workspaces": {
  "packages": ["packages/*", "!packages/rea", "packages/console/*", "packages/sdk/js", "packages/slack", "packages/hackbrowser"],
  "catalog": { "...": "restore from git history" }
}
```

The server (`packages/cyberstrike`) is Bun-only code at runtime; the npm dev
flow starts the web UI only, so the app will show its "not connected" state
until it can reach a CyberStrike server.
