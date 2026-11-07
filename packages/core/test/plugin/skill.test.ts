import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@cyberstrike-io/core/effect/app-node-builder"
import { SkillPlugin } from "@cyberstrike-io/core/plugin/skill"
import { SkillV2 } from "@cyberstrike-io/core/skill"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(SkillV2.node))

describe("SkillPlugin.Plugin", () => {
  it.effect("registers the built-in customize-cyberstrike skill", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* SkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      expect(yield* skill.list()).toContainEqual(
        expect.objectContaining({
          name: "customize-cyberstrike",
          description: expect.stringContaining("cyberstrike's own configuration"),
        }),
      )
    }),
  )
})
