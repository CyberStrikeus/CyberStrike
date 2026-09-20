// @cyberstrike-io/aws — AWS cloud assessment domain (plugin).
//
// Installed via `npm install @cyberstrike-io/aws`. The CyberStrike plugin
// loader runs this default export and wires the returned `tool` hooks into
// the host — no core edits. The awshook tool lives in THIS package; the
// package reaches core runtime only through `cyberstrike/public` (the
// versioned boundary) and the `@cyberstrike-io/plugin` contract.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import { requireCoreApi } from "cyberstrike/public"
import { AwshookTool } from "./awshook"

export default async function awsPlugin(_input: PluginInput): Promise<Hooks> {
  requireCoreApi("1.2.0")

  return {
    tool: {
      awshook: AwshookTool,
    },
  }
}
