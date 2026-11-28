import path from "node:path"
import { pathToFileURL } from "node:url"
import { DateTime, Effect, Option, Queue, Schema, Stream } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionStats } from "@opencode/schema/session-stats"
import { Revert } from "@opencode/schema/session-revert"
import { Form } from "@opencode/schema/form"
import { FileAttachment } from "@opencode/schema/prompt"
import { InstructionEntry } from "@opencode/schema/instruction-entry"
import {
  CommandExecutionError,
  CommandNotFoundError,
  ConflictError,
  FormInvalidAnswerError,
  FormNotFoundError,
  InvalidRequestError,
  MessageNotFoundError,
  ServiceUnavailableError,
  SessionBusyError,
  SessionNotFoundError,
  SkillNotFoundError,
  UnknownError,
} from "@opencode/protocol/errors"
import { eq } from "drizzle-orm"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { HttpServerResponse } from "effect/http"
import { projectForm } from "@cyberstrike-io/api-v2/projection/form"
import { projectMessage } from "@cyberstrike-io/api-v2/projection/message"
import { PublicSessionMessage } from "@cyberstrike-io/api-v2/wire"
import { Identifier } from "../../id/id"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { Command } from "../../command"
import { Database } from "../../storage/db"
import { MessageTable, SessionTable } from "../../session/session.sql"
import { Lock } from "../../util/lock"
import { Question } from "../../question"
import { Project as ProjectDomain } from "../../project/project"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"
import { Provider } from "../../provider/provider"
import { Filesystem } from "../../util/filesystem"
import { Session } from "../../session"
import { SessionCompaction } from "../../session/compaction"
import { SessionEnvironment } from "../../session/environment"
import { Inbox } from "../../session/inbox"
import { SessionInstructions } from "../../session/instructions"
import { SessionLog } from "../../session/log"
import { LLM } from "../../session/llm"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { SessionRevert } from "../../session/revert"
import { SessionStatus } from "../../session/status"
import { Skill } from "../../skill"
import { SkillContext } from "../../skill/context"
import { Log } from "../../util/log"
import { inInstance } from "../instance"
import { getSession, notFound, publicSession, sessionDirectory } from "../lookup"
import { Registry } from "../../shell/registry"
import { Foreground } from "../../tool/bash"

const log = Log.create({ service: "api-v2.session" })

const encoder = new TextEncoder()

// One SSE data frame carrying one JSON item, the framing session.log declares.
const sse = (item: unknown) => encoder.encode(`data: ${JSON.stringify(item)}\n\n`)

const exists = (sessionID: string) =>
  getSession(sessionID).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  )

// Agent and model choices made through switchAgent / switchModel. They apply to the next prompt. In-memory only:
// a restart drops them, and the v1 surface keeps no per-session selection either.
const selections = new Map<string, { agent?: string; model?: { providerID: string; modelID: string } }>()

const DAY = 24 * 60 * 60 * 1000

type ToolMode = typeof SessionStats.ToolMode.Type

// Runs a v1 domain call in the session's instance, but keeps the rejection so the caller can map it onto a declared error.
const attempt = <A>(directory: string, fn: () => Promise<A>) =>
  Effect.tryPromise({
    try: () => Instance.provide({ directory, init: InstanceBootstrap, fn }) as Promise<A>,
    catch: (cause) => cause,
  })

const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const badRequest = (error: InvalidRequestError) =>
  HttpServerResponse.jsonUnsafe({ _tag: error._tag, message: error.message }, { status: 400 })

const busy = (sessionID: string) => (cause: unknown) =>
  cause instanceof Session.BusyError
    ? Effect.fail(new SessionBusyError({ sessionID, message: cause.message }))
    : Effect.die(cause)

// Each message is projected on its own. A malformed message is logged and skipped; the page still answers.
const decodeMessage = Schema.decodeUnknownOption(PublicSessionMessage)
const projectRow = (row: MessageV2.WithParts) => {
  const info = MessageV2.Info.safeParse(row.info)
  if (!info.success) {
    log.warn("skipped a malformed message", { messageID: row.info.id })
    return Option.none()
  }
  const parts = row.parts.flatMap((part) => {
    const decoded = MessageV2.Part.safeParse(part)
    return decoded.success ? [decoded.data] : []
  })
  return decodeMessage(projectMessage({ info: info.data, parts }))
}

// Admits one user-side message. Returns undefined when the ID is already taken, which is the caller's conflict.
const admit = (input: {
  sessionID: string
  directory: string
  messageID: string
  parts: Parameters<typeof SessionPrompt.prompt>[0]["parts"]
}) =>
  inInstance(input.directory, async () => {
    using lock = await Lock.write(`v2.prompt:${input.messageID}`)
    if (
      Database.use((db) =>
        db.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, input.messageID)).get(),
      )
    )
      return
    return SessionPrompt.prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      noReply: true,
      parts: input.parts,
    })
  })

// Starts the agent loop in the background, the same way session.prompt does.
const resume = (directory: string, sessionID: string) =>
  inInstance(directory, () => {
    SessionPrompt.loop({ sessionID }).catch((cause: unknown) => log.error("loop failed", { sessionID, cause }))
  })

const attachments = (
  files: ReadonlyArray<{ uri: string; name?: string; description?: string; mention?: unknown }> = [],
) =>
  Effect.forEach(files, (file) => {
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

const toQuestion = (field: typeof Form.Field.Type): Effect.Effect<Question.Info, InvalidRequestError> => {
  const title = field.title ?? field.key
  if (field.type === "multiselect")
    return Effect.succeed({
      question: title,
      header: title.slice(0, 30),
      multiple: true,
      custom: field.custom ?? true,
      options: field.options.map((option) => ({ label: option.label, description: option.description ?? "" })),
    })
  if (field.type === "string")
    return Effect.succeed({
      question: title,
      header: title.slice(0, 30),
      custom: field.custom ?? true,
      options: (field.options ?? []).map((option) => ({ label: option.label, description: option.description ?? "" })),
    })
  return Effect.fail(
    new InvalidRequestError({ message: `Unsupported form field type: ${field.type}`, field: field.key }),
  )
}

const median = (values: number[]) => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const zeroTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

// Aggregates every session in the local database. Activity days and streaks are counted in the formatter's timezone.
async function aggregate(input: {
  from?: number
  to?: number
  project?: string
  tools: ToolMode
  formatter: Intl.DateTimeFormat
}) {
  const sessions = Database.use((db) => db.select().from(SessionTable).all())
    .map(Session.fromRow)
    .filter((session) => !input.project || session.projectID === input.project)
  const all = (
    await Promise.all(
      sessions.map(async (session) =>
        (await Session.messages({ sessionID: session.id })).map((entry) => ({ session, entry })),
      ),
    )
  ).flat()
  const to = input.to ?? Date.now()
  const from = input.from ?? all.reduce((min, { entry }) => Math.min(min, entry.info.time.created), to)
  const inRange = all.filter(({ entry }) => entry.info.time.created >= from && entry.info.time.created <= to)
  const seen = new Map(inRange.map(({ session }) => [session.id, session]))
  const entries = inRange.map(({ entry }) => entry)
  const assistants = entries.flatMap((entry) =>
    entry.info.role === "assistant" ? [{ info: entry.info, parts: entry.parts }] : [],
  )
  const calls = assistants.flatMap(({ parts }) => parts.flatMap((part) => (part.type === "tool" ? [part] : [])))
  const outcome = (status: string) =>
    status === "completed" ? "succeeded" : status === "error" ? "failed" : "unfinished"
  const count = (list: typeof calls, key: "succeeded" | "failed" | "unfinished") =>
    list.filter((part) => outcome(part.state.status) === key).length
  const durations = (list: typeof calls) =>
    list.flatMap((part) => {
      if (part.state.status !== "completed" && part.state.status !== "error") return []
      const time = part.state.time
      return time.end === undefined ? [] : [time.end - time.start]
    })
  const totals = {
    calls: calls.length,
    succeeded: count(calls, "succeeded"),
    failed: count(calls, "failed"),
    unfinished: count(calls, "unfinished"),
  }
  const tools =
    input.tools === "none"
      ? { mode: "none" as const }
      : input.tools === "summary"
        ? { mode: "summary" as const, totals }
        : {
            mode: "detail" as const,
            totals,
            usage: [...new Set(calls.map((part) => part.tool))].map((name) => {
              const own = calls.filter((part) => part.tool === name)
              return compact({
                name,
                calls: own.length,
                succeeded: count(own, "succeeded"),
                failed: count(own, "failed"),
                unfinished: count(own, "unfinished"),
                durationP50: median(durations(own)),
              })
            }),
          }
  const days = assistants.reduce((map, { info }) => {
    const date = input.formatter.format(info.time.created)
    return map.set(date, (map.get(date) ?? 0) + 1)
  }, new Map<string, number>())
  const activity = [...days].map(([date, steps]) => ({ date, steps })).sort((a, b) => a.date.localeCompare(b.date))
  const dayNumbers = activity.map((day) => Date.parse(`${day.date}T00:00:00Z`) / DAY)
  const streak = dayNumbers.reduce(
    ({ run, best }, day, index) => {
      const next = index > 0 && day - dayNumbers[index - 1] === 1 ? run + 1 : 1
      return { run: next, best: Math.max(best, next) }
    },
    { run: 0, best: 0 },
  ).best
  const models = [
    ...assistants
      .reduce((map, { info }) => {
        const key = `${info.providerID}/${info.modelID}`
        const current = map.get(key) ?? {
          model: { id: info.modelID, providerID: info.providerID },
          steps: 0,
          tokens: zeroTokens,
          cost: 0,
        }
        return map.set(key, {
          model: current.model,
          steps: current.steps + 1,
          tokens: {
            input: current.tokens.input + info.tokens.input,
            output: current.tokens.output + info.tokens.output,
            reasoning: current.tokens.reasoning + info.tokens.reasoning,
            cache: {
              read: current.tokens.cache.read + info.tokens.cache.read,
              write: current.tokens.cache.write + info.tokens.cache.write,
            },
          },
          cost: current.cost + (info.cost ?? 0),
        })
      }, new Map<string, { model: { id: string; providerID: string }; steps: number; tokens: typeof zeroTokens; cost: number }>())
      .values(),
  ]
  return {
    range: { from, to },
    sessions: seen.size,
    subagents: [...seen.values()].filter((session) => session.parentID).length,
    prompts: entries.filter((entry) => entry.info.role === "user").length,
    steps: assistants.length,
    tokens: assistants.reduce(
      (sum, { info }) => ({
        input: sum.input + info.tokens.input,
        output: sum.output + info.tokens.output,
        reasoning: sum.reasoning + info.tokens.reasoning,
        cache: { read: sum.cache.read + info.tokens.cache.read, write: sum.cache.write + info.tokens.cache.write },
      }),
      zeroTokens,
    ),
    cost: assistants.reduce((sum, { info }) => sum + (info.cost ?? 0), 0),
    tools,
    activeDays: activity.length,
    streak,
    activity,
    models,
  }
}

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
    .handle(
      "session.stats",
      Effect.fn(function* (ctx) {
        const formatter = yield* Effect.try({
          try: () =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: ctx.query.timezone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }),
          catch: () =>
            new InvalidRequestError({ message: `Invalid timezone: ${ctx.query.timezone}`, field: "timezone" }),
        })
        if (ctx.query.from !== undefined && ctx.query.to !== undefined && ctx.query.from > ctx.query.to)
          return yield* new InvalidRequestError({ message: "from must not be after to", field: "from" })
        const data = yield* inInstance(process.cwd(), () =>
          aggregate({
            from: ctx.query.from,
            to: ctx.query.to,
            project: ctx.query.project,
            tools: ctx.query.tools ?? "summary",
            formatter,
          }),
        )
        return { data: yield* Schema.decodeUnknownEffect(SessionStats.Info)(data).pipe(Effect.orDie) }
      }),
    )
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
    .handle(
      "session.import",
      Effect.fn(function* (ctx) {
        const info = ctx.payload.info
        // Transcript rows are v2 projections; turning them back into v1 messages and parts is not implemented, so a
        // transcript with messages is refused instead of imported as an empty session.
        if (ctx.payload.messages.length > 0)
          return yield* new InvalidRequestError({
            message: "Importing transcript messages is not supported by this server",
          })
        if (info.parentID && !(yield* exists(info.parentID)))
          return yield* new SessionNotFoundError({
            sessionID: info.parentID,
            message: `Session not found: ${info.parentID}`,
          })
        if (yield* exists(info.id))
          return yield* new ConflictError({ message: "Session ID already exists", resource: info.id })
        const directory = ctx.payload.location?.directory ?? info.location.directory
        const created = yield* inInstance(directory, () =>
          Session.createNext({ id: info.id, title: info.title, parentID: info.parentID, directory }),
        )
        return { data: yield* publicSession(created) }
      }),
    )
    .handle(
      "session.export",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        // Redaction is not available for v1 transcripts, so a sanitized export is refused rather than silently unredacted.
        if (ctx.query.sanitize)
          return HttpServerResponse.jsonUnsafe(
            { _tag: "InvalidRequestError", message: "sanitize is not supported by this server" },
            { status: 400 },
          )
        const rows = yield* inInstance(session.directory, () => Session.messages({ sessionID: session.id }))
        return {
          data: {
            info: yield* publicSession(session),
            messages: rows.flatMap((row) => Option.toArray(projectRow(row))),
          },
        }
      }),
    )
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
    .handle(
      "session.move",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const directory = ctx.payload.directory
        if (!(yield* Effect.promise(() => Filesystem.isDir(directory))))
          return yield* new InvalidRequestError({ message: `Not a directory: ${directory}` })
        // A running loop owns the session's directory, so a move waits for idle. The v1 loop has no boundary to defer
        // it to, and the declared errors have no busy case, so a busy session is refused as an invalid request.
        const busy = yield* inInstance(session.directory, () => SessionStatus.get(session.id).type !== "idle")
        if (busy) return yield* new InvalidRequestError({ message: "Session is busy; move it when it is idle" })
        const projectID = (yield* Effect.promise(() => ProjectDomain.fromDirectory(directory))).project.id
        yield* inInstance(session.directory, () => Session.move({ sessionID: session.id, directory, projectID }))
        SessionLog.append({
          sessionID: session.id,
          type: "session.moved",
          data: { sessionID: session.id, location: { directory }, projectID },
        })
      }),
    )
    .handle(
      "session.prompt",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const messageID = ctx.payload.id ?? Identifier.ascending("message")
        const selection = selections.get(ctx.params.sessionID) ?? {}
        const text = ctx.payload.text
        const files = yield* attachments(ctx.payload.files)
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
    .handle(
      "session.command",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const name = ctx.payload.name
        const command = yield* inInstance(session.directory, () => Command.get(name))
        if (!command) return yield* new CommandNotFoundError({ command: name, message: `Command not found: ${name}` })
        const selection = selections.get(session.id) ?? {}
        return yield* attachments(ctx.payload.files).pipe(
          Effect.flatMap((files) =>
            attempt(session.directory, () =>
              SessionPrompt.command({
                sessionID: session.id,
                command: name,
                arguments: ctx.payload.text ?? "",
                agent: selection.agent,
                model: selection.model && `${selection.model.providerID}/${selection.model.modelID}`,
                parts: files.map((file) => ({
                  type: "file" as const,
                  mime: file.mime,
                  url: `data:${file.mime};base64,${file.data}`,
                  filename: file.name,
                })),
              }),
            ).pipe(
              Effect.mapError((cause) => new CommandExecutionError({ command: name, message: failure(cause) })),
              Effect.map(() => undefined),
            ),
          ),
          // Bad attachments are a client error; the command endpoint declares no invalid-request error.
          Effect.catchTag("InvalidRequestError", (error) => Effect.succeed(badRequest(error))),
        )
      }),
    )
    .handle(
      "session.skill",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const skill = yield* inInstance(session.directory, () => Skill.get(ctx.payload.id))
        if (!skill)
          return yield* new SkillNotFoundError({ skill: ctx.payload.id, message: `Skill not found: ${ctx.payload.id}` })
        yield* inInstance(session.directory, () => SkillContext.load(skill.name))
        // The v1 skill tool's load output, minus the sampled file list and kill-chain links.
        const text = [
          `<skill_content name="${skill.name}" verified="${skill.verified ?? "unverified"}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${pathToFileURL(path.dirname(skill.location)).href}`,
          "</skill_content>",
        ].join("\n")
        yield* admit({
          sessionID: session.id,
          directory: session.directory,
          messageID: Identifier.ascending("message"),
          parts: [{ type: "text", text, synthetic: true }],
        })
        if (ctx.payload.resume !== false) yield* resume(session.directory, session.id)
      }),
    )
    .handle(
      "session.synthetic",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const messageID = ctx.payload.id ?? Identifier.ascending("message")
        const message = yield* admit({
          sessionID: session.id,
          directory: session.directory,
          messageID,
          parts: [{ type: "text", text: ctx.payload.text, synthetic: true, metadata: ctx.payload.metadata }],
        })
        if (!message) return yield* new ConflictError({ message: "Message ID already exists", resource: messageID })
        if (ctx.payload.resume !== false) yield* resume(session.directory, session.id)
        return {
          data: yield* Schema.decodeUnknownEffect(SessionInbox.Synthetic)(
            compact({
              id: messageID,
              sessionID: session.id,
              type: "synthetic",
              delivery: ctx.payload.delivery ?? "queue",
              payload: compact({ text: ctx.payload.text, metadata: ctx.payload.metadata }),
              time: { created: message.info.time.created },
            }),
          ).pipe(Effect.orDie),
        }
      }),
    )
    .handle(
      "session.shell",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const selection = selections.get(session.id) ?? {}
        const agent = selection.agent ?? (yield* inInstance(session.directory, () => Agent.defaultAgent()))
        return yield* attempt(session.directory, () =>
          SessionPrompt.shell({ sessionID: session.id, agent, model: selection.model, command: ctx.payload.command }),
        ).pipe(
          Effect.map(() => undefined),
          // The declared errors have no busy case for shell, so a busy session answers 409 directly.
          Effect.catch((cause: unknown) =>
            cause instanceof Session.BusyError
              ? Effect.succeed(
                  HttpServerResponse.jsonUnsafe(
                    { _tag: "SessionBusyError", sessionID: session.id, message: cause.message },
                    { status: 409 },
                  ),
                )
              : Effect.die(cause),
          ),
        )
      }),
    )
    .handle(
      "session.compact",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const selection = selections.get(session.id) ?? {}
        const entry = yield* inInstance(session.directory, async () => {
          await SessionRevert.cleanup(session)
          const messages = await Session.messages({ sessionID: session.id })
          const lastUser = messages.flatMap((row) => (row.info.role === "user" ? [row.info] : [])).at(-1)
          const agent = selection.agent ?? (lastUser?.agent || (await Agent.defaultAgent()))
          const model = selection.model ?? (await SessionPrompt.lastModel(session.id))
          await SessionCompaction.create({ sessionID: session.id, agent, model, auto: false })
          return (await Session.messages({ sessionID: session.id })).at(-1)
        })
        if (!entry) return yield* Effect.die(new Error("compaction was not recorded"))
        yield* resume(session.directory, session.id)
        return {
          data: yield* Schema.decodeUnknownEffect(SessionInbox.Compaction)({
            id: entry.info.id,
            sessionID: session.id,
            type: "compaction",
            delivery: ctx.payload.delivery ?? "queue",
            payload: {},
            time: { created: entry.info.time.created },
          }).pipe(Effect.orDie),
        }
      }),
    )
    .handle(
      "session.wait",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        yield* inInstance(session.directory, async () => {
          while (SessionStatus.get(session.id).type !== "idle") await Bun.sleep(100)
        })
      }),
    )
    .handle(
      "session.revert.stage",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const messageID = ctx.payload.messageID
        // v1 reverts always restore the file changes; a message-only boundary has no v1 equivalent.
        if (ctx.payload.files === false)
          return badRequest(
            new InvalidRequestError({ message: "Staging a revert without file changes is not supported" }),
          )
        const rows = yield* inInstance(session.directory, () => Session.messages({ sessionID: session.id }))
        if (!rows.some((row) => row.info.id === messageID))
          return yield* new MessageNotFoundError({
            sessionID: session.id,
            messageID,
            message: `Message not found: ${messageID}`,
          })
        const reverted = yield* attempt(session.directory, () =>
          SessionRevert.revert({ sessionID: session.id, messageID }),
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof Session.BusyError
              ? new SessionBusyError({ sessionID: session.id, message: cause.message })
              : new UnknownError({ message: failure(cause) }),
          ),
        )
        if (!reverted.revert) return yield* Effect.die(new Error("revert was not staged"))
        return {
          data: yield* Schema.decodeUnknownEffect(Revert)(
            compact({
              messageID: reverted.revert.messageID,
              partID: reverted.revert.partID,
              snapshot: reverted.revert.snapshot,
            }),
          ).pipe(Effect.orDie),
        }
      }),
    )
    .handle(
      "session.revert.clear",
      Effect.fn(function* (ctx) {
        yield* getSession(ctx.params.sessionID)
      }),
    )
    .handle(
      "session.revert.commit",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        yield* attempt(session.directory, async () => {
          SessionPrompt.assertNotBusy(session.id)
          await SessionRevert.cleanup(session)
        }).pipe(Effect.catch(busy(session.id)))
      }),
    )
    .handle(
      "session.context",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const rows = yield* inInstance(session.directory, () => MessageV2.filterCompacted(MessageV2.stream(session.id)))
        return { data: rows.flatMap((row) => Option.toArray(projectRow(row))) }
      }),
    )
    .handle(
      "session.diff",
      Effect.fn(function* (ctx) {
        yield* getSession(ctx.params.sessionID)
        return { data: [] }
      }),
    )
    .handle(
      "session.inbox.list",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const rows = yield* inInstance(session.directory, () => Inbox.list(session.id))
        return { data: yield* Schema.decodeUnknownEffect(Schema.Array(SessionInbox.Info))(rows).pipe(Effect.orDie) }
      }),
    )
    .handle(
      "session.inbox.cancel",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        // An item that was already answered is a no-op, as the endpoint declares.
        yield* inInstance(session.directory, () =>
          Inbox.cancel({ sessionID: session.id, messageID: ctx.params.inboxID }),
        )
      }),
    )
    .handle(
      "session.inbox.update",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const delivery = ctx.payload.delivery
        const changed = yield* inInstance(session.directory, async () => {
          const updated = await Inbox.update({ sessionID: session.id, messageID: ctx.params.inboxID, delivery })
          // Steering an idle session starts its loop, which answers the pending input.
          if (updated && delivery === "steer" && SessionStatus.get(session.id).type === "idle")
            SessionPrompt.loop({ sessionID: session.id }).catch((cause: unknown) =>
              log.error("loop failed", { sessionID: session.id, cause }),
            )
          return updated
        })
        if (!changed)
          return yield* new ConflictError({ message: "Inbox item is not pending", resource: ctx.params.inboxID })
      }),
    )
    .handle(
      "session.instructions.entry.list",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const rows = SessionInstructions.list(session.id)
        return { data: yield* Schema.decodeUnknownEffect(Schema.Array(InstructionEntry.Info))(rows).pipe(Effect.orDie) }
      }),
    )
    .handle(
      "session.instructions.entry.put",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const actualBytes = encoder.encode(JSON.stringify(ctx.payload.value)).byteLength
        if (actualBytes > InstructionEntry.MaxValueBytes)
          return yield* new InstructionEntry.ValueTooLargeError({
            actualBytes,
            maxBytes: InstructionEntry.MaxValueBytes,
            message: `Instruction value is ${actualBytes} bytes; the limit is ${InstructionEntry.MaxValueBytes}`,
          })
        SessionInstructions.put({ sessionID: session.id, key: ctx.params.key, value: ctx.payload.value })
      }),
    )
    .handle(
      "session.instructions.entry.remove",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        SessionInstructions.remove({ sessionID: session.id, key: ctx.params.key })
      }),
    )
    .handle(
      "session.generate",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const text = yield* attempt(session.directory, async () => {
          const rows = await MessageV2.filterCompacted(MessageV2.stream(session.id))
          const user = rows.flatMap((row) => (row.info.role === "user" ? [row.info] : [])).at(-1)
          if (!user) throw new Error("Session has no user message to generate from")
          const agent = (await Agent.get(user.agent)) ?? (await Agent.get(await Agent.defaultAgent()))
          if (!agent) throw new Error(`Agent not found: ${user.agent}`)
          const picked = user.model ?? (await SessionPrompt.lastModel(session.id))
          const model = await Provider.getModel(picked.providerID, picked.modelID)
          const stream = await LLM.stream({
            agent,
            user,
            system: [],
            tools: {},
            model,
            abort: new AbortController().signal,
            sessionID: session.id,
            retries: 2,
            messages: [
              ...MessageV2.toModelMessages(rows, model),
              { role: "user" as const, content: ctx.payload.prompt },
            ],
          })
          return stream.text
        }).pipe(Effect.mapError((cause) => new ServiceUnavailableError({ message: failure(cause), service: "llm" })))
        return { data: { text } }
      }),
    )
    .handle(
      "session.log",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const follow = ctx.query.follow === true
        const stream = Stream.callback<Uint8Array>((queue) =>
          Effect.gen(function* () {
            let cursor = Number(ctx.query.after ?? 0)
            // Sends every event after the cursor, then moves the cursor to the last one sent.
            const pump = () => {
              for (const event of SessionLog.read({ sessionID: session.id, after: cursor })) {
                cursor = event.durable.seq
                Queue.offerUnsafe(queue, sse(event))
              }
            }
            pump()
            // The marker tells the reader that it holds every event up to seq. It is omitted while nothing is held.
            const synced = { type: "log.synced", aggregateID: session.id, ...(cursor > 0 ? { seq: cursor } : {}) }
            Queue.offerUnsafe(queue, sse(synced))
            if (!follow) return Queue.endUnsafe(queue)
            const timer = setInterval(pump, 250)
            yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(timer)))
            return yield* Effect.never
          }),
        )
        return HttpServerResponse.stream(stream, { contentType: "text/event-stream" })
      }),
    )
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
    .handle(
      "session.background",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const run = Foreground.get(session.id)
        // Idle sessions have no foreground command to move, so the request is a no-op.
        if (!run) return HttpServerResponse.empty({ status: 204 })
        const entry = yield* inInstance(session.directory, () =>
          Registry.adopt({ child: run.proc, command: run.command, cwd: run.cwd, shell: run.shell }),
        )
        // The command may have exited while the registry took it over. Its exit was missed, so drop the entry.
        if (run.proc.exitCode !== null || run.proc.signalCode !== null) {
          yield* inInstance(session.directory, () => Registry.remove(entry.id))
          return HttpServerResponse.empty({ status: 204 })
        }
        run.detach(entry)
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "session.message",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const rows = yield* inInstance(session.directory, () => Session.messages({ sessionID: session.id }))
        const row = rows.find((item) => item.info.id === ctx.params.messageID)
        const data = row === undefined ? undefined : Option.getOrUndefined(projectRow(row))
        if (!data)
          return yield* new MessageNotFoundError({
            sessionID: session.id,
            messageID: ctx.params.messageID,
            message: `Message not found: ${ctx.params.messageID}`,
          })
        return { data }
      }),
    )
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
    .handle(
      "session.form.create",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const questions = yield* Effect.forEach(ctx.payload.fields, toQuestion)
        // Question.ask resolves only when the form is answered, so the request is taken from the bus instead.
        const request = yield* inInstance(
          session.directory,
          () =>
            new Promise<Question.Request>((resolve, reject) => {
              const unsubscribe = Bus.subscribe(Question.Event.Asked, (event) => {
                if (event.properties.sessionID !== session.id) return
                if (JSON.stringify(event.properties.questions) !== JSON.stringify(questions)) return
                unsubscribe()
                resolve(event.properties)
              })
              Question.ask({ sessionID: session.id, questions }).then(() => undefined, reject)
            }),
        )
        return {
          data: yield* Schema.decodeUnknownEffect(Form.Info)(
            compact({ ...projectForm(request), metadata: ctx.payload.metadata }),
          ).pipe(Effect.orDie),
        }
      }),
    )
    .handle(
      "session.form.get",
      Effect.fn(function* (ctx) {
        const formID = ctx.params.formID.replace(/^frm_/, "que_")
        const session = yield* getSession(ctx.params.sessionID)
        const rows = yield* inInstance(session.directory, () => Question.list())
        const row = rows.find((item) => item.id === formID && item.sessionID === ctx.params.sessionID)
        if (!row)
          return yield* new FormNotFoundError({
            id: ctx.params.formID,
            message: `Form not found: ${ctx.params.formID}`,
          })
        // Only pending forms exist in v1; answered and cancelled forms are not retained.
        return {
          data: yield* Schema.decodeUnknownEffect(Form.Detail)({
            ...projectForm(row),
            state: { status: "pending" },
          }).pipe(Effect.orDie),
        }
      }),
    )
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
    .handle(
      "session.environment",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        SessionEnvironment.set(session.id, ctx.payload.variables)
      }),
    )
    .handle(
      "session.view",
      Effect.fn(function* (ctx) {
        const session = yield* getSession(ctx.params.sessionID)
        const idle = DateTime.toEpochMillis(ctx.payload.idle)
        // The viewed watermark only moves forward, so a stale report never un-views a newer idle transition.
        const viewed = SessionLog.viewed(session.id)
        if (viewed !== undefined && viewed >= idle) return
        SessionLog.append({ sessionID: session.id, type: "session.viewed", data: { sessionID: session.id, idle } })
      }),
    ),
)
