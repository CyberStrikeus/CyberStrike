import z from "zod"
import { Tool } from "./tool"
import { WebCredential } from "../session/web/web-credential"
import { Session } from "../session"

export const WebUpdateCredentialTool = Tool.define("web_update_credential", {
  description: `Update a credential's auth headers in the session store. Use this after minting fresh tokens via curl — write the new headers here, then use http_replay with the credential parameter to send test requests with the fresh auth. Only headers you provide are updated; other credential fields are preserved.`,
  parameters: z.object({
    credential_id: z.string().describe("The credential ID to update (from web_get_session_context)"),
    headers: z
      .record(z.string(), z.string())
      .describe(
        'Auth headers to set on this credential (e.g. {"Cookie": "__session=eyJ...", "Authorization": "Bearer ..."}). Replaces the credential\'s stored headers entirely.',
      ),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)

    const existing = WebCredential.getById(params.credential_id)
    if (!existing) {
      return {
        title: "web_update_credential: not found",
        output: `Credential "${params.credential_id}" does not exist. Use web_get_session_context to list available credentials.`,
        metadata: { updated: false },
      }
    }

    if (existing.session_id !== sessionID) {
      return {
        title: "web_update_credential: wrong session",
        output: `Credential "${params.credential_id}" belongs to a different session.`,
        metadata: { updated: false },
      }
    }

    const updated = WebCredential.update({
      id: params.credential_id,
      sessionID,
      headers: params.headers,
    })

    if (!updated) {
      return {
        title: "web_update_credential: update failed",
        output: `Failed to update credential "${params.credential_id}".`,
        metadata: { updated: false },
      }
    }

    const headerKeys = Object.keys(params.headers)
    return {
      title: `Updated credential "${existing.label}" headers`,
      output: JSON.stringify(
        {
          credential_id: params.credential_id,
          label: existing.label,
          headers_updated: headerKeys,
          hint: `Use http_replay with credential: "${params.credential_id}" to send requests with these headers.`,
        },
        null,
        2,
      ),
      metadata: { updated: true },
    }
  },
})
