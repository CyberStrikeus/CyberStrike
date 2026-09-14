import z from "zod"
import { Tool } from "./tool"
import { WebRole } from "../session/web/web-role"
import { WebInspect } from "../session/web/web-inspect"
import { Session } from "../session"

const description = `Record a user role discovered during web application analysis.

Use this tool when you discover distinct user roles in the application such as:
- admin, administrator
- user, member
- guest, anonymous
- moderator, editor
- customer, vendor

The tool will:
1. Store the role with optional hierarchy level
2. Trigger re-tests with existing credentials against all endpoints
3. Skip if role already exists (returns existing)

Hierarchy levels (optional):
- 0: Unauthenticated/Guest
- 1: Basic user
- 2: Privileged user
- 3: Admin
- Higher numbers = more privileges`

export const WebWriteRoleTool = Tool.define("web_write_role", {
  description,
  parameters: z.object({
    name: z.string().describe("Name of the role (e.g., 'admin', 'user', 'guest')"),
    level: z.number().optional().describe("Hierarchy level (0=guest, 1=user, 2=privileged, 3=admin)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const existing = WebRole.getByName(sessionID, params.name)
    if (existing) {
      if (params.level !== undefined && existing.level !== params.level) {
        WebRole.updateLevel({ id: existing.id, level: params.level })
      }
      return {
        title: `Role: ${params.name} (existing)`,
        output: JSON.stringify({ role: existing, is_new: false }, null, 2),
        metadata: { role: existing, isNew: false },
      }
    }

    const role = WebRole.add({
      sessionID,
      name: params.name,
      level: params.level,
    })

    // A new role applies session-wide for access-control retesting — but TARGETED: only endpoints
    // with an access-control surface (skip static assets), so the queue tracks real attack surface
    // instead of one retest per JS/CSS/image. Endpoint-dedup means each endpoint gets ONE queue
    // entry whose `role` flag accumulates values — no per-role duplicate rows.
    const flagged = WebInspect.flagMatching({
      sessionID,
      type: "role",
      value: role.name,
      priority: "high",
      match: WebInspect.isAccessControlSurface,
    })

    const output = {
      role: {
        id: role.id,
        name: role.name,
        level: role.level,
      },
      is_new: true,
      retests_queued: flagged,
    }

    return {
      title: `Role: ${params.name}`,
      output: JSON.stringify(output, null, 2),
      metadata: { role, isNew: true },
    }
  },
})
