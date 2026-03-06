import z from "zod"
import { Tool } from "./tool"
import { WebObject } from "../session/web/web-object"
import { Session } from "../session"

const description = `Record a data object (entity) discovered during web application analysis.

Use this tool when you discover data entities in request/response such as:
- User, Account, Profile
- Order, Cart, Product
- Comment, Post, Article
- Session, Token, Permission

The tool will:
1. Store the object with its fields
2. Track sensitive fields (password, token, secret, etc.)
3. Track ID fields for IDOR testing
4. Merge with existing object if already discovered (adds new fields)

Examples of field categorization:
- Regular fields: name, email, description, created_at
- Sensitive fields: password, token, secret, api_key, ssn
- ID fields: id, user_id, order_id, product_id`

export const WebWriteObjectTool = Tool.define("web_write_object", {
  description,
  parameters: z.object({
    name: z.string().describe("Name of the object/entity (e.g., 'User', 'Order', 'Product')"),
    fields: z.array(z.string()).optional().describe("List of field names discovered"),
    sensitive_fields: z
      .array(z.string())
      .optional()
      .describe("Fields containing sensitive data (password, token, etc.)"),
    id_fields: z.array(z.string()).optional().describe("Fields that are IDs/references (id, user_id, etc.)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const object = WebObject.add({
      sessionID,
      name: params.name,
      fields: params.fields,
      sensitiveFields: params.sensitive_fields,
      idFields: params.id_fields,
    })

    const output = {
      object: {
        id: object.id,
        name: object.name,
        fields: object.fields,
        sensitive_fields: object.sensitive_fields,
        id_fields: object.id_fields,
      },
    }

    return {
      title: `Object: ${params.name}`,
      output: JSON.stringify(output, null, 2),
      metadata: { object },
    }
  },
})
