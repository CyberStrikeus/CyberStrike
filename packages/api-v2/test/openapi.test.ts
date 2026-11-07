import { expect, test } from "bun:test"
import path from "path"

const doc = await Bun.file(path.join(import.meta.dir, "../openapi.json")).json()

test("exposes upstream's session endpoints", () => {
  expect(Object.keys(doc.paths)).toContain("/api/session")
  expect(doc.paths["/api/session"].get.operationId).toBe("session.list")
  expect(doc.paths["/api/session"].post.operationId).toBe("session.create")
})

test("exposes upstream's info endpoint", () => {
  expect(doc.paths["/api/info"].get.operationId).toBe("server.info")
})

test("every path is under /api except upstream's pairing link", () => {
  const outside = Object.keys(doc.paths).filter((p) => !p.startsWith("/api"))
  expect(outside).toEqual(["/auth/connect/{code}"])
})
