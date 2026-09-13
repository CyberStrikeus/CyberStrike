// mineDiscoveredJs — the recursive JS-mining pass (Enterprise). Consumes the discovered inventory
// Vortex's crawler fills (kind:"js"), fetches FIRST-PARTY bundles through the core Sender, mines each
// with `mineInto`, and follows newly discovered first-party JS until a cap. Depends on core
// (store/Sender/mineInto) only; core never imports this — the paid recursion stays out of the free
// crawl.ts.
//
// First-party vs CDN routing (the policy from the design discussion):
// - first-party JS (same host as the seed, or a root-relative ref) → fetch + store + MINE (endpoints
//   / further JS / secrets). This is where custom app secrets and internal routes live.
// - CDN / third-party JS → NOT mined here. Tech/version fingerprinting over those is the core rule
//   engine's job (tech-* packs run over any stored transaction); mining a vendor bundle for "secrets"
//   is pure noise. They are marked seen so the loop does not reconsider them.
import type { TrafficStore, Sender, Transaction } from "@cyberstrike-io/vortex"
import { mineInto } from "./ingest"

// Known public CDN / third-party script hosts — routing only (a vendor bundle is never mined).
const CDN_HOST =
  /(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|code\.jquery\.com|ajax\.googleapis\.com|ajax\.aspnetcdn\.com|cdn\.tailwindcss\.com|stackpath\.bootstrapcdn\.com|maxcdn\.bootstrapcdn\.com|use\.fontawesome\.com|kit\.fontawesome\.com|polyfill\.io|cdn\.shopify\.com|static\.cloudflareinsights\.com|www\.gstatic\.com|apis\.google\.com)/i

export interface MineCrawlOptions {
  baseUrl?: string // seed URL — resolves relative JS refs and defines the first-party host
  maxJs?: number // cap on JS bundles fetched (default 50)
  entropy?: boolean // pass-through to the miner (default true)
}

type Party = "first-party" | "cdn" | "third-party"

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

export function classifyScript(url: string, seedHost?: string): Party {
  if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return "first-party"
  const h = hostOf(url)
  if (!h) return "first-party" // unparseable / bare relative — assume same origin
  if (seedHost && h === seedHost) return "first-party"
  if (CDN_HOST.test(h)) return "cdn"
  return "third-party"
}

function resolve(ref: string, baseUrl?: string): string {
  if (!baseUrl) return ref
  try {
    return new URL(ref, baseUrl).toString()
  } catch {
    return ref
  }
}

function bodyOf(tx: Transaction): string {
  return tx.response?.body ?? ""
}

// Walk the discovered first-party JS, fetch + mine each, follow newly found first-party JS. Returns
// what it fetched and the aggregate discovery/secret counts.
export async function mineDiscoveredJs(
  store: TrafficStore,
  send: Sender,
  opts: MineCrawlOptions = {},
): Promise<{ fetched: string[]; discovered: number; secrets: number; skipped: string[] }> {
  const maxJs = opts.maxJs ?? 50
  const seedHost = opts.baseUrl ? hostOf(opts.baseUrl) : undefined
  const fetched: string[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  let discovered = 0
  let secrets = 0

  while (fetched.length < maxJs) {
    // Pick the next un-seen discovered JS. Re-query each pass so refs found mid-mine are included.
    const next = store.discovered("js").find((d) => !d.hit && !seen.has(d.value))
    if (!next) break
    seen.add(next.value)

    const abs = resolve(next.value, opts.baseUrl)
    const party = classifyScript(next.value.startsWith("http") ? next.value : abs, seedHost)
    if (party !== "first-party") {
      skipped.push(abs)
      store.addDiscovered([{ ...next, hit: true }]) // mark seen; leave tech detection to core rules
      continue
    }

    let res
    try {
      res = await send({ url: abs, method: "GET" }, {})
    } catch {
      store.addDiscovered([{ ...next, hit: true }])
      continue
    }
    store.add(res.transaction)
    fetched.push(abs)
    store.addDiscovered([{ ...next, hit: true, fromTransaction: res.transaction.id }])

    const r = mineInto(store, res.transaction.id, bodyOf(res.transaction), { baseUrl: abs, entropy: opts.entropy })
    discovered += r.discovered
    secrets += r.secrets
  }

  return { fetched, discovered, secrets, skipped }
}
