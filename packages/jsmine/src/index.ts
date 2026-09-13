// @cyberstrike-io/jsmine — Enterprise JS-body miner. Public surface:
// - `mine(text, opts)` — pure text→Extract (endpoints / jsUrls / secrets).
// - `mineInto(store, txId, text, opts)` — mine + persist into a Vortex store (secrets → signals).
export type { MineOptions } from "./jsmine"
export { mine } from "./jsmine"
export { mineInto } from "./ingest"
