import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { discoverDomains } from "../../src/cloud/domain-discovery"

// Build a throwaway node_modules fixture and point discovery at it via `roots`,
// so the test never depends on an active Instance or the real filesystem layout.
let root: string
let base: string

async function writePkg(name: string, pkg: Record<string, unknown>) {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", ...pkg }))
}

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "cs-discovery-"))
  root = path.join(base, "node_modules")
  await mkdir(root, { recursive: true })
  // a compatible scoped domain
  await writePkg("@foo/aws-pro", { cyberstrike: { coreApi: "1.2.0", domains: ["aws"], tier: "pro" } })
  // an unscoped compatible domain with no coreApi pin (any host)
  await writePkg("legacy-domain", { cyberstrike: { domains: ["legacy"] } })
  // an incompatible domain (pins a future core)
  await writePkg("@foo/future", { cyberstrike: { coreApi: "99.0.0", domains: ["future"] } })
  // a normal package that is NOT a domain
  await writePkg("left-pad", {})
  // a package with a malformed manifest
  await writePkg("@foo/broken", { cyberstrike: { coreApi: "latest" } })
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe("domain auto-discovery", () => {
  test("finds only packages that declare a cyberstrike manifest", async () => {
    const { found } = await discoverDomains({ roots: [root] })
    const names = found.map((d) => d.name).sort()
    expect(names).toEqual(["@foo/aws-pro", "@foo/future", "legacy-domain"])
    // left-pad (no manifest) is absent; @foo/broken is an error, not a find
    expect(names).not.toContain("left-pad")
    expect(names).not.toContain("@foo/broken")
  })

  test("computes compatibility from the manifest coreApi", async () => {
    const { found } = await discoverDomains({ roots: [root] })
    const aws = found.find((d) => d.name === "@foo/aws-pro")!
    const legacy = found.find((d) => d.name === "legacy-domain")!
    const future = found.find((d) => d.name === "@foo/future")!
    expect(aws.compatible).toBe(true)
    expect(legacy.compatible).toBe(true) // no coreApi pin → any host
    expect(future.compatible).toBe(false)
    expect(future.reason).toContain("needs core >= 99.0.0")
  })

  test("surfaces the package dir (what the loader imports) and manifest fields", async () => {
    const { found } = await discoverDomains({ roots: [root] })
    const aws = found.find((d) => d.name === "@foo/aws-pro")!
    expect(aws.dir).toBe(path.join(root, "@foo/aws-pro"))
    expect(aws.manifest.tier).toBe("pro")
    expect(aws.manifest.domains).toEqual(["aws"])
  })

  test("a malformed manifest is reported as an error, not a find", async () => {
    const { errors } = await discoverDomains({ roots: [root] })
    expect(errors.some((e) => e.name === "@foo/broken")).toBe(true)
    expect(errors.find((e) => e.name === "@foo/broken")!.error).toContain("coreApi")
  })

  test("skip excludes already-loaded packages", async () => {
    const { found } = await discoverDomains({ roots: [root], skip: ["@foo/aws-pro"] })
    expect(found.some((d) => d.name === "@foo/aws-pro")).toBe(false)
    expect(found.some((d) => d.name === "legacy-domain")).toBe(true)
  })

  test("a missing node_modules root yields nothing (never throws)", async () => {
    const { found, errors } = await discoverDomains({ roots: [path.join(base, "does-not-exist")] })
    expect(found).toEqual([])
    expect(errors).toEqual([])
  })
})
