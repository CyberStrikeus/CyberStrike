// Domain manifest — the STATIC self-declaration a domain package puts in its
// package.json under a `cyberstrike` field, so the host can discover it, check
// compatibility, and list it WITHOUT executing the package first.
//
//   "cyberstrike": {
//     "coreApi": "1.2.0",           // minimum core API it needs (>=), see core-api.ts
//     "domains": ["aws"],           // domain keys it registers (informational)
//     "tools":   ["aws_iam_probe"], // tool ids it contributes (informational)
//     "tier":    "pro"              // "free" | "pro" (informational)
//   }
//
// The manifest is a declaration, not the source of truth: the real registration
// still happens when the plugin's default export runs and returns its hooks. The
// manifest lets the host do a pre-flight compatibility check (skip an incompatible
// package before importing it) and power a `cyberstrike domains` listing.
import { z } from "zod"

export const DomainManifest = z
  .object({
    // Minimum core API version (major.minor.patch); host must satisfy it. Same
    // semantics as requireCoreApi — a plain min version, ">=" is implied.
    coreApi: z
      .string()
      .regex(/^\d+\.\d+\.\d+/, "coreApi must be a semver version, e.g. \"1.2.0\"")
      .optional(),
    domains: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    tier: z.enum(["free", "pro"]).optional(),
    // Informational grouping for `cyberstrike domains` listing (e.g. "cloud" for
    // azure/gcp/aws/oracle, "mobile" for android/ios). Top-level domains omit it.
    category: z.string().optional(),
  })
  .strict()

export type DomainManifest = z.infer<typeof DomainManifest>

export interface ManifestParse {
  manifest?: DomainManifest
  error?: string
}

/**
 * Read + validate the `cyberstrike` field of a parsed package.json object.
 * Returns `{}` (neither manifest nor error) when the field is absent — i.e. the
 * package is simply not a CyberStrike domain, which is not an error. Returns
 * `{ error }` only when the field is present but malformed.
 */
export function readManifest(pkgJson: unknown): ManifestParse {
  if (!pkgJson || typeof pkgJson !== "object") return {}
  const field = (pkgJson as Record<string, unknown>)["cyberstrike"]
  if (field === undefined) return {}
  const parsed = DomainManifest.safeParse(field)
  if (!parsed.success) {
    return { error: `invalid \"cyberstrike\" manifest: ${parsed.error.issues.map((i) => i.message).join("; ")}` }
  }
  return { manifest: parsed.data }
}

/** True when a parsed package.json declares a CyberStrike domain manifest. */
export function hasManifest(pkgJson: unknown): boolean {
  return readManifest(pkgJson).manifest !== undefined
}
