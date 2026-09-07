// Domain auto-discovery — find installed domain packages WITHOUT a config entry.
//
// The pitch is `npm install @cyberstrike-io/<domain>` and it just works — the same
// ergonomics as adding an MCP server, but native. So the host scans the project's
// node_modules for packages that declare a `cyberstrike` manifest (domain-manifest.ts)
// and hands the compatible ones to the plugin loader. This is the 4th load source
// after INTERNAL_PLUGINS, the bundled DEFAULT_DOMAINS, and config.plugin.
//
// Why the PROJECT node_modules (Instance.directory / worktree) and not the host's
// install cache: a user runs `npm install` in their own workspace, so the package
// lands in ./node_modules. The host's <Global.Path.cache>/node_modules is where
// config.plugin packages are installed and is already loaded by the config loop —
// scanning it here would double-load. Read-only, never throws: a broken package is
// reported, not fatal, so discovery can't take down startup.
import path from "node:path"
import { readdir } from "node:fs/promises"
import { Instance } from "../project/instance"
import { CORE_API_VERSION, coreApiSatisfies } from "./core-api"
import { readManifest, type DomainManifest } from "./domain-manifest"

export interface DiscoveredDomain {
  name: string // package name (e.g. "@foo/aws-pro")
  dir: string // absolute path to the package dir (what the loader imports)
  root: string // the node_modules root it was found in
  manifest: DomainManifest
  compatible: boolean // coreApiSatisfies(manifest.coreApi) — true when no coreApi is pinned
  reason?: string // why it is incompatible (present only when compatible === false)
}

export interface DiscoveryResult {
  found: DiscoveredDomain[]
  errors: Array<{ name: string; dir: string; error: string }> // packages with a malformed manifest
}

/** node_modules roots to scan: the project + its git worktree, deduped, if resolvable. */
export function projectRoots(): string[] {
  const roots: string[] = []
  try {
    const dir = Instance.directory
    if (dir) roots.push(path.join(dir, "node_modules"))
  } catch {
    // no active instance (e.g. a unit test) — caller can pass roots explicitly
  }
  try {
    const wt = Instance.worktree
    if (wt && wt !== "/") roots.push(path.join(wt, "node_modules"))
  } catch {
    // ignore
  }
  return [...new Set(roots)]
}

/** List installed packages under a node_modules root (handles @scope/ dirs). */
async function listPackages(root: string): Promise<Array<{ name: string; dir: string }>> {
  const out: Array<{ name: string; dir: string }> = []
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return out // root doesn't exist — nothing installed there
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue
    if (entry.startsWith("@")) {
      const scopeDir = path.join(root, entry)
      let subs: string[]
      try {
        subs = await readdir(scopeDir)
      } catch {
        continue
      }
      for (const sub of subs) {
        if (sub.startsWith(".")) continue
        out.push({ name: `${entry}/${sub}`, dir: path.join(scopeDir, sub) })
      }
      continue
    }
    out.push({ name: entry, dir: path.join(root, entry) })
  }
  return out
}

/**
 * Discover installed domain packages. Scans each root once, reads each package's
 * package.json, and keeps only those carrying a valid `cyberstrike` manifest.
 * `skip` names (already loaded — bundled defaults, config plugins) are ignored so
 * a package never loads twice. Compatibility is computed but NOT enforced here —
 * the caller decides to load or skip, so an incompatible domain is still visible
 * in `cyberstrike domains`.
 */
export async function discoverDomains(opts?: {
  roots?: string[]
  skip?: Iterable<string>
}): Promise<DiscoveryResult> {
  const roots = opts?.roots ?? projectRoots()
  const skip = new Set(opts?.skip ?? [])
  const found: DiscoveredDomain[] = []
  const errors: DiscoveryResult["errors"] = []
  const seen = new Set<string>()

  for (const root of roots) {
    for (const pkg of await listPackages(root)) {
      if (skip.has(pkg.name) || seen.has(pkg.name)) continue
      let json: unknown
      try {
        json = await Bun.file(path.join(pkg.dir, "package.json")).json()
      } catch {
        continue // no/unreadable package.json — not a package we can load
      }
      const parsed = readManifest(json)
      if (parsed.error) {
        errors.push({ name: pkg.name, dir: pkg.dir, error: parsed.error })
        seen.add(pkg.name)
        continue
      }
      if (!parsed.manifest) continue // valid package, just not a cyberstrike domain
      seen.add(pkg.name)
      const min = parsed.manifest.coreApi
      const compatible = !min || coreApiSatisfies(min)
      found.push({
        name: pkg.name,
        dir: pkg.dir,
        root,
        manifest: parsed.manifest,
        compatible,
        reason: compatible ? undefined : `needs core >= ${min}, host provides ${CORE_API_VERSION}`,
      })
    }
  }

  return { found, errors }
}
