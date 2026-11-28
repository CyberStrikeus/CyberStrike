import { Effect, Option, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { projectMessage } from "@cyberstrike-io/api-v2/projection/message"
import { PublicSessionMessage } from "@cyberstrike-io/api-v2/wire"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { Log } from "../../util/log"
import { inInstance } from "../instance"
import { getSession } from "../lookup"

const log = Log.create({ service: "api-v2.message" })

// Each message is decoded on its own. One malformed message is logged and skipped; the page still answers.
const decodeOne = Schema.decodeUnknownOption(PublicSessionMessage)

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  handlers.handle(
    "session.messages",
    Effect.fn(function* (ctx) {
      const sessionID = ctx.params.sessionID
      const session = yield* getSession(sessionID)
      const rows = yield* inInstance(session.directory, () => Session.messages({ sessionID, limit: ctx.query.limit }))
      const data = rows.flatMap((row) => {
        const info = MessageV2.Info.safeParse(row.info)
        if (!info.success) {
          log.warn("skipped a malformed message", { sessionID, messageID: row.info.id })
          return []
        }
        const parts = row.parts.flatMap((part) => {
          const decoded = MessageV2.Part.safeParse(part)
          if (decoded.success) return [decoded.data]
          log.warn("skipped a malformed part", { sessionID, messageID: row.info.id, partID: part.id })
          return []
        })
        const decoded = decodeOne(projectMessage({ info: info.data, parts }))
        if (Option.isSome(decoded)) return [decoded.value]
        log.warn("skipped a message that does not match the v2 schema", { sessionID, messageID: row.info.id })
        return []
      })
      return { data, cursor: {} }
    }),
  ),
)
