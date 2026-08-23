import z from "zod"
import { Tool } from "./tool"
import { WebCredential } from "../session/web/web-credential"
import { Recipe } from "../session/web/credential-recipe"
import { Session } from "../session"
import { Request } from "../session/request"

const RECIPE_DESC = `Save a credential refresh recipe to a credential. The recipe describes how to mint fresh auth tokens by replaying a sequence of captured requests — the engine executes it automatically on 401 to refresh expired credentials.

## Recipe format

A recipe has:
- **auth_type**: "bearer" | "cookie" | "jwt_cookie" | "api_key" | "oauth" | "custom"
- **ttl_seconds** (optional): expected credential lifetime for proactive refresh
- **steps[]**: ordered HTTP requests that produce fresh tokens. Each step:
  - **request_id**: captured request to replay (from web_get_session_context)
  - **mutations** (optional): field-level changes before sending
  - **override_body** (optional): replace the body entirely
  - **inject** (optional): inject values from previous steps — cookies (boolean), headers ({"X-CSRF": "{{var}}"}), body_fields ({"csrf": "{{var}}"})
  - **extract** (optional): what to extract from the response:
    - set_cookies: true | ["session_id", "csrf"] — extract Set-Cookie headers
    - headers: ["X-Token"] — extract response headers
    - json: [{path: "access_token", as: "token"}] — extract from JSON body
    - regex: [{pattern: "name=\\"csrf\\" value=\\"([^\"]+)\\"", group: 1, as: "csrf"}] — extract via regex
- **credential_map**: template mapping extracted values to credential headers. Use {{variable}} syntax.
  Special: {{cookies}} expands to all accumulated Set-Cookie values.

## Examples

Simple cookie login:
\`\`\`json
{
  "auth_type": "cookie",
  "ttl_seconds": 3600,
  "steps": [{"request_id": "req_login", "extract": {"set_cookies": true}}],
  "credential_map": {"Cookie": "{{cookies}}"}
}
\`\`\`

OAuth token refresh:
\`\`\`json
{
  "auth_type": "oauth",
  "ttl_seconds": 3600,
  "steps": [{"request_id": "req_token", "extract": {"json": [{"path": "access_token", "as": "token"}]}}],
  "credential_map": {"Authorization": "Bearer {{token}}"}
}
\`\`\`

CSRF + cookie login:
\`\`\`json
{
  "auth_type": "cookie",
  "steps": [
    {"request_id": "req_login_page", "extract": {"regex": [{"pattern": "name=\\"_csrf\\" value=\\"([^\"]+)\\"", "group": 1, "as": "csrf"}], "set_cookies": true}},
    {"request_id": "req_login_post", "inject": {"cookies": true, "body_fields": {"_csrf": "{{csrf}}"}}, "extract": {"set_cookies": true}}
  ],
  "credential_map": {"Cookie": "{{cookies}}"}
}
\`\`\``

export const CredentialSetRecipeTool = Tool.define("credential_set_recipe", {
  description: RECIPE_DESC,
  parameters: z.object({
    credential_id: z.string().describe("Credential ID to attach the recipe to (from web_get_session_context)"),
    recipe: Recipe.describe("The refresh recipe — see description for format and examples"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)

    const existing = WebCredential.getById(params.credential_id)
    if (!existing) {
      return {
        title: "credential_set_recipe: not found",
        output: `Credential "${params.credential_id}" does not exist. Use web_get_session_context to list credentials.`,
        metadata: { saved: false },
      }
    }

    if (existing.session_id !== sessionID) {
      return {
        title: "credential_set_recipe: wrong session",
        output: `Credential "${params.credential_id}" belongs to a different session.`,
        metadata: { saved: false },
      }
    }

    const requests = Request.get(sessionID)
    const missing = params.recipe.steps
      .map((s, i) => ({ idx: i, id: s.request_id }))
      .filter((s) => !requests.some((r) => r.id === s.id))

    if (missing.length > 0) {
      return {
        title: "credential_set_recipe: invalid request_id",
        output: `Recipe references request(s) not in this session: ${missing.map((m) => `step ${m.idx}: "${m.id}"`).join(", ")}. Use web_get_session_context to find valid request IDs.`,
        metadata: { saved: false },
      }
    }

    const result = WebCredential.setRecipe({
      id: params.credential_id,
      sessionID,
      recipe: params.recipe,
    })

    if (!result) {
      return {
        title: "credential_set_recipe: save failed",
        output: `Failed to save recipe for credential "${params.credential_id}".`,
        metadata: { saved: false },
      }
    }

    const stepSummary = params.recipe.steps.map((s, i) => `  Step ${i}: ${s.request_id}`).join("\n")

    return {
      title: `Recipe saved for "${existing.label}"`,
      output: JSON.stringify(
        {
          credential_id: params.credential_id,
          label: existing.label,
          auth_type: params.recipe.auth_type,
          ttl_seconds: params.recipe.ttl_seconds ?? null,
          steps: params.recipe.steps.length,
          credential_map_keys: Object.keys(params.recipe.credential_map),
          step_summary: stepSummary,
          effect: "http_replay will auto-refresh this credential on 401 by replaying this recipe.",
        },
        null,
        2,
      ),
      metadata: { saved: true },
    }
  },
})
