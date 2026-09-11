import type { CoreRuntime } from "cyberstrike/public"

// Set once when the plugin loads (from input.core); read at CALL time everywhere else.
let injected: CoreRuntime | undefined

export function setCore(c: CoreRuntime): void {
  injected = c
}

/** The host-injected core runtime. Throws if the plugin ran without injection
 *  (an incompatible host) rather than crashing with a confusing undefined error. */
export function core(): CoreRuntime {
  if (!injected) throw new Error("@cyberstrike-io/saas: core runtime not injected — incompatible CyberStrike host.")
  return injected
}
