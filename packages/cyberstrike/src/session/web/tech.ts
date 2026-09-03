// Framework fingerprinting (P2, design §4 / §6.4). Deterministic — NO LLM. Turns raw signals
// the extension gathered (page globals, DOM markers, cookies, meta, script srcs) — and, later,
// server response headers — into a TechStack, plus a plain-language hint the Navigator uses to
// reason about HOW navigation works on this app (SPA client-routing vs SSR full-page nav vs
// hydration). Lives here (no page-state / nav deps) so both the storage layer and the nav layer
// import it without a cycle.

export interface TechStack {
  client: string[] // React, Angular, Vue, jQuery
  metaFramework?: string // Next.js, Nuxt, SvelteKit, Remix
  server: string[] // Java, PHP, ASP.NET, Rails, Node/Express, Laravel, WordPress, …
  sessionKind?: string // inferred from the session cookie
  rendering: "spa" | "ssr" | "unknown"
  signals: string[] // the raw markers that fired (transparency / debug)
}

// What the extension gathers per page. All optional — a strict-CSP page may yield only DOM/cookies.
export interface FingerprintInput {
  globals?: string[] // window.* names present: ["React","__NEXT_DATA__","__NUXT__",…]
  dom?: string[] // attribute/marker names seen: ["data-reactroot","ng-version","data-v","data-sveltekit"]
  cookies?: string[] // cookie names: ["JSESSIONID","PHPSESSID"]
  meta?: string // <meta name="generator"> content
  scripts?: string[] // script-src hints: ["/_next/","/_nuxt/","angular"]
  headers?: Record<string, string> // server response headers (reserved — wired via the ingest pipeline in P4)
}

// --- detection tables (single source; extend here, not in call sites) ---------------------
const CLIENT: { needle: string; name: string; where: "globals" | "dom" }[] = [
  { needle: "react", name: "React", where: "globals" },
  { needle: "__react", name: "React", where: "globals" },
  { needle: "data-reactroot", name: "React", where: "dom" },
  { needle: "ng", name: "Angular", where: "globals" },
  { needle: "getallangularrootelements", name: "Angular", where: "globals" },
  { needle: "ng-version", name: "Angular", where: "dom" },
  { needle: "zone", name: "Angular", where: "globals" }, // Zone.js ⇒ Angular
  { needle: "vue", name: "Vue", where: "globals" },
  { needle: "__vue__", name: "Vue", where: "globals" },
  { needle: "data-v", name: "Vue", where: "dom" },
  { needle: "jquery", name: "jQuery", where: "globals" },
]
const META: { needle: string; name: string }[] = [
  { needle: "__next_data__", name: "Next.js" },
  { needle: "/_next/", name: "Next.js" },
  { needle: "__nuxt__", name: "Nuxt" },
  { needle: "/_nuxt/", name: "Nuxt" },
  { needle: "data-sveltekit", name: "SvelteKit" },
  { needle: "__remixcontext", name: "Remix" },
]
const COOKIE_SERVER: { needle: string; name: string }[] = [
  { needle: "jsessionid", name: "Java" },
  { needle: "phpsessid", name: "PHP" },
  { needle: "asp.net_sessionid", name: "ASP.NET" },
  { needle: "laravel_session", name: "Laravel" },
  { needle: "connect.sid", name: "Node/Express" },
  { needle: "_rails_session", name: "Rails" },
  { needle: "_session_id", name: "Rails" },
  { needle: "cfid", name: "ColdFusion" },
  { needle: "cftoken", name: "ColdFusion" },
]
const HEADER_SERVER: { header: string; name: string }[] = [
  { header: "x-aspnet-version", name: "ASP.NET" },
  { header: "x-drupal-cache", name: "Drupal" },
]
const GENERATOR: { needle: string; name: string }[] = [
  { needle: "wordpress", name: "WordPress" },
  { needle: "drupal", name: "Drupal" },
  { needle: "joomla", name: "Joomla" },
  { needle: "shopify", name: "Shopify" },
]

export namespace FrameworkFingerprinter {
  function add(set: Set<string>, v?: string) {
    if (v) set.add(v)
  }

  export function detect(input: FingerprintInput): TechStack {
    const client = new Set<string>()
    const server = new Set<string>()
    const signals: string[] = []
    let metaFramework: string | undefined
    let sessionKind: string | undefined

    const globals = (input.globals ?? []).map((s) => s.toLowerCase())
    const dom = (input.dom ?? []).map((s) => s.toLowerCase())
    const scripts = (input.scripts ?? []).map((s) => s.toLowerCase())
    const cookies = (input.cookies ?? []).map((s) => s.toLowerCase())
    const meta = (input.meta ?? "").toLowerCase()
    const headers = input.headers ?? {}

    for (const r of CLIENT) {
      const hay = r.where === "globals" ? globals : dom
      if (hay.some((s) => s === r.needle || s.includes(r.needle))) {
        add(client, r.name)
        signals.push(`${r.where}:${r.needle}`)
      }
    }
    for (const r of META) {
      if (globals.some((s) => s.includes(r.needle)) || dom.some((s) => s.includes(r.needle)) || scripts.some((s) => s.includes(r.needle))) {
        metaFramework = metaFramework ?? r.name
        signals.push(`meta-framework:${r.needle}`)
      }
    }
    for (const r of COOKIE_SERVER) {
      if (cookies.some((c) => c.includes(r.needle))) {
        add(server, r.name)
        sessionKind = sessionKind ?? r.name
        signals.push(`cookie:${r.needle}`)
      }
    }
    for (const r of HEADER_SERVER) {
      if (headers[r.header] !== undefined) {
        add(server, r.name)
        signals.push(`header:${r.header}`)
      }
    }
    const poweredBy = (headers["x-powered-by"] ?? "").toLowerCase()
    if (poweredBy.includes("php")) add(server, "PHP")
    if (poweredBy.includes("asp.net")) add(server, "ASP.NET")
    if (poweredBy.includes("express")) add(server, "Node/Express")
    if (poweredBy) signals.push(`header:x-powered-by`)
    for (const r of GENERATOR) {
      if (meta.includes(r.needle)) {
        add(server, r.name)
        signals.push(`generator:${r.needle}`)
      }
    }
    // ASP.NET WebForms / JSF postback tokens (from DOM hidden fields the extension reports).
    if (dom.some((s) => s.includes("__viewstate"))) {
      add(server, "ASP.NET WebForms")
      signals.push("dom:__viewstate")
    }
    if (dom.some((s) => s.includes("javax.faces.viewstate"))) {
      add(server, "JSF")
      signals.push("dom:jsf-viewstate")
    }

    const isSpa = client.size > 0 || metaFramework !== undefined
    const rendering: TechStack["rendering"] = isSpa ? "spa" : server.size > 0 ? "ssr" : "unknown"
    return { client: [...client], metaFramework, server: [...server], sessionKind, rendering, signals }
  }

  // Plain-language hint fed to the Navigator (P3) so it reasons about HOW to navigate this app.
  export function describe(tech: TechStack): string {
    const stack = [...tech.client, tech.metaFramework, ...tech.server].filter(Boolean).join(", ") || "unknown stack"
    if (tech.metaFramework) {
      return `${stack} — meta-framework: SSR HTML may be inert until it hydrates (wait for hydration before acting); navigation is client-side (buttons/role=link/onclick) and/or partial payloads, NOT full page loads; API routes appear in XHR and JS chunks. Re-observe after each action (the DOM re-renders).`
    }
    if (tech.rendering === "spa") {
      return `${stack} — SPA with client-side routing: navigations are usually buttons / role=link / onclick, NOT <a href>; endpoints appear as XHR; the DOM re-renders in place, so re-observe after each action and element ids are per-snapshot.`
    }
    if (tech.rendering === "ssr") {
      return `${stack} — server-rendered (MPA): navigation is full-page (<a href>); forms submit with POST; expect hidden CSRF/ViewState tokens that must be preserved on submit.`
    }
    return `${stack}: treat as a classic multi-page app (full-page navigation, form POST) until signals say otherwise.`
  }
}
