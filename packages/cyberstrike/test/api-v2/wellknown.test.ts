import { expect, test } from "bun:test"
import path from "path"
import { listen } from "../../src/api-v2/server"
import { Auth } from "../../src/auth"
import { tmpdir } from "../fixture/fixture"

const echo = [process.execPath, "-e", "process.stdout.write('tok-123')"]

test("wellknown add rejects non-https hosts, oversized or unlisted discovery, and stores only allowlisted output", async () => {
  await using tmp = await tmpdir({
    config: { integration: { wellknown_commands: [echo] } },
  })
  const marker = path.join(tmp.path, "ran")
  const denied = [process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x"); process.stdout.write("tok")`]
  const env = "FIXTURE_WELLKNOWN_TOKEN"
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const pathname = new URL(req.url).pathname
      if (pathname === "/large/.well-known/cyberstrike") return new Response("x".repeat(300 * 1024))
      if (pathname === "/allowed/.well-known/cyberstrike") return Response.json({ auth: { command: echo, env } })
      if (pathname === "/denied/.well-known/cyberstrike") return Response.json({ auth: { command: denied, env } })
      return new Response("missing", { status: 404 })
    },
  })
  const api = await listen({ hostname: "127.0.0.1", port: 0 })
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const add = (url: string) =>
    fetch(new URL(`/api/experimental/integration/wellknown?${query}`, api.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    })
  const origin = `http://127.0.0.1:${server.port}`
  const allowedBase = `${origin}/allowed`
  const deniedBase = `${origin}/denied`
  try {
    // Plain http is refused for any host other than loopback, before anything is fetched.
    const remote = await add(`http://0.0.0.0:${server.port}/allowed`)
    expect(remote.status).toBe(400)
    expect((await remote.json())._tag).toBe("InvalidRequestError")
    expect((await add("http://example.invalid/allowed")).status).toBe(400)
    expect((await add("https://user:pass@example.invalid")).status).toBe(400)

    // A discovery body over the size cap is refused rather than truncated.
    const large = await add(`${origin}/large`)
    expect(large.status).toBe(400)

    // A command that is not allowlisted is never executed.
    const unlisted = await add(deniedBase)
    expect(unlisted.status).toBe(400)
    expect((await unlisted.json())._tag).toBe("InvalidRequestError")
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Auth.get(deniedBase)).toBeUndefined()

    // An allowlisted command stores its trimmed output the same way the v1 wellknown login does.
    const allowed = await add(allowedBase)
    expect(allowed.status).toBe(204)
    expect(await Auth.get(allowedBase)).toEqual({ type: "wellknown", key: env, token: "tok-123" })
  } finally {
    await Auth.remove(allowedBase)
    await Auth.remove(deniedBase)
    await api.stop()
    server.stop(true)
  }
}, 60_000)
