import { describe, expect, test } from "bun:test"
import { Topology } from "../../src/topology"

describe("topology projection", () => {
  test("links assets, endpoints, and findings without sensitive bodies", () => {
    const graph = Topology.project({
      sessionID: "ses_test",
      time: 1,
      intel: [
        {
          id: "int_one",
          sessionID: "ses_test",
          type: "technology",
          title: "nginx 1.24",
          detail: "sensitive banner",
          source: "recon",
          asset: "example.test",
          confidenceLevel: "confirmed",
          tags: ["technology"],
          relatedEntries: [],
          status: "tested",
          position: 0,
          timeCreated: 1,
          timeUpdated: 1,
        },
      ],
      requests: [
        {
          id: "req_one",
          session_id: "ses_test",
          method: "GET",
          normalized_path: "/api/users",
          raw_request: "Authorization: secret",
          status: "processed",
          host: "api.example.test",
          origin: "https://api.example.test",
          response_status: 200,
          processed_response: "secret response",
          time: { created: 1, updated: 2 },
        },
      ],
      vulnerabilities: [
        {
          id: "vul_one",
          severity: "high",
          title: "IDOR exposes users",
          description: "sensitive evidence",
          endpoint: "/api/users",
          status: "approved",
        },
      ],
    })

    expect(graph.nodes.some((node) => node.kind === "asset" && node.label === "example.test")).toBe(true)
    expect(graph.nodes.some((node) => node.kind === "endpoint" && node.label === "GET /api/users")).toBe(true)
    expect(graph.nodes.some((node) => node.kind === "finding" && node.label === "IDOR exposes users")).toBe(true)
    expect(graph.edges.some((edge) => edge.kind === "vulnerable_to")).toBe(true)
    expect(JSON.stringify(graph)).not.toContain("secret")
    expect(JSON.stringify(graph)).not.toContain("sensitive")
  })

  test("omits dangling related edges", () => {
    const graph = Topology.project({
      sessionID: "ses_test",
      intel: [
        {
          id: "int_one",
          sessionID: "ses_test",
          type: "infrastructure",
          title: "Gateway",
          asset: "10.0.0.1",
          tags: [],
          relatedEntries: ["int_missing"],
          status: "new",
          position: 0,
          timeCreated: 1,
          timeUpdated: 1,
        },
      ],
      requests: [],
      vulnerabilities: [],
    })
    expect(graph.edges.some((edge) => edge.target === "intel_int_missing")).toBe(false)
  })

  test("merges the same host across intel and web capture", () => {
    const graph = Topology.project({
      sessionID: "ses_test",
      intel: [
        {
          id: "int_host",
          sessionID: "ses_test",
          type: "subdomain",
          title: "api.example.test",
          source: "osint",
          asset: "example.test",
          tags: [],
          relatedEntries: [],
          status: "new",
          position: 0,
          timeCreated: 1,
          timeUpdated: 1,
        },
      ],
      requests: [
        {
          id: "req_one",
          session_id: "ses_test",
          method: "GET",
          normalized_path: "/",
          status: "processed",
          host: "api.example.test",
          time: { created: 1, updated: 1 },
        },
      ],
      vulnerabilities: [],
    })
    const hosts = graph.nodes.filter((node) => node.kind === "host" && node.label === "api.example.test")
    expect(hosts).toHaveLength(1)
    expect(hosts[0]?.source).toBe("multiple")
  })
})
