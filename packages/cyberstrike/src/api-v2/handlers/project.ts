import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Project } from "@opencode/schema/project"
import { ProjectNotFoundError } from "@opencode/protocol/errors"
import { HttpServerResponse } from "effect/http"
import { Project as ProjectDomain } from "../../project/project"

type Row = NonNullable<ReturnType<typeof ProjectDomain.get>>

const wire = (row: Row) =>
  compact({
    id: row.id,
    canonical: row.worktree,
    vcs: row.vcs,
    name: row.name,
    icon: row.icon && compact({ url: row.icon.url, override: row.icon.override, color: row.icon.color }),
    commands: row.commands && compact({ start: row.commands.start }),
    // Upstream also requires `active`; CyberStrike has no separate activity clock, so the last update stands in.
    time: {
      created: row.time.created,
      updated: row.time.updated,
      active: row.time.initialized ?? row.time.updated,
    },
    sandboxes: row.sandboxes,
  })

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  handlers
    .handle(
      "project.list",
      Effect.fn(function* () {
        const data = ProjectDomain.list().map(wire)
        return yield* Schema.decodeUnknownEffect(Schema.Array(Project.Info))(data).pipe(Effect.orDie)
      }),
    )
    .handle(
      "project.update",
      Effect.fn(function* (ctx) {
        const projectID = ctx.params.projectID
        const current = ProjectDomain.get(projectID)
        if (!current) return yield* new ProjectNotFoundError({ projectID, message: `Project not found: ${projectID}` })
        // The v1 update cannot move a project's canonical directory, so a different one is refused, not dropped.
        if (ctx.payload.canonical !== undefined && ctx.payload.canonical !== current.worktree)
          return HttpServerResponse.jsonUnsafe(
            {
              _tag: "InvalidRequestError",
              message: "Changing the canonical directory is not supported",
              field: "canonical",
            },
            { status: 400 },
          )
        const updated = yield* Effect.promise(() =>
          ProjectDomain.update({
            projectID,
            name: ctx.payload.name,
            icon: ctx.payload.icon,
            commands: ctx.payload.commands,
          }),
        )
        return yield* Schema.decodeUnknownEffect(Project.Info)(wire(updated)).pipe(Effect.orDie)
      }),
    ),
)
