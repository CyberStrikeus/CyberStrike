import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@cyberstrike-io/core/effect/app-node-builder"
import { Location } from "@cyberstrike-io/core/location"
import { Project } from "@cyberstrike-io/core/project"
import { AbsolutePath } from "@cyberstrike-io/core/schema"
import { WorkspaceV2 } from "@cyberstrike-io/core/workspace"
import { testEffect } from "./lib/effect"

const workspaceID = WorkspaceV2.ID.make("wrk_test")
const ref = { directory: AbsolutePath.make("/repo/packages/app"), workspaceID }
const projectLayer = Layer.succeed(
  Project.Service,
  Project.Service.of({
    directories: () => Effect.succeed([]),
    resolve: () =>
      Effect.succeed({
        id: Project.ID.make("project"),
        directory: AbsolutePath.make("/repo"),
        vcs: { type: "git", store: AbsolutePath.make("/repo/.git") },
      }),
    commit: () => Effect.void,
  }),
)
const it = testEffect(AppNodeBuilder.build(Location.boundNode(ref), [[Project.node, projectLayer]]))

describe("Location", () => {
  it.effect("resolves the current project and vcs information", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service

      expect(location.directory).toBe(AbsolutePath.make("/repo/packages/app"))
      expect(location.workspaceID).toBe(workspaceID)
      expect(location.project.id).toBe(Project.ID.make("project"))
      expect(location.project.directory).toBe(AbsolutePath.make("/repo"))
      expect(location.vcs).toEqual({
        type: "git",
        store: AbsolutePath.make("/repo/.git"),
      })
    }),
  )
})
