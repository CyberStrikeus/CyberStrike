import { $ } from "bun"

// CyberStrike: electron's own postinstall fetches its binary during `bun
// install`, so the explicit `bun run install-electron` step upstream ran here is
// not needed in our monorepo.

await $`bun ./scripts/copy-icons.ts ${process.env.CYBERSTRIKE_CHANNEL ?? "dev"}`

await $`cd ../cyberstrike && bun script/build-node.ts`

// CyberStrike TODO: background-CLI sidecar binary download disabled — see
// prebuild.ts. No @cyberstrike-io/cli-* package exists yet.
// await downloadCliToResources()
