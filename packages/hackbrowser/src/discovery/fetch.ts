import type { Page } from "playwright"

const FETCH_TIMEOUT_MS = 8000

/**
 * Build a text-fetcher that runs INSIDE the page context, so requests inherit
 * the logged-in session cookies and the browser's proxy/TLS configuration —
 * critical behind a corporate SSL-inspection proxy, where a bare Node HTTP
 * client would hit `unable to get local issuer certificate`, and for
 * auth-gated specs, where it would 401.
 *
 * Returns null on any non-OK response, network error, or timeout, so a missing
 * sitemap/spec is a no-op for callers rather than a throw.
 */
export function makeFetchText(page: Page): (url: string) => Promise<string | null> {
  return async (url: string) => {
    try {
      return await page.evaluate(
        async ({ target, timeout }) => {
          try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeout)
            const res = await fetch(target, {
              credentials: "include",
              redirect: "follow",
              signal: controller.signal,
            })
            clearTimeout(timer)
            if (!res.ok) return null
            return await res.text()
          } catch {
            return null
          }
        },
        { target: url, timeout: FETCH_TIMEOUT_MS },
      )
    } catch {
      // page.evaluate itself can reject (page navigated / detached mid-call).
      return null
    }
  }
}
