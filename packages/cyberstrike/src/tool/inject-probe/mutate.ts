import type { ResolvedRequest, InjPoint } from "./types"
import { multipartBoundary, setMultipartField, setMultipartOperator } from "./multipart"

const sanitizeHeaderValue = (v: string) => v.replace(/[\r\n ]/g, "")

export function setJsonField(body: string, path: string, value: string): string {
  try {
    const root = JSON.parse(body || "{}")
    const keys = path.split(".")
    let cur: any = root
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]!] !== "object" || cur[keys[i]!] == null) cur[keys[i]!] = {}
      cur = cur[keys[i]!]
    }
    cur[keys[keys.length - 1]!] = value
    return JSON.stringify(root)
  } catch {
    return body
  }
}

export function setJsonValue(body: string, path: string, value: any): string {
  try {
    const root = JSON.parse(body || "{}")
    const keys = path.split(".")
    let cur: any = root
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]!] !== "object" || cur[keys[i]!] == null) cur[keys[i]!] = {}
      cur = cur[keys[i]!]
    }
    cur[keys[keys.length - 1]!] = value
    return JSON.stringify(root)
  } catch {
    return body
  }
}

export function setCookie(cookieHeader: string, name: string, value: string): string {
  const safeVal = value.replace(/[;\r\n ]/g, "")
  const parts = (cookieHeader ? cookieHeader.split(/;\s*/) : []).filter(
    (p) => p && p.split("=")[0]!.trim().toLowerCase() !== name.toLowerCase(),
  )
  parts.push(`${name}=${safeVal}`)
  return parts.join("; ")
}

export function injectPathSegment(pathname: string, indexStr: string, value: string): string {
  const segs = pathname.split("/")
  const nonEmpty: number[] = []
  for (let i = 0; i < segs.length; i++) if (segs[i] !== "") nonEmpty.push(i)
  const target = nonEmpty[Number(indexStr)]
  if (target == null) return pathname
  segs[target] = encodeURIComponent(value.replace(/\.\.(\/|\\)?/g, ""))
  return segs.join("/")
}

export function applyOperatorTarget(
  r: ResolvedRequest,
  point: InjPoint,
  opKey: string,
  opVal: any,
): { url: string; body: string; headers: Record<string, string> } | null {
  const headers = { ...r.headers }
  const u = new URL(r.url.toString())
  const origin = `${u.protocol}//${u.host}${u.pathname}`
  const enc = (s: string) => encodeURIComponent(s)
  const rawPair = `${point.name}[${opKey}]=${enc(String(opVal))}`
  switch (point.location) {
    case "query": {
      const parts: string[] = []
      for (const [k, v] of u.searchParams) if (k !== point.name) parts.push(`${enc(k)}=${enc(v)}`)
      parts.push(rawPair)
      return { url: `${origin}?${parts.join("&")}`, body: r.body, headers }
    }
    case "form_field": {
      if (r.contentType.includes("multipart/form-data")) {
        const b = multipartBoundary(r)
        const mp = b ? setMultipartOperator(r.body, b, point.name, opKey, opVal) : null
        return mp != null ? { url: u.toString(), body: mp, headers } : null
      }
      const f = new URLSearchParams(r.body)
      const parts: string[] = []
      for (const [k, v] of f) if (k !== point.name) parts.push(`${enc(k)}=${enc(v)}`)
      parts.push(rawPair)
      return { url: u.toString(), body: parts.join("&"), headers }
    }
    case "json_body":
      return { url: u.toString(), body: setJsonValue(r.body, point.name, { [opKey]: opVal }), headers }
    default:
      return null
  }
}

export function applyLfiTarget(
  r: ResolvedRequest,
  point: InjPoint,
  value: string,
): { url: string; body: string; headers: Record<string, string> } {
  const headers = { ...r.headers }
  const u = new URL(r.url.toString())
  const origin = `${u.protocol}//${u.host}${u.pathname}`
  const enc = (s: string) => encodeURIComponent(s)
  let body = r.body
  switch (point.location) {
    case "query": {
      const parts: string[] = []
      for (const [k, v] of u.searchParams) if (k !== point.name) parts.push(`${enc(k)}=${enc(v)}`)
      parts.push(`${enc(point.name)}=${value}`)
      return { url: `${origin}?${parts.join("&")}`, body, headers }
    }
    case "form_field": {
      if (r.contentType.includes("multipart/form-data")) {
        const b = multipartBoundary(r)
        return { url: u.toString(), body: (b && setMultipartField(r.body, b, point.name, value)) ?? r.body, headers }
      }
      const f = new URLSearchParams(r.body)
      const parts: string[] = []
      for (const [k, v] of f) if (k !== point.name) parts.push(`${enc(k)}=${enc(v)}`)
      parts.push(`${enc(point.name)}=${value}`)
      return { url: u.toString(), body: parts.join("&"), headers }
    }
    case "json_body":
      return { url: u.toString(), body: setJsonValue(r.body, point.name, value), headers }
    case "path": {
      const segs = u.pathname.split("/")
      const nonEmpty: number[] = []
      for (let i = 0; i < segs.length; i++) if (segs[i] !== "") nonEmpty.push(i)
      const t = nonEmpty[Number(point.name)]
      if (t != null) segs[t] = value
      return { url: `${u.protocol}//${u.host}${segs.join("/")}${u.search}`, body, headers }
    }
    case "header":
      headers[point.name.toLowerCase()] = value.replace(/[\r\n]/g, "")
      return { url: u.toString(), body, headers }
    case "cookie":
      headers["cookie"] = setCookie(headers["cookie"] ?? "", point.name, value.replace(/[\r\n;]/g, ""))
      return { url: u.toString(), body, headers }
  }
}

export function duplicatePayload(
  r: ResolvedRequest,
  point: InjPoint,
  value: string,
  position: "first" | "last",
): { url: string; body: string; headers: Record<string, string> } | null {
  const headers = { ...r.headers }
  const u = new URL(r.url.toString())

  if (point.location === "query") {
    const original = u.searchParams.get(point.name)
    if (original == null) return null
    if (position === "last") {
      u.searchParams.append(point.name, value)
    } else {
      u.searchParams.delete(point.name)
      u.searchParams.append(point.name, value)
      u.searchParams.append(point.name, original)
    }
    return { url: u.toString(), body: r.body, headers }
  }

  if (point.location === "form_field") {
    if (r.contentType.includes("multipart/form-data")) return null
    const f = new URLSearchParams(r.body)
    const original = f.get(point.name)
    if (original == null) return null
    if (position === "last") {
      f.append(point.name, value)
    } else {
      f.delete(point.name)
      f.append(point.name, value)
      f.append(point.name, original)
    }
    return { url: u.toString(), body: f.toString(), headers }
  }

  return null
}

export function applyPayload(
  r: ResolvedRequest,
  point: InjPoint,
  value: string,
): { url: string; body: string; headers: Record<string, string> } {
  const headers = { ...r.headers }
  const u = new URL(r.url.toString())
  let body = r.body
  switch (point.location) {
    case "query":
      u.searchParams.set(point.name, value)
      break
    case "form_field": {
      if (r.contentType.includes("multipart/form-data")) {
        const b = multipartBoundary(r)
        const mp = b ? setMultipartField(r.body, b, point.name, value) : null
        body = mp ?? r.body
        break
      }
      const f = new URLSearchParams(r.body)
      f.set(point.name, value)
      body = f.toString()
      break
    }
    case "json_body":
      body = setJsonField(r.body, point.name, value)
      break
    case "header":
      headers[point.name.toLowerCase()] = sanitizeHeaderValue(value)
      break
    case "cookie":
      headers["cookie"] = setCookie(headers["cookie"] ?? "", point.name, value)
      break
    case "path":
      u.pathname = injectPathSegment(u.pathname, point.name, value)
      break
  }
  return { url: u.toString(), body, headers }
}
