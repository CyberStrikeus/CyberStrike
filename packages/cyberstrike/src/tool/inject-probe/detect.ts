import type { SendOk } from "./types"
import { XSS_BREAKOUT } from "./payloads/xss"

export const WAF_BODY =
  /cloudflare|attention required|just a moment|checking your browser|access denied|request unsuccessful|mod_?security|incapsula|sucuri|akamai|captcha|are you a robot|ddos protection/i
export const WAF_SERVER = /cloudflare|sucuri|akamai|incapsula|mod_?security|awselb|barracuda|f5|big-?ip/i

export function looksBlocked(status: number): boolean {
  return status === 403 || status === 406 || status === 429 || status === 503
}

export function blockSignal(res: SendOk): string | undefined {
  if (looksBlocked(res.status)) return `HTTP ${res.status}`
  const server = res.headers["server"] ?? ""
  if (res.headers["cf-ray"] || res.headers["x-sucuri-id"] || WAF_SERVER.test(server)) {
    if (WAF_BODY.test(res.text.slice(0, 4000))) return `WAF challenge (${server || "cdn header"})`
  }
  if (WAF_BODY.test(res.text.slice(0, 2000))) return "WAF/challenge page"
  return undefined
}

export function excerptAround(text: string, index: number, matchLen: number, radius = 90): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + matchLen + radius)
  const body = text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 320)
  return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "")
}

export function excerptOf(text: string, needle: string, radius = 90): string {
  const i = text.indexOf(needle)
  return i < 0 ? "" : excerptAround(text, i, needle.length, radius)
}

export function classifyXssContext(text: string, marker: string): string {
  const i = text.indexOf(marker)
  if (i < 0) return "unknown"
  const before = text.slice(Math.max(0, i - 80), i)
  if (/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*$/i.test(before)) return "javascript"
  if (/<textarea\b[^>]*>(?:(?!<\/textarea>)[\s\S])*$/i.test(before)) return "rcdata-textarea"
  if (/<title\b[^>]*>(?:(?!<\/title>)[\s\S])*$/i.test(before)) return "rcdata-title"
  if (/<style\b[^>]*>(?:(?!<\/style>)[\s\S])*$/i.test(before)) return "rcdata-style"
  const urlAttr = /(?:href|src|action|formaction|xlink:href|poster|data)\s*=\s*/i
  if (/=\s*"[^"]*$/.test(before)) return urlAttr.test(before) ? "attribute-url-double" : "attribute-double-quote"
  if (/=\s*'[^']*$/.test(before)) return urlAttr.test(before) ? "attribute-url-single" : "attribute-single-quote"
  if (/<[a-z][^>]*$/i.test(before)) return "tag-name"
  return "html-body"
}

export function xssWeaponFires(payload: string, survived: boolean, ctx: string): boolean {
  const s = payload.replace(/^\s+/, "")
  if (s.startsWith("javascript:")) return /attribute-url/.test(ctx)
  if (s.startsWith("<")) return survived
  if (/^["']/.test(s)) return /attribute|javascript/.test(ctx)
  return /javascript/.test(ctx) || survived
}
