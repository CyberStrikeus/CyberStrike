import type { SessionInput } from "./types"
import { compact } from "./compact"

// Encoded wire shape of upstream's Session.Info. Timestamps are epoch millis; the handler decodes this through
// the upstream schema, so a projection bug surfaces as a schema error at the boundary.
export function projectSession(info: SessionInput) {
  return compact({
    id: info.id,
    projectID: info.projectID,
    title: info.title,
    parentID: info.parentID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: compact({
      created: info.time.created,
      updated: info.time.updated,
      archived: info.time.archived,
    }),
    location: { directory: info.directory },
    revert: info.revert && compact({ ...info.revert }),
  })
}
