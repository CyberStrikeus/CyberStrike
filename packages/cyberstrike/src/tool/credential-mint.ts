import z from "zod"
import { Tool } from "./tool"
import { WebCredential } from "../session/web/web-credential"
import { CredentialRecipe, Recipe } from "../session/web/credential-recipe"
import { Session } from "../session"
import { Request } from "../session/request"

function originFromRequests(sessionID: string, requestID: string): string | undefined {
  const req = Request.get(sessionID).find((r) => r.id === requestID)
  if (!req) return undefined
  if (req.origin) return req.origin.replace(/\/+$/, "")
  const host = req.host
  if (!host) return undefined
  const scheme = req.scheme ?? "http"
  const port = req.port ? `:${req.port}` : ""
  return `${scheme}://${host}${port}`
}

export const CredentialMintTool = Tool.define("credential_mint", {
  description: `Execute a credential's refresh recipe to mint fresh auth tokens. Replays the recipe's HTTP steps in order, extracts tokens from responses, and updates the credential's headers.

Use this to:
- Proactively refresh a credential before it expires
- Recover from a 401 by minting fresh tokens
- Test that a saved recipe actually works

The engine automatically does this on 401 during http_replay — this tool lets you trigger it manually.`,
  parameters: z.object({
    credential_id: z.string().describe("Credential ID whose recipe to execute (from web_get_session_context)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)

    const cred = WebCredential.getById(params.credential_id)
    if (!cred) {
      return {
        title: "credential_mint: not found",
        output: `Credential "${params.credential_id}" does not exist.`,
        metadata: { minted: false },
      }
    }

    if (cred.session_id !== sessionID) {
      return {
        title: "credential_mint: wrong session",
        output: `Credential "${params.credential_id}" belongs to a different session.`,
        metadata: { minted: false },
      }
    }

    const recipe = WebCredential.getRecipe(params.credential_id)
    if (!recipe) {
      return {
        title: "credential_mint: no recipe",
        output: `Credential "${params.credential_id}" has no refresh recipe. Use credential_set_recipe to create one first.`,
        metadata: { minted: false },
      }
    }

    const parsed = Recipe.safeParse(recipe)
    if (!parsed.success) {
      return {
        title: "credential_mint: invalid recipe",
        output: `Recipe on credential "${params.credential_id}" is malformed: ${parsed.error.message}`,
        metadata: { minted: false },
      }
    }

    const origin = originFromRequests(sessionID, parsed.data.steps[0].request_id)
    if (!origin) {
      return {
        title: "credential_mint: no origin",
        output: `Cannot determine origin from request "${parsed.data.steps[0].request_id}". Is the request still in the session?`,
        metadata: { minted: false },
      }
    }

    try {
      const result = await CredentialRecipe.execute(parsed.data, {
        sessionID,
        origin,
        signal: ctx.abort,
      })

      if (Object.keys(result.headers).length === 0) {
        return {
          title: "credential_mint: empty result",
          output: JSON.stringify(
            {
              minted: false,
              message:
                "Recipe executed but produced no credential headers. Check the recipe's credential_map and extraction rules.",
              extracted_variables: Object.keys(result.bag),
            },
            null,
            2,
          ),
          metadata: { minted: false },
        }
      }

      WebCredential.update({
        id: params.credential_id,
        sessionID,
        headers: result.headers,
      })

      return {
        title: `Minted fresh tokens for "${cred.label}"`,
        output: JSON.stringify(
          {
            credential_id: params.credential_id,
            label: cred.label,
            auth_type: parsed.data.auth_type,
            headers_updated: Object.keys(result.headers),
            extracted_variables: Object.keys(result.bag),
            hint: `Use http_replay with credential: "${params.credential_id}" to test with these fresh tokens.`,
          },
          null,
          2,
        ),
        metadata: { minted: true },
      }
    } catch (e) {
      return {
        title: "credential_mint: execution failed",
        output: `Recipe execution failed: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { minted: false },
      }
    }
  },
})
