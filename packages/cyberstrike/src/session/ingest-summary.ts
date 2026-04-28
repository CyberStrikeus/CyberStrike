import { Identifier } from "../id/id"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { WebFunction } from "./web/web-function"
import { WebObject } from "./web/web-object"
import { WebRole } from "./web/web-role"
import { WebCredential } from "./web/web-credential"
import { Vulnerability } from "./vulnerability"

export namespace IngestSummary {
  export const KIND = "ingest-summary"

  export interface Snapshot {
    functions: number
    objects: number
    roles: number
    credentials: number
    vulnerabilities: number
  }

  export function snapshot(sessionID: string): Snapshot {
    return {
      functions: WebFunction.get(sessionID).length,
      objects: WebObject.get(sessionID).length,
      roles: WebRole.get(sessionID).length,
      credentials: WebCredential.get(sessionID).length,
      vulnerabilities: Vulnerability.get(sessionID).length,
    }
  }

  const LABELS: Record<keyof Snapshot, string> = {
    functions: "function",
    objects: "object",
    roles: "role",
    credentials: "credential",
    vulnerabilities: "vulnerability",
  }

  export function formatDelta(before: Snapshot, after: Snapshot): string | null {
    const parts: string[] = []
    for (const key of Object.keys(LABELS) as (keyof Snapshot)[]) {
      const delta = after[key] - before[key]
      if (delta === 0) continue
      const sign = delta > 0 ? "+" : ""
      parts.push(`${sign}${delta} ${LABELS[key]}`)
    }
    return parts.length > 0 ? parts.join(", ") : null
  }

  export interface WriteInput {
    sessionID: string
    agent: string
    model: { providerID: string; modelID: string }
    source: string
    before: Snapshot
    after: Snapshot
  }

  export async function write(input: WriteInput): Promise<void> {
    const delta = formatDelta(input.before, input.after)
    if (!delta) return

    const messageID = Identifier.ascending("message")
    await Session.updateMessage({
      id: messageID,
      role: "user",
      sessionID: input.sessionID,
      time: { created: Date.now() },
      agent: input.agent,
      model: input.model,
    })
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID,
      sessionID: input.sessionID,
      type: "text",
      text: `Ingest processed: ${input.source} — ${delta}`,
      time: { start: Date.now(), end: Date.now() },
      metadata: { kind: KIND },
    })
  }
}
