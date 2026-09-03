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

  test("projects Nmap ports and routes", () => {
    const graph = Topology.project({
      sessionID: "ses_test",
      intel: [],
      requests: [],
      vulnerabilities: [],
      scans: [
        {
          id: "nms_test",
          sessionID: "ses_test",
          name: "Service scan",
          source: "nmap_scan",
          xmlHash: "hash",
          time: 1,
          summary: { scanner: "nmap", up: 1, down: 0, total: 1 },
          hosts: [
            {
              id: "192.0.2.10",
              status: "up",
              addresses: [{ address: "192.0.2.10", type: "ipv4" }],
              hostnames: ["api.example.test"],
              ports: [
                {
                  protocol: "tcp",
                  port: 443,
                  state: "open",
                  service: { name: "https", cpe: [] },
                  scripts: [],
                },
              ],
              os: [],
              trace: [{ ttl: 1, address: "192.0.2.1" }],
            },
          ],
        },
      ],
    })
    expect(graph.nodes.some((node) => node.kind === "service" && node.label === "443/tcp https")).toBe(true)
    expect(graph.edges.some((edge) => edge.kind === "exposes")).toBe(true)
    expect(graph.edges.some((edge) => edge.kind === "routes_to")).toBe(true)
  })

  test("uses the latest Nmap observation per host", () => {
    const host = (port: number) => ({
      id: "192.0.2.10",
      status: "up",
      addresses: [{ address: "192.0.2.10", type: "ipv4" }],
      hostnames: ["api.example.test"],
      ports: [
        {
          protocol: "tcp",
          port,
          state: "open",
          service: { name: port === 80 ? "http" : "https", cpe: [] },
          scripts: [],
        },
      ],
      os: [],
      trace: [],
    })
    const graph = Topology.project({
      sessionID: "ses_test",
      intel: [],
      requests: [],
      vulnerabilities: [],
      scans: [
        {
          id: "nms_old",
          sessionID: "ses_test",
          name: "Old",
          source: "nmap_scan",
          xmlHash: "old",
          time: 1,
          summary: { scanner: "nmap", up: 1, down: 0, total: 1 },
          hosts: [host(80)],
        },
        {
          id: "nms_new",
          sessionID: "ses_test",
          name: "New",
          source: "nmap_scan",
          xmlHash: "new",
          time: 2,
          summary: { scanner: "nmap", up: 1, down: 0, total: 1 },
          hosts: [host(443)],
        },
      ],
    })
    expect(graph.nodes.some((node) => node.label === "80/tcp http")).toBe(false)
    expect(graph.nodes.some((node) => node.label === "443/tcp https")).toBe(true)
  })

  test("projects every host in a multi-host Nmap scan", () => {
    const host = (address: string, port: number) => ({
      id: address,
      status: "up",
      addresses: [{ address, type: "ipv4" }],
      hostnames: [`host-${port}.example.test`],
      ports: [
        {
          protocol: "tcp",
          port,
          state: "open",
          service: { name: port === 22 ? "ssh" : "https", cpe: [] },
          scripts: [],
        },
      ],
      os: [],
      trace: [],
    })
    const graph = Topology.project({
      sessionID: "ses_test",
      intel: [],
      requests: [],
      vulnerabilities: [],
      scans: [
        {
          id: "nms_multi",
          sessionID: "ses_test",
          name: "Multi-host",
          source: "nmap_scan",
          xmlHash: "multi",
          time: 1,
          summary: { scanner: "nmap", up: 2, down: 0, total: 2 },
          hosts: [host("192.0.2.10", 22), host("192.0.2.11", 443)],
        },
      ],
    })

    expect(graph.nodes.filter((node) => node.kind === "host")).toHaveLength(2)
    expect(graph.nodes.some((node) => node.label === "22/tcp ssh")).toBe(true)
    expect(graph.nodes.some((node) => node.label === "443/tcp https")).toBe(true)
  })

  test("does not create traceroute self-loops or overwrite the host label", () => {
    const graph = Topology.project({
      sessionID: "ses_test",
      intel: [],
      requests: [],
      vulnerabilities: [],
      scans: [
        {
          id: "nms_trace",
          sessionID: "ses_test",
          name: "Trace",
          source: "nmap_scan",
          xmlHash: "trace",
          time: 1,
          summary: { scanner: "nmap", up: 1, down: 0, total: 1 },
          hosts: [
            {
              id: "192.0.2.10",
              status: "up",
              addresses: [{ address: "192.0.2.10", type: "ipv4" }],
              hostnames: ["api.example.test"],
              ports: [],
              os: [],
              trace: [
                { ttl: 1, address: "192.0.2.1", host: "gateway.example.test" },
                { ttl: 2, address: "192.0.2.10" },
              ],
            },
          ],
        },
      ],
    })
    const target = graph.nodes.find((node) => node.label === "api.example.test")
    expect(target).toBeDefined()
    expect(graph.edges.some((edge) => edge.source === edge.target)).toBe(false)
    expect(graph.edges.some((edge) => edge.target === target?.id && edge.kind === "routes_to")).toBe(true)
  })
})
