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
import { Installation } from "@/installation"
import fs from "fs/promises"

export namespace Skill {
  const log = Log.create({ service: "skill" })

  // Ensure the built-in skill corpus is present for compiled binaries. It is NOT bundled in the
  // npm tarball (the offensive skill content trips npm's publish-time automated review — #114),
  // and the AWS Marketplace AMI strips it to pass the image scan; both fetch `skills.tar.gz` on
  // first run into the XDG data dir. The corpus changes far less often than the app version, so it
  // lives at ONE stable release URL (the `skills` tag), not a per-version asset; override with
  // CYBERSTRIKE_SKILLS_URL (e.g. to a CDN). Degrades gracefully if the download fails; dev/source
  // builds use the in-repo .cyberstrike/skill tree (VERSION "local") and skip this entirely.
  async function ensureInstalledSkills(installedDir: string) {
    if (Installation.VERSION === "local") return
    if (await Filesystem.isDir(installedDir)) {
      const entries = await fs.readdir(installedDir).catch(() => [] as string[])
      if (entries.length > 0) return
    }
    const url =
      process.env.CYBERSTRIKE_SKILLS_URL ||
      "https://github.com/CyberStrikeus/CyberStrike/releases/download/skills/skills.tar.gz"
    const tmp = path.join(Global.Path.cache, "skills.tar.gz")
    try {
      process.stderr.write("\n  \x1b[36m◆ CyberStrike\x1b[0m — first run: downloading the skill corpus…\n")
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await Bun.write(tmp, res)
      await Bun.$`tar -xzf ${tmp} -C ${Global.Path.data}`.quiet()
      await fs.rm(tmp, { force: true })
      process.stderr.write("  \x1b[32m✓\x1b[0m skill corpus ready\n\n")
      log.info("installed skill corpus from release", { version: Installation.VERSION })
    } catch (error) {
      process.stderr.write("  \x1b[33m⚠\x1b[0m couldn't download skills (offline?) — skill search will be limited\n\n")
      log.warn("could not fetch skill corpus; built-in skills unavailable", {
        url,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
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
    slash: z.boolean().optional(),
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


  // Run `fn` over `items` at most `limit` at a time. Skill loading opens each file (parse + read),
  // so loading thousands of external skills with an unbounded Promise.all can exhaust file
  // descriptors (EMFILE/ENFILE). A bounded pool keeps concurrent opens capped regardless of count.
  async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
    let i = 0
    const worker = async () => {
      while (i < items.length) await fn(items[i++]!)
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  }
  const SKILL_LOAD_CONCURRENCY = 48

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
        log.debug("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      dirs.add(path.dirname(match))

      const raw = md.data as Record<string, unknown>
      let fileContent: string
      try {
        fileContent = await Bun.file(match).text()
      } catch (err) {
        // A per-file I/O failure — most importantly EMFILE/ENFILE when the machine is out of file
        // descriptors — must NOT crash the whole skill load and abort startup. Skip this one skill
        // and keep going; a crowded machine then loses a few skills instead of failing to boot.
        log.warn("skill load skipped (io error)", { skill: match, err: String(err) })
        return
      }
      const verified = await SkillSigning.verify({
        content: fileContent,
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
        severity_boost:
          typeof raw.severity_boost === "object" && raw.severity_boost !== null && !Array.isArray(raw.severity_boost)
            ? (raw.severity_boost as Record<string, string>)
            : undefined,
        slash: raw.slash === true ? true : undefined,
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
        .then((matches) => mapLimit(matches, SKILL_LOAD_CONCURRENCY, addSkill))
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

    // Scan .cyberstrike/skill/ and .cyberstrike/skills/ directories
    for (const dir of await Config.directories()) {
      for (const sub of ["skill", "skills"]) {
        const root = path.join(dir, sub)
        if (!(await Filesystem.isDir(root))) continue
        await mapLimit(await Filesystem.findByName(root, "SKILL.md"), SKILL_LOAD_CONCURRENCY, addSkill)
      }
    }

    // Built-in skills: resolve .cyberstrike/ relative to this source file
    // so they're always found regardless of Instance.directory (web UI header).
    // Skip in test mode to preserve test isolation.
    if (!process.env.CYBERSTRIKE_TEST_HOME) {
      const builtinRoot = path.resolve(import.meta.dir, "../../../..")
      const builtinDir = path.join(builtinRoot, ".cyberstrike")
      if (await Filesystem.isDir(builtinDir)) {
        for (const sub of ["skill", "skills"]) {
          const root = path.join(builtinDir, sub)
          if (!(await Filesystem.isDir(root))) continue
          await mapLimit(await Filesystem.findByName(root, "SKILL.md"), SKILL_LOAD_CONCURRENCY, addSkill)
        }
      }

      // Bundled skills beside the compiled binary — the flat archive (GitLab / standalone
      // download) ships skill/ next to the exe, mirroring the web-dir resolution in server.ts.
      // This loads the full offensive corpus OFFLINE on every OS: import.meta.dir resolves to
      // bunfs in a compiled binary (built-in scan above misses), and the GitHub fetch below only
      // has assets for npm-published versions (a GitLab-only release 404s). Check beside the exe,
      // then one level up (npm bin/ subdirectory layout).
      let bundledFound = false
      for (const dir of [
        path.join(path.dirname(process.execPath), "skill"),
        path.join(path.dirname(process.execPath), "..", "skill"),
      ]) {
        if (!(await Filesystem.isDir(dir))) continue
        const matches = await Filesystem.findByName(dir, "SKILL.md")
        if (matches.length === 0) continue
        await mapLimit(matches, SKILL_LOAD_CONCURRENCY, addSkill)
        bundledFound = true
        break
      }

      // Installed skills: XDG data dir. Not bundled in the npm tarball (offensive skill
      // content trips npm's automated review — #114); fetched from the GitHub Release on
      // first run for npm-published binaries. Skipped when the corpus was already found bundled
      // beside the exe (GitLab/standalone archive), where the GitHub fetch would 404.
      const installedDir = path.join(Global.Path.data, "skill")
      if (!bundledFound) await ensureInstalledSkills(installedDir)
      if (await Filesystem.isDir(installedDir)) {
        await mapLimit(await Filesystem.findByName(installedDir, "SKILL.md"), SKILL_LOAD_CONCURRENCY, addSkill)
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
      await mapLimit(await Filesystem.findByName(resolved, "SKILL.md"), SKILL_LOAD_CONCURRENCY, addSkill)
    }

    // Download and load skills from URLs
    for (const url of config.skills?.urls ?? []) {
      const list = await Discovery.pull(url)
      for (const dir of list) {
        dirs.add(dir)
        await mapLimit(await Filesystem.findByName(dir, "SKILL.md"), SKILL_LOAD_CONCURRENCY, addSkill)
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

  /**
   * Lightweight directory list - scans for SKILL.md files without parsing them.
   * Used for permission initialization to avoid triggering full skill indexing.
   * ~500ms vs 4.3s for full state() initialization.
   */
  export async function dirsOnly(): Promise<string[]> {
    const dirs = new Set<string>()

    const scanExternal = async (root: string) => {
      for await (const match of EXTERNAL_SKILL_GLOB.scan({
        cwd: root,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
        dot: true,
      })) {
        dirs.add(path.dirname(match))
      }
    }

    // Scan external skill directories (.claude/skills/, .agents/skills/)
    if (!Flag.CYBERSTRIKE_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        await scanExternal(root)
      }

      for await (const root of Filesystem.up({
        targets: EXTERNAL_DIRS,
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanExternal(root)
      }
    }

    const addDirs = (matches: string[]) => {
      for (const match of matches) dirs.add(path.dirname(match))
    }

    // Scan .cyberstrike/skill/ and .cyberstrike/skills/ directories
    for (const dir of await Config.directories()) {
      for (const sub of ["skill", "skills"]) {
        const root = path.join(dir, sub)
        if (!(await Filesystem.isDir(root))) continue
        addDirs(await Filesystem.findByName(root, "SKILL.md"))
      }
    }

    // Built-in skills
    if (!process.env.CYBERSTRIKE_TEST_HOME) {
      const builtinRoot = path.resolve(import.meta.dir, "../../../..")
      const builtinDir = path.join(builtinRoot, ".cyberstrike")
      if (await Filesystem.isDir(builtinDir)) {
        for (const sub of ["skill", "skills"]) {
          const root = path.join(builtinDir, sub)
          if (!(await Filesystem.isDir(root))) continue
          addDirs(await Filesystem.findByName(root, "SKILL.md"))
        }
      }

      // Installed skills: XDG data dir
      const installedDir = path.join(Global.Path.data, "skill")
      if (await Filesystem.isDir(installedDir)) addDirs(await Filesystem.findByName(installedDir, "SKILL.md"))
    }

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      if (!(await Filesystem.isDir(resolved))) continue
      addDirs(await Filesystem.findByName(resolved, "SKILL.md"))
    }

    // Downloaded skills from URLs
    for (const url of config.skills?.urls ?? []) {
      const list = await Discovery.pull(url).catch(() => [])
      if (!list) continue
      for (const dir of list) {
        dirs.add(dir)
      }
    }

    return Array.from(dirs)
  }
}
