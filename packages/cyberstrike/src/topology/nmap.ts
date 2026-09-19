import { createHash } from "node:crypto"
import { XMLParser } from "fast-xml-parser"
import z from "zod"
import { and, asc, eq } from "drizzle-orm"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Identifier } from "../id/id"
import { Database } from "../storage/db"
import { NmapScanTable } from "./nmap.sql"

export namespace NmapScan {
  const MAX_XML_BYTES = 10 * 1024 * 1024
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: false,
    allowBooleanAttributes: true,
  })

  const Address = z.object({
    address: z.string(),
    type: z.string(),
    vendor: z.string().optional(),
  })
  const Script = z.object({
    id: z.string(),
    output: z.string(),
  })
  const Service = z.object({
    name: z.string().optional(),
    product: z.string().optional(),
    version: z.string().optional(),
    extra: z.string().optional(),
    os: z.string().optional(),
    method: z.string().optional(),
    confidence: z.number().optional(),
    cpe: z.array(z.string()),
  })
  const Port = z.object({
    protocol: z.string(),
    port: z.number(),
    state: z.string(),
    reason: z.string().optional(),
    service: Service,
    scripts: z.array(Script),
  })
  const Os = z.object({
    name: z.string(),
    accuracy: z.number(),
    line: z.number().optional(),
    classes: z.array(
      z.object({
        type: z.string().optional(),
        vendor: z.string().optional(),
        family: z.string().optional(),
        generation: z.string().optional(),
        accuracy: z.number().optional(),
        cpe: z.array(z.string()),
      }),
    ),
  })
  const Hop = z.object({
    ttl: z.number(),
    address: z.string(),
    rtt: z.number().optional(),
    host: z.string().optional(),
  })
  export const Host = z.object({
    id: z.string(),
    status: z.string(),
    reason: z.string().optional(),
    addresses: z.array(Address),
    hostnames: z.array(z.string()),
    ports: z.array(Port),
    os: z.array(Os),
    trace: z.array(Hop),
    start: z.number().optional(),
    end: z.number().optional(),
  })
  export type Host = z.infer<typeof Host>

  export const Summary = z.object({
    scanner: z.string(),
    args: z.string().optional(),
    version: z.string().optional(),
    start: z.number().optional(),
    finished: z.number().optional(),
    elapsed: z.number().optional(),
    up: z.number(),
    down: z.number(),
    total: z.number(),
  })

  export const Data = z.object({
    summary: Summary,
    hosts: z.array(Host),
  })
  export type Data = z.infer<typeof Data>

  export const Info = Data.extend({
    id: Identifier.schema("nmap_scan"),
    sessionID: z.string(),
    name: z.string(),
    profile: z.string().optional(),
    command: z.string().optional(),
    source: z.string(),
    xmlHash: z.string(),
    time: z.number(),
  })
  export type Info = z.infer<typeof Info>

  export const Diff = z.object({
    from: z.string(),
    to: z.string(),
    addedHosts: z.array(z.string()),
    removedHosts: z.array(z.string()),
    changedHosts: z.array(
      z.object({
        host: z.string(),
        addedPorts: z.array(z.string()),
        removedPorts: z.array(z.string()),
        changedServices: z.array(z.string()),
      }),
    ),
  })
  export type Diff = z.infer<typeof Diff>

  export const Event = {
    Updated: BusEvent.define(
      "nmap.scan.updated",
      z.object({
        sessionID: z.string(),
        scanID: z.string(),
        hosts: z.number(),
      }),
    ),
  }

  const list = <T>(value: T | T[] | undefined): T[] => {
    if (value === undefined) return []
    return Array.isArray(value) ? value : [value]
  }
  const object = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Record<string, unknown>
  }
  const text = (value: unknown) => {
    if (typeof value === "string" || typeof value === "number") return String(value)
  }
  const number = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const cpe = (value: unknown) =>
    list(value)
      .map((item) => text(item))
      .filter((item): item is string => !!item)

  export function parse(xml: string): Data {
    if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw new Error("Nmap XML exceeds the 10 MiB import limit")
    const root = object(parser.parse(xml))
    const run = object(root?.nmaprun)
    if (!run) throw new Error("Input is not an Nmap XML document")

    const hosts = list(run.host).flatMap((value) => {
      const host = object(value)
      if (!host) return []
      const status = object(host.status)
      const addresses = list(host.address).flatMap((value) => {
        const address = object(value)
        const valueText = text(address?.addr)
        const type = text(address?.addrtype)
        if (!valueText || !type) return []
        return [{ address: valueText, type, vendor: text(address?.vendor) }]
      })
      const hostnames = list(object(host.hostnames)?.hostname)
        .map((value) => text(object(value)?.name))
        .filter((value): value is string => !!value)
      const ports = list(object(host.ports)?.port).flatMap((value) => {
        const port = object(value)
        if (!port) return []
        const portNumber = number(port?.portid)
        const protocol = text(port?.protocol)
        const portState = object(port?.state)
        if (portNumber === undefined || !protocol || !portState) return []
        const service = object(port.service)
        return [
          {
            protocol,
            port: portNumber,
            state: text(portState.state) ?? "unknown",
            reason: text(portState.reason),
            service: {
              name: text(service?.name),
              product: text(service?.product),
              version: text(service?.version),
              extra: text(service?.extrainfo),
              os: text(service?.ostype),
              method: text(service?.method),
              confidence: number(service?.conf),
              cpe: cpe(service?.cpe),
            },
            scripts: list(port.script).flatMap((value) => {
              const script = object(value)
              const id = text(script?.id)
              if (!id) return []
              return [{ id, output: text(script?.output) ?? "" }]
            }),
          },
        ]
      })
      const os = list(object(host.os)?.osmatch).flatMap((value) => {
        const match = object(value)
        if (!match) return []
        const name = text(match?.name)
        const accuracy = number(match?.accuracy)
        if (!name || accuracy === undefined) return []
        return [
          {
            name,
            accuracy,
            line: number(match?.line),
            classes: list(match.osclass).flatMap((value) => {
              const item = object(value)
              if (!item) return []
              return [
                {
                  type: text(item.type),
                  vendor: text(item.vendor),
                  family: text(item.osfamily),
                  generation: text(item.osgen),
                  accuracy: number(item.accuracy),
                  cpe: cpe(item.cpe),
                },
              ]
            }),
          },
        ]
      })
      const trace = list(object(host.trace)?.hop).flatMap((value) => {
        const hop = object(value)
        const ttl = number(hop?.ttl)
        const address = text(hop?.ipaddr)
        if (ttl === undefined || !address) return []
        return [{ ttl, address, rtt: number(hop?.rtt), host: text(hop?.host) }]
      })
      const primary = addresses.find((address) => address.type === "ipv4" || address.type === "ipv6")?.address
      const id = primary ?? hostnames[0]
      if (!id) return []
      return [
        {
          id,
          status: text(status?.state) ?? "unknown",
          reason: text(status?.reason),
          addresses,
          hostnames,
          ports,
          os,
          trace,
          start: number(host.starttime),
          end: number(host.endtime),
        },
      ]
    })

    const runstats = object(run.runstats)
    const finished = object(runstats?.finished)
    const stats = object(runstats?.hosts)
    return Data.parse({
      summary: {
        scanner: text(run.scanner) ?? "nmap",
        args: text(run.args),
        version: text(run.version),
        start: number(run.start),
        finished: number(finished?.time),
        elapsed: number(finished?.elapsed),
        up: number(stats?.up) ?? hosts.filter((host) => host.status === "up").length,
        down: number(stats?.down) ?? hosts.filter((host) => host.status === "down").length,
        total: number(stats?.total) ?? hosts.length,
      },
      hosts,
    })
  }

  const columns = {
    id: NmapScanTable.id,
    session_id: NmapScanTable.session_id,
    name: NmapScanTable.name,
    profile: NmapScanTable.profile,
    command: NmapScanTable.command,
    source: NmapScanTable.source,
    xml_hash: NmapScanTable.xml_hash,
    data: NmapScanTable.data,
    time_created: NmapScanTable.time_created,
  }

  type Row = Omit<typeof NmapScanTable.$inferSelect, "raw_xml">

  const map = (row: Row): Info => ({
    id: row.id,
    sessionID: row.session_id,
    name: row.name,
    profile: row.profile ?? undefined,
    command: row.command ?? undefined,
    source: row.source,
    xmlHash: row.xml_hash,
    time: row.time_created,
    ...row.data,
  })

  export function add(input: {
    sessionID: string
    name: string
    xml: string
    profile?: string
    command?: string
    source?: string
  }) {
    const data = parse(input.xml)
    const hash = createHash("sha256").update(input.xml).digest("hex")
    const duplicate = Database.use((db) =>
      db
        .select(columns)
        .from(NmapScanTable)
        .where(and(eq(NmapScanTable.session_id, input.sessionID), eq(NmapScanTable.xml_hash, hash)))
        .get(),
    )
    if (duplicate) return map(duplicate)
    const now = Date.now()
    const scan: Info = {
      id: Identifier.ascending("nmap_scan"),
      sessionID: input.sessionID,
      name: input.name.trim() || `Nmap scan ${new Date(now).toISOString()}`,
      profile: input.profile,
      command: input.command,
      source: input.source ?? "operator",
      xmlHash: hash,
      time: now,
      ...data,
    }
    Database.use((db) =>
      db
        .insert(NmapScanTable)
        .values({
          id: scan.id,
          session_id: scan.sessionID,
          name: scan.name,
          profile: scan.profile,
          command: scan.command,
          source: scan.source,
          xml_hash: scan.xmlHash,
          raw_xml: input.xml,
          data,
          time_created: now,
        })
        .run(),
    )
    Database.effect(() =>
      Bus.publish(Event.Updated, {
        sessionID: scan.sessionID,
        scanID: scan.id,
        hosts: scan.hosts.length,
      }),
    )
    return scan
  }

  export function get(scanID: string) {
    const row = Database.use((db) =>
      db.select(columns).from(NmapScanTable).where(eq(NmapScanTable.id, scanID)).get(),
    )
    return row ? map(row) : undefined
  }

  export function scans(sessionID: string) {
    return Database.use((db) =>
      db
        .select(columns)
        .from(NmapScanTable)
        .where(eq(NmapScanTable.session_id, sessionID))
        .orderBy(asc(NmapScanTable.id))
        .all(),
    ).map(map)
  }

  const hostName = (host: Host) => host.hostnames[0] ?? host.id
  const portKey = (port: Host["ports"][number]) => `${port.port}/${port.protocol}`
  const serviceKey = (port: Host["ports"][number]) =>
    [port.service.name, port.service.product, port.service.version, port.state].filter(Boolean).join(" ")

  export function diff(from: Info, to: Info): Diff {
    const before = new Map(from.hosts.map((host) => [host.id, host]))
    const after = new Map(to.hosts.map((host) => [host.id, host]))
    const addedHosts = [...after.keys()].filter((id) => !before.has(id)).map((id) => hostName(after.get(id)!))
    const removedHosts = [...before.keys()].filter((id) => !after.has(id)).map((id) => hostName(before.get(id)!))
    const changedHosts = [...after.keys()].flatMap((id) => {
      const oldHost = before.get(id)
      const newHost = after.get(id)
      if (!oldHost || !newHost) return []
      const oldPorts = new Map(oldHost.ports.map((port) => [portKey(port), port]))
      const newPorts = new Map(newHost.ports.map((port) => [portKey(port), port]))
      const addedPorts = [...newPorts.keys()].filter((port) => !oldPorts.has(port))
      const removedPorts = [...oldPorts.keys()].filter((port) => !newPorts.has(port))
      const changedServices = [...newPorts.keys()].filter(
        (port) => oldPorts.has(port) && serviceKey(oldPorts.get(port)!) !== serviceKey(newPorts.get(port)!),
      )
      if (!addedPorts.length && !removedPorts.length && !changedServices.length) return []
      return [{ host: hostName(newHost), addedPorts, removedPorts, changedServices }]
    })
    return { from: from.id, to: to.id, addedHosts, removedHosts, changedHosts }
  }
}
