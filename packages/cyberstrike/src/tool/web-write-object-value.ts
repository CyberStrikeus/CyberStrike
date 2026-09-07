import z from "zod"
import { Tool } from "./tool"
import { WebObject } from "../session/web/web-object"
import { WebRetest } from "../session/web/web-retest"
import { Session } from "../session"

const description = `Record a specific object ID value discovered during web application analysis.

Use this tool when you discover actual ID values that can be used for IDOR testing:
- User IDs: 123, abc-uuid-xyz
- Order IDs: ORD-001, 456
- Resource IDs: any identifiers found in URLs or responses

The tool will:
1. Store the value associated with its object and field
2. Track which credential discovered this value (for ownership)
3. Trigger re-tests on endpoints using this object type
4. Skip if value already exists

These values are critical for:
- IDOR testing (swap IDs between users)
- Access control testing
- Business logic testing`

export const WebWriteObjectValueTool = Tool.define("web_write_object_value", {
  description,
  parameters: z.object({
    object_name: z.string().describe("Name of the object this value belongs to (e.g., 'User', 'Order')"),
    field_name: z.string().describe("Name of the field (e.g., 'id', 'user_id')"),
    value: z.string().describe("The actual ID value discovered"),
    credential_id: z.string().optional().describe("ID of the credential used when this value was discovered"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    let object = WebObject.getByName(sessionID, params.object_name)
    if (!object) {
      object = WebObject.add({
        sessionID,
        name: params.object_name,
        idFields: [params.field_name],
      })
    }

    const result = WebObject.addValue({
      sessionID,
      objectID: object.id,
      fieldName: params.field_name,
      value: params.value,
      credentialID: params.credential_id,
    })

    let retestsQueued = 0
    if (result.isNew) {
      // A newly-discovered object value is IDOR fuel: flag every captured endpoint with it so
      // the id-manipulation specialist re-tests using it. Endpoint-dedup means each endpoint
      // holds ONE entry whose `object_value` flag accumulates the values — the specialist
      // sweeps them together instead of a separate queue row per value (the old 480-row blowup).
      retestsQueued = WebRetest.flagAll({ sessionID, type: "object_value", value: params.value, priority: "medium" })
    }

    const output = {
      object_value: {
        id: result.value.id,
        object_name: params.object_name,
        field_name: params.field_name,
        value: params.value,
      },
      is_new: result.isNew,
      retests_queued: retestsQueued,
    }

    return {
      title: `Value: ${params.object_name}.${params.field_name} = ${params.value}`,
      output: JSON.stringify(output, null, 2),
      metadata: { objectValue: result.value, isNew: result.isNew },
    }
  },
})
