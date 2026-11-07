// License validation for brain connections.
// Validates the client's Pro/Enterprise license token and returns the tier.

export namespace License {
  export type Result =
    | { valid: true; tier: "pro" | "enterprise"; org?: string }
    | { valid: false; reason: string }

  // Phase 1: simple token lookup. Phase 2: JWT with org claims + Stripe integration.
  export async function validate(token: string): Promise<Result> {
    // TODO: implement real license validation (Stripe subscription lookup,
    // JWT verification, org-level entitlements)
    if (!token || token.length < 8) {
      return { valid: false, reason: "invalid license token" }
    }

    // Placeholder: accept any non-empty token as pro for development.
    // Production will verify against the license server.
    return { valid: true, tier: "pro" }
  }
}
