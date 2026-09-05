import type { ResolvedRequest } from "./types"

export function multipartBoundary(r: ResolvedRequest): string | null {
  const m = r.contentType.match(/boundary=("?)([^";]+)\1/i)
  if (m) return m[2]!.trim()
  const b = r.body.match(/^--(.+?)\r?\n/)
  return b ? b[1]!.trim() : null
}

export function mpFieldName(seg: string): string | null {
  if (/filename="/i.test(seg)) return null
  const m = seg.match(/content-disposition:[^\r\n]*\bname="([^"]+)"/i)
  return m ? m[1]! : null
}

export function multipartFieldNames(body: string, boundary: string): string[] {
  const names: string[] = []
  for (const seg of body.split(`--${boundary}`)) {
    const n = mpFieldName(seg)
    if (n != null) names.push(n)
  }
  return names
}

export function setMultipartField(body: string, boundary: string, name: string, value: string): string | null {
  if (value.includes(`--${boundary}`)) return null
  const delim = `--${boundary}`
  const segments = body.split(delim)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    if (mpFieldName(seg) !== name) continue
    const sep = seg.match(/\r?\n\r?\n/)
    if (!sep || sep.index == null) continue
    const headEnd = sep.index + sep[0].length
    const rest = seg.slice(headEnd)
    const trail = rest.match(/\r?\n$/)?.[0] ?? "\r\n"
    segments[i] = seg.slice(0, headEnd) + value + trail
    return segments.join(delim)
  }
  return null
}

export function setMultipartOperator(
  body: string,
  boundary: string,
  name: string,
  opKey: string,
  opVal: any,
): string | null {
  const v = String(opVal)
  if (v.includes(`--${boundary}`)) return null
  const delim = `--${boundary}`
  const segments = body.split(delim)
  for (let i = 0; i < segments.length; i++) {
    if (mpFieldName(segments[i]!) !== name) continue
    const seg = segments[i]!.replace(
      /(content-disposition:[^\r\n]*?\bname=")[^"]+(")/i,
      (_m, pre, post) => `${pre}${name}[${opKey}]${post}`,
    )
    const sep = seg.match(/\r?\n\r?\n/)
    if (!sep || sep.index == null) return null
    const headEnd = sep.index + sep[0].length
    const trail = seg.slice(headEnd).match(/\r?\n$/)?.[0] ?? "\r\n"
    segments[i] = seg.slice(0, headEnd) + v + trail
    return segments.join(delim)
  }
  return null
}
