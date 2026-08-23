import z from "zod"
import { Tool } from "./tool"
import { WebCredential, COMMON_AUTH_HEADERS } from "../session/web/web-credential"
import { Session } from "../session"
import { Request } from "../session/request"
import { HttpMessage } from "../replay/message"
import { Mutate } from "../replay/mutate"
import { BackendFetch } from "../replay/backend-fetch"

function originFromRequest(req: Request.Info): string | undefined {
  if (req.origin) return req.origin.replace(/\/+$/, "")
  if (!req.host) return undefined
  const scheme = req.scheme ?? "http"
  const port = req.port ? `:${req.port}` : ""
  return `${scheme}://${req.host}${port}`
}

export const CredentialValidateTool = Tool.define("credential_validate", {
  description: `Check whether a credential is still valid by sending a test request and inspecting the response status. Sends the captured request with the credential's auth headers and reports whether the server accepted (2xx/3xx) or rejected (401/403) the credentials.

Use this to:
- Verify credentials are still live before starting a test run
- Check if a credential needs refreshing (use credential_mint if invalid)
- Compare multiple credentials' validity`,
  parameters: z.object({
    credential_id: z.string().describe("Credential ID to validate"),
    request_id: z
      .string()
      .describe(
        "Captured request to send as the test probe. Pick a lightweight authenticated endpoint (e.g. GET /api/me, GET /dashboard).",
      ),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)

    const cred = WebCredential.getById(params.credential_id)
    if (!cred) {
      return {
        title: "credential_validate: not found",
        output: `Credential "${params.credential_id}" does not exist.`,
        metadata: { valid: false },
      }
    }

    if (cred.session_id !== sessionID) {
      return {
        title: "credential_validate: wrong session",
        output: `Credential "${params.credential_id}" belongs to a different session.`,
        metadata: { valid: false },
      }
    }

    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request?.raw_request) {
      return {
        title: "credential_validate: request not found",
        output: `Request "${params.request_id}" not found or has no raw data.`,
        metadata: { valid: false },
      }
    }

    const origin = originFromRequest(request)
    if (!origin) {
      return {
        title: "credential_validate: no origin",
        output: `Cannot determine origin from request "${params.request_id}".`,
        metadata: { valid: false },
      }
    }

    let msg: HttpMessage.Request
    try {
      msg = HttpMessage.parse(request.raw_request)
    } catch (e) {
      return {
        title: "credential_validate: parse error",
        output: `Could not parse request: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { valid: false },
      }
    }

    for (const h of COMMON_AUTH_HEADERS) {
      msg = Mutate.removeHeader(msg, h)
    }
    for (const [name, value] of Object.entries(cred.headers)) {
      msg = Mutate.setHeader(msg, name, value)
    }

    try {
      const result = await BackendFetch.send(msg, {
        origin,
        totalTimeoutMs: 15000,
        signal: ctx.abort,
      })

      if (result.error) {
        return {
          title: "credential_validate: send error",
          output: `Request failed: ${result.error.message}`,
          metadata: { valid: false },
        }
      }

      const status = result.response!.status
      const valid = status >= 200 && status < 400

      return {
        title: `credential_validate: ${valid ? "valid" : "invalid"} (${status})`,
        output: JSON.stringify(
          {
            credential_id: params.credential_id,
            label: cred.label,
            valid,
            status,
            timing_ms: Math.round(result.timing.totalMs),
            has_recipe: !!cred.recipe,
            hint: valid
              ? "Credential is still accepted by the server."
              : cred.recipe
                ? "Credential rejected. Use credential_mint to refresh it using the saved recipe."
                : "Credential rejected. No recipe saved — use credential_set_recipe to create one, then credential_mint.",
          },
          null,
          2,
        ),
        metadata: { valid, status },
      }
    } catch (e) {
      return {
        title: "credential_validate: error",
        output: `Validation failed: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { valid: false },
      }
    }
  },
})
