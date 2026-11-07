import { $ } from "bun"
import { cpSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

// CyberStrike: electron's own postinstall fetches its binary during `bun
// install`, so the explicit `bun run install-electron` step upstream ran here is
// not needed in our monorepo.

await $`bun ./scripts/copy-icons.ts ${process.env.CYBERSTRIKE_CHANNEL ?? "dev"}`

await $`cd ../cyberstrike && bun script/build-node.ts`

const here = dirname(fileURLToPath(import.meta.url))
const extensionSrc = join(here, "..", "..", "hackbrowser", "extension")
const extensionDst = join(here, "..", "resources", "cyberstrike", "extension")
if (existsSync(extensionSrc)) {
  mkdirSync(extensionDst, { recursive: true })
  cpSync(extensionSrc, extensionDst, { recursive: true })
  console.log("Copied hackbrowser extension to resources/cyberstrike/extension")
}

// CyberStrike TODO: background-CLI sidecar binary download disabled — see
// prebuild.ts. No @cyberstrike-io/cli-* package exists yet.
// await downloadCliToResources()
