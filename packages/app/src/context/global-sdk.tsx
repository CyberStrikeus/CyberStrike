import type { Event, CyberstrikeClient } from "@cyberstrike-io/sdk/v2/client"
import { createSimpleContext } from "@cyberstrike-io/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import type { GlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup } from "solid-js"
import { createSdkForServer } from "@/utils/server"
import { usePlatform } from "./platform"
import { useServer } from "./server"

export type CreateClientOpts = Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">

export type GlobalSDKValue = {
  url: string
  client: CyberstrikeClient
  event: GlobalEmitter<{ [key: string]: Event }>
  createClient: (opts: CreateClientOpts) => CyberstrikeClient
}

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: (): GlobalSDKValue => {
    const server = useServer()
    const platform = usePlatform()
    const abort = new AbortController()

    const currentServer = server.current
    if (!currentServer) throw new Error("No server available")

    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    type Queued = { directory: string; payload: Event }
    const FLUSH_FRAME_MS = 16
    const STREAM_YIELD_MS = 8
    const RECONNECT_DELAY_MS = 250

    let queue: Queued[] = []
    let buffer: Queued[] = []
    const coalesced = new Map<string, number>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0

    const key = (directory: string, payload: Event) => {
      if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
      if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
      if (payload.type === "message.part.updated") {
        const part = payload.properties.part
        return `message.part.updated:${directory}:${part.messageID}:${part.id}`
      }
    }

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined

      if (queue.length === 0) return

      const events = queue
      queue = buffer
      buffer = events
      queue.length = 0
      coalesced.clear()

      last = Date.now()
      batch(() => {
        for (const event of events) {
          emitter.emit(event.directory, event.payload)
        }
      })

      buffer.length = 0
    }

    const schedule = () => {
      if (timer) return
      const elapsed = Date.now() - last
      timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
    }

    let streamErrorLogged = false

    const enqueue = (directory: string, payload: Event) => {
      streamErrorLogged = false
      const k = key(directory, payload)
      if (k) {
        const i = coalesced.get(k)
        if (i !== undefined) {
          queue[i] = { directory, payload }
          return
        }
        coalesced.set(k, queue.length)
      }
      queue.push({ directory, payload })
      schedule()
    }

    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    // Browser: use fetch + manual TextDecoder (avoids TextDecoderStream/pipeThrough Firefox issues)
    // Tauri: use SDK fetch-based SSE (supports platform.fetch override)
    if (!platform.fetch) {
      const eventUrl = `${currentServer.http.url}/global/event`

      const parseSseChunks = (raw: string): { events: Array<{ data: string }>; rest: string } => {
        const events: Array<{ data: string }> = []
        const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        const chunks = normalized.split("\n\n")
        const rest = chunks.pop() ?? ""
        for (const chunk of chunks) {
          const lines = chunk.split("\n")
          const dataLines: string[] = []
          for (const line of lines) {
            if (line.startsWith("data:")) dataLines.push(line.replace(/^data:\s*/, ""))
          }
          if (dataLines.length) events.push({ data: dataLines.join("\n") })
        }
        return { events, rest }
      }

      void (async () => {
        while (!abort.signal.aborted) {
          try {
            const headers: Record<string, string> = {}
            if (currentServer.http.password)
              headers["Authorization"] =
                `Basic ${btoa(`${currentServer.http.username ?? "cyberstrike"}:${currentServer.http.password}`)}`
            const response = await fetch(eventUrl, { signal: abort.signal, headers })
            if (!response.ok) throw new Error(`SSE ${response.status}`)
            if (!response.body) throw new Error("No body")

            streamErrorLogged = false
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buf = ""
            let yielded = Date.now()

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                const parsed = parseSseChunks(buf)
                buf = parsed.rest
                for (const ev of parsed.events) {
                  try {
                    const data = JSON.parse(ev.data)
                    const directory = data.directory ?? "global"
                    const payload = data.payload
                    if (payload) enqueue(directory, payload)
                  } catch {}
                }
                if (Date.now() - yielded < STREAM_YIELD_MS) continue
                yielded = Date.now()
                await wait(0)
              }
            } finally {
              reader.releaseLock()
            }
          } catch (error) {
            if (abort.signal.aborted) return
            if (!streamErrorLogged) {
              streamErrorLogged = true
              console.error("[global-sdk] event stream error", {
                url: currentServer.http.url,
                error,
              })
            }
          }

          if (abort.signal.aborted) return
          await wait(RECONNECT_DELAY_MS)
        }
      })().finally(flush)
    } else {
      const eventFetch = (() => {
        try {
          const url = new URL(currentServer.http.url)
          const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
          if (url.protocol === "http:" && !loopback) return platform.fetch
        } catch {
          return
        }
      })()

      const eventSdk = createSdkForServer({
        signal: abort.signal,
        fetch: eventFetch,
        server: currentServer.http,
      })

      void (async () => {
        while (!abort.signal.aborted) {
          try {
            const events = await eventSdk.global.event({
              onSseError: (error) => {
                if (streamErrorLogged) return
                streamErrorLogged = true
                console.error("[global-sdk] event stream error", {
                  url: currentServer.http.url,
                  fetch: eventFetch ? "platform" : "webview",
                  error,
                })
              },
            })
            let yielded = Date.now()
            for await (const event of events.stream) {
              const directory = event.directory ?? "global"
              const payload = event.payload
              enqueue(directory, payload)

              if (Date.now() - yielded < STREAM_YIELD_MS) continue
              yielded = Date.now()
              await wait(0)
            }
          } catch (error) {
            if (!streamErrorLogged) {
              streamErrorLogged = true
              console.error("[global-sdk] event stream failed", {
                url: currentServer.http.url,
                fetch: eventFetch ? "platform" : "webview",
                error,
              })
            }
          }

          if (abort.signal.aborted) return
          await wait(RECONNECT_DELAY_MS)
        }
      })().finally(flush)
    }

    onCleanup(() => {
      abort.abort()
      flush()
    })

    const sdk = createSdkForServer({
      server: currentServer.http,
      fetch: platform.fetch,
      throwOnError: true,
    })

    return {
      url: currentServer.http.url,
      client: sdk,
      event: emitter,
      createClient(opts: CreateClientOpts): CyberstrikeClient {
        const s = server.current
        if (!s) throw new Error("Server not available")
        return createSdkForServer({
          server: s.http,
          fetch: platform.fetch,
          ...opts,
        })
      },
    }
  },
})
