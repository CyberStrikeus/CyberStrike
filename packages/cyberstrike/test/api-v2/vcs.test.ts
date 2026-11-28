import { expect, test } from "bun:test"
import { $ } from "bun"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

test("vcs init, info, branches, base and diff answer from the repository", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const location = `location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`
  const call = (method: string, route: string) => fetch(new URL(route, server.url), { method })
  try {
    expect((await call("POST", `/api/vcs/init?${location}`)).status).toBe(204)
    expect((await call("POST", `/api/vcs/init?${location}`)).status).toBe(409)
    expect((await call("POST", `/api/vcs/init?${location}&provider=nope`)).status).toBe(400)

    await Bun.write(`${tmp.path}/a.txt`, "one\n")
    await $`git add a.txt && git -c user.email=t@t -c user.name=t commit -m first`.cwd(tmp.path).quiet()
    await Bun.write(`${tmp.path}/a.txt`, "one\ntwo\n")
    await Bun.write(`${tmp.path}/b.txt`, "new\n")

    const branch = (await $`git symbolic-ref --short HEAD`.cwd(tmp.path).text()).trim()
    const info = (await (await call("GET", `/api/vcs?${location}`)).json()).data
    expect(info.provider).toBe("git")
    expect(info.branch.current).toBe(branch)

    const working = (await (await call("GET", `/api/vcs/diff?${location}&mode=working`)).json()).data
    const byFile = Object.fromEntries(working.map((item: { file: string }) => [item.file, item]))
    expect(byFile["a.txt"]).toMatchObject({ status: "modified", additions: 1, deletions: 0 })
    expect(byFile["b.txt"]).toBeUndefined()

    const branches = (await (await call("GET", `/api/vcs/branch?${location}`)).json()).data
    expect(branches).toContain(branch)
    expect((await (await call("GET", `/api/vcs/branch?${location}&limit=1`)).json()).data).toHaveLength(1)

    expect((await call("GET", `/api/vcs/base?${location}`)).status).toBe(200)
    expect((await call("GET", `/api/vcs/diff?${location}&mode=branch`)).status).toBe(400)
  } finally {
    await server.stop()
  }
})

test("fs write stores the raw body under the location, creating parent directories", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const location = `location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`
  try {
    const response = await fetch(
      new URL(`/api/experimental/fs/write?${location}&path=${encodeURIComponent("deep/note.txt")}`, server.url),
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new TextEncoder().encode("hello"),
      },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.path).toBe(`${tmp.path}/deep/note.txt`)
    expect(await Bun.file(`${tmp.path}/deep/note.txt`).text()).toBe("hello")
  } finally {
    await server.stop()
  }
})
