export function singleflight<T>(fn: () => Promise<T>) {
  let inflight: Promise<T> | undefined
  return () => {
    if (inflight) return inflight
    inflight = fn().finally(() => {
      inflight = undefined
    })
    return inflight
  }
}
