import z from "zod"
import { Tool } from "./tool"
import { Request } from "../session/request"
import { Session } from "../session"

const description = `Get detailed information for a specific HTTP request by ID.

Returns the full HTTP request including headers, body, and response data for a single endpoint.

Use this when you need to examine a specific request in detail (e.g., to analyze parameters for testing).
For overview of all requests, use web_get_session_context with include: ["requests"].`

export const WebGetRequestDetailTool = Tool.define("web_get_request_detail", {
  description,
  parameters: z.object({
    request_id: z.string().describe("The ID of the request to retrieve"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const requests = Request.get(sessionID)
    const request = requests.find((r) => r.id === params.request_id)

    if (!request) {
      return {
        title: "Request Not Found",
        output: `Request with ID "${params.request_id}" not found in session context.`,
        metadata: {},
      }
    }

    const detail = {
      id: request.id,
      method: request.method,
      normalized_path: request.normalized_path,
      raw_request: request.raw_request ?? "",
      status: request.status,
      credential_id: request.credential_id ?? null,
      body_hash: request.body_hash ?? null,
      query_hash: request.query_hash ?? null,
      response: {
        status: request.response_status ?? null,
        headers: request.response_headers ?? null,
        content_type: request.response_content_type ?? null,
        size: request.response_size ?? null,
        processed: request.processed_response ?? null,
      },
      time: request.time,
    }

    return {
      title: `Request Detail: ${request.method} ${request.normalized_path}`,
      output: JSON.stringify(detail, null, 2),
      metadata: {},
    }
  },
})
