import type { SessionApi, SessionInfo, SessionListInput } from "@cyberstrike-io/client/promise"
import type { Session } from "@cyberstrike-io/sdk/v2/client"
import { withTimestampedFallback } from "./session-title"

export function normalizeSessionInfo(input: SessionInfo | Session): Session {
  if (!("location" in input)) return input
  return {
    id: input.id,
    slug: input.id,
    projectID: input.projectID,
    directory: input.location.directory,
    parentID: input.parentID,
    title: withTimestampedFallback(input),
    version: "",
    time: input.time,
    revert: input.revert && {
      messageID: input.revert.messageID,
      partID: input.revert.partID,
      snapshot: input.revert.snapshot,
    },
  }
}

export async function listAllSessions(api: Pick<SessionApi, "list">, input: Omit<SessionListInput, "cursor">) {
  const load = async (cursor?: string): Promise<Session[]> => {
    const result = await api.list({ ...input, limit: input.limit ?? 100, cursor })
    const sessions = result.data.map(normalizeSessionInfo)
    if (result.data.length === 0 || !result.cursor.next) return sessions
    return [...sessions, ...(await load(result.cursor.next))]
  }
  return load()
}
