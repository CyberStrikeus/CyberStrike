import { useNavigate } from "@solidjs/router"
import { produce } from "solid-js/store"
import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useTabs } from "@/context/tabs"
import { errorMessage } from "@/pages/layout/helpers"
import { useSessionKey } from "@/pages/session/session-layout"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"

export function useSessionArchive() {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const tabs = useTabs()
  const { params } = useSessionKey()

  const navigateAfterRemoval = (sessionID: string, dir: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    const href = (id: string) =>
      params.serverKey ? sessionHref(requireServerKey(params.serverKey), id) : legacySessionHref(dir, id)
    if (parentID) {
      navigate(href(parentID))
      return
    }
    if (nextSessionID) {
      navigate(href(nextSessionID))
      return
    }
    if (params.serverKey) {
      tabs.newDraft({ server: requireServerKey(params.serverKey), directory: dir })
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const archive = async (sessionID: string) => {
    const session = sync()?.session.get(sessionID)
    if (!session) return
    const s = sdk()
    if (!s) return
    if ((await s.protocol) !== "v1") return

    const sessions = sync()?.data.session ?? []
    const index = sessions.findIndex((x) => x.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await s.client.session
      .update({ sessionID, directory: s.directory, time: { archived: Date.now() } })
      .then(() => {
        sync().set(
          produce((draft) => {
            const idx = draft.session.findIndex((x) => x.id === sessionID)
            if (idx !== -1) draft.session.splice(idx, 1)
          }),
        )
        sync()?.session.evict(sessionID)
        serverSync().homeSessions.remove(sessionID)
        navigateAfterRemoval(sessionID, s.directory, session.parentID, nextSession?.id)
        notifySessionTabsRemoved({ directory: s.directory, sessionIDs: [sessionID] })
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
  }

  return { archive, navigateAfterRemoval }
}
