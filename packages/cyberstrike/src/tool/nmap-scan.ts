import z from "zod"
import { NmapScan } from "../topology/nmap"
import { Tool } from "./tool"
import { Session } from "../session"

const Target = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.startsWith("-") && /^[A-Za-z0-9._:/-]+$/.test(value), "Use a domain, IP, range, or CIDR")

const Ports = z
  .string()
  .trim()
  .max(500)
  .regex(/^[0-9,TU:-]+$/i, "Ports must use Nmap numeric port/range syntax")

const Profile = z.enum(["quick", "service", "os", "comprehensive"])

const profiles: Record<z.infer<typeof Profile>, string[]> = {
  quick: ["-T4", "-F"],
  service: ["-T4", "-sV"],
  os: ["-T4", "-sV", "-O"],
  comprehensive: ["-T4", "-sV", "-O", "-sC"],
}

const invocation = (input: {
  binary: string
  profile: z.infer<typeof Profile>
  sudo?: string
  platform?: NodeJS.Platform
  uid?: number
}) => {
  const privileged = input.profile === "os" || input.profile === "comprehensive"
  if (!privileged || input.platform === "win32" || input.uid === 0) {
    return { argv: [input.binary], privileged }
  }
  if (!input.sudo) throw new Error("This Nmap profile requires root or passwordless sudo on this execution plane")
  return { argv: [input.sudo, "-n", input.binary], privileged }
}

const scope = (target: string, privileged: boolean) => `${privileged ? "elevated" : "standard"}:${target}`

export const NmapScanTool = Tool.define("nmap_scan", {
  description:
    "Run an authorized Nmap profile, stream progress, persist canonical XML, and update topology. This performs active network testing and always requires explicit target approval.",
  parameters: z.object({
    target: Target.describe("Authorized domain, IP, range, or CIDR"),
    profile: Profile.default("service").describe("quick, service, os, or comprehensive"),
    ports: Ports.optional().describe("Optional numeric Nmap port/range syntax"),
    name: z.string().trim().min(1).max(200).optional().describe("Saved scan name"),
    timeout: z.number().int().min(10).max(1_800).default(300).describe("Timeout in seconds"),
  }),
  async execute(params, ctx) {
    const binary = Bun.which("nmap")
    if (!binary) throw new Error("Nmap is not installed on this execution plane")
    const exec = invocation({
      binary,
      profile: params.profile,
      sudo: Bun.which("sudo") ?? undefined,
      platform: process.platform,
      uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    })
    const args = [
      ...profiles[params.profile],
      ...(params.ports ? ["-p", params.ports] : []),
      "--stats-every",
      "5s",
      "-oX",
      "-",
      params.target,
    ]
    const command = [...exec.argv, ...args].join(" ")
    await ctx.ask({
      permission: "nmap_scan",
      patterns: [scope(params.target, exec.privileged)],
      always: [scope(params.target, exec.privileged)],
      metadata: {
        target: params.target,
        profile: params.profile,
        ports: params.ports,
        privileged: exec.privileged,
        executor: exec.argv[0],
        command,
      },
    })

    const proc = Bun.spawn([...exec.argv, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const decoder = new TextDecoder()
    const progress = async () => {
      const reader = proc.stderr.getReader()
      let output = ""
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return output
        output += decoder.decode(chunk.value, { stream: true })
        ctx.metadata({
          title: `Nmap ${params.target}`,
          metadata: {
            target: params.target,
            profile: params.profile,
            progress: output.slice(-4_000),
          },
        })
      }
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, params.timeout * 1_000)
    const abort = () => proc.kill()
    ctx.abort.addEventListener("abort", abort, { once: true })
    const [xml, stderr, code] = await Promise.all([new Response(proc.stdout).text(), progress(), proc.exited]).finally(
      () => {
        clearTimeout(timer)
        ctx.abort.removeEventListener("abort", abort)
      },
    )
    if (ctx.abort.aborted) throw new Error("Nmap scan aborted")
    if (timedOut) throw new Error(`Nmap scan exceeded ${params.timeout} seconds`)
    if (code !== 0) throw new Error(`Nmap exited with code ${code}: ${stderr.trim().slice(-2_000)}`)

    const scan = NmapScan.add({
      sessionID: Session.root(ctx.sessionID),
      name: params.name ?? `${params.profile} scan of ${params.target}`,
      profile: params.profile,
      command,
      source: "nmap_scan",
      xml,
    })
    return {
      title: scan.name,
      metadata: {
        scanID: scan.id,
        target: params.target,
        profile: params.profile,
        hosts: scan.hosts.length,
        up: scan.summary.up,
        down: scan.summary.down,
        total: scan.summary.total,
        xmlHash: scan.xmlHash,
      },
      output: [
        `Saved Nmap scan ${scan.id}`,
        `Hosts: ${scan.summary.up} up, ${scan.summary.down} down, ${scan.summary.total} total`,
        `Open ports: ${scan.hosts.flatMap((host) => host.ports.filter((port) => port.state === "open")).length}`,
        `XML SHA-256: ${scan.xmlHash}`,
      ].join("\n"),
    }
  },
})

export const NmapScanParameters = {
  Target,
  Ports,
  Profile,
  Invocation: invocation,
  Scope: scope,
}
