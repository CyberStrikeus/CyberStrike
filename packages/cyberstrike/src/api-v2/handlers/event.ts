import { Effect, Queue, Stream } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { frame, projectEvent } from "@cyberstrike-io/api-v2/events"
import { GlobalBus } from "../../bus/global"
import { MessageV2 } from "../../session/message-v2"

const encoder = new TextEncoder()

// The global bus also sees newly opened directories, not just instances known when the feed connected.
export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  handlers.handle(
    "event.subscribe",
    Effect.fn(function* () {
      const stream = Stream.callback<Uint8Array>((queue) =>
        Effect.gen(function* () {
          yield* Queue.offer(queue, encoder.encode(frame({ type: "server.connected", data: {} })))
          const forward = async ({ payload: event }: Parameters<typeof GlobalBus.emit<"event">>[1]) => {
            const part = event.type === "message.part.updated" ? event.properties.part : undefined
            const text =
              (event.type === "message.part.delta" && event.properties.field === "text") || part?.type === "text"
            const parts = text ? await MessageV2.parts(part?.messageID ?? event.properties.messageID) : []
            const ordinal = parts
              .filter((part) => ["text", "reasoning", "tool"].includes(part.type))
              .findIndex((item) => item.id === (part?.id ?? event.properties.partID))
            if (text && ordinal < 0) return
            const wire = projectEvent(event, ordinal)
            if (wire) Queue.offerUnsafe(queue, encoder.encode(frame(wire)))
          }
          GlobalBus.on("event", forward)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              GlobalBus.off("event", forward)
            }),
          )
          return yield* Effect.never
        }),
      )
      return HttpServerResponse.stream(stream, { contentType: "text/event-stream" })
    }),
  ),
)
