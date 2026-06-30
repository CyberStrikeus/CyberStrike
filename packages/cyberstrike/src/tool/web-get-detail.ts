import z from "zod"
import { Tool } from "./tool"
import { WebObject } from "../session/web/web-object"
import { WebFunction } from "../session/web/web-function"
import { WebRole } from "../session/web/web-role"
import { WebCredential } from "../session/web/web-credential"
import { Session } from "../session"

const description = `Fetch FULL detail for ONE discovered entity by name or id.

web_get_session_context gives you a bounded view scoped to your endpoint (the "recent" block) plus a NAME-only "catalog" of everything else. Use this tool to pull full detail for a catalog entry you need beyond your endpoint — e.g.:
- kind "object": full schema (fields, sensitive_fields, id_fields) + ALL observed values with the credential that saw each (cross-endpoint IDOR substrate).
- kind "function" / "role" / "credential": the full record.

(For a request's headers/body/response use web_get_request_detail instead.)
You normally do NOT need this for your own endpoint — its objects/values are already in the "recent" block of your context.`

export const WebGetDetailTool = Tool.define("web_get_detail", {
  description,
  parameters: z.object({
    kind: z.enum(["object", "function", "role", "credential"]),
    id: z.string().describe("Name (for object/function/role) or id of the entity to fetch"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    let detail: unknown
    switch (params.kind) {
      case "object": {
        const obj = WebObject.getByName(sessionID, params.id) ?? WebObject.getById(params.id)
        if (obj && obj.session_id === sessionID) {
          detail = {
            name: obj.name,
            fields: obj.fields,
            sensitive_fields: obj.sensitive_fields,
            id_fields: obj.id_fields,
            values: WebObject.getValues(obj.id).map((v) => ({
              field: v.field_name,
              value: v.value,
              credential_id: v.credential_id,
            })),
          }
        }
        break
      }
      case "function": {
        const fn = WebFunction.get(sessionID).find((f) => f.name === params.id || f.id === params.id)
        if (fn)
          detail = {
            name: fn.name,
            action_type: fn.action_type,
            request_id: fn.request_id,
            objects: fn.objects,
            role_id: fn.role_id,
          }
        break
      }
      case "role": {
        const role = WebRole.get(sessionID).find((r) => r.name === params.id || r.id === params.id)
        if (role) detail = { name: role.name, level: role.level }
        break
      }
      case "credential": {
        const cred = WebCredential.get(sessionID).find((c) => c.id === params.id || c.label === params.id)
        if (cred) detail = { id: cred.id, label: cred.label, headers: cred.headers, role_id: cred.role_id }
        break
      }
    }
    return {
      title: `Detail: ${params.kind} ${params.id}`,
      output: detail ? JSON.stringify(detail, null, 2) : `No ${params.kind} found for "${params.id}" in this session.`,
      metadata: {},
    }
  },
})
