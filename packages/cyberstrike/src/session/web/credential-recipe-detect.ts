import { Request } from "../request"
import { WebCredential } from "./web-credential"
import type { Recipe } from "./credential-recipe"

// Auto-derive a credential refresh recipe from captured traffic. Short-lived
// tokens (Clerk ~60s, Auth0, Firebase) expire mid-test; without a recipe the
// only recourse is hand-minting via curl. This scans the session's captures for
// the request whose response minted the credential's current JWT, then builds a
// single-step recipe that replays that request (its raw form still carries the
// durable session cookie, e.g. __client) to mint a fresh token on demand.
//
// Pure HTTP — works identically in full-auto headed and headless (no browser).

export namespace CredentialRecipeDetect {
  // Matches a JWT: three base64url segments, header starting with "eyJ".
  const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/

  interface JwtLocation {
    path: string
    value: string
  }

  // Walk a JSON value depth-first, return the dot-path to the first JWT string.
  function findJwtPath(node: unknown, prefix: string): JwtLocation | undefined {
    if (typeof node === "string") {
      return JWT_RE.test(node) ? { path: prefix, value: node } : undefined
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = findJwtPath(node[i], prefix ? `${prefix}.${i}` : String(i))
        if (found) return found
      }
      return undefined
    }
    if (node && typeof node === "object") {
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        const found = findJwtPath(val, prefix ? `${prefix}.${key}` : key)
        if (found) return found
      }
    }
    return undefined
  }

  // Decode a JWT's exp - iat to estimate token lifetime. Falls back to 60s.
  function jwtTtlSeconds(jwt: string): number {
    const parts = jwt.split(".")
    if (parts.length < 2) return 60
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
        exp?: number
        iat?: number
      }
      if (typeof payload.exp === "number" && typeof payload.iat === "number") {
        const ttl = payload.exp - payload.iat
        if (ttl > 0 && ttl < 3600) return ttl
      }
    } catch {
      // not decodable — use default
    }
    return 60
  }

  // Find which credential header carries the bearer token and its prefix.
  function findAuthHeader(headers: Record<string, string>): { name: string; prefix: string } {
    for (const [name, value] of Object.entries(headers)) {
      if (/^Bearer\s+eyJ/i.test(value)) return { name, prefix: "Bearer " }
      if (JWT_RE.test(value) && !value.includes(" ")) return { name, prefix: "" }
    }
    return { name: "Authorization", prefix: "Bearer " }
  }

  /**
   * Build a refresh recipe for a credential by locating its token-mint request
   * among captured traffic. Returns undefined when no minting endpoint is found.
   */
  export function derive(sessionID: string, credentialID: string): Recipe | undefined {
    const cred = WebCredential.getById(credentialID)
    if (!cred) return undefined

    const auth = findAuthHeader(cred.headers ?? {})

    const requests = Request.get(sessionID)
    // Prefer requests tagged with this credential, then any request in the
    // session. Most-recent first so we replay the freshest mint endpoint.
    const tagged = requests.filter((r) => r.credential_id === credentialID)
    const pool = (tagged.length > 0 ? tagged : requests)
      .slice()
      .sort((a, b) => b.time.created - a.time.created)

    for (const req of pool) {
      if (!req.raw_request || !req.processed_response) continue
      const ct = req.response_content_type ?? ""
      if (!ct.includes("json") && !req.processed_response.trimStart().startsWith("{")) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(req.processed_response)
      } catch {
        continue
      }

      const jwt = findJwtPath(parsed, "")
      if (!jwt) continue

      const recipe: Recipe = {
        auth_type: "bearer",
        ttl_seconds: jwtTtlSeconds(jwt.value),
        steps: [
          {
            request_id: req.id,
            extract: { json: [{ path: jwt.path, as: "token" }] },
          },
        ],
        credential_map: { [auth.name]: `${auth.prefix}{{token}}` },
      }
      return recipe
    }

    return undefined
  }
}
