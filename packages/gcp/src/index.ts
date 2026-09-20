// @cyberstrike-io/gcp — GCP cloud assessment domain (plugin).
//
// Installed via `npm install @cyberstrike-io/gcp`. The CyberStrike plugin
// loader runs this default export and wires the returned `tool` hooks into
// the host — no core edits. The gcphook tool lives in THIS package; the
// package reaches core runtime only through `cyberstrike/public` (the
// versioned boundary) and the `@cyberstrike-io/plugin` contract.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import { requireCoreApi } from "cyberstrike/public"
import { GcphookTool } from "./gcphook"

export default async function gcpPlugin(_input: PluginInput): Promise<Hooks> {
  requireCoreApi("1.2.0")

  return {
    tool: {
      gcphook: GcphookTool,
    },
  }
}
