#!/usr/bin/env bun
// Generate index.json for the skill registry
// Usage: bun run packages/cyberstrike/script/generate-registry.ts
// Output: .cyberstrike/skill/index.json (for publishing to skills.cyberstrike.io)
import path from "path"
import { readdirSync, statSync } from "fs"

const root = path.resolve(import.meta.dir, "../../..")
const skillDir = path.join(root, ".cyberstrike", "skill")

type RegistryEntry = {
  name: string
  description: string
  category?: string
  owasp_id?: string
  verified?: string
  tags?: string[]
  tech_stack?: string[]
  cwe_ids?: string[]
  files: string[]
}

async function main() {
  const entries: RegistryEntry[] = []

  const dirs = readdirSync(skillDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  for (const name of dirs) {
    const skillPath = path.join(skillDir, name, "SKILL.md")
    const file = Bun.file(skillPath)
    if (!(await file.exists())) continue

    const content = await file.text()
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) continue

    const fm = fmMatch[1]
    const get = (key: string) => fm.match(new RegExp(`^${key}:\\s*"?(.+?)"?$`, "m"))?.[1]
    const getArray = (key: string) => {
      const m = fm.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, "m"))
      if (!m) return []
      return m[1].split(",").map((s) => s.trim()).filter(Boolean)
    }

    // Collect all files in this skill directory
    const dir = path.join(skillDir, name)
    const files: string[] = []
    const walk = (d: string, prefix: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(path.join(d, entry.name), rel)
        else files.push(rel)
      }
    }
    walk(dir, "")

    entries.push({
      name,
      description: get("description") ?? "",
      category: get("category"),
      owasp_id: get("owasp_id"),
      verified: get("signed_by") ? "official" : "unverified",
      tags: getArray("tags"),
      tech_stack: getArray("tech_stack"),
      cwe_ids: getArray("cwe_ids"),
      files,
    })
  }

  const index = { version: "1.0", skills: entries }
  const output = path.join(skillDir, "index.json")
  await Bun.write(output, JSON.stringify(index, null, 2) + "\n")

  console.log(`Generated ${output}`)
  console.log(`  ${entries.length} skills indexed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
