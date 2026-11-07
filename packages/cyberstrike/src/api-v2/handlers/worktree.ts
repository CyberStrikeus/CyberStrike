import { $ } from "bun"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Worktree as WorktreeSchema } from "@opencode/schema/worktree"
import { ProjectNotFoundError } from "@opencode/protocol/errors"
import { WorktreeError } from "@opencode/protocol/groups/worktree"
import { Project as ProjectDomain } from "../../project/project"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"
import { Worktree } from "../../worktree"

const projectOf = (projectID: string) =>
  Effect.suspend(() => {
    const info = ProjectDomain.get(projectID)
    if (info) return Effect.succeed(info)
    return Effect.fail(new ProjectNotFoundError({ projectID, message: `Project not found: ${projectID}` }))
  })

const failed = (message: string) => new WorktreeError({ name: "WorktreeError", data: { message } })

// The v1 worktree domain reads the instance it runs in, and throws plain errors. Those become typed WorktreeError
// answers instead of defects.
const scoped = <A>(directory: string, fn: () => A | Promise<A>) =>
  Effect.tryPromise({
    try: async () => await Instance.provide({ directory, init: InstanceBootstrap, fn }),
    catch: (error) => failed(error instanceof Error ? error.message : String(error)),
  })

export const WorktreeHandler = HttpApiBuilder.group(Api, "server.worktree", (handlers) =>
  handlers
    .handle(
      "worktree.list",
      Effect.fn(function* (ctx) {
        const info = yield* projectOf(ctx.query.projectID)
        // The saved inventory only: sandboxes whose directories still exist, with no discovery or config load.
        const directories = yield* Effect.promise(() => ProjectDomain.sandboxes(info.id))
        return yield* Schema.decodeUnknownEffect(WorktreeSchema.List)(
          directories.map((directory) => ({ directory })),
        ).pipe(Effect.orDie)
      }),
    )
    .handle(
      "worktree.create",
      Effect.fn(function* (ctx) {
        const info = yield* projectOf(ctx.payload.projectID)
        // The v1 domain only takes a name; it cannot honor a source, branch, or parent directory, so those are refused.
        if (ctx.payload.from || ctx.payload.branch || ctx.payload.directory)
          return yield* failed("from, branch, and directory are not supported by this server")
        const created = yield* scoped(info.worktree, () => Worktree.create({ name: ctx.payload.name }))
        return yield* Schema.decodeUnknownEffect(WorktreeSchema.Info)({ directory: created.directory }).pipe(
          Effect.orDie,
        )
      }),
    )
    .handle(
      "worktree.remove",
      Effect.fn(function* (ctx) {
        const info = yield* projectOf(ctx.payload.projectID)
        // Only saved sandboxes of this project can be removed; the v1 domain would delete any other directory.
        const sandboxes = yield* Effect.promise(() => ProjectDomain.sandboxes(info.id))
        if (!sandboxes.includes(ctx.payload.directory)) return yield* failed("Worktree not found")
        // The v1 domain always forces removal, so without force a worktree with local changes is refused here.
        if (!ctx.payload.force) {
          const status = yield* Effect.promise(() =>
            $`git status --porcelain`.cwd(ctx.payload.directory).quiet().nothrow().text(),
          )
          if (status.trim())
            return yield* new WorktreeError({
              name: "WorktreeError",
              data: { message: "Worktree has local changes", forceRequired: true },
            })
        }
        yield* scoped(info.worktree, () => Worktree.remove({ directory: ctx.payload.directory }))
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "worktree.refresh",
      Effect.fn(function* (ctx) {
        const info = yield* projectOf(ctx.payload.projectID)
        // Saved sandboxes are reconciled against git's own worktree list; the response is a bare 204 per the contract.
        yield* scoped(info.worktree, () => Worktree.refresh())
        return HttpServerResponse.empty({ status: 204 })
      }),
    ),
)
