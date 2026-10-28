import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { Form } from "@opencode/schema/form"
import { FileAttachment } from "@opencode/schema/prompt"
import { ConflictError, FormInvalidAnswerError, InvalidRequestError } from "@opencode/protocol/errors"
import { eq } from "drizzle-orm"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { HttpServerResponse } from "effect/http"
import { projectForm } from "@cyberstrike-io/api-v2/projection/form"
import { Identifier } from "../../id/id"
import { Agent } from "../../agent/agent"
import { Database } from "../../storage/db"
import { MessageTable } from "../../session/session.sql"
import { Lock } from "../../util/lock"
import { Question } from "../../question"
import { Project as ProjectDomain } from "../../project/project"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { SessionStatus } from "../../session/status"
import { Log } from "../../util/log"
import { inInstance } from "../instance"
import { getSession, notFound, publicSession, sessionDirectory } from "../lookup"
import { unavailable } from "./stub"

const log = Log.create({ service: "api-v2.session" })

// Agent and model choices made through switchAgent / switchModel. They apply to the next prompt. In-memory only:
// a restart drops them, and the v1 surface keeps no per-session selection either.
const selections = new Map<string, { agent?: string; model?: { providerID: string; modelID: string } }>()

export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  handlers
    .handle(
      "session.list",
      Effect.fn(function* (ctx) {
        const rows = yield* inInstance(ctx.query.directory ?? process.cwd(), async () => {
          const out: Session.Info[] = []
          for await (const session of Session.list({
            directory: ctx.query.directory,
            search: ctx.query.search,
            limit: ctx.query.limit,
          })) {
            out.push(session)
          }
          return out
        })
        const data = yield* Effect.forEach(rows, publicSession)
        return { data, cursor: {} }
      }),
    )
    .handle("session.stats", () => unavailable)
    .handle(
      "session.create",
      Effect.fn(function* (ctx) {
        const directory = ctx.payload.location?.directory ?? process.cwd()
        const info = yield* inInstance(directory, () =>
          Session.create({ parentID: ctx.payload.parentID, title: ctx.payload.title }),
        )
        const model = ctx.payload.model
        if (ctx.payload.agent || model) {
          selections.set(info.id, {
            agent: ctx.payload.agent,
            model: model && { providerID: model.providerID, modelID: model.id },
          })
        }
        return { data: yield* publicSession(info) }
      }),
    )
    .handle("session.import", () => unavailable)
    .handle("session.export", () => unavailable)
    .handle(
      "session.active",
      Effect.fn(function* () {
        // Status is kept per project instance, so the answer is the union over every known project.
        const statuses = yield* Effect.forEach(ProjectDomain.list(), (project) =>
          inInstance(project.worktree, () => SessionStatus.list()),
        )
        const data = Object.fromEntries(
          statuses
            .flatMap((status) => Object.entries(status))
            .filter(([, status]) => status.type !== "idle")
            .map(([sessionID]) => [sessionID, { type: "running" as const }]),
        )
        return { data }
      }),
    )
    .handle(
      "session.get",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        return { data: yield* publicSession(session) }
      }),
    )
    .handle(
      "session.remove",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        yield* inInstance(session.directory, () => Session.remove(ctx.params.sessionID))
      }),
    )
    .handle(
      "session.fork",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const forked = yield* inInstance(session.directory, () =>
          Session.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload.before }),
        )
        return { data: yield* publicSession(forked) }
      }),
    )
    .handle(
      "session.switchAgent",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        // Older OpenCode clients call the default primary agent "build".
        const agent = yield* inInstance(session.directory, async () =>
          ctx.payload.agent === "build" && !(await Agent.get("build")) ? Agent.defaultAgent() : ctx.payload.agent,
        )
        const current = selections.get(ctx.params.sessionID) ?? {}
        selections.set(ctx.params.sessionID, { ...current, agent })
      }),
    )
    .handle(
      "session.switchModel",
      Effect.fn(function* (ctx) {
        yield* getSession(ctx.params.sessionID)
        const current = selections.get(ctx.params.sessionID) ?? {}
        selections.set(ctx.params.sessionID, {
          ...current,
          model: { providerID: ctx.payload.model.providerID, modelID: ctx.payload.model.id },
        })
      }),
    )
    .handle(
      "session.update",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const title = ctx.payload.title
        if (title === undefined) return
        yield* inInstance(session.directory, () => Session.setTitle({ sessionID: ctx.params.sessionID, title }))
      }),
    )
    .handle("session.move", () => unavailable)
    .handle(
      "session.prompt",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const messageID = ctx.payload.id ?? Identifier.ascending("message")
        const selection = selections.get(ctx.params.sessionID) ?? {}
        const text = ctx.payload.text
        const files = yield* Effect.forEach(ctx.payload.files ?? [], (file) => {
          const match = /^data:([^;,]+);base64,(.*)$/s.exec(file.uri)
          if (!match)
            return Effect.fail(new InvalidRequestError({ message: "Only base64 data URI attachments are supported" }))
          return Schema.decodeUnknownEffect(FileAttachment)(
            compact({
              data: match[2],
              mime: match[1],
              source: { type: "inline" },
              name: file.name,
              description: file.description,
              mention: file.mention,
            }),
          ).pipe(Effect.mapError(() => new InvalidRequestError({ message: "Invalid file attachment" })))
        })
        // Persist admission before acknowledging it; only the model loop runs in the background.
        const message = yield* inInstance(session.directory, async () => {
          using lock = await Lock.write(`v2.prompt:${messageID}`)
          if (
            Database.use((db) =>
              db.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, messageID)).get(),
            )
          )
            return
          return SessionPrompt.prompt({
            sessionID: ctx.params.sessionID,
            messageID,
            agent: selection.agent,
            model: selection.model,
            noReply: true,
            parts: [
              { type: "text", text },
              ...files.map((file) => ({
                type: "file" as const,
                mime: file.mime,
                url: `data:${file.mime};base64,${file.data}`,
                filename: file.name,
              })),
              ...(ctx.payload.agents ?? []).map((agent) => ({ type: "agent" as const, name: agent.name })),
            ],
          })
        })
        if (!message) return yield* new ConflictError({ message: "Message ID already exists", resource: messageID })
        if (ctx.payload.resume !== false)
          yield* inInstance(session.directory, () => {
            SessionPrompt.loop({ sessionID: session.id }).catch((cause: unknown) =>
              log.error("prompt failed", { sessionID: session.id, cause }),
            )
          })
        const admitted = {
          id: messageID,
          sessionID: session.id,
          type: "user",
          delivery: ctx.payload.delivery ?? "queue",
          time: { created: message.info.time.created },
          payload: compact({
            text,
            files: files.map((file) => ({ ...file, source: { type: "inline" } })),
            agents: ctx.payload.agents ?? [],
            skills: [],
            metadata: ctx.payload.metadata,
          }),
        }
        return { data: yield* Schema.decodeUnknownEffect(SessionInbox.User)(admitted).pipe(Effect.orDie) }
      }),
    )
    .handle("session.command", () => unavailable)
    .handle("session.skill", () => unavailable)
    .handle("session.synthetic", () => unavailable)
    .handle("session.shell", () => unavailable)
    .handle("session.compact", () => unavailable)
    .handle("session.wait", () => unavailable)
    .handle("session.revert.stage", () => unavailable)
    .handle(
      "session.revert.clear",
      Effect.fn(function* (ctx) {
        yield* getSession(ctx.params.sessionID)
      }),
    )
    .handle("session.revert.commit", () => unavailable)
    .handle("session.context", () => unavailable)
    .handle(
      "session.diff",
      Effect.fn(function* (ctx) {
        yield* getSession(ctx.params.sessionID)
        return { data: [] }
      }),
    )
    .handle("session.inbox.list", () => unavailable)
    .handle("session.inbox.cancel", () => unavailable)
    .handle("session.inbox.update", () => unavailable)
    .handle("session.instructions.entry.list", () => unavailable)
    .handle("session.instructions.entry.put", () => unavailable)
    .handle("session.instructions.entry.remove", () => unavailable)
    .handle("session.generate", () => unavailable)
    .handle("session.log", () => unavailable)
    .handle(
      "session.interrupt",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        // Only this process can own a running turn, so the status map is the source of truth.
        const running = (yield* inInstance(session.directory, () => SessionStatus.list()))[ctx.params.sessionID]
        if (!running || running.type === "idle") return { interrupted: false }
        yield* inInstance(session.directory, () => {
          SessionPrompt.cancel(ctx.params.sessionID)
        })
        return { interrupted: true }
      }),
    )
    .handle("session.background", () => unavailable)
    .handle("session.message", () => unavailable)
    .handle(
      "session.form.list",
      Effect.fn(function* (ctx) {
        const directory = yield* sessionDirectory(ctx.params.sessionID)
        if (!directory) return { data: [] }
        const rows = yield* inInstance(directory, () => Question.list())
        return {
          data: yield* Schema.decodeUnknownEffect(Schema.Array(Form.Info))(
            rows.filter((row) => row.sessionID === ctx.params.sessionID).map(projectForm),
          ).pipe(Effect.orDie),
        }
      }),
    )
    .handle("session.form.create", () => unavailable)
    .handle("session.form.get", () => unavailable)
    .handle(
      "session.form.reply",
      Effect.fn(function* (ctx) {
        const formID = ctx.params.formID.replace(/^frm_/, "que_")
        const directory = yield* sessionDirectory(ctx.params.sessionID)
        const rows = directory ? yield* inInstance(directory, () => Question.list()) : []
        const form = rows.find((row) => row.id === formID && row.sessionID === ctx.params.sessionID)
        if (!directory || !form) return notFound("FormNotFoundError", `Form not found: ${formID}`)
        const invalid =
          Object.keys(ctx.payload.answer).some(
            (key) => !form.questions.some((_, index) => key === `question-${index}`),
          ) ||
          form.questions.some((question, index) => {
            const value = ctx.payload.answer[`question-${index}`]
            if (question.multiple ? !Array.isArray(value) : typeof value !== "string") return true
            const values = Array.isArray(value) ? value : [value]
            return (
              values.length === 0 ||
              values.some(
                (value) =>
                  typeof value !== "string" ||
                  !value ||
                  (question.custom === false && !question.options.some((option) => option.label === value)),
              )
            )
          })
        if (invalid)
          return yield* new FormInvalidAnswerError({ id: ctx.params.formID, message: "Invalid question answers" })
        // Answers arrive keyed by field; the v1 question takes one list of picked labels per question, in order.
        const answers = form.questions.map((_, index) => {
          const value: unknown = ctx.payload.answer[`question-${index}`]
          return Array.isArray(value) ? value.map(String) : [String(value)]
        })
        yield* inInstance(directory, () => Question.reply({ requestID: formID, answers }))
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "session.form.cancel",
      Effect.fn(function* (ctx) {
        const formID = ctx.params.formID.replace(/^frm_/, "que_")
        const directory = yield* sessionDirectory(ctx.params.sessionID)
        const rows = directory ? yield* inInstance(directory, () => Question.list()) : []
        if (!directory || !rows.some((row) => row.id === formID && row.sessionID === ctx.params.sessionID))
          return notFound("FormNotFoundError", `Form not found: ${formID}`)
        yield* inInstance(directory, () => Question.reject(formID))
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle("session.environment", () => unavailable)
    .handle("session.view", () => unavailable),
)
