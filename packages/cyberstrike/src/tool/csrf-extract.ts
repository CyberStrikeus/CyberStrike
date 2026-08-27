import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Request } from "../session/request"
import { WebCredential, COMMON_AUTH_HEADERS } from "../session/web/web-credential"
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

export const CsrfExtractTool = Tool.define("csrf_extract", {
  description: `Fetch a page and extract a CSRF token from the response. Replays a captured GET request, then extracts the token using one of: regex pattern matching on the body, a response header name, or a Set-Cookie name.

Use this to:
- Get a fresh CSRF token before sending a state-changing request
- Verify CSRF token rotation (fetch twice, compare)
- Extract anti-CSRF tokens from login/form pages before submitting a state-changing form`,
  parameters: z.object({
    request_id: z.string().describe("Captured GET request that serves the page containing the CSRF token"),
    credential_id: z
      .string()
      .optional()
      .describe("Credential ID to inject auth headers — needed when the CSRF page requires authentication"),
    extract_from: z
      .enum(["body", "header", "cookie"])
      .describe("Where to find the CSRF token: body (HTML/JSON), header, or cookie"),
    name: z
      .string()
      .describe(
        'What to look for — regex pattern (body), header name (header), or cookie name (cookie). For body regex, use a capture group: e.g. name="_token" value="([^"]+)"',
      ),
    group: z
      .number()
      .optional()
      .default(1)
      .describe("Regex capture group index (default 1, only used when extract_from=body)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)

    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request?.raw_request) {
      return {
        title: "csrf_extract: request not found",
        output: `Request "${params.request_id}" not found or has no raw data.`,
        metadata: { extracted: false },
      }
    }

    const origin = originFromRequest(request)
    if (!origin) {
      return {
        title: "csrf_extract: no origin",
        output: `Cannot determine origin from request "${params.request_id}".`,
        metadata: { extracted: false },
      }
    }

    let msg: HttpMessage.Request
    try {
      msg = HttpMessage.parse(request.raw_request)
    } catch (e) {
      return {
        title: "csrf_extract: parse error",
        output: `Could not parse request: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { extracted: false },
      }
    }

    if (params.credential_id) {
      const cred = WebCredential.getById(params.credential_id)
      if (!cred) {
        return {
          title: "csrf_extract: credential not found",
          output: `Credential "${params.credential_id}" not found.`,
          metadata: { extracted: false },
        }
      }
      for (const h of COMMON_AUTH_HEADERS) {
        msg = Mutate.removeHeader(msg, h)
      }
      for (const [name, value] of Object.entries(cred.headers)) {
        msg = Mutate.setHeader(msg, name, value)
      }
    }

    const result = await BackendFetch.send(msg, {
      origin,
      totalTimeoutMs: 15000,
      followRedirects: true,
      signal: ctx.abort,
    })

    if (result.error) {
      return {
        title: "csrf_extract: send error",
        output: `Request failed: ${result.error.message}`,
        metadata: { extracted: false },
      }
    }

    const res = result.response!

    let token: string | undefined

    if (params.extract_from === "body") {
      const bodyText = new TextDecoder().decode(res.body)
      try {
        const match = bodyText.match(new RegExp(params.name))
        if (match) {
          const group = params.group ?? 1
          token = match[group]
        }
      } catch (e) {
        return {
          title: "csrf_extract: invalid regex",
          output: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`,
          metadata: { extracted: false },
        }
      }
    } else if (params.extract_from === "header") {
      const found = res.headers.find((h) => h.name.toLowerCase() === params.name.toLowerCase())
      if (found) token = found.value
    } else if (params.extract_from === "cookie") {
      for (const h of res.headers) {
        if (h.name.toLowerCase() !== "set-cookie") continue
        const eqIdx = h.value.indexOf("=")
        if (eqIdx < 1) continue
        const cookieName = h.value.slice(0, eqIdx).trim()
        if (cookieName === params.name) {
          const rest = h.value.slice(eqIdx + 1)
          const semiIdx = rest.indexOf(";")
          token = semiIdx >= 0 ? rest.slice(0, semiIdx).trim() : rest.trim()
          break
        }
      }
    }

    if (!token) {
      return {
        title: "csrf_extract: not found",
        output: JSON.stringify(
          {
            extracted: false,
            extract_from: params.extract_from,
            name: params.name,
            status: res.status,
            body_len: res.body.length,
            hint:
              params.extract_from === "body"
                ? "Regex did not match. Check the pattern or inspect the response body with http_replay."
                : `No ${params.extract_from} named "${params.name}" in response.`,
          },
          null,
          2,
        ),
        metadata: { extracted: false },
      }
    }

    return {
      title: `CSRF token extracted (${params.extract_from})`,
      output: JSON.stringify(
        {
          extracted: true,
          token,
          extract_from: params.extract_from,
          name: params.name,
          hint: `Use this token in http_replay mutations: {op: "set-header", name: "X-CSRF-Token", value: "${token}"} or {op: "body-set-field", name: "_token", value: "${token}"}`,
        },
        null,
        2,
      ),
      metadata: { extracted: true },
    }
  },
})
