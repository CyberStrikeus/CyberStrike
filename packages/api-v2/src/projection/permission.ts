import type { PermissionInput } from "./types"

// Upstream's permission request carries one action and its resources. v1 splits that across permission + patterns.
export function projectPermission(request: PermissionInput) {
  return {
    id: request.id,
    sessionID: request.sessionID,
    action: request.permission,
    resources: request.patterns,
    metadata: request.metadata,
  }
}
