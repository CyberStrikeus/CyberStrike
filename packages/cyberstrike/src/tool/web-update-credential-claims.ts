import z from "zod"
import { Tool } from "./tool"
import { WebCredential } from "../session/web/web-credential"
import { WebRole } from "../session/web/web-role"
import { Session } from "../session"

const description = `Link an existing credential to a discovered role.

IMPORTANT: You CANNOT create new credentials. Credentials are managed by the browser extension only.

Use this tool when:
- You identify the role associated with a credential (from JWT claims, response data, etc.)
- You want to link a credential to a discovered role

The credential MUST already exist in the session (created by the browser extension).
If the credential_id is not found or belongs to a different session, the operation will fail.`

export const WebUpdateCredentialClaimsTool = Tool.define("web_update_credential_claims", {
  description,
  parameters: z.object({
    credential_id: z.string().describe("The ID of the existing credential to update (provided in credential context)"),
    role_name: z.string().describe("Name of the role to link to this credential (will be created if doesn't exist)"),
    role_level: z.number().optional().describe("Hierarchy level of the role (higher = more privileges)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)

    // Verify credential exists
    const existing = WebCredential.getById(params.credential_id)
    if (!existing) {
      return {
        title: "Error: Credential not found",
        output: `Credential ${params.credential_id} does not exist. Credentials can only be created by the browser extension.`,
        metadata: { updated: false },
      }
    }

    // Session kontrolü
    if (existing.session_id !== sessionID) {
      return {
        title: "Error: Credential belongs to another session",
        output: `Credential ${params.credential_id} does not belong to this session. Cannot update credentials from other sessions.`,
        metadata: { updated: false },
      }
    }

    // Create or get role
    const role = WebRole.add({
      sessionID,
      name: params.role_name,
      level: params.role_level,
      discoveredFrom: "credential_analysis",
    })

    // Link credential to role
    WebCredential.link({
      id: params.credential_id,
      roleID: role.id,
    })

    const output = {
      credential_id: params.credential_id,
      label: existing.label,
      role_linked: params.role_name,
      role_id: role.id,
      role_level: params.role_level || null,
    }

    return {
      title: `Linked credential "${existing.label}" to role "${params.role_name}"`,
      output: JSON.stringify(output, null, 2),
      metadata: { updated: true },
    }
  },
})
