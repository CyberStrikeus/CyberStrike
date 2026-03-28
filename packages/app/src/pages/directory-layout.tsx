import { createEffect, createMemo, Show, type ParentProps } from "solid-js"
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

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()

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
      onNavigateToSession={(sessionID: string) => navigate(`/${params.dir}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${params.dir}/session/${sessionID}`}
      onSyncSession={(sessionID: string) => sync.session.sync(sessionID)}
      agentColor={resolveAgentColor}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
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
      <SDKProvider directory={directory}>
        <SyncProvider>
          <DirectoryDataProvider directory={directory()}>{props.children}</DirectoryDataProvider>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
