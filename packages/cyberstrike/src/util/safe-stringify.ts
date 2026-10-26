// Stack-safe JSON.stringify — falls back to a shallow placeholder on
// "Maximum call stack size exceeded" (deeply nested or circular data)
// instead of crashing the caller.
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return "[unserializable]"
  }
}
