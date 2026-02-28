import z from "zod"
import { Tool } from "./tool"
import { WebFunction } from "../session/web/web-function"
import { WebRole } from "../session/web/web-role"
import { WebObject } from "../session/web/web-object"
import { Session } from "../session"

const description = `Record an application function (endpoint purpose) discovered during analysis.

Use this tool to map what each endpoint does:
- Create_User, Get_User, Update_User, Delete_User
- List_Orders, Place_Order, Cancel_Order
- Login, Logout, Register, Reset_Password

This creates a function-to-endpoint mapping that helps with:
- Understanding application structure
- Identifying authorization requirements
- Planning business logic tests
- Detecting missing access controls

Action types:
- create: POST endpoints that create resources
- read: GET endpoints that retrieve data
- update: PUT/PATCH endpoints that modify resources
- delete: DELETE endpoints that remove resources`

export const WebWriteFunctionTool = Tool.define("web_write_function", {
  description,
  parameters: z.object({
    name: z.string().describe("Descriptive function name (e.g., 'Create_Order', 'Get_User_Profile')"),
    action_type: z.enum(["create", "read", "update", "delete"]).describe("Type of action this endpoint performs"),
    request_id: z.string().describe("ID of the request/endpoint this function maps to"),
    role_name: z.string().optional().describe("Role required to access this function (if known)"),
    object_names: z.array(z.string()).optional().describe("Objects this function operates on"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    let roleID: string | undefined
    if (params.role_name) {
      const role = WebRole.getByName(sessionID, params.role_name)
      roleID = role?.id
    }

    let objectIDs: string[] | undefined
    if (params.object_names?.length) {
      objectIDs = params.object_names
        .map((name) => WebObject.getByName(sessionID, name)?.id)
        .filter((id): id is string => !!id)
    }

    const func = WebFunction.add({
      sessionID,
      name: params.name,
      actionType: params.action_type,
      requestID: params.request_id,
      roleID,
      objects: objectIDs,
    })

    const output = {
      function: {
        id: func.id,
        name: func.name,
        action_type: func.action_type,
        request_id: func.request_id,
        role_id: func.role_id,
        objects: func.objects,
      },
    }

    return {
      title: `Function: ${params.name} (${params.action_type})`,
      output: JSON.stringify(output, null, 2),
      metadata: { function: func },
    }
  },
})
