import type { Event, CyberstrikeClient } from "@cyberstrike-io/sdk/v2/client"
import { createSimpleContext } from "@cyberstrike-io/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import type { GlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { useGlobalSDK } from "./global-sdk"
import type { CreateClientOpts } from "./global-sdk"

type SDKEventMap = {
  [key in Event["type"]]: Extract<Event, { type: key }>
}

export type SDKValue = {
  readonly directory: string
  readonly client: CyberstrikeClient
  event: GlobalEmitter<SDKEventMap>
  readonly url: string
  createClient: (opts: CreateClientOpts) => CyberstrikeClient
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: Accessor<string> }): SDKValue => {
    const globalSDK = useGlobalSDK()

    const directory = createMemo(props.directory)
    const client = createMemo(() =>
      globalSDK.createClient({
        directory: directory(),
        throwOnError: true,
      }),
    )

    const emitter = createGlobalEmitter<SDKEventMap>()

    createEffect(() => {
      const unsub = globalSDK.event.on(directory(), (event) => {
        emitter.emit(event.type, event)
      })
      onCleanup(unsub)
    })

    return {
      get directory() {
        return directory()
      },
      get client() {
        return client()
      },
      event: emitter,
      get url() {
        return globalSDK.url
      },
      createClient(opts: CreateClientOpts) {
        return globalSDK.createClient(opts)
      },
    }
  },
})
