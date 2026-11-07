import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { parse } from "../../src/api-v2/handlers/websearch"
import { tmpdir } from "../fixture/fixture"

// Exa's text reply: results separated by "---", each opening with Title, URL and Published lines.
const reply = [
  "Title: Effect | Production Grade TypeScript",
  "URL: https://effect.website/",
  "Published: N/A",
  "Author: N/A",
  "Highlights:",
  "Effect | Production Grade TypeScript",
  "",
  "---",
  "",
  "Title: effect",
  "URL: https://www.npmjs.com/package/effect",
  "Published: 2026-10-20T00:00:00.000Z",
  "Author: N/A",
  "Highlights:",
  "effect - npm",
].join("\n")

test("websearch parses Exa's text reply into results", () => {
  expect(parse(reply)).toEqual([
    {
      url: "https://effect.website/",
      title: "Effect | Production Grade TypeScript",
      content: "Effect | Production Grade TypeScript",
      time: { published: undefined },
    },
    {
      url: "https://www.npmjs.com/package/effect",
      title: "effect",
      content: "effect - npm",
      time: { published: Date.parse("2026-10-20T00:00:00.000Z") },
    },
  ])
  expect(parse("no results here")).toEqual([])
})

test("websearch lists the Exa provider and refuses queries the config denies or unknown providers", async () => {
  await using tmp = await tmpdir({
    config: { permission: { websearch: "deny" } },
  })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (route: string, body?: unknown) =>
    fetch(new URL(`${route}?directory=${encodeURIComponent(tmp.path)}`, server.url), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const providers = await (await call("/api/websearch/provider")).json()
    expect(providers.data).toEqual([{ id: "exa", name: "Exa" }])

    const unknown = await call("/api/websearch", { query: "effect", providerID: "nope" })
    expect(unknown.status).toBe(400)

    const denied = await call("/api/websearch", { query: "effect" })
    expect(denied.status).toBe(400)
    expect((await denied.json())._tag).toBe("InvalidRequestError")
  } finally {
    await server.stop()
  }
}, 60_000)
