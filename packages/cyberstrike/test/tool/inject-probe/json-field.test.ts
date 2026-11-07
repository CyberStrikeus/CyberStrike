import { describe, test, expect } from "bun:test"
import { setJsonField, setJsonValue } from "../../../src/tool/inject-probe/mutate"

describe("setJsonField", () => {
  test("sets a top-level field", () => {
    const result = JSON.parse(setJsonField('{"name":"alice"}', "name", "bob"))
    expect(result.name).toBe("bob")
  })

  test("sets a nested field", () => {
    const result = JSON.parse(setJsonField('{"user":{"name":"alice"}}', "user.name", "bob"))
    expect(result.user.name).toBe("bob")
  })

  test("creates intermediate objects for missing path", () => {
    const result = JSON.parse(setJsonField("{}", "a.b.c", "value"))
    expect(result.a.b.c).toBe("value")
  })

  test("preserves other fields", () => {
    const result = JSON.parse(setJsonField('{"name":"alice","age":30}', "name", "bob"))
    expect(result.name).toBe("bob")
    expect(result.age).toBe(30)
  })

  test("handles empty body as empty object", () => {
    const result = JSON.parse(setJsonField("", "key", "val"))
    expect(result.key).toBe("val")
  })

  test("returns original body for invalid JSON", () => {
    expect(setJsonField("not-json", "key", "val")).toBe("not-json")
  })

  test("overwrites non-object intermediate with object", () => {
    const result = JSON.parse(setJsonField('{"a":"string"}', "a.b", "val"))
    expect(result.a.b).toBe("val")
  })

  test("overwrites null intermediate with object", () => {
    const result = JSON.parse(setJsonField('{"a":null}', "a.b", "val"))
    expect(result.a.b).toBe("val")
  })
})

describe("setJsonValue", () => {
  test("sets a string value", () => {
    const result = JSON.parse(setJsonValue('{"key":"old"}', "key", "new"))
    expect(result.key).toBe("new")
  })

  test("sets an object value (NoSQL operator)", () => {
    const result = JSON.parse(setJsonValue('{"user":"admin"}', "user", { $ne: null }))
    expect(result.user).toEqual({ $ne: null })
  })

  test("sets null value", () => {
    const result = JSON.parse(setJsonValue('{"key":"val"}', "key", null))
    expect(result.key).toBeNull()
  })

  test("sets numeric value", () => {
    const result = JSON.parse(setJsonValue('{"count":0}', "count", 42))
    expect(result.count).toBe(42)
  })

  test("sets nested object value", () => {
    const result = JSON.parse(setJsonValue('{"a":{"b":"old"}}', "a.b", { $gt: "" }))
    expect(result.a.b).toEqual({ $gt: "" })
  })

  test("sets boolean value", () => {
    const result = JSON.parse(setJsonValue('{"active":true}', "active", false))
    expect(result.active).toBe(false)
  })

  test("returns original body for invalid JSON", () => {
    expect(setJsonValue("broken", "key", "val")).toBe("broken")
  })
})
