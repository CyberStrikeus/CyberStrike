import type { CoreRuntime } from "cyberstrike/public"

let injected: CoreRuntime | undefined

export function setCore(c: CoreRuntime): void {
  injected = c
}

export function core(): CoreRuntime {
  if (!injected) throw new Error("@cyberstrike-io/re: core runtime not injected — incompatible CyberStrike host.")
  return injected
}
