import z from "zod"
import path from "path"
import os from "os"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@cyberstrike-io/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Discovery } from "./discovery"
import { SkillSigning } from "./signing"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
    // Signing & verification
    version: z.string().optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sha256: z.string().optional(),
    signature: z.string().optional(),
    signed_by: z.string().optional(),
    verified: z.enum(["official", "community", "unverified", "tampered"]).optional(),
    // Categorization
    category: z.string().optional(),
    owasp_id: z.string().optional(),
    // Kill chain & tech stack
    tech_stack: z.array(z.string()).optional(),
    cwe_ids: z.array(z.string()).optional(),
    chains_with: z.array(z.string()).optional(),
    prerequisites: z.array(z.string()).optional(),
    severity_boost: z.record(z.string(), z.string()).optional(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  // External skill directories to search for (project-level and global)
  // These follow the directory layout used by Claude Code and other agents.
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  const CYBERSTRIKE_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const SKILL_GLOB = new Bun.Glob("**/SKILL.md")

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const dirs = new Set<string>()

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return

      // Warn on duplicate skill names
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      dirs.add(path.dirname(match))

      const raw = md.data as Record<string, unknown>
      const verified = await SkillSigning.verify({
        content: md.content,
        sha256: typeof raw.sha256 === "string" ? raw.sha256 : undefined,
        signature: typeof raw.signature === "string" ? raw.signature : undefined,
        signed_by: typeof raw.signed_by === "string" ? raw.signed_by : undefined,
      })

      if (verified === "tampered") {
        log.warn("skill integrity check failed, skipping", { name: parsed.data.name, path: match })
        Bus.publish(Session.Event.Error, {
          error: new NamedError.Unknown({
            message: `Skill "${parsed.data.name}" failed integrity check and was not loaded`,
          }).toObject(),
        })
        return
      }

      const toStringArray = (v: unknown): string[] | undefined =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        content: md.content,
        verified,
        version: typeof raw.version === "string" ? raw.version : undefined,
        author: typeof raw.author === "string" ? raw.author : undefined,
        tags: toStringArray(raw.tags),
        sha256: typeof raw.sha256 === "string" ? raw.sha256 : undefined,
        signature: typeof raw.signature === "string" ? raw.signature : undefined,
        signed_by: typeof raw.signed_by === "string" ? raw.signed_by : undefined,
        category: typeof raw.category === "string" ? raw.category : undefined,
        owasp_id: typeof raw.owasp_id === "string" ? raw.owasp_id : undefined,
        tech_stack: toStringArray(raw.tech_stack),
        cwe_ids: toStringArray(raw.cwe_ids),
        chains_with: toStringArray(raw.chains_with),
        prerequisites: toStringArray(raw.prerequisites),
        severity_boost: typeof raw.severity_boost === "object" && raw.severity_boost !== null && !Array.isArray(raw.severity_boost)
          ? raw.severity_boost as Record<string, string>
          : undefined,
      }
    }

    const scanExternal = async (root: string, scope: "global" | "project") => {
      return Array.fromAsync(
        EXTERNAL_SKILL_GLOB.scan({
          cwd: root,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        }),
      )
        .then((matches) => Promise.all(matches.map(addSkill)))
        .catch((error) => {
          log.error(`failed to scan ${scope} skills`, { dir: root, error })
        })
    }

    // Scan external skill directories (.claude/skills/, .agents/skills/, etc.)
    // Load global (home) first, then project-level (so project-level overwrites)
    if (!Flag.CYBERSTRIKE_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        await scanExternal(root, "global")
      }

      for await (const root of Filesystem.up({
        targets: EXTERNAL_DIRS,
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanExternal(root, "project")
      }
    }

    // Scan .cyberstrike/skill/ directories
    for (const dir of await Config.directories()) {
      for await (const match of CYBERSTRIKE_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      if (!(await Filesystem.isDir(resolved))) {
        log.warn("skill path not found", { path: resolved })
        continue
      }
      for await (const match of SKILL_GLOB.scan({
        cwd: resolved,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    // Download and load skills from URLs
    for (const url of config.skills?.urls ?? []) {
      const list = await Discovery.pull(url)
      for (const dir of list) {
        dirs.add(dir)
        for await (const match of SKILL_GLOB.scan({
          cwd: dir,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
        })) {
          await addSkill(match)
        }
      }
    }

    return {
      skills,
      dirs: Array.from(dirs),
    }
  })

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x.skills))
  }

  export async function dirs() {
    return state().then((x) => x.dirs)
  }
}
