import { $, semver } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  CYBERSTRIKE_CHANNEL: process.env["CYBERSTRIKE_CHANNEL"],
  CYBERSTRIKE_BUMP: process.env["CYBERSTRIKE_BUMP"],
  CYBERSTRIKE_VERSION: process.env["CYBERSTRIKE_VERSION"],
  CYBERSTRIKE_RELEASE: process.env["CYBERSTRIKE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.CYBERSTRIKE_CHANNEL) return env.CYBERSTRIKE_CHANNEL
  if (env.CYBERSTRIKE_BUMP === "beta") return "beta"
  if (env.CYBERSTRIKE_BUMP) return "latest"
  if (env.CYBERSTRIKE_VERSION && !env.CYBERSTRIKE_VERSION.startsWith("0.0.0-")) {
    // Extract prerelease tag from semver (e.g. "1.1.6-beta.1" → "beta")
    const pre = env.CYBERSTRIKE_VERSION.match(/-([a-z]+)/i)?.[1]
    return pre ?? "latest"
  }
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.CYBERSTRIKE_VERSION) return env.CYBERSTRIKE_VERSION
  if (IS_PREVIEW && env.CYBERSTRIKE_BUMP !== "beta")
    return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`

  const registry = (await fetch("https://registry.npmjs.org/@cyberstrike-io%2Fcyberstrike").then((res) => {
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
  })) as { "dist-tags": Record<string, string>; versions: Record<string, unknown> }

  if (env.CYBERSTRIKE_BUMP === "beta") {
    const latest = registry["dist-tags"]?.latest
    if (!latest) throw new Error("No published latest version found on npm")
    const [major, minor, patch] = latest.split(".").map((x: string) => Number(x) || 0)

    const beta = registry["dist-tags"]?.beta
    if (beta) {
      const betaMatch = beta.match(/^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/)
      if (betaMatch) {
        const [, bMaj, bMin, bPatch, bNum] = betaMatch
        const sameMajor = Number(bMaj) === major
        const sameMinor = Number(bMin) === minor
        const samePatch = Number(bPatch) === patch + 1
        if (sameMajor && sameMinor && samePatch) {
          return `${bMaj}.${bMin}.${bPatch}-beta.${Number(bNum) + 1}`
        }
      }
    }
    return `${major}.${minor}.${patch + 1}-beta.0`
  }

  const version = registry["dist-tags"]?.latest
  if (!version) throw new Error("No published latest version found on npm")
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.CYBERSTRIKE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const team = [
  "actions-user",
  "cyberstrike",
  "rekram1-node",
  "thdxr",
  "kommander",
  "jayair",
  "fwang",
  "adamdotdevin",
  "iamdavidhill",
  "cyberstrike-agent[bot]",
  "R44VC0RP",
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.CYBERSTRIKE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`cyberstrike script`, JSON.stringify(Script, null, 2))
