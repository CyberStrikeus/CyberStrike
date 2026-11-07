// Verification token store (#72). Code-enforced gate that prevents triage from
// marking a finding as "triaged" without first replaying its HTTP evidence.
//
// Flow:
//   1. http_replay tool calls Verification.record() after a successful replay
//      → produces a token (SHA-256 of session + request_id + response status + body prefix)
//      → token is returned to the agent in the tool result
//   2. triage_vulnerability tool calls Verification.validate() on draft→triaged transitions
//      → checks the token exists and was produced from one of the finding's evidence_request_ids
//      → rejects the transition if the token is missing or invalid
//
// The store is in-memory (Map keyed by session ID). Triage runs in a short-lived
// child session and tokens only need to survive that session's lifetime.

import { createHash } from "node:crypto"

const SECRET = createHash("sha256")
  .update(`cyberstrike-verification-${process.pid}-${Date.now()}`)
  .digest("hex")

interface TokenRecord {
  requestId: string
  status: number
  bodyPrefix: string
  time: number
}

const store = new Map<string, Map<string, TokenRecord>>()

function sessionStore(sessionID: string): Map<string, TokenRecord> {
  let s = store.get(sessionID)
  if (!s) {
    s = new Map()
    store.set(sessionID, s)
  }
  return s
}

function makeToken(sessionID: string, requestId: string, status: number, bodyPrefix: string): string {
  return createHash("sha256")
    .update(`${SECRET}:${sessionID}:${requestId}:${status}:${bodyPrefix}`)
    .digest("hex")
    .slice(0, 32)
}

export namespace Verification {
  export function record(input: {
    sessionID: string
    requestId: string
    responseStatus: number
    bodyPrefix: string
  }): string {
    const token = makeToken(input.sessionID, input.requestId, input.responseStatus, input.bodyPrefix)
    sessionStore(input.sessionID).set(token, {
      requestId: input.requestId,
      status: input.responseStatus,
      bodyPrefix: input.bodyPrefix,
      time: Date.now(),
    })
    return token
  }

  export interface ValidateResult {
    valid: boolean
    replayedRequestId?: string
    reason?: string
  }

  export function validate(input: {
    sessionID: string
    token: string
    evidenceRequestIds: string[]
  }): ValidateResult {
    const s = store.get(input.sessionID)
    if (!s) return { valid: false, reason: "No replay records found for this session." }
    const rec = s.get(input.token)
    if (!rec) return { valid: false, reason: "Token not found — replay http_replay first to get a valid token." }
    if (!input.evidenceRequestIds.includes(rec.requestId)) {
      return {
        valid: false,
        reason: `Token was produced from request "${rec.requestId}" which is not in this finding's evidence_request_ids [${input.evidenceRequestIds.join(", ")}].`,
      }
    }
    return { valid: true, replayedRequestId: rec.requestId }
  }

  export function hasAnyReplay(sessionID: string): boolean {
    const s = store.get(sessionID)
    return !!s && s.size > 0
  }

  export function clear(sessionID: string): void {
    store.delete(sessionID)
  }
}
