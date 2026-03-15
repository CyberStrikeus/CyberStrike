import z from "zod"
import { Tool } from "./tool"
import { WebCredential } from "../session/web/web-credential"
import { WebRole } from "../session/web/web-role"
import { WebObject } from "../session/web/web-object"
import { WebFunction } from "../session/web/web-function"
import { WebRetest } from "../session/web/web-retest"
import { Request } from "../session/request"
import { Session } from "../session"

const description = `Get the current web application context for this session.

Returns discovered information about:
- Credentials: Authentication tokens and their claims (included by default)
- Roles: User roles and hierarchy (included by default)
- Objects: Data entities and their fields (included by default)
- Functions: Endpoint-to-function mappings (included by default)
- Retest Queue: Pending re-tests triggered by new discoveries (optional, use include parameter)
- Requests: Analyzed endpoints summary (optional, use include parameter - returns only id, method, path, status)

By default, returns: credentials, roles, objects, functions.
Use the 'include' parameter to specify exactly which sections you need.

For detailed request information (headers, body, response), use the web_get_request_detail tool with a specific request ID.

Use this to understand the application architecture before planning tests.`

export const WebGetSessionContextTool = Tool.define("web_get_session_context", {
  description,
  parameters: z.object({
    include: z
      .array(z.enum(["credentials", "roles", "objects", "functions", "retest_queue", "requests"]))
      .optional()
      .describe(
        "Specific sections to include. Default: ['credentials', 'roles', 'objects', 'functions']. " +
          "Add 'retest_queue' or 'requests' only if needed. Note: 'requests' returns only summary (id, method, path, status), not full request details.",
      ),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const include = params.include ?? ["credentials", "roles", "objects", "functions"]

    const context: Record<string, unknown> = {}

    if (include.includes("credentials")) {
      const credentials = WebCredential.get(sessionID)
      context.credentials = {
        count: credentials.length,
        items: credentials.map((c) => ({
          id: c.id,
          label: c.label,
          headers: c.headers,
          container_id: c.container_id,
          role_id: c.role_id,
        })),
      }
    }

    if (include.includes("roles")) {
      const roles = WebRole.get(sessionID)
      context.roles = {
        count: roles.length,
        items: roles.map((r) => ({
          id: r.id,
          name: r.name,
          level: r.level,
        })),
      }
    }

    if (include.includes("objects")) {
      const objects = WebObject.get(sessionID)
      const allValues = WebObject.getAllValues(sessionID)

      context.objects = {
        count: objects.length,
        items: objects.map((o) => {
          const values = allValues.filter((v) => v.object_id === o.id)
          return {
            id: o.id,
            name: o.name,
            fields: o.fields,
            sensitive_fields: o.sensitive_fields,
            id_fields: o.id_fields,
            discovered_values: values.map((v) => ({
              field: v.field_name,
              value: v.value,
              credential_id: v.credential_id,
            })),
          }
        }),
      }
    }

    if (include.includes("functions")) {
      const functions = WebFunction.get(sessionID)
      context.functions = {
        count: functions.length,
        items: functions.map((f) => ({
          id: f.id,
          name: f.name,
          action_type: f.action_type,
          request_id: f.request_id,
          role_id: f.role_id,
          objects: f.objects,
        })),
      }
    }

    if (include.includes("retest_queue")) {
      const queue = WebRetest.getPending(sessionID)
      const counts = WebRetest.count(sessionID)
      context.retest_queue = {
        pending: counts.pending,
        processing: counts.processing,
        completed: counts.completed,
        items: queue.slice(0, 10).map((r) => ({
          id: r.id,
          request_id: r.request_id,
          trigger_type: r.trigger_type,
          priority: r.priority,
        })),
      }
    }

    if (include.includes("requests")) {
      const requests = Request.get(sessionID)
      context.requests = {
        count: requests.length,
        items: requests.map((r) => ({
          id: r.id,
          method: r.method,
          path: r.normalized_path,
          status: r.status,
        })),
      }
    }

    // Summary
    context.summary = {
      total_credentials: include.includes("credentials") ? (context.credentials as { count: number }).count : undefined,
      total_roles: include.includes("roles") ? (context.roles as { count: number }).count : undefined,
      total_objects: include.includes("objects") ? (context.objects as { count: number }).count : undefined,
      total_functions: include.includes("functions") ? (context.functions as { count: number }).count : undefined,
      pending_retests: include.includes("retest_queue")
        ? (context.retest_queue as { pending: number }).pending
        : undefined,
      total_requests: include.includes("requests") ? (context.requests as { count: number }).count : undefined,
    }

    return {
      title: "Web Session Context",
      output: JSON.stringify(context, null, 2),
      metadata: { context },
    }
  },
})
