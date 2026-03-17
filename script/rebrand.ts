#!/usr/bin/env bun
/**
 * CyberStrike Rebrand Script
 *
 * Automates find-replace across the monorepo for the OpenCode → CyberStrike rebrand.
 * Applies replacements in specificity order (most specific first) to avoid double-replacement.
 *
 * Usage:
 *   bun script/rebrand.ts              # Execute replacements
 *   bun script/rebrand.ts --dry-run    # Preview changes without modifying files
 */

import { readdir, readFile, writeFile, stat } from "fs/promises"
import { join, extname, relative } from "path"

const ROOT = join(import.meta.dir, "..")
const DRY_RUN = process.argv.includes("--dry-run")

// Replacements in specificity order (most specific first)
const REPLACEMENTS: [string, string][] = [
  // Scope and package names (most specific)
  ["@opencode-ai/", "@cyberstrikeus/"],
  ["opencode-ai", "cyberstrike"],

  // GitHub references
  ["anomalyco/tap/opencode", "CyberStrikeus/tap/cyberstrike"],
  ["anomalyco/opencode", "CyberStrikeus/CyberStrike"],

  // Domain
  ["opencode.ai", "cyberstrike.us"],
  ["opncd.ai", "cybrstk.us"],

  // Desktop app identifier
  ["ai.opencode.desktop", "us.cyberstrike.desktop"],

  // Env variable prefix (before bare "OPENCODE")
  ["OPENCODE_", "CYBERSTRIKE_"],
  ['"OPENCODE"', '"CYBERSTRIKE"'],
  ["'OPENCODE'", "'CYBERSTRIKE'"],
  [".OPENCODE", ".CYBERSTRIKE"],
  ["OPENCODE", "CYBERSTRIKE"],

  // Title case product name
  ["OpenCode", "CyberStrike"],

  // PascalCase (e.g. createOpencodeClient, OpencodeClient)
  ["Opencode", "Cyberstrike"],

  // Bare lowercase (least specific - applied last)
  ["opencode", "cyberstrike"],
]

// Patterns that should NOT be replaced (3rd-party packages)
const EXCLUDE_PATTERNS = [
  "@gitlab/opencode-gitlab-auth",
  "@openauthjs/openauth",
  "@openrouter/",
  "@opentui/",
  "openTelemetry",
  "opentelemetry",
  "OpenTelemetry",
  "open-telemetry",
]

// File extensions to process
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".md",
  ".mdx",
  ".toml",
  ".nix",
  ".rs",
  ".txt",
  ".sh",
  ".css",
  ".xml",
  ".astro",
  ".svg",
  ".html",
  ".patch",
  ".d.ts",
])

// Directories to skip
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".turbo",
  ".next",
  ".output",
  "target", // Rust build output
])

// Files to skip
const SKIP_FILES = new Set([
  "bun.lock",
  "Cargo.lock",
  "rebrand.ts", // this script
])

interface FileChange {
  path: string
  replacements: number
  patterns: string[]
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walkFiles(fullPath)
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue
      const ext = extname(entry.name).toLowerCase()
      // Also handle extensionless files like "install"
      if (TEXT_EXTENSIONS.has(ext) || entry.name === "install") {
        yield fullPath
      }
    }
  }
}

function protectExclusions(content: string): [string, Map<string, string>] {
  const protections = new Map<string, string>()
  let protected_ = content

  EXCLUDE_PATTERNS.forEach((pattern, i) => {
    const placeholder = `__PROTECT_${i}_${Date.now()}__`
    const regex = new RegExp(escapeRegex(pattern), "g")
    if (regex.test(protected_)) {
      protections.set(placeholder, pattern)
      protected_ = protected_.replace(regex, placeholder)
    }
  })

  return [protected_, protections]
}

function restoreExclusions(content: string, protections: Map<string, string>): string {
  let restored = content
  for (const [placeholder, original] of protections) {
    restored = restored.replaceAll(placeholder, original)
  }
  return restored
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function applyReplacements(content: string): { result: string; count: number; patterns: string[] } {
  // Step 1: Protect exclusions
  const [protected_, protections] = protectExclusions(content)

  // Step 2: Apply replacements in order
  let result = protected_
  let totalCount = 0
  const matchedPatterns: string[] = []

  for (const [from, to] of REPLACEMENTS) {
    const regex = new RegExp(escapeRegex(from), "g")
    const matches = result.match(regex)
    if (matches && matches.length > 0) {
      totalCount += matches.length
      matchedPatterns.push(`${from} → ${to} (${matches.length}x)`)
      result = result.replaceAll(from, to)
    }
  }

  // Step 3: Restore exclusions
  result = restoreExclusions(result, protections)

  return { result, count: totalCount, patterns: matchedPatterns }
}

async function main() {
  console.log(`\n🔄 CyberStrike Rebrand Script`)
  console.log(`   Mode: ${DRY_RUN ? "DRY RUN (no files will be modified)" : "LIVE"}`)
  console.log(`   Root: ${ROOT}\n`)

  const changes: FileChange[] = []
  let totalReplacements = 0
  let filesProcessed = 0
  let filesChanged = 0

  for await (const filePath of walkFiles(ROOT)) {
    filesProcessed++
    try {
      const content = await readFile(filePath, "utf-8")
      const { result, count, patterns } = applyReplacements(content)

      if (count > 0) {
        filesChanged++
        totalReplacements += count
        const relPath = relative(ROOT, filePath)
        changes.push({ path: relPath, replacements: count, patterns })

        if (!DRY_RUN) {
          await writeFile(filePath, result, "utf-8")
        }
      }
    } catch {
      // Skip binary files or read errors
    }
  }

  // Print summary
  console.log(`\n📊 Summary:`)
  console.log(`   Files scanned:  ${filesProcessed}`)
  console.log(`   Files changed:  ${filesChanged}`)
  console.log(`   Replacements:   ${totalReplacements}`)
  console.log()

  if (changes.length > 0) {
    console.log(`📝 Changed files:\n`)
    for (const change of changes.sort((a, b) => b.replacements - a.replacements)) {
      console.log(`   ${change.path} (${change.replacements} replacements)`)
      for (const p of change.patterns) {
        console.log(`      ${p}`)
      }
    }
  }

  if (DRY_RUN) {
    console.log(`\n⚠️  DRY RUN - no files were modified. Run without --dry-run to apply changes.\n`)
  } else {
    console.log(`\n✅ Rebrand complete. Run 'bun install' and 'bun turbo typecheck' to verify.\n`)
  }
}

main().catch(console.error)
