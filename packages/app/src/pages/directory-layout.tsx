import { createEffect, createMemo, Show, type Accessor, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"

import { DataProvider } from "@cyberstrike-io/ui/context"
import type { QuestionAnswer } from "@cyberstrike-io/sdk/v2"
import { decode64 } from "@/utils/base64"
import { showToast } from "@cyberstrike-io/ui/toast"
import { useLanguage } from "@/context/language"
import { agentColor } from "@/utils/agent"

// `dirBase64` overrides the URL segment used when building session hrefs. The /:dir
// route leaves it undefined and falls back to params.dir; the /new-session draft route
// has no :dir param, so it passes the base64 of the draft's resolved directory instead.
export function DirectoryDataProvider(props: ParentProps<{ directory: string; dirBase64?: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()

  const dirSegment = () => props.dirBase64 ?? params.dir

  const resolveAgentColor = (name: string) => {
    const visible = sync.data.agent.filter((a) => a.mode !== "subagent" && !a.hidden)
    const index = visible.findIndex((a) => a.name === name)
    const agent = index >= 0 ? visible[index] : sync.data.agent.find((a) => a.name === name)
    return agentColor(name, agent?.color, index >= 0 ? index : undefined)
  }

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onPermissionRespond={(input: {
        sessionID: string
        permissionID: string
        response: "once" | "always" | "reject"
      }) => sdk.client.permission.respond(input)}
      onQuestionReply={(input: { requestID: string; answers: QuestionAnswer[] }) => sdk.client.question.reply(input)}
      onQuestionReject={(input: { requestID: string }) => sdk.client.question.reject(input)}
      onNavigateToSession={(sessionID: string) => navigate(`/${dirSegment()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${dirSegment()}/session/${sessionID}`}
      onSyncSession={(sessionID: string) => sync.session.sync(sessionID)}
      agentColor={resolveAgentColor}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

// The per-directory context stack (SDK → Sync → Data → Local) shared by the /:dir
// route and the /new-session draft route. Keeping it in one place means the draft
// composer renders inside exactly the same context DirectoryLayout establishes, just
// keyed on a directory resolved from the draft instead of the URL segment.
export function DirectoryProviders(
  props: ParentProps<{ directory: Accessor<string>; dirBase64?: Accessor<string> }>,
) {
  return (
    <SDKProvider directory={props.directory}>
      <SyncProvider>
        <DirectoryDataProvider directory={props.directory()} dirBase64={props.dirBase64?.()}>
          {props.children}
        </DirectoryDataProvider>
      </SyncProvider>
    </SDKProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const [store, setStore] = createStore({ invalid: "" })
  const directory = createMemo(() => {
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    if (store.invalid === params.dir) return
    setStore("invalid", params.dir)
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })
  return (
    <Show when={directory()}>
      <DirectoryProviders directory={directory}>{props.children}</DirectoryProviders>
    </Show>
  )
}
