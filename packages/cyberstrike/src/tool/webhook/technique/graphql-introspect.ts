import z from "zod"
import { Tool } from "../../tool"
import { webhookContext, toolResult, toolError } from "../define"
import type { HttpSender } from "../transport"

const INTROSPECTION_QUERY = `{"query":"{ __schema { queryType { name } mutationType { name } types { name kind fields { name type { name kind ofType { name kind ofType { name kind } } } args { name type { name kind ofType { name kind } } } isDeprecated deprecationReason } enumValues { name } inputFields { name type { name kind ofType { name kind } } } } } }"}`

const SENSITIVE = /password|secret|token|api_?key|auth|admin|internal|private|ssn|credit_?card|cvv|session/i

export namespace GraphqlIntrospect {
  export interface Field {
    name: string
    type: string
    sensitive: boolean
    deprecated: boolean
  }

  export interface SchemaType {
    name: string
    kind: string
    fields: Field[]
  }

  export interface Result {
    introspection: boolean
    bypass?: string
    queries: string[]
    mutations: string[]
    types: SchemaType[]
    sensitive: string[]
    deprecated: string[]
    requests: number
  }

  function typeName(t: any): string {
    if (!t) return "Unknown"
    if (t.name) return t.name
    if (t.ofType) return typeName(t.ofType)
    return t.kind || "Unknown"
  }

  function parse(data: any): Omit<Result, "introspection" | "bypass" | "requests"> {
    const schema = data?.__schema || data?.data?.__schema
    if (!schema) return { queries: [], mutations: [], types: [], sensitive: [], deprecated: [] }

    const queries: string[] = []
    const mutations: string[] = []
    const types: SchemaType[] = []
    const sensitive: string[] = []
    const deprecated: string[] = []

    const qname = schema.queryType?.name || "Query"
    const mname = schema.mutationType?.name || "Mutation"

    for (const t of schema.types || []) {
      if (t.name.startsWith("__")) continue
      const fields: Field[] = (t.fields || []).map((f: any) => {
        const tn = typeName(f.type)
        const flag = SENSITIVE.test(f.name)
        if (flag) sensitive.push(`${t.name}.${f.name}`)
        if (f.isDeprecated) deprecated.push(`${t.name}.${f.name}: ${f.deprecationReason || "no reason"}`)
        return { name: f.name, type: tn, sensitive: flag, deprecated: !!f.isDeprecated }
      })

      if (t.name === qname) queries.push(...fields.map((f) => f.name))
      if (t.name === mname) mutations.push(...fields.map((f) => f.name))

      if (fields.length > 0) types.push({ name: t.name, kind: t.kind, fields })
    }

    return { queries, mutations, types, sensitive, deprecated }
  }

  function tryParse(res: { status: number; body: string } | { error: string }) {
    if ("error" in res) return null
    if (res.status !== 200) return null
    try {
      const data = JSON.parse(res.body)
      if (data?.data?.__schema || data?.__schema) return parse(data)
    } catch {}
    return null
  }

  export async function run(url: string, sender: HttpSender): Promise<Result> {
    let requests = 0

    const res = await sender.send({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      body: INTROSPECTION_QUERY,
    })
    requests++
    const p1 = tryParse(res)
    if (p1) return { introspection: true, ...p1, requests }

    const encoded = encodeURIComponent("{ __schema { queryType { name } types { name kind fields { name type { name kind } isDeprecated deprecationReason } } } }")

    const res2 = await sender.send({
      method: "GET",
      url: `${url}?query=${encoded}`,
      headers: {},
    })
    requests++
    const p2 = tryParse(res2)
    if (p2) return { introspection: true, bypass: "GET query param", ...p2, requests }

    const res3 = await sender.send({
      method: "POST",
      url,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `query=${encoded}`,
    })
    requests++
    const p3 = tryParse(res3)
    if (p3) return { introspection: true, bypass: "form-urlencoded", ...p3, requests }

    return { introspection: false, queries: [], mutations: [], types: [], sensitive: [], deprecated: [], requests }
  }
}

const DESCRIPTION = `GraphQL introspection & schema mining. Sends introspection queries to a GraphQL endpoint, maps the full schema (types, queries, mutations, fields), and flags security-relevant elements.

Tries multiple introspection methods: standard POST, GET query param bypass, and form-urlencoded bypass — catches endpoints that only block the obvious approach.

**When to use:** When Vortex detects a /graphql or /api/graphql endpoint, or Content-Type: application/graphql.
**What it finds:** Full API schema, sensitive fields (password/token/admin), deprecated fields, mutations for privilege escalation.
**Output:** Schema map with types/queries/mutations + flagged sensitive fields.`

export const GraphqlIntrospectTool = Tool.define("graphql_introspect", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("GraphQL endpoint URL (e.g. https://target.com/graphql)."),
  }),
  async execute(params, ctx) {
    const wctx = webhookContext(ctx)
    const result = await GraphqlIntrospect.run(params.url, wctx.sender)
    if (!result.introspection)
      return toolResult("graphql_introspect", `introspection disabled (${result.requests} attempts)`, result)
    const label = `${result.types.length} types, ${result.queries.length} queries, ${result.mutations.length} mutations, ${result.sensitive.length} sensitive fields`
    return toolResult("graphql_introspect", label, result)
  },
})
