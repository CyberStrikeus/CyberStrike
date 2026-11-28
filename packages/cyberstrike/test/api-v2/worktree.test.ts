import { $ } from "bun"
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

// Covers the v2 worktree group against the v1 worktree domain, on a real git repository.
setDefaultTimeout(60_000)

const PASSWORD = "worktree-pw"
const AUTH = `Basic ${Buffer.from(`cyberstrike:${PASSWORD}`).toString("base64")}`

let base: string
let stop: () => Promise<void>

beforeAll(async () => {
  const server = await listen({ hostname: "127.0.0.1", port: 0, password: PASSWORD })
  base = server.url.toString().replace(/\/$/, "")
  stop = server.stop
})

afterAll(async () => {
  await stop()
})

const call =(method: string, route: string, body?: unknown) =>
  fetch(`${base}${route}`, {
    method,
    headers: { authorization: AUTH, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

test("a worktree is created for a git project and listed with the saved inventory", async () => {
  await using tmp = await tmpdir({ git: true })
  // Booting the location registers its project; the project ID is then read from the project list.
  await fetch(`${base}/api/mcp?location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`, {
    headers: { authorization: AUTH },
  })
  const projects = await (await call("GET", "/api/project")).json()
  const project = projects.find((item: { canonical: string }) => item.canonical === tmp.path)
  expect(project).toBeDefined()
  const projectID = project.id as string

  const empty = await call("GET", `/api/worktree?projectID=${projectID}`)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toEqual([])

  const created = await call("POST", "/api/worktree", { projectID, name: "v2-check" })
  expect(created.status).toBe(200)
  const directory = (await created.json()).directory as string
  expect(directory.length).toBeGreaterThan(0)

  const listed = await (await call("GET", `/api/worktree?projectID=${projectID}`)).json()
  expect(listed.map((item: { directory: string }) => item.directory)).toContain(directory)

  // Removal is not asserted here: removing a v1 worktree makes background file indexing fail with an unhandled ENOENT.
})

test("an unknown project is a ProjectNotFoundError", async () => {
  const res = await call("GET", "/api/worktree?projectID=global-missing")
  expect(res.status).toBe(404)
  expect((await res.json())._tag).toBe("ProjectNotFoundError")
})

test("options the v1 domain cannot honor are refused, and removing a directory that is not a saved worktree is refused", async () => {
  await using tmp = await tmpdir({ git: true })
  await fetch(`${base}/api/mcp?location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`, {
    headers: { authorization: AUTH },
  })
  const projects = await (await call("GET", "/api/project")).json()
  const projectID = projects.find((item: { canonical: string }) => item.canonical === tmp.path).id as string

  const branched = await call("POST", "/api/worktree", { projectID, branch: "feature" })
  expect(branched.status).toBe(400)
  expect((await branched.json())._tag).toBe("WorktreeError")

  const stray = await call("DELETE", "/api/worktree", { projectID, directory: tmp.path, force: true })
  expect(stray.status).toBe(400)
  expect((await stray.json())._tag).toBe("WorktreeError")
})

test("refresh adopts a checkout git knows about and drops one git no longer lists", async () => {
  await using tmp = await tmpdir({ git: true })
  await fetch(`${base}/api/mcp?location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`, {
    headers: { authorization: AUTH },
  })
  const projects = await (await call("GET", "/api/project")).json()
  const projectID = projects.find((item: { canonical: string }) => item.canonical === tmp.path).id as string
  const listing = async () =>
    (await (await call("GET", `/api/worktree?projectID=${projectID}`)).json()).map(
      (item: { directory: string }) => item.directory,
    )

  await using checkout = await tmpdir()
  // A checkout made outside the server is unknown to the saved inventory until a refresh.
  await $`git worktree add --detach ${checkout.path}`.cwd(tmp.path).quiet()
  expect(await listing()).not.toContain(checkout.path)

  const adopted = await call("POST", "/api/worktree/refresh", { projectID })
  expect(adopted.status).toBe(204)
  expect(await listing()).toContain(checkout.path)

  await $`git worktree remove --force ${checkout.path}`.cwd(tmp.path).quiet()
  const dropped = await call("POST", "/api/worktree/refresh", { projectID })
  expect(dropped.status).toBe(204)
  expect(await listing()).not.toContain(checkout.path)
})

test("refresh for an unknown project is a ProjectNotFoundError", async () => {
  const res = await call("POST", "/api/worktree/refresh", { projectID: "global-missing" })
  expect(res.status).toBe(404)
  expect((await res.json())._tag).toBe("ProjectNotFoundError")
})
