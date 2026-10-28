import { Effect, Option, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Integration } from "@opencode/schema/integration"
import { Location } from "@opencode/schema/location"
import {
  IntegrationAttemptNotFoundError,
  IntegrationMethodNotFoundError,
  IntegrationNotFoundError,
  InvalidRequestError,
} from "@opencode/protocol/errors"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { ModelsDev } from "../../provider/models"
import { Provider } from "../../provider/provider"
import { ProviderAuth } from "../../provider/auth"
import { Registry } from "../../shell/registry"
import { inInstance } from "../instance"
import { unavailable } from "./stub"

type Attempt = {
  integrationID: string
  method: number
  mode: "auto" | "code"
  created: number
  expires: number
  status: "pending" | "complete" | "failed"
  message?: string
}

// A command attempt runs its command as a registry entry. Its output is the credential, so it is read on settle and dropped.
type CommandAttempt = {
  integrationID: string
  shellID: string
  created: number
  expires: number
  status: "pending" | "complete" | "failed" | "expired"
  message?: string
}

// OAuth attempts belong to the instance that began them, the same scope the v1 pending-auth state uses.
const attempts = Instance.state(async () => new Map<string, Attempt>())
const commands = Instance.state(async () => new Map<string, CommandAttempt>())

// The v1 OAuth flow has no expiry of its own; an attempt left open this long reads as expired.
const ttl = 10 * 60 * 1000

// The v1 config has no command-auth field, so a provider opts in with `options.auth_command`: the argv to run.
const commandOf = (provider: Config.Provider | undefined) =>
  Schema.decodeUnknownOption(Schema.NonEmptyArray(Schema.String))(provider?.options?.auth_command).pipe(
    Option.getOrUndefined,
  )

const integration = (
  provider: Provider.Info,
  methods: ProviderAuth.Method[],
  stored: Auth.Info | undefined,
  command: readonly string[] | undefined,
) => ({
  id: provider.id,
  name: provider.name,
  methods: [
    ...methods.flatMap((method, index) =>
      method.type === "oauth" ? [{ id: String(index), type: "oauth", label: method.label }] : [],
    ),
    ...(command ? [{ id: "command", type: "command", label: "Run command", command }] : []),
    // Every v1 provider accepts a stored API key, so the key method is always offered.
    { type: "key", label: "API key" },
    ...(provider.env.length > 0 ? [{ type: "env", names: provider.env }] : []),
  ],
  connections: [
    ...(stored && stored.type !== "wellknown"
      ? [
          {
            type: "credential",
            id: `cred_${provider.id}`,
            label: provider.name,
            method: stored.type === "oauth" ? "oauth" : "key",
          },
        ]
      : []),
    ...provider.env.filter((name) => process.env[name] !== undefined).map((name) => ({ type: "env", name })),
  ],
})

// The v1 provider catalog: models.dev providers that config does not disable, plus connected providers.
const catalog = async () => {
  const config = await Config.get()
  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
  const known = await ModelsDev.get()
  const connected = await Provider.list()
  const listed = Object.fromEntries(
    Object.entries(known)
      .filter(([id]) => (enabled ? enabled.has(id) : true) && !disabled.has(id))
      .map(([id, provider]) => [id, Provider.fromModelsDevProvider(provider)]),
  )
  const methods = await ProviderAuth.methods()
  const stored = await Auth.all()
  return Object.values(Object.assign(listed, connected)).map((provider) =>
    integration(provider, methods[provider.id] ?? [], stored[provider.id], commandOf(config.provider?.[provider.id])),
  )
}

const find = (integrationID: string) =>
  catalog().then((items) => items.find((item) => item.id === integrationID))

const view = (attempt: Attempt) => ({
  status: attempt.status === "pending" && Date.now() >= attempt.expires ? "expired" : attempt.status,
  time: { created: attempt.created, expires: attempt.expires },
  message: attempt.message,
})

const attemptOf = async (integrationID: string, attemptID: string) => {
  const attempt = (await attempts()).get(attemptID)
  if (!attempt || attempt.integrationID !== integrationID) return undefined
  return attempt
}

const commandAttemptOf = async (integrationID: string, attemptID: string) => {
  const attempt = (await commands()).get(attemptID)
  if (!attempt || attempt.integrationID !== integrationID) return undefined
  return attempt
}

// Moves a command attempt out of pending once its process has ended. Stdout is the credential, the same value
// connect.key would store. The captured output is removed afterwards, whatever the outcome.
const settle = async (attempt: CommandAttempt) => {
  if (attempt.status !== "pending") return
  const entry = await Registry.get(attempt.shellID)
  if (!entry) {
    attempt.status = "failed"
    attempt.message = "Command was removed"
    return
  }
  if (entry.status === "running") {
    if (Date.now() < attempt.expires) return
    await Registry.remove(attempt.shellID)
    attempt.status = "expired"
    return
  }
  const page = await Registry.output(attempt.shellID, 0, Registry.MAX)
  await Registry.remove(attempt.shellID)
  if (entry.status === "timeout") {
    attempt.status = "expired"
    return
  }
  if (entry.status === "killed") {
    attempt.status = "failed"
    attempt.message = `Command was terminated by ${entry.signal}`
    return
  }
  if (entry.exit !== 0) {
    attempt.status = "failed"
    attempt.message = `Command exited with code ${entry.exit}`
    return
  }
  if (!page || page.cursor < page.size) {
    attempt.status = "failed"
    attempt.message = "Command output is too large to be a credential"
    return
  }
  const key = page.output.trim()
  if (!key) {
    attempt.status = "failed"
    attempt.message = "Command produced no credential"
    return
  }
  await ProviderAuth.api({ providerID: attempt.integrationID, key })
  attempt.status = "complete"
}

const commandView = (attempt: CommandAttempt) => ({
  status: attempt.status,
  time: { created: attempt.created, expires: attempt.expires },
  ...(attempt.message === undefined ? {} : { message: attempt.message }),
})

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  handlers
    .handle(
      "integration.list",
      Effect.fn(function* () {
        const directory = yield* Directory
        const data = yield* inInstance(directory, catalog)
        return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(Integration.Info)))({
          location: { directory },
          data,
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "integration.get",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const integrationID = ctx.params.integrationID
        const data = yield* inInstance(directory, () => find(integrationID))
        if (!data) return yield* new IntegrationNotFoundError({ integrationID, message: `Integration not found: ${integrationID}` })
        return yield* Schema.decodeUnknownEffect(Location.response(Integration.Info))({
          location: { directory },
          data,
        }).pipe(Effect.orDie)
      }),
    )
    .handle("integration.wellknown.add", () => unavailable)
    .handle(
      "integration.connect.key",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const integrationID = ctx.params.integrationID
        const item = yield* inInstance(directory, () => find(integrationID))
        if (!item) return yield* new IntegrationNotFoundError({ integrationID, message: `Integration not found: ${integrationID}` })
        // The v1 key route stores the key the same way. Labels and form answers have no slot in the v1 store and are not kept.
        yield* inInstance(directory, () => ProviderAuth.api({ providerID: integrationID, key: ctx.payload.key }))
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    // Left unimplemented: v1 has no external credential-source concept. Auth stores api, oauth and wellknown entries only,
    // so there is no reference type a connect.external call could store. See the report on this change.
    .handle("integration.connect.external", () => unavailable)
    .handle(
      "integration.oauth.connect",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const integrationID = ctx.params.integrationID
        const methodID = ctx.payload.methodID
        const attempt = yield* inInstance(directory, async () => {
          const item = await find(integrationID)
          // OAuth methods are the only ones with an ID, and that ID is their index in the v1 method list.
          const offered = item?.methods.some((candidate) => "id" in candidate && candidate.id === methodID)
          if (!offered) return undefined
          const method = Number(methodID)
          const authorization = await ProviderAuth.authorize({ providerID: integrationID, method })
          if (!authorization) return undefined
          const created = Date.now()
          const attemptID = Integration.AttemptID.create()
          ;(await attempts()).set(attemptID, {
            integrationID,
            method,
            mode: authorization.method,
            created,
            expires: created + ttl,
            status: "pending",
          })
          return {
            attemptID,
            url: authorization.url,
            instructions: authorization.instructions,
            mode: authorization.method,
            time: { created, expires: created + ttl },
          }
        })
        if (!attempt)
          return yield* new InvalidRequestError({
            message: `OAuth method not found for integration ${integrationID}: ${methodID}`,
            field: "methodID",
          })
        return yield* Schema.decodeUnknownEffect(Location.response(Integration.Attempt))({
          location: { directory },
          data: attempt,
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "integration.oauth.status",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const { integrationID, attemptID } = ctx.params
        const found = yield* inInstance(directory, async () => {
          if (!(await find(integrationID))) return "integration" as const
          const attempt = await attemptOf(integrationID, attemptID)
          return attempt ? view(attempt) : ("attempt" as const)
        })
        if (found === "integration") return yield* new IntegrationNotFoundError({ integrationID, message: `Integration not found: ${integrationID}` })
        if (found === "attempt")
          return yield* new IntegrationAttemptNotFoundError({ integrationID, attemptID, message: `Attempt not found: ${attemptID}` })
        return yield* Schema.decodeUnknownEffect(Location.response(Integration.AttemptStatus))({
          location: { directory },
          data: found,
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "integration.oauth.complete",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const { integrationID, attemptID } = ctx.params
        const code = ctx.payload.code
        const outcome = yield* inInstance(directory, async () => {
          if (!(await find(integrationID))) return { kind: "integration" as const }
          const attempt = await attemptOf(integrationID, attemptID)
          if (!attempt) return { kind: "attempt" as const }
          const current = view(attempt)
          if (current.status !== "pending") return { kind: "settled" as const, status: current.status }
          if (attempt.mode === "code" && !code) return { kind: "code" as const }
          const failure = await ProviderAuth.callback({
            providerID: integrationID,
            method: attempt.method,
            code,
          }).then(
            () => undefined,
            () => "OAuth connection failed",
          )
          attempt.status = failure ? "failed" : "complete"
          attempt.message = failure
          return { kind: "done" as const, failure }
        })
        if (outcome.kind === "integration") return yield* new IntegrationNotFoundError({ integrationID, message: `Integration not found: ${integrationID}` })
        if (outcome.kind === "attempt")
          return yield* new IntegrationAttemptNotFoundError({ integrationID, attemptID, message: `Attempt not found: ${attemptID}` })
        if (outcome.kind === "settled")
          return yield* new InvalidRequestError({ message: `OAuth attempt is ${outcome.status}`, field: "attemptID" })
        if (outcome.kind === "code") return yield* new InvalidRequestError({ message: "Authorization code required", field: "code" })
        if (outcome.failure) return yield* new InvalidRequestError({ message: outcome.failure })
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "integration.oauth.cancel",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const { integrationID, attemptID } = ctx.params
        yield* inInstance(directory, async () => {
          const store = await attempts()
          if (await attemptOf(integrationID, attemptID)) store.delete(attemptID)
        })
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "integration.command.connect",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const integrationID = ctx.params.integrationID
        const methodID = ctx.payload.methodID
        const started = yield* inInstance(directory, async () => {
          const item = await find(integrationID)
          if (!item) return { kind: "integration" as const }
          // Only the command method carries an argv, so flatMap yields the argv of the matching method, or nothing.
          const argv = item.methods.flatMap((candidate) =>
            "command" in candidate && candidate.id === methodID ? candidate.command : [],
          )
          if (argv.length === 0) return { kind: "method" as const }
          const created = Date.now()
          const attemptID = Integration.AttemptID.create()
          const shellID = await Registry.start({
            argv,
            timeout: ttl,
            metadata: { integrationID, attemptID },
            stderr: false,
          }).then(
            (entry) => entry.id,
            () => undefined,
          )
          if (!shellID) return { kind: "start" as const }
          ;(await commands()).set(attemptID, {
            integrationID,
            shellID,
            created,
            expires: created + ttl,
            status: "pending",
          })
          return { kind: "started" as const, attemptID, created }
        })
        if (started.kind === "integration")
          return yield* new IntegrationNotFoundError({ integrationID, message: `Integration not found: ${integrationID}` })
        if (started.kind === "method")
          return yield* new IntegrationMethodNotFoundError({
            integrationID,
            methodID,
            message: `Method not found for integration ${integrationID}: ${methodID}`,
          })
        if (started.kind === "start")
          return yield* new InvalidRequestError({
            message: `Command could not start for integration ${integrationID}`,
            field: "methodID",
          })
        return yield* Schema.decodeUnknownEffect(Location.response(Integration.CommandAttempt))({
          location: { directory },
          data: {
            attemptID: started.attemptID,
            time: { created: started.created, expires: started.created + ttl },
          },
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "integration.command.status",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const { integrationID, attemptID } = ctx.params
        const found = yield* inInstance(directory, async () => {
          if (!(await find(integrationID))) return { kind: "integration" as const }
          const attempt = await commandAttemptOf(integrationID, attemptID)
          if (!attempt) return { kind: "attempt" as const }
          await settle(attempt)
          return { kind: "view" as const, view: commandView(attempt) }
        })
        if (found.kind === "integration")
          return yield* new IntegrationNotFoundError({ integrationID, message: `Integration not found: ${integrationID}` })
        if (found.kind === "attempt")
          return yield* new IntegrationAttemptNotFoundError({ integrationID, attemptID, message: `Attempt not found: ${attemptID}` })
        return yield* Schema.decodeUnknownEffect(Location.response(Integration.CommandAttemptStatus))({
          location: { directory },
          data: found.view,
        }).pipe(Effect.orDie)
      }),
    )
    .handle(
      "integration.command.cancel",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const { integrationID, attemptID } = ctx.params
        yield* inInstance(directory, async () => {
          const attempt = await commandAttemptOf(integrationID, attemptID)
          if (!attempt) return
          ;(await commands()).delete(attemptID)
          await Registry.remove(attempt.shellID)
        })
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
