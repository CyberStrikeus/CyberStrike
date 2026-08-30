import type { Page } from "playwright"
import { register } from "../registry.ts"
import { EMPTY_RESULT, type Detector, type DiscoveryContext, type DiscoveryResult } from "../detector.ts"

const GRAPHQL_CANDIDATES = ["/graphql", "/api/graphql", "/query", "/v1/graphql"]

// Minimal READ-ONLY introspection probe — `{__typename}` mutates nothing; it
// just confirms the endpoint speaks GraphQL. The endpoint itself is then emitted
// (Approach B) for the proxy-agents to test deeper.
const PROBE_BODY = JSON.stringify({ query: "{__typename}" })

async function looksLikeGraphql(page: Page, url: string): Promise<boolean> {
  try {
    return await page.evaluate(
      async ({ target, body }) => {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 8000)
          const res = await fetch(target, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          })
          clearTimeout(timer)
          const text = await res.text()
          // A GraphQL server answers {__typename} with a data/errors envelope.
          return /"data"\s*:|"errors"\s*:\s*\[/.test(text) && /__typename|graphql|must provide query/i.test(text)
        } catch {
          return false
        }
      },
      { target: url, body: PROBE_BODY },
    )
  } catch {
    return false
  }
}

/** Detect a GraphQL endpoint and emit it (POST) for the proxy-agents to test. */
const graphql: Detector = {
  name: "graphql",
  kind: "spec",
  async applies(): Promise<boolean> {
    return true
  },
  async detect(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const origin = new URL(ctx.baseUrl).origin
    for (const path of GRAPHQL_CANDIDATES) {
      const url = origin + path
      if (!ctx.inScope(new URL(url).hostname)) continue
      if (await looksLikeGraphql(ctx.page, url)) {
        return { pages: [], endpoints: [{ method: "POST", url, source: "graphql" }], confidence: 1 }
      }
    }
    return EMPTY_RESULT
  },
}

register(graphql)
export { graphql }
