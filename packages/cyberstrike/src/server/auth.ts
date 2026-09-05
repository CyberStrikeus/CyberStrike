import { timingSafeEqual } from "node:crypto"

export namespace ServerAuth {
  export type Role = "operator" | "observer"

  function equal(left: string, right: string) {
    const a = Buffer.from(left)
    const b = Buffer.from(right)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }

  function basic(header?: string) {
    const match = header ? /^Basic\s+(.+)$/i.exec(header) : undefined
    if (!match) return
    const decoded = Buffer.from(match[1], "base64").toString("utf8")
    const split = decoded.indexOf(":")
    if (split === -1) return
    return {
      username: decoded.slice(0, split),
      password: decoded.slice(split + 1),
    }
  }

  export function role(input: {
    header?: string
    loopback: boolean
    proxied: boolean
    operator: { username: string; password?: string }
    observer: { username: string; password?: string }
  }): Role | undefined {
    if (input.loopback && !input.proxied) return "operator"
    const auth = basic(input.header)
    if (!auth) return
    if (
      input.operator.password &&
      equal(auth.username, input.operator.username) &&
      equal(auth.password, input.operator.password)
    )
      return "operator"
    if (
      input.observer.password &&
      equal(auth.username, input.observer.username) &&
      equal(auth.password, input.observer.password)
    )
      return "observer"
  }

  const observer = [
    /^\/global\/health$/,
    /^\/event-log\/session\/[^/]+(?:\/stream)?$/,
    /^\/topology\/session\/[^/]+(?:\/notes|\/nmap(?:\/diff)?)?$/,
    /^\/methodology\/session\/[^/]+\/(?:state|intel|coverage-notes|intel\/coverage(?:\/assets)?|chains|violations|performance|report\/compile|report\/download)$/,
    /^\/session\/?$/,
    /^\/session\/status$/,
    /^\/session\/[^/]+(?:\/children|\/usage|\/todo|\/vulnerability|\/web\/roles|\/web\/objects|\/web\/functions)?$/,
    /^\/mcp\/?$/,
    /^\/mcp\/catalog$/,
    /^\/bolt\/?$/,
    /^\/system\/capabilities$/,
  ]

  export function allows(role: Role, input: { method: string; path: string; upgrade?: string }) {
    if (role === "operator") return true
    if (input.upgrade?.toLowerCase() === "websocket") return false
    if (input.method !== "GET" && input.method !== "HEAD") return false
    return observer.some((pattern) => pattern.test(input.path))
  }
}
