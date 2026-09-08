import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { params, graphql, query } from "../src/index"

function tx(url: string, body: string, contentType: string, method = "POST"): Transaction {
  return { id: "t", source: "browser", host: "app.test", request: { method, url: `https://app.test${url}`, headers: [{ name: "content-type", value: contentType }], body } }
}

describe("multipart/form-data param extraction", () => {
  const boundary = "----WebKitFormBoundaryABC"
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="title"',
    "",
    "My Report",
    `--${boundary}`,
    'Content-Disposition: form-data; name="avatar"; filename="evil.svg"',
    "Content-Type: image/svg+xml",
    "",
    "<svg onload=alert(1)>",
    `--${boundary}--`,
    "",
  ].join("\r\n")

  test("surfaces text fields and file parts (name + filename)", () => {
    const p = params(tx("/upload", body, `multipart/form-data; boundary=${boundary}`))
    expect(p.body["title"]).toBe("My Report")
    expect(p.body["avatar"]).toBe("<file:evil.svg>")
    expect(p.body["avatar.filename"]).toBe("evil.svg")
  })

  test("HTTPQL can target a multipart file's filename (upload-attack surface)", () => {
    const corpus = [tx("/upload", body, `multipart/form-data; boundary=${boundary}`)]
    expect(query(corpus, "req.body.avatar.filename:~svg")).toHaveLength(1)
  })
})

describe("GraphQL awareness", () => {
  const gqlBody = JSON.stringify({ operationName: "GetUser", query: "query GetUser($id: ID!){ user(id:$id){ email } }", variables: { id: "42" } })

  test("parses operation, query and variables from a JSON POST", () => {
    const g = graphql(tx("/graphql", gqlBody, "application/json"))
    expect(g?.operationName).toBe("GetUser")
    expect(g?.query).toContain("user(id:$id)")
    expect(g?.variables).toEqual({ id: "42" })
  })
  test("undefined for a non-GraphQL JSON body", () => {
    expect(graphql(tx("/api/x", JSON.stringify({ foo: 1 }), "application/json"))).toBeUndefined()
  })
  test("GET ?query= form", () => {
    const g = graphql(tx("/graphql?query=" + encodeURIComponent("{ me { id } }"), "", "", "GET"))
    expect(g?.query).toContain("me")
  })
  test("HTTPQL graphql fields + variables via flattened body", () => {
    const corpus = [tx("/graphql", gqlBody, "application/json")]
    expect(query(corpus, "req.graphql.op:GetUser")).toHaveLength(1)
    expect(query(corpus, "req.graphql.query:~user")).toHaveLength(1)
    expect(query(corpus, "req.body.variables.id:42")).toHaveLength(1) // variables reachable via JSON flatten
  })
})
