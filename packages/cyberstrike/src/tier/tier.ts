// Runtime tier gate for the free/open-core split (Enterprise issue #35).
//
//   free  ⊂ pro ⊂ enterprise
//
// The free/public build ships the web workflow + generic harness agents only.
// SaaS/enterprise deployments raise the tier via the CYBERSTRIKE_TIER env var,
// which unlocks the pro (mobile/cloud/internal) and enterprise (sast/asm/
// enterprise-vortex) domains at runtime. This is the step-1 runtime cut; a later
// step 2 does build-time code exclusion.
export namespace Tier {
  export type Level = "free" | "pro" | "enterprise"

  const RANK: Record<Level, number> = { free: 0, pro: 1, enterprise: 2 }

  // The active tier, read live from the environment so tests and deployments can
  // set it per-process. Anything unset or unrecognized falls back to the free
  // default — the public build must never accidentally unlock a higher tier.
  export function active(): Level {
    const value = process.env["CYBERSTRIKE_TIER"]?.toLowerCase()
    if (value === "pro") return "pro"
    if (value === "enterprise") return "enterprise"
    return "free"
  }

  // True when the active tier is at least `required`. A required of "free" always
  // allows (rank 0). free < pro < enterprise.
  export function allows(required: Level): boolean {
    return RANK[active()] >= RANK[required]
  }
}
