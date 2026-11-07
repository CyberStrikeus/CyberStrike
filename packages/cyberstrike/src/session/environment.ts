// Per-session overlay on the process environment for local shell commands. Set through session.environment; the
// bash tool and the session shell merge it over the instance environment. Kept in memory, like the agent and model
// selections, so a restart clears it.
export namespace SessionEnvironment {
  const overlays = new Map<string, Record<string, string>>()

  export function set(sessionID: string, variables: Record<string, string>) {
    overlays.set(sessionID, { ...variables })
  }

  export function get(sessionID: string | undefined): Record<string, string> {
    if (!sessionID) return {}
    return overlays.get(sessionID) ?? {}
  }
}
