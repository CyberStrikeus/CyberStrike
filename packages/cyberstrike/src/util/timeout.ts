export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timeout: NodeJS.Timeout
  return Promise.race([
    promise.then((result) => {
      clearTimeout(timeout)
      return result
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        if (onTimeout) onTimeout()
        reject(new Error(`Operation timed out after ${ms}ms`))
      }, ms)
    }),
  ])
}
