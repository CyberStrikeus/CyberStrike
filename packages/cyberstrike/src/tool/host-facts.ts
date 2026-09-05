import z from "zod"
import { SystemCapabilities } from "../system/capabilities"
import { Tool } from "./tool"

export const HostFactsTool = Tool.define("host_facts", {
  description:
    "Inspect the local execution plane before choosing tools. Returns OS, virtualization, CPU, memory, interfaces, and a typed security-tool readiness inventory. This is read-only.",
  parameters: z.object({}),
  async execute() {
    const info = await SystemCapabilities.get()
    const ready = info.tools.filter((tool) => tool.available)
    return {
      title: `Execution plane: ${info.hostname}`,
      metadata: {
        hostname: info.hostname,
        platform: info.platform,
        virtualization: info.virtualization,
        ready: ready.length,
        total: info.tools.length,
      },
      output: [
        `Host: ${info.hostname} (${info.platform} ${info.release}, ${info.arch})`,
        `Virtualization: ${info.virtualization ?? "unknown"}`,
        `CPU: ${info.cpu.model} (${info.cpu.cores} cores)`,
        `Memory: ${Math.round(info.memory.free / 1024 / 1024)} MiB free / ${Math.round(info.memory.total / 1024 / 1024)} MiB`,
        `Interfaces: ${info.interfaces.map((item) => item.name).join(", ") || "none"}`,
        `Ready tools (${ready.length}/${info.tools.length}): ${ready.map((tool) => tool.name).join(", ") || "none"}`,
      ].join("\n"),
    }
  },
})
