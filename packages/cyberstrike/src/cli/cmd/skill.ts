import path from "path"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Skill } from "../../skill/skill"
import { SkillIndex } from "../../skill/index-engine"
import { SkillSigning } from "../../skill/signing"
import { Discovery } from "../../skill/discovery"
import { Instance } from "../../project/instance"

function verifiedIcon(status?: string): string {
  if (status === "official") return "✓"
  if (status === "community") return "○"
  if (status === "tampered") return "✗"
  return "?"
}

function verifiedColor(status?: string): string {
  if (status === "official") return "\x1b[32m"
  if (status === "community") return "\x1b[33m"
  if (status === "tampered") return "\x1b[31m"
  return "\x1b[90m"
}

const reset = "\x1b[0m"

export const SkillCommand = cmd({
  command: "skill",
  describe: "manage offensive security skills",
  builder: (yargs) =>
    yargs
      .command(SkillListCommand)
      .command(SkillSearchCommand)
      .command(SkillVerifyCommand)
      .command(SkillCreateCommand)
      .command(SkillInstallCommand)
      .command(SkillRemoveCommand)
      .command(SkillSignCommand)
      .demandCommand(),
  async handler() {},
})

const SkillListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all available skills",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Skills")

        const skills = await Skill.all()
        if (skills.length === 0) {
          prompts.log.info("No skills found.")
          prompts.outro("")
          return
        }

        const grouped = new Map<string, typeof skills>()
        for (const skill of skills) {
          const cat = skill.category ?? "other"
          if (!grouped.has(cat)) grouped.set(cat, [])
          grouped.get(cat)!.push(skill)
        }

        for (const [category, items] of grouped) {
          prompts.log.step(`${category} (${items.length})`)
          for (const skill of items) {
            const icon = verifiedIcon(skill.verified)
            const color = verifiedColor(skill.verified)
            const tech = skill.tech_stack?.length ? ` [${skill.tech_stack.slice(0, 5).join(", ")}]` : ""
            console.log(`  ${color}${icon}${reset} ${skill.name} — ${skill.description}${tech}`)
          }
        }

        prompts.outro(`${skills.length} skills total`)
      },
    })
  },
})

const SkillSearchCommand = cmd({
  command: "search <query>",
  describe: "search skills by keyword, tech stack, CWE, or category",
  builder: (yargs) =>
    yargs
      .positional("query", { type: "string", demandOption: true })
      .option("tech", { type: "string", describe: "filter by tech stack (comma-separated)" })
      .option("cwe", { type: "string", describe: "filter by CWE ID" })
      .option("category", { type: "string", describe: "filter by category" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        await SkillIndex.rebuild()

        let results: SkillIndex.Entry[]
        if (args.cwe) results = SkillIndex.byCWE(args.cwe)
        else if (args.tech) results = SkillIndex.byTechStack(args.tech.split(","))
        else if (args.category) results = SkillIndex.byCategory(args.category)
        else results = SkillIndex.search(args.query)

        prompts.intro(`Search: "${args.query}"`)

        if (results.length === 0) {
          prompts.log.info("No results found.")
          prompts.outro("")
          return
        }

        for (const r of results) {
          const icon = verifiedIcon(r.verified)
          const color = verifiedColor(r.verified)
          const chains = r.chains_with.length ? ` → ${r.chains_with.join(", ")}` : ""
          console.log(`  ${color}${icon}${reset} ${r.name} — ${r.description}${chains}`)
        }

        prompts.outro(`${results.length} results`)
      },
    })
  },
})

const SkillVerifyCommand = cmd({
  command: "verify [name]",
  describe: "verify skill integrity",
  builder: (yargs) => yargs.positional("name", { type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Skill Verification")

        const skills = args.name ? [await Skill.get(args.name)].filter(Boolean) : await Skill.all()

        if (skills.length === 0) {
          prompts.log.warn(args.name ? `Skill "${args.name}" not found.` : "No skills found.")
          prompts.outro("")
          return
        }

        let passed = 0
        let failed = 0

        for (const skill of skills) {
          if (!skill) continue
          const status = await SkillSigning.verify({
            content: skill.content,
            sha256: skill.sha256,
            signature: skill.signature,
            signed_by: skill.signed_by,
          })

          const icon = verifiedIcon(status)
          const color = verifiedColor(status)
          console.log(`  ${color}${icon}${reset} ${skill.name} — ${status}`)

          if (status === "tampered") failed++
          else passed++
        }

        if (failed > 0) prompts.log.error(`${failed} skill(s) failed verification!`)
        prompts.outro(`${passed} passed, ${failed} failed`)
      },
    })
  },
})

const SkillCreateCommand = cmd({
  command: "create <name>",
  describe: "scaffold a new skill",
  builder: (yargs) =>
    yargs
      .positional("name", { type: "string", demandOption: true })
      .option("category", { type: "string", default: "custom" })
      .option("description", { type: "string", default: "Custom security skill" }),
  async handler(args) {
    const dir = `.cyberstrike/skill/${args.name}`
    const file = `${dir}/SKILL.md`

    if (await Bun.file(file).exists()) {
      prompts.log.error(`Skill "${args.name}" already exists at ${file}`)
      return
    }

    const content = [
      "---",
      `name: ${args.name}`,
      `description: ${args.description}`,
      `category: ${args.category}`,
      `version: "1.0.0"`,
      `author: community`,
      `tags: [${args.category}]`,
      `tech_stack: []`,
      `cwe_ids: []`,
      `chains_with: []`,
      `prerequisites: []`,
      `severity_boost: {}`,
      "---",
      "",
      `# ${args.name}`,
      "",
      "## What to Check",
      "",
      "- [ ] Add your test cases here",
      "",
      "## How to Test",
      "",
      "### Step 1: Identify Targets",
      "",
      "```bash",
      "# Add your testing commands here",
      "```",
      "",
      "### Step 2: Execute Tests",
      "",
      "Describe your testing methodology here.",
      "",
    ].join("\n")

    await Bun.write(file, content)
    prompts.intro("Skill Created")
    prompts.log.success(`${file}`)
    prompts.outro("Edit the SKILL.md to add your testing methodology.")
  },
})

const SkillInstallCommand = cmd({
  command: "install <url>",
  describe: "install skills from a remote URL or registry",
  builder: (yargs) => yargs.positional("url", { type: "string", demandOption: true }),
  async handler(args) {
    UI.empty()
    prompts.intro("Skill Install")

    const spinner = prompts.spinner()
    spinner.start(`Fetching from ${args.url}`)
    const dirs = await Discovery.pull(args.url)
    spinner.stop(`Downloaded ${dirs.length} skill(s)`)

    for (const dir of dirs) {
      const name = path.basename(dir)
      prompts.log.success(`  ${name}`)
    }

    prompts.outro(`${dirs.length} skills installed to cache`)
  },
})

const SkillRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove a cached remote skill",
  builder: (yargs) => yargs.positional("name", { type: "string", demandOption: true }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Skill Remove")

        const skill = await Skill.get(args.name)
        if (!skill) {
          prompts.log.error(`Skill "${args.name}" not found.`)
          prompts.outro("")
          return
        }

        const cacheDir = Discovery.dir()
        if (!skill.location.startsWith(cacheDir)) {
          prompts.log.error(`Skill "${args.name}" is a built-in skill and cannot be removed.`)
          prompts.outro("Only cached remote skills can be removed.")
          return
        }

        const { rmSync } = await import("fs")
        rmSync(path.dirname(skill.location), { recursive: true })
        prompts.log.success(`Removed "${args.name}"`)
        prompts.outro("")
      },
    })
  },
})

const SkillSignCommand = cmd({
  command: "sign [name]",
  describe: "sign skills with Ed25519 (maintainer only)",
  builder: (yargs) =>
    yargs
      .positional("name", { type: "string" })
      .option("key", { type: "string", describe: "path to private key file" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Skill Signing")

        const keyPath = args.key ?? path.join(process.cwd(), ".skill-signing-key")
        const keyFile = Bun.file(keyPath)
        if (!(await keyFile.exists())) {
          prompts.log.error(`Private key not found at ${keyPath}`)
          prompts.outro("Use --key to specify the path, or run sign-skills.ts --generate first.")
          return
        }
        const privateKeyB64 = (await keyFile.text()).trim()

        const skills = args.name ? [await Skill.get(args.name)].filter(Boolean) : await Skill.all()
        if (skills.length === 0) {
          prompts.log.warn(args.name ? `Skill "${args.name}" not found.` : "No skills found.")
          prompts.outro("")
          return
        }

        let signed = 0
        for (const skill of skills) {
          if (!skill) continue
          const content = await Bun.file(skill.location).text()
          const result = await SkillSigning.sign(content, privateKeyB64)

          // Update frontmatter
          const first = content.indexOf("---")
          const second = content.indexOf("\n---", first + 3)
          if (first === -1 || second === -1) {
            prompts.log.warn(`  SKIP: ${skill.name} (no frontmatter)`)
            continue
          }

          let fm = content.slice(first + 3, second + 1)
          const body = content.slice(second + 1)
          fm = fm
            .replace(/^sha256:.*\n/gm, "")
            .replace(/^signature:.*\n/gm, "")
            .replace(/^signed_by:.*\n/gm, "")
          const insert = `sha256: ${result.sha256}\nsignature: ${result.signature}\nsigned_by: cyberstrike-official\n`
          await Bun.write(skill.location, "---" + fm + insert + body)

          console.log(`  ${verifiedColor("official")}${verifiedIcon("official")}${reset} ${skill.name}`)
          signed++
        }

        prompts.outro(`${signed} skill(s) signed`)
      },
    })
  },
})
