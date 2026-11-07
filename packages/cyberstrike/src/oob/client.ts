import { OobStore } from "./store"
import { OobServer } from "./server"

// Shared OOB read client (#89). The one place that resolves the OOB base domain and reads captured
// interactions — from the in-process store (OOB server runs in this process) OR a remote OOB server's
// management API (CYBERSTRIKE_OOB_API). Both the subagent tools (tool/oob.ts) and the deterministic SSRF
// probe (session/web/ssrf-probe.ts) go through here, so there is a single source of truth.
export namespace Oob {
  // The delegated base domain OOB hosts are minted under, or undefined when OOB is not configured.
  export function domain(): string | undefined {
    return OobServer.domain() || process.env.CYBERSTRIKE_OOB_DOMAIN?.toLowerCase().replace(/^\.+|\.+$/g, "") || undefined
  }

  export function configured(): boolean {
    return !!domain()
  }

  // Captured interactions for a token: the remote management API when CYBERSTRIKE_OOB_API is set,
  // otherwise the in-process store. Never throws — a read failure falls back to the in-process store.
  export async function readInteractions(token: string): Promise<OobStore.Interaction[]> {
    const api = process.env.CYBERSTRIKE_OOB_API
    if (api) {
      try {
        const r = await fetch(`${api.replace(/\/$/, "")}/i/${encodeURIComponent(token)}`)
        if (r.ok) {
          const j = (await r.json()) as { interactions?: OobStore.Interaction[] }
          if (Array.isArray(j.interactions)) return j.interactions
        }
      } catch {
        /* fall through to the in-process store */
      }
    }
    return OobStore.poll(token)
  }
}
