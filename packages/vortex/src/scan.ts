// scan() — the one call that turns rules into stored signals ("flags" on the traffic). Runs the
// registry's passive + corpus rules over the OBSERVED corpus (never replay probes) and persists the
// deduped signals into the store, so downstream consumers read them from the DB instead of re-
// running rules. Active/probe rules need a sender, so they run via runActiveRules and are persisted
// with the same store.addSignals.
import type { TrafficStore } from "./store"
import type { RuleRegistry, Signal } from "./rule"
import { observed } from "./scope"
import { scanCanaries } from "./canary"

export function scan(store: TrafficStore, registry: RuleRegistry): Signal[] {
  const signals = registry.analyze(observed(store.all()))
  store.addSignals(signals)
  return signals
}

// Scan the store's observed responses against its registered canaries for cross-request (stored)
// reflections, and persist the resulting signals. Run after new observed traffic arrives.
export function scanStored(store: TrafficStore): Signal[] {
  const signals = scanCanaries(store.all(), store.canaries())
  store.addSignals(signals)
  return signals
}

// Persist an already-produced signal set (e.g. from runActiveRules) into the store.
export function recordSignals(store: TrafficStore, signals: Signal[]): number {
  return store.addSignals(signals)
}
