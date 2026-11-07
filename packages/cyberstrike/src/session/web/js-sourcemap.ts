// Pure source-map handling (P4.2, design §5). A JS bundle often points at a source map that holds
// the ORIGINAL file paths (`sources`) and, in dev/careless builds, the original un-minified source
// (`sourcesContent`). Mining the un-minified source recovers routes/secrets the minifier obscured,
// and the source paths reveal internal structure. Pure — no fetch, no LLM; JsMiner does the I/O.
export namespace JsSourceMap {
  export interface Parsed {
    sources: string[] // original file paths (e.g. "src/api/client.ts")
    sourcesContent: string[] // original un-minified source, when the map ships it
  }

  // `//# sourceMappingURL=...` (or the legacy `//@`). Usually the LAST such comment wins.
  const REF_RE = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)[ \t]*$/gm

  // Resolve the external source-map URL a bundle references, or null (none / inline data-URI /
  // unresolvable). Inline maps are handled by `inline()` instead (no fetch needed).
  export function refUrl(jsText: string, jsBundleUrl: string): string | null {
    let ref: string | undefined
    let m: RegExpExecArray | null
    REF_RE.lastIndex = 0
    while ((m = REF_RE.exec(jsText))) ref = m[1] // keep the last one
    if (!ref || ref.startsWith("data:")) return null
    try {
      return new URL(ref, jsBundleUrl).href
    } catch {
      return null
    }
  }

  // Decode + parse an INLINE `sourceMappingURL=data:...` map (base64 or URL-encoded JSON), or null.
  export function inline(jsText: string): Parsed | null {
    let ref: string | undefined
    let m: RegExpExecArray | null
    REF_RE.lastIndex = 0
    while ((m = REF_RE.exec(jsText))) ref = m[1]
    if (!ref || !ref.startsWith("data:")) return null
    const comma = ref.indexOf(",")
    if (comma < 0) return null
    const meta = ref.slice(0, comma)
    const payload = ref.slice(comma + 1)
    try {
      const json = /;base64/i.test(meta) ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload)
      return parse(json)
    } catch {
      return null
    }
  }

  // Parse source-map JSON, tolerating anything malformed (returns null). Only the two fields we
  // mine are extracted; everything else (mappings/names) is ignored.
  export function parse(mapText: string): Parsed | null {
    try {
      const j = JSON.parse(mapText) as { sources?: unknown; sourcesContent?: unknown }
      if (!j || typeof j !== "object") return null
      const sources = Array.isArray(j.sources) ? j.sources.filter((s): s is string => typeof s === "string") : []
      const sourcesContent = Array.isArray(j.sourcesContent) ? j.sourcesContent.filter((s): s is string => typeof s === "string") : []
      if (sources.length === 0 && sourcesContent.length === 0) return null
      return { sources, sourcesContent }
    } catch {
      return null
    }
  }
}
