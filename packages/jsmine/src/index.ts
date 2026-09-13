// @cyberstrike-io/jsmine — Enterprise JS-body miner. Public surface:
// - `mine(text, opts)` — pure text→Extract (endpoints / jsUrls / secrets).
// - `mineInto(store, txId, text, opts)` — mine + persist into a Vortex store (secrets → signals).
export type { MineOptions } from "./jsmine"
export { mine } from "./jsmine"
export { mineInto } from "./ingest"
// The recursive JS-mining crawl pass over the discovered inventory (first-party fetch + mine).
export type { MineCrawlOptions } from "./crawl"
export { mineDiscoveredJs, classifyScript } from "./crawl"
// The Vortex plugin wrapper — registerPlugin(registry, jsmine.plugin()) wires mining into the engine.
export { plugin } from "./plugin"
