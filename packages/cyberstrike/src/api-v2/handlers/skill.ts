import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { compact } from "@cyberstrike-io/api-v2/projection/compact"
import { Skill as WireSkill } from "@opencode/schema/skill"
import { Location } from "@opencode/schema/location"
import { Skill } from "../../skill/skill"
import { inInstance } from "../instance"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle(
    "skill.list",
    Effect.fn(function* () {
      const directory = yield* Directory
      const skills = yield* inInstance(directory, () => Skill.all())
      // The v1 skill name is its identity, and its location is the SKILL.md file the content was read from.
      const data = skills.map((skill) =>
        compact({
          id: skill.name,
          name: skill.name,
          description: skill.description,
          path: skill.location,
          content: skill.content,
        }),
      )
      return yield* Schema.decodeUnknownEffect(Location.response(Schema.Array(WireSkill.Info)))({
        location: { directory },
        data,
      }).pipe(Effect.orDie)
    }),
  ),
)
