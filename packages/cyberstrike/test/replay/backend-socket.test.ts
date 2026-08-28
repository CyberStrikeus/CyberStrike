import { describe, test, expect, afterEach } from "bun:test"
import net from "node:net"
import { BackendSocket } from "../../src/replay/backend-socket"

const CRLF = "\r\n"

// A raw TCP server that records the exact bytes it received and replies with a
// caller-provided response. Used to prove byte-exactness and non-hang behavior.
function rawServer(
  response: string,
  opts: { keepOpen?: boolean } = {},
): Promise<{ port: number; received: () => Buffer; close: () => void }> {
  const buffers: Buffer[] = []
  const server = net.createServer((sock) => {
    sock.on("data", (d) => {
      buffers.push(d)
      const all = Buffer.concat(buffers)
      // Reply once the request head is complete.
      if (all.includes("\r\n\r\n")) {
        sock.write(response)
        if (!opts.keepOpen) sock.end()
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port
      resolve({
        port,
        received: () => Buffer.concat(buffers),
        close: () => server.close(),
      })
    })
  })
}

let closers: Array<() => void> = []
afterEach(() => {
  closers.forEach((c) => c())
  closers = []
})

const RESP = [`HTTP/1.1 200 OK`, `Content-Length: 5`, ``, `hello`].join(CRLF)

describe("BackendSocket.send", () => {
  test("writes the exact bytes it was given (byte-exact)", async () => {
    const srv = await rawServer(RESP)
    closers.push(srv.close)
    // Deliberately odd: lowercase method, duplicate Host, weird spacing — the
    // kind of thing fetch would normalize away.
    const raw = [`get /A HTTP/1.1`, `Host: a`, `Host: b`, `X-Odd:   spaced`, ``, ``].join(CRLF)
    const r = await BackendSocket.send(new TextEncoder().encode(raw), { host: "127.0.0.1", port: srv.port })
    expect(r.error).toBeUndefined()
    expect(srv.received().toString("latin1")).toBe(raw) // exact bytes on the wire
  })

  test("parses a Content-Length response without hanging on keep-alive", async () => {
    const srv = await rawServer(RESP, { keepOpen: true }) // never closes
    closers.push(srv.close)
    const raw = [`GET / HTTP/1.1`, `Host: a`, ``, ``].join(CRLF)
    const r = await BackendSocket.send(new TextEncoder().encode(raw), {
      host: "127.0.0.1",
      port: srv.port,
      totalTimeoutMs: 2000,
    })
    expect(r.response?.status).toBe(200)
    expect(new TextDecoder().decode(r.response!.body)).toBe("hello")
  })

  test("parses a chunked response", async () => {
    const chunked = [`HTTP/1.1 200 OK`, `Transfer-Encoding: chunked`, ``, `5\r\nhello\r\n0\r\n\r\n`].join(CRLF)
    const srv = await rawServer(chunked, { keepOpen: true })
    closers.push(srv.close)
    const raw = [`GET / HTTP/1.1`, `Host: a`, ``, ``].join(CRLF)
    const r = await BackendSocket.send(new TextEncoder().encode(raw), {
      host: "127.0.0.1",
      port: srv.port,
      totalTimeoutMs: 2000,
    })
    expect(r.response?.status).toBe(200)
    expect(new TextDecoder().decode(r.response!.body)).toContain("hello")
  })

  test("classifies a refused connection", async () => {
    const r = await BackendSocket.send(new TextEncoder().encode("GET / HTTP/1.1\r\n\r\n"), {
      host: "127.0.0.1",
      port: 1,
      connectTimeoutMs: 1000,
    })
    expect(r.response).toBeUndefined()
    expect(r.error?.kind).toBe("conn_refused")
  })
})
