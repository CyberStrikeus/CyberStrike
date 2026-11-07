/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-cyberstrike.md" with { type: "text" }

export const CustomizeOpencodeContent = customizeOpencodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-cyberstrike",
            description:
              "Use ONLY when the user is editing or creating cyberstrike's own configuration: cyberstrike.json, cyberstrike.jsonc, files under .cyberstrike/, or files under ~/.config/cyberstrike/. Also use when creating or fixing cyberstrike agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring cyberstrike itself.",
            location: AbsolutePath.make("/builtin/customize-cyberstrike.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
    })
  }),
})
