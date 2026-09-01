import { createHash } from "node:crypto"
import z from "zod"
import { Intel } from "../methodology/intel"
import { Request } from "../session/request"
import { Vulnerability } from "../session/vulnerability"
import { NmapScan } from "./nmap"

export namespace Topology {
  export const Kind = z.enum(["asset", "host", "service", "endpoint", "identity", "finding", "fact"])
  export type Kind = z.infer<typeof Kind>

  export const Node = z.object({
    id: z.string(),
    kind: Kind,
    label: z.string(),
    source: z.string(),
    status: z.string().optional(),
    severity: z.string().optional(),
    confidence: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  export type Node = z.infer<typeof Node>

  export const Edge = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    kind: z.string(),
  })
  export type Edge = z.infer<typeof Edge>

  export const Snapshot = z.object({
    sessionID: z.string(),
    nodes: Node.array(),
    edges: Edge.array(),
    time: z.number(),
  })
  export type Snapshot = z.infer<typeof Snapshot>

  const id = (prefix: string, value: string) =>
    `${prefix}_${createHash("sha256").update(value.toLowerCase().trim()).digest("hex").slice(0, 16)}`

  const kind = (type: Intel.Type): Kind => {
    if (type === "subdomain" || type === "infrastructure") return "host"
    if (type === "endpoint") return "endpoint"
    if (type === "technology" || type === "configuration" || type === "api_schema") return "service"
    if (type === "credential" || type === "authentication_flow") return "identity"
    if (type === "vulnerability_hint") return "finding"
    return "fact"
  }

  export function project(input: {
    sessionID: string
    intel: Intel.Entry[]
    requests: Request.Info[]
    vulnerabilities: Vulnerability.Info[]
    scans?: NmapScan.Info[]
    time?: number
  }): Snapshot {
    const nodes = new Map<string, Node>()
    const edges = new Map<string, Edge>()
    const endpoints = new Map<string, string>()
    const intel = new Map<string, string>()

    const node = (value: Node) => {
      const current = nodes.get(value.id)
      nodes.set(
        value.id,
        current
          ? {
              ...current,
              ...value,
              source: current.source === value.source ? current.source : "multiple",
              data: { ...current.data, ...value.data },
            }
          : value,
      )
      return value.id
    }
    const edge = (source: string, target: string, kind: string) => {
      const key = `${source}:${kind}:${target}`
      edges.set(key, { id: id("edge", key), source, target, kind })
    }
    const asset = (value: string, source: string) =>
      node({
        id: id("asset", value),
        kind: "asset",
        label: value,
        source,
        data: {},
      })

    for (const entry of input.intel) {
      const parent = asset(entry.asset, entry.source ?? "intel")
      const entryKind = kind(entry.type)
      const current = node({
        id: entryKind === "host" ? id("host", entry.title) : `intel_${entry.id}`,
        kind: entryKind,
        label: entry.title,
        source: entry.source ?? "intel",
        status: entry.status,
        severity: entry.severity,
        confidence: entry.confidenceLevel,
        data: {
          type: entry.type,
          intelID: entry.id,
          asset: entry.asset,
          tags: entry.tags,
          updatedAt: entry.timeUpdated,
        },
      })
      intel.set(entry.id, current)
      edge(parent, current, "observed")
      if (entry.type === "endpoint") endpoints.set(entry.title.toLowerCase().trim(), current)
    }

    for (const entry of input.intel) {
      const current = intel.get(entry.id)
      if (!current) continue
      for (const related of entry.relatedEntries) {
        const target = intel.get(related)
        if (target) edge(current, target, "related")
      }
    }

    for (const request of input.requests) {
      const host = request.host ?? request.origin ?? request.site ?? "Unknown web target"
      const parent = node({
        id: id("host", host),
        kind: "host",
        label: host,
        source: "web",
        status: request.status,
        data: {
          origin: request.origin,
          scheme: request.scheme,
          port: request.port,
          site: request.site,
        },
      })
      const key = `${request.method} ${request.origin ?? host}${request.normalized_path}`
      const current = node({
        id: id("endpoint", key),
        kind: "endpoint",
        label: `${request.method} ${request.normalized_path}`,
        source: "web",
        status: request.status,
        data: {
          requestID: request.id,
          origin: request.origin,
          protocol: request.protocol,
          operation: request.operation,
          responseStatus: request.response_status,
          updatedAt: request.time.updated,
        },
      })
      endpoints.set(request.normalized_path.toLowerCase().trim(), current)
      endpoints.set(key.toLowerCase().trim(), current)
      edge(parent, current, "exposes")
    }

    for (const finding of input.vulnerabilities) {
      const current = node({
        id: finding.id ? `finding_${finding.id}` : id("finding", `${finding.title}:${finding.endpoint ?? ""}`),
        kind: "finding",
        label: finding.title,
        source: "finding",
        status: finding.status,
        severity: finding.severity,
        confidence: finding.candidate ? "candidate" : "confirmed",
        data: {
          cwe: finding.cwe_id,
          endpoint: finding.endpoint,
          attackVector: finding.attack_vector,
          updatedAt: finding.time?.updated,
        },
      })
      const endpoint = finding.endpoint ? endpoints.get(finding.endpoint.toLowerCase().trim()) : undefined
      if (endpoint) edge(endpoint, current, "vulnerable_to")
    }

    const latest = new Map<string, { scan: NmapScan.Info; host: NmapScan.Host }>()
    for (const scan of (input.scans ?? []).toSorted((a, b) => a.time - b.time)) {
      for (const host of scan.hosts) latest.set(host.id, { scan, host })
    }
    for (const observation of latest.values()) {
      const scan = observation.scan
      const host = observation.host
        const current = node({
          id: id("host", host.id),
          kind: "host",
          label: host.hostnames[0] ?? host.id,
          source: "nmap",
          status: host.status,
          confidence: host.os[0] ? `${host.os[0].accuracy}%` : undefined,
          data: {
            addresses: host.addresses,
            os: host.os,
            scanID: scan.id,
            scanName: scan.name,
            scannedAt: scan.time,
          },
        })
        for (const port of host.ports) {
          const service = node({
            id: id("service", `${host.id}:${port.protocol}:${port.port}`),
            kind: "service",
            label: `${port.port}/${port.protocol} ${port.service.name ?? port.service.product ?? "unknown"}`,
            source: "nmap",
            status: port.state,
            data: {
              host: host.id,
              port: port.port,
              protocol: port.protocol,
              service: port.service,
              scripts: port.scripts,
              scanID: scan.id,
            },
          })
          edge(current, service, "exposes")
        }
        let prior: string | undefined
        const target = new Set(host.addresses.map((address) => address.address))
        for (const hop of host.trace.toSorted((a, b) => a.ttl - b.ttl)) {
          if (target.has(hop.address)) continue
          const hopNode = node({
            id: id("host", hop.address),
            kind: "host",
            label: hop.host ?? hop.address,
            source: "nmap",
            data: {
              address: hop.address,
              ttl: hop.ttl,
              rtt: hop.rtt,
              scanID: scan.id,
            },
          })
          if (prior) edge(prior, hopNode, "routes_to")
          prior = hopNode
        }
        if (prior) edge(prior, current, "routes_to")
    }

    return {
      sessionID: input.sessionID,
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      time: input.time ?? Date.now(),
    }
  }

  export function get(sessionID: string) {
    return project({
      sessionID,
      intel: Intel.get(sessionID),
      requests: Request.get(sessionID),
      vulnerabilities: Vulnerability.get(sessionID),
      scans: NmapScan.scans(sessionID),
    })
  }
}
