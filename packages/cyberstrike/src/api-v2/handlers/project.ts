import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Project } from "@opencode/schema/project"
import { Project as ProjectDomain } from "../../project/project"
import { unavailable } from "./stub"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  handlers
    .handle(
      "project.list",
      Effect.fn(function* () {
        const data = ProjectDomain.list().map((row) =>
          compact({
            id: row.id,
            canonical: row.worktree,
            vcs: row.vcs,
            name: row.name,
            // Upstream also requires `active`; CyberStrike has no separate activity clock, so the last update stands in.
            time: {
              created: row.time.created,
              updated: row.time.updated,
              active: row.time.initialized ?? row.time.updated,
            },
            sandboxes: row.sandboxes,
          }),
        )
        return yield* Schema.decodeUnknownEffect(Schema.Array(Project.Info))(data).pipe(Effect.orDie)
      }),
    )
    .handle("project.update", () => unavailable),
)
