import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Skill } from "../../skill/skill"
import { SkillIndex } from "../../skill/index-engine"
import { SkillContext } from "../../skill/context"
import { KillChain } from "../../skill/killchain"
import { SkillSigning } from "../../skill/signing"
import { Discovery } from "../../skill/discovery"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { modify, applyEdits } from "jsonc-parser"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const SkillSummary = z.object({
  name: z.string(),
  description: z.string(),
  verified: z.string().optional(),
  category: z.string().optional(),
  owasp_id: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tech_stack: z.array(z.string()).optional(),
  cwe_ids: z.array(z.string()).optional(),
  chains_with: z.array(z.string()).optional(),
})

export const SkillRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List skills",
        description: "Get all available skills with verification status.",
        operationId: "skill.list",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(z.array(SkillSummary)),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json(skills)
      },
    )
    .get(
      "/search",
      describeRoute({
        summary: "Search skills",
        description: "Search skills by keyword, tech stack, CWE, or category.",
        operationId: "skill.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(z.array(SkillSummary)),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          q: z.string().optional(),
          tech: z.string().optional(),
          cwe: z.string().optional(),
          category: z.string().optional(),
          tag: z.string().optional(),
        }),
      ),
      async (c) => {
        await SkillIndex.rebuild()
        const { q, tech, cwe, category, tag } = c.req.valid("query")

        let results: SkillIndex.Entry[]
        if (cwe) results = SkillIndex.byCWE(cwe)
        else if (tech) results = SkillIndex.byTechStack(tech.split(","))
        else if (category) results = SkillIndex.byCategory(category)
        else if (tag) results = SkillIndex.byTag(tag)
        else if (q) results = SkillIndex.search(q)
        else results = SkillIndex.all()

        return c.json(results)
      },
    )
    .get(
      "/context",
      describeRoute({
        summary: "Get loaded skills",
        description: "Get skills currently loaded in agent context.",
        operationId: "skill.context",
        responses: {
          200: {
            description: "Context state",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    active: z.array(z.string()),
                    tokens: z.number(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          active: SkillContext.active(),
          tokens: SkillContext.tokenCount(),
        })
      },
    )
    .post(
      "/chain",
      describeRoute({
        summary: "Kill chain analysis",
        description: "Analyze findings for kill chain opportunities.",
        operationId: "skill.chain",
        responses: {
          200: {
            description: "Kill chain analysis results",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    chains: z.array(
                      z.object({
                        skills: z.array(z.string()),
                        combined_severity: z.string(),
                        description: z.string(),
                        next_steps: z.array(z.string()),
                      }),
                    ),
                    summary: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          findings: z.array(
            z.object({
              skill_id: z.string(),
              severity: z.enum(["info", "low", "medium", "high", "critical"]),
              cwe_id: z.string().optional(),
              tech_stack: z.array(z.string()).optional(),
            }),
          ),
        }),
      ),
      async (c) => {
        await SkillIndex.rebuild()
        const { findings } = c.req.valid("json")
        const chains = KillChain.analyze(findings)
        const summary = KillChain.summary(findings)
        return c.json({ chains, summary })
      },
    )
    .get(
      "/:name",
      describeRoute({
        summary: "Get skill detail",
        description: "Get a single skill with full content.",
        operationId: "skill.get",
        responses: {
          200: {
            description: "Skill detail",
            content: {
              "application/json": {
                schema: resolver(Skill.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const skill = await Skill.get(name)
        if (!skill) return c.json({ error: `Skill "${name}" not found` }, 404)
        return c.json(skill)
      },
    )
    .post(
      "/:name/verify",
      describeRoute({
        summary: "Verify skill integrity",
        description: "Re-verify a skill's SHA-256 hash and signature.",
        operationId: "skill.verify",
        responses: {
          200: {
            description: "Verification result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    name: z.string(),
                    verified: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const skill = await Skill.get(name)
        if (!skill) return c.json({ error: `Skill "${name}" not found` }, 404)

        const verified = await SkillSigning.verify({
          content: skill.content,
          sha256: skill.sha256,
          signature: skill.signature,
          signed_by: skill.signed_by,
        })
        return c.json({ name, verified })
      },
    )
    .post(
      "/install",
      describeRoute({
        summary: "Install skill from URL",
        description: "Download and install a skill from a remote URL or registry.",
        operationId: "skill.install",
        responses: {
          200: {
            description: "Installed skill names",
            content: {
              "application/json": {
                schema: resolver(z.object({ installed: z.array(z.string()) })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          url: z.string().describe("URL to skill registry or individual skill"),
        }),
      ),
      async (c) => {
        const { url } = c.req.valid("json")
        const dirs = await Discovery.pull(url)
        const names = dirs.map((d) => d.split("/").pop() ?? d)
        return c.json({ installed: names })
      },
    )
    .delete(
      "/:name",
      describeRoute({
        summary: "Remove a skill",
        description: "Remove a locally cached remote skill.",
        operationId: "skill.remove",
        responses: {
          200: {
            description: "Removal result",
            content: {
              "application/json": {
                schema: resolver(z.object({ removed: z.boolean(), name: z.string() })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const skill = await Skill.get(name)
        if (!skill) return c.json({ error: `Skill "${name}" not found` }, 404)

        const cacheDir = Discovery.dir()
        const skillDir = `${cacheDir}/${name}`
        const file = Bun.file(skillDir)
        if (skill.location.startsWith(cacheDir) && (await file.exists())) {
          const { rmSync } = await import("fs")
          rmSync(skillDir, { recursive: true })
          return c.json({ removed: true, name })
        }
        return c.json({ error: "Only cached remote skills can be removed" }, 400 as never)
      },
    )
    .post(
      "/:name/enable",
      describeRoute({
        summary: "Enable a skill",
        description: "Remove a skill from the disabled list in config.",
        operationId: "skill.enable",
        responses: {
          200: {
            description: "Enable result",
            content: {
              "application/json": {
                schema: resolver(z.object({ name: z.string(), enabled: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const config = await Config.get()
        const disabled = config.skills?.disabled ?? []
        const updated = disabled.filter((n) => n !== name)

        const configPath = `${Global.Path.config}/cyberstrike.json`
        const raw = (await Bun.file(configPath).exists()) ? await Bun.file(configPath).text() : "{}"
        const edits = modify(raw, ["skills", "disabled"], updated.length > 0 ? updated : undefined, {
          formattingOptions: { tabSize: 2, insertSpaces: true },
        })
        await Bun.write(configPath, applyEdits(raw, edits))

        return c.json({ name, enabled: true })
      },
    )
    .post(
      "/:name/disable",
      describeRoute({
        summary: "Disable a skill",
        description: "Add a skill to the disabled list in config.",
        operationId: "skill.disable",
        responses: {
          200: {
            description: "Disable result",
            content: {
              "application/json": {
                schema: resolver(z.object({ name: z.string(), enabled: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const config = await Config.get()
        const disabled = config.skills?.disabled ?? []
        if (!disabled.includes(name)) disabled.push(name)

        const configPath = `${Global.Path.config}/cyberstrike.json`
        const raw = (await Bun.file(configPath).exists()) ? await Bun.file(configPath).text() : "{}"
        const edits = modify(raw, ["skills", "disabled"], disabled, {
          formattingOptions: { tabSize: 2, insertSpaces: true },
        })
        await Bun.write(configPath, applyEdits(raw, edits))

        return c.json({ name, enabled: false })
      },
    ),
)
