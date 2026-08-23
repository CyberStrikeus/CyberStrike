import z from "zod"
import { Request } from "../request"
import { HttpMessage } from "../../replay/message"
import { Apply } from "../../replay/apply"
import { Mutate } from "../../replay/mutate"
import { BackendFetch } from "../../replay/backend-fetch"
import { Governor } from "../../replay/governor"
import { Send } from "../../replay/send"

const RecipeExtract = z.object({
  set_cookies: z
    .union([z.literal(true), z.array(z.string())])
    .optional()
    .describe("true = extract all Set-Cookie headers; string[] = only named cookies"),
  headers: z
    .array(z.string())
    .optional()
    .describe("Response header names to extract (stored as header:<name>)"),
  json: z
    .array(
      z.object({
        path: z.string().describe("Dot-delimited JSON path, e.g. 'data.access_token'"),
        as: z.string().describe("Variable name to store the extracted value under"),
      }),
    )
    .optional()
    .describe("Extract fields from a JSON response body"),
  regex: z
    .array(
      z.object({
        pattern: z.string().describe("Regex pattern to match against response body"),
        group: z.number().default(1).describe("Capture group index (default 1)"),
        as: z.string().describe("Variable name to store the match under"),
      }),
    )
    .optional()
    .describe("Extract values via regex from the response body (e.g. CSRF tokens in HTML)"),
})

const MutationRef = z.object({
  op: z.enum([
    "set-query",
    "add-query",
    "remove-query",
    "set-header",
    "add-header",
    "remove-header",
    "set-body",
    "set-method",
    "set-target",
    "body-merge",
    "body-set-field",
    "body-remove-field",
    "set-cookie",
    "remove-cookie",
    "set-path-param",
  ]),
  name: z.string().optional(),
  value: z.string().optional(),
})

const RecipeStep = z.object({
  request_id: z.string().describe("Captured request to use as template for this step"),
  mutations: z.array(MutationRef).optional().describe("Mutations to apply before sending"),
  override_body: z.string().optional().describe("Replace request body entirely"),
  inject: z
    .object({
      cookies: z
        .boolean()
        .optional()
        .describe("Carry accumulated Set-Cookie values as the Cookie header"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Template headers: {"X-CSRF-Token": "{{csrf}}"}'),
      body_fields: z
        .record(z.string(), z.string())
        .optional()
        .describe('Template body fields (JSON merge): {"_token": "{{csrf}}"}'),
    })
    .optional()
    .describe("Inject extracted values from previous steps"),
  extract: RecipeExtract.optional().describe("What to extract from this step's response"),
  follow_redirects: z.boolean().optional().describe("Follow 3xx redirects for this step"),
})

export const Recipe = z.object({
  auth_type: z.enum(["bearer", "cookie", "jwt_cookie", "api_key", "oauth", "custom"]),
  ttl_seconds: z.number().optional().describe("Expected credential lifetime — hint for proactive refresh"),
  steps: z.array(RecipeStep).min(1).describe("Ordered HTTP steps that produce fresh auth tokens"),
  credential_map: z
    .record(z.string(), z.string())
    .describe(
      'Maps extracted values to credential headers via {{variable}} templates. Example: {"Authorization": "Bearer {{token}}", "Cookie": "{{cookies}}"}',
    ),
})
export type Recipe = z.infer<typeof Recipe>

export namespace CredentialRecipe {
  export interface ExecuteOptions {
    sessionID: string
    origin: string
    signal?: AbortSignal
  }

  function resolveTemplate(template: string, bag: Record<string, string>): string {
    let unresolved = false
    const result = template.replace(/\{\{([\w:.\-]+)\}\}/g, (_, key) => {
      const val = bag[key]
      if (!val) unresolved = true
      return val ?? ""
    })
    return unresolved ? "" : result
  }

  function originFromRequest(req: { origin?: string | null; host?: string | null; scheme?: string | null; port?: number | null }): string | undefined {
    if (req.origin) return req.origin.replace(/\/+$/, "")
    if (!req.host) return undefined
    const scheme = req.scheme ?? "http"
    const port = req.port ? `:${req.port}` : ""
    return `${scheme}://${req.host}${port}`
  }

  function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
    const parts = dotPath.split(".")
    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  function parseSetCookie(headerValue: string): { name: string; value: string } | undefined {
    const idx = headerValue.indexOf("=")
    if (idx < 1) return undefined
    const name = headerValue.slice(0, idx).trim()
    const rest = headerValue.slice(idx + 1)
    const semiIdx = rest.indexOf(";")
    const value = semiIdx >= 0 ? rest.slice(0, semiIdx).trim() : rest.trim()
    return { name, value }
  }

  async function sendStep(
    msg: HttpMessage.Request,
    origin: string,
    followRedirects: boolean | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Send.Result> {
    const budget = new Governor.GlobalBudget()
    const breaker = new Governor.CircuitBreaker()
    return Send.governed(
      () =>
        BackendFetch.send(msg, {
          origin,
          followRedirects: followRedirects ?? false,
          signal,
        }),
      msg.method,
      { budget, breaker },
      {},
    )
  }

  export async function execute(
    recipe: Recipe,
    opts: ExecuteOptions,
  ): Promise<{ headers: Record<string, string>; bag: Record<string, string> }> {
    const bag: Record<string, string> = {}
    const cookieJar: Record<string, string> = {}

    for (let i = 0; i < recipe.steps.length; i++) {
      const step = recipe.steps[i]

      const request = Request.get(opts.sessionID).find((r) => r.id === step.request_id)
      if (!request?.raw_request) {
        throw new Error(`Recipe step ${i}: request "${step.request_id}" not found or has no raw data`)
      }

      let msg = HttpMessage.parse(request.raw_request)

      if (step.mutations) {
        const resolved = step.mutations.map((m) => ({
          ...m,
          value: m.value ? resolveTemplate(m.value, bag) : m.value,
        }))
        msg = Apply.mutations(msg, resolved as Apply.Mutation[])
      }

      if (step.override_body !== undefined) {
        msg = Mutate.setBody(msg, resolveTemplate(step.override_body, bag))
      }

      if (step.inject) {
        if (step.inject.cookies && Object.keys(cookieJar).length > 0) {
          const cookieValue = Object.entries(cookieJar)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ")
          msg = Mutate.setHeader(msg, "Cookie", cookieValue)
        }

        if (step.inject.headers) {
          for (const [name, template] of Object.entries(step.inject.headers)) {
            msg = Mutate.setHeader(msg, name, resolveTemplate(template, bag))
          }
        }

        if (step.inject.body_fields) {
          const ct = msg.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? ""
          const isForm = ct.includes("application/x-www-form-urlencoded")
          if (isForm) {
            const bodyStr = new TextDecoder().decode(msg.body)
            const params = new URLSearchParams(bodyStr)
            for (const [field, template] of Object.entries(step.inject.body_fields)) {
              params.set(field, resolveTemplate(template, bag))
            }
            msg = Mutate.setBody(msg, params.toString())
          } else {
            for (const [field, template] of Object.entries(step.inject.body_fields)) {
              msg = Mutate.bodySetField(msg, field, resolveTemplate(template, bag))
            }
          }
        }
      }

      const stepOrigin = originFromRequest(request) ?? opts.origin
      const result = await sendStep(msg, stepOrigin, step.follow_redirects, opts.signal)
      if (result.error) {
        throw new Error(`Recipe step ${i} failed: ${result.error.message}`)
      }
      const res = result.response!
      if (res.status >= 400) {
        throw new Error(`Recipe step ${i} returned HTTP ${res.status}`)
      }

      if (step.extract) {
        if (step.extract.set_cookies) {
          const filter = Array.isArray(step.extract.set_cookies) ? step.extract.set_cookies : null
          for (const h of res.headers) {
            if (h.name.toLowerCase() !== "set-cookie") continue
            const parsed = parseSetCookie(h.value)
            if (!parsed) continue
            if (filter && !filter.includes(parsed.name)) continue
            cookieJar[parsed.name] = parsed.value
            bag[`cookie:${parsed.name}`] = parsed.value
          }
        }

        if (step.extract.headers) {
          for (const name of step.extract.headers) {
            const found = res.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
            if (found) bag[`header:${name.toLowerCase()}`] = found.value
          }
        }

        if (step.extract.json) {
          const bodyText = new TextDecoder().decode(res.body)
          try {
            const json = JSON.parse(bodyText) as Record<string, unknown>
            for (const entry of step.extract.json) {
              const value = getNestedValue(json, entry.path)
              if (value !== undefined) bag[entry.as] = String(value)
            }
          } catch {
            // body is not JSON — skip json extraction silently
          }
        }

        if (step.extract.regex) {
          const bodyText = new TextDecoder().decode(res.body)
          for (const entry of step.extract.regex) {
            try {
              const match = bodyText.match(new RegExp(entry.pattern))
              if (match) {
                const group = entry.group ?? 1
                if (match[group] !== undefined) bag[entry.as] = match[group]
              }
            } catch {
              // invalid regex — skip silently
            }
          }
        }
      }
    }

    bag["cookies"] = Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")

    const headers: Record<string, string> = {}
    for (const [name, template] of Object.entries(recipe.credential_map)) {
      const resolved = resolveTemplate(template, bag)
      if (resolved) headers[name] = resolved
    }

    return { headers, bag }
  }
}
