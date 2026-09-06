// Core public-API version — the compatibility boundary between the host and an
// installed workflow package (docs/domain-plugin-architecture.md).
//
// This is the version of the `src/public.ts` SURFACE, independent of the app's
// npm/release version. Bump the MAJOR when a public member is removed or changed
// incompatibly (a package pinned to the old major must refuse to load); bump the
// MINOR when members are added (older packages still work). A workflow package
// calls requireCoreApi() in its provider factory to fail fast + surface a clear
// health error instead of running against an incompatible host.
// 1.1.0 — added Session, Vulnerability, VulnStatus (for the azure extraction);
// additive, so packages pinned to >= 1.0.0 still load.
export const CORE_API_VERSION = "1.1.0"

function parse(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec((v ?? "").trim())
  if (!m) return [-1, -1, -1] // unparseable → never satisfies (safe)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** True when the host's core API is at least `minVersion` (semver major.minor.patch). */
export function coreApiSatisfies(minVersion: string): boolean {
  const have = parse(CORE_API_VERSION)
  const need = parse(minVersion)
  if (have[0] < 0 || need[0] < 0) return false
  for (let i = 0; i < 3; i++) {
    if (have[i] > need[i]) return true
    if (have[i] < need[i]) return false
  }
  return true // exactly equal
}

/**
 * Assert the host core API satisfies `minVersion`. Call it in a workflow package's
 * provider factory: on mismatch it throws, and the registry's resolveProviders
 * catches it, so the domain shows in the health report as failed-to-load with a
 * clear reason rather than registering a domain that will misbehave.
 */
export function requireCoreApi(minVersion: string): void {
  if (!coreApiSatisfies(minVersion)) {
    throw new Error(
      `incompatible core API: this package needs core >= ${minVersion}, host provides ${CORE_API_VERSION}. Upgrade cyberstrike.`,
    )
  }
}
