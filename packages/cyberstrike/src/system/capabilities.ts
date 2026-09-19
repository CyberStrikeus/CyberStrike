import os from "node:os"
import z from "zod"

export namespace SystemCapabilities {
  const tools = [
    "nmap",
    "masscan",
    "rustscan",
    "nuclei",
    "ffuf",
    "httpx",
    "subfinder",
    "amass",
    "sqlmap",
    "tshark",
    "tcpdump",
    "wireshark",
    "msfconsole",
    "netexec",
    "bloodhound-python",
    "docker",
    "podman",
    "ollama",
    "bun",
    "node",
    "npm",
  ] as const

  export const Info = z.object({
    hostname: z.string(),
    platform: z.string(),
    release: z.string(),
    arch: z.string(),
    virtualization: z.string().optional(),
    cpu: z.object({
      model: z.string(),
      cores: z.number(),
    }),
    memory: z.object({
      total: z.number(),
      free: z.number(),
    }),
    uptime: z.number(),
    interfaces: z.array(
      z.object({
        name: z.string(),
        addresses: z.array(
          z.object({
            address: z.string(),
            family: z.string(),
            internal: z.boolean(),
          }),
        ),
      }),
    ),
    tools: z.array(
      z.object({
        name: z.string(),
        available: z.boolean(),
        path: z.string().optional(),
      }),
    ),
    time: z.number(),
  })
  export type Info = z.infer<typeof Info>

  async function virtualization() {
    const binary = Bun.which("systemd-detect-virt")
    if (!binary) return
    const proc = Bun.spawn([binary], { stdout: "pipe", stderr: "ignore" })
    const [code, output] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
    if (code !== 0) return
    return output.trim() || undefined
  }

  export async function get(): Promise<Info> {
    const cpus = os.cpus()
    const interfaces = os.networkInterfaces()
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      virtualization: await virtualization(),
      cpu: {
        model: cpus[0]?.model ?? "unknown",
        cores: cpus.length,
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
      },
      uptime: os.uptime(),
      interfaces: Object.entries(interfaces).map(([name, addresses]) => ({
        name,
        addresses: (addresses ?? []).map((address) => ({
          address: address.address,
          family: address.family,
          internal: address.internal,
        })),
      })),
      tools: tools.map((name) => {
        const path = Bun.which(name)
        return {
          name,
          available: !!path,
          path: path ?? undefined,
        }
      }),
      time: Date.now(),
    }
  }
}
