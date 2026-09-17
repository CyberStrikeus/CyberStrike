#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../cyberstrike && bun script/build-node.ts`

// CyberStrike TODO: the background-CLI sidecar binary download is disabled.
// Upstream pulls a prebuilt rust CLI from @opencode-ai/cli-* (see utils.ts),
// which has no @cyberstrike-io/cli-* equivalent published yet. Re-enable once we
// ship our own CLI binaries.
// if (channel === "dev") await downloadCliToResources()
