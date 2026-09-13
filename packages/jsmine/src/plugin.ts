// The Vortex plugin wrapper — how jsmine plugs into the engine WITHOUT the free core importing it.
// An Enterprise bootstrap does `registerPlugin(registry, jsmine.plugin())`, then core's
// `extract(store, registry)` calls the hook over each observed transaction. Core owns the seam
// (VortexPlugin.onTransaction); jsmine owns what the hook does. Dependency direction stays
// jsmine → vortex; core never imports this package.
import type { VortexPlugin, Transaction } from "@cyberstrike-io/vortex"
import { mineInto } from "./ingest"
import type { MineOptions } from "./jsmine"

// Only mine JavaScript responses — a content-type of *javascript/*ecmascript, or a .js/.mjs/.cjs URL.
function isJsTransaction(tx: Transaction): boolean {
  const ct = tx.response?.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? ""
  if (/javascript|ecmascript/i.test(ct)) return true
  try {
    return /\.(?:m?js|cjs)(?:$|[?#])/i.test(new URL(tx.request.url).pathname)
  } catch {
    return false
  }
}

// Build the jsmine VortexPlugin. `opts` is passed through to the miner (entropy toggle, max, etc.);
// baseUrl is set per-transaction to the script's own URL so its relative refs resolve correctly.
export function plugin(opts: Omit<MineOptions, "baseUrl"> = {}): VortexPlugin {
  return {
    name: "@cyberstrike-io/jsmine",
    version: "0.1.0",
    requiresCore: "^1.0.0",
    onTransaction: [
      (store, tx) => {
        if (!isJsTransaction(tx)) return
        const body = tx.response?.body ?? ""
        if (!body) return
        mineInto(store, tx.id, body, { ...opts, baseUrl: tx.request.url })
      },
    ],
  }
}
