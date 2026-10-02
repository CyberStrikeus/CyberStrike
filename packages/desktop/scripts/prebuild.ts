#!/usr/bin/env bun
import { $ } from "bun"
import { cpSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../cyberstrike && bun script/build-node.ts`

const here = dirname(fileURLToPath(import.meta.url))
const extensionSrc = join(here, "..", "..", "hackbrowser", "extension")
const extensionDst = join(here, "..", "resources", "cyberstrike", "extension")
if (existsSync(extensionSrc)) {
  mkdirSync(extensionDst, { recursive: true })
  cpSync(extensionSrc, extensionDst, { recursive: true })
  console.log("Copied hackbrowser extension to resources/cyberstrike/extension")
}

// CyberStrike TODO: the background-CLI sidecar binary download is disabled.
// Upstream pulls a prebuilt rust CLI from @opencode-ai/cli-* (see utils.ts),
// which has no @cyberstrike-io/cli-* equivalent published yet. Re-enable once we
// ship our own CLI binaries.
// if (channel === "dev") await downloadCliToResources()
