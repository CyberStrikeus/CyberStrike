// Single-server tabs ADAPTER (Phase B v2-shell spike).
//
// Upstream opencode ships a ~385-line multi-server tab machine (persistence,
// migration, closed-tab history, per-tab prompt state, drag reorder) whose tabs
// each carry a `server: ServerConnection.Key`. CyberStrike is single-server:
// one connection via `context/server`, one data layer via
// `context/global-sdk` + `context/global-sync`.
//
// This shim presents that single server as the shape the ported v2 shell reads:
// a `store` that is a list of exactly one active tab, bound to the current route
// (directory + session id) and the single active connection. It deliberately
// implements ONLY the surface the ported presentational pieces consume; it is
// not a general tab manager.
import { createMemo, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { createSimpleContext } from "@cyberstrike-io/ui/context"
import { ServerConnection, useServer } from "./server"
import { decode64 } from "@/utils/base64"

export type SessionTab = {
  type: "session"
  server: ServerConnection.Key
  directory: string
  sessionId: string
}

export type DraftTab = {
  type: "draft"
  draftID: string
  server: ServerConnection.Key
  directory: string
}

export type Tab = SessionTab | DraftTab

export const draftHref = (draftID: string) => `/new-session?draftId=${encodeURIComponent(draftID)}`

export const tabHref = (tab: Tab) =>
  tab.type === "draft" ? draftHref(tab.draftID) : `/${encodeURIComponent(tab.directory)}/session/${tab.sessionId}`

export const tabKey = (tab: Tab) =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${tab.directory}\n${tab.sessionId}`

export type TabsValue = {
  // A list of exactly one — the "list of one server" contract as a list of one
  // active tab. Presentational pieces iterate it with <For>.
  store: Accessor<Tab[]>
  active: Accessor<Tab | undefined>
  ready: Accessor<boolean>
}

export const { use: useTabs, provider: TabsProvider } = createSimpleContext({
  name: "Tabs",
  gate: false,
  init: (): TabsValue => {
    const server = useServer()
    const params = useParams<{ dir?: string; id?: string }>()

    const active = createMemo<Tab | undefined>(() => {
      const key = server.key
      if (!key) return undefined
      const dir = (params.dir ? decode64(params.dir) : "") ?? ""
      if (!params.id) return undefined
      return { type: "session", server: key, directory: dir, sessionId: params.id }
    })

    const store = createMemo<Tab[]>(() => {
      const tab = active()
      return tab ? [tab] : []
    })

    return {
      store,
      active,
      ready: () => server.ready(),
    }
  },
})
