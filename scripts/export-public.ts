#!/usr/bin/env bun
// Tier-driven public-mirror strip list.
//
// The public CyberStrike mirror ships only the AGPL open core: every paid domain
// package MUST be physically absent from it. The set of directories to strip is
// NOT a hardcoded list (that rots the moment a package is added or re-tiered) — it
// is COMPUTED from the package manifests. Any `packages/*` whose `cyberstrike.tier`
// is "pro" or "enterprise" is stripped; "free" and untiered core stay.
//
// So adding a paid package (e.g. this Step-2 extraction: internal-network, mobile,
// cloud) or re-tiering an existing one (Step 1) needs NO edit here — the package's
// own manifest is the single source of truth.
//
//   bun scripts/export-public.ts            # print the computed strip list
//   bun scripts/export-public.ts --json     # machine-readable {strip, keep, untiered}
//   bun scripts/export-public.ts --command  # print the git filter-repo command
//
// This script produces the list + a documented command; running filter-repo itself
// (destructive history rewrite) stays a deliberate manual step.
import { Glob } from "bun"
import path from "node:path"

export interface DomainTier {
  dir: string // repo-relative package dir, e.g. "packages/azure"
  name: string // package name from package.json
  tier?: string // cyberstrike.tier, if declared
}

// A domain is stripped from the public mirror when its tier is paid. Read as a raw
// string (not via the manifest's zod enum) so a future "enterprise" tier strips too,
// even before the enum is widened.
const PAID_TIERS = new Set(["pro", "enterprise"])

export function isPaid(tier: string | undefined): boolean {
  return tier !== undefined && PAID_TIERS.has(tier)
}

/** Scan `packages/*` and read each one's package.json tier declaration. */
export async function scanPackages(repoRoot: string): Promise<DomainTier[]> {
  const glob = new Glob("packages/*/package.json")
  const out: DomainTier[] = []
  for await (const rel of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
    const json = await Bun.file(path.join(repoRoot, rel))
      .json()
      .catch(() => null)
    if (!json || typeof json !== "object") continue
    const cs = json.cyberstrike
    const tier = cs && typeof cs === "object" && typeof cs.tier === "string" ? cs.tier : undefined
    out.push({ dir: path.dirname(rel), name: json.name ?? path.dirname(rel), tier })
  }
  out.sort((a, b) => a.dir.localeCompare(b.dir))
  return out
}

export interface StripPlan {
  strip: string[] // paid dirs to remove from the public mirror
  keep: string[] // free-tier dirs that stay
  untiered: string[] // dirs with NO cyberstrike.tier manifest (neither stripped nor a declared free domain)
}

export async function computeStripPlan(repoRoot: string): Promise<StripPlan> {
  const pkgs = await scanPackages(repoRoot)
  const strip: string[] = []
  const keep: string[] = []
  const untiered: string[] = []
  for (const p of pkgs) {
    if (isPaid(p.tier)) strip.push(p.dir)
    else if (p.tier === "free") keep.push(p.dir)
    else untiered.push(p.dir)
  }
  return { strip, keep, untiered }
}

/** Just the strip dirs — the primary output other tooling consumes. */
export async function computeStripDirs(repoRoot: string): Promise<string[]> {
  return computeStripPlan(repoRoot).then((p) => p.strip)
}

function filterRepoCommand(strip: string[]): string {
  const args = strip.map((d) => `--path '${d}/'`).join(" ")
  return `git filter-repo --invert-paths ${args}`
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dir, "..")
  const plan = await computeStripPlan(repoRoot)
  const argv = Bun.argv.slice(2)

  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n")
    return
  }
  if (argv.includes("--command")) {
    process.stdout.write(filterRepoCommand(plan.strip) + "\n")
    return
  }

  process.stdout.write(`Public-mirror strip list (tier-driven, computed from package manifests)\n\n`)
  process.stdout.write(`STRIP (paid — pro/enterprise), ${plan.strip.length} dirs:\n`)
  for (const d of plan.strip) process.stdout.write(`  - ${d}\n`)
  process.stdout.write(`\nKEEP (free-tier domains), ${plan.keep.length} dirs:\n`)
  for (const d of plan.keep) process.stdout.write(`  - ${d}\n`)
  if (plan.untiered.length) {
    process.stdout.write(
      `\nUNTIERED (no cyberstrike.tier manifest — NOT auto-stripped; review before publishing), ${plan.untiered.length} dirs:\n`,
    )
    for (const d of plan.untiered) process.stdout.write(`  - ${d}\n`)
  }
  process.stdout.write(`\nTo strip from a fresh mirror clone (destructive history rewrite — run deliberately):\n`)
  process.stdout.write(`  ${filterRepoCommand(plan.strip)}\n`)
}

if (import.meta.main) {
  await main()
}
