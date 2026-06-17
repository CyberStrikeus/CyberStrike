import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import { Log } from "../util/log"
import { createAuthorization, exchangeCode } from "../auth/anthropic-oauth"

const log = Log.create({ service: "plugin.anthropic" })

/**
 * Anthropic subscription (Claude Pro/Max) login via OAuth. Uses the automatic
 * loopback flow: the browser redirects to a local server that captures the
 * code (no manual paste). Tokens are stored in cyberstrike's own auth store
 * (auth.json) by the auth framework; refresh + request shaping live in the
 * provider's anthropic loader.
 */
export async function AnthropicAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      methods: [
        {
          label: "Claude Pro/Max (browser)",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = createAuthorization()
            return {
              url,
              instructions: "Authorize in your browser, then paste the code shown (looks like `code#state`).",
              method: "code" as const,
              callback: async (code: string) => {
                const tokens = await exchangeCode(code, verifier)
                if (!tokens) {
                  log.error("anthropic oauth exchange failed")
                  return { type: "failed" as const }
                }
                return {
                  type: "success" as const,
                  refresh: tokens.refresh,
                  access: tokens.access,
                  expires: tokens.expires,
                }
              },
            }
          },
        },
        {
          // Preserve the API-key option (defining a plugin shadows the default
          // API-key method, so we re-add it here).
          type: "api",
          label: "API Key",
          prompts: [
            {
              type: "text",
              key: "key",
              message: "Anthropic API key",
              placeholder: "sk-ant-api...",
            },
          ],
          authorize: async (inputs) => {
            const key = inputs?.key
            if (!key) return { type: "failed" as const }
            return { type: "success" as const, key }
          },
        },
      ],
    },
  }
}
