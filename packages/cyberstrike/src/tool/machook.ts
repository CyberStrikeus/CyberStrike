import z from "zod"
import { Tool } from "./tool"
import path from "path"

const MACHOOK_DIR = path.resolve(import.meta.dir, "../../data/machook")

const AVAILABLE_PROGRAMS: Record<string, { description: string; args: string }> = {
  keychain_dump: {
    description:
      "Extract passwords from macOS Keychain via security command and Keychain API — dumps login, system, and application keychains",
    args: "[--keychain PATH] [--json-output]",
  },
  chrome_creds: {
    description:
      "Extract Chrome and Safari saved passwords, cookies, and autofill data from local browser storage — decrypts via Safe Storage key",
    args: "[--browser chrome|safari|all] [--json-output]",
  },
  ssh_keys: {
    description:
      "Find and exfiltrate SSH private keys, known_hosts, authorized_keys, and SSH agent identities for all users",
    args: "[--user USER] [--json-output]",
  },
  tcc_bypass: {
    description:
      "Bypass Transparency, Consent, and Control (TCC) framework to access protected resources — camera, microphone, files, screen recording",
    args: "[--method direct|inject|reset] [--json-output]",
  },
  keylog_mac: {
    description:
      "Capture keystrokes via CGEventTap or IOKit HID API — logs key events with application context and window title",
    args: "[--duration SECONDS] [--json-output]",
  },
  dtrace_exec: {
    description:
      "Monitor all process executions system-wide via DTrace syscall::exec*: probes — capture PID, PPID, command, arguments (requires SIP disabled)",
    args: "[--duration SECONDS] [--json-output]",
  },
  dtrace_net: {
    description:
      "Monitor network connections via DTrace ip:::send and ip:::receive probes — capture source/dest IP, port, PID, bytes",
    args: "[--duration SECONDS] [--json-output]",
  },
  dtrace_file: {
    description:
      "Monitor file access via DTrace syscall::open*: probes — capture PID, process name, file path, flags",
    args: "[--duration SECONDS] [--pid PID] [--json-output]",
  },
  xprotect_check: {
    description:
      "Enumerate XProtect and MRT (Malware Removal Tool) signatures to identify what payloads and techniques would be detected",
    args: "[--json-output]",
  },
  gatekeeper_bypass: {
    description:
      "Remove com.apple.quarantine extended attribute from downloaded files to bypass Gatekeeper code signing checks",
    args: "--path PATH [--recursive] [--json-output]",
  },
  log_clear: {
    description:
      "Clear unified logging (ASL), audit logs at /var/audit/, system log archives, and crash reporter data",
    args: "[--json-output]",
  },
  cleanup_mac: {
    description:
      "Remove CyberStrike artifacts — LaunchAgents, DTrace scripts, log modifications, temporary files. ALWAYS run before leaving a target",
    args: "[--json-output]",
  },
}

export const MachookTool = Tool.define("machook", {
  description: `Execute a macOS post-exploitation program for credential harvesting, monitoring, and stealth operations. Most programs require root privileges. Available programs: ${Object.keys(AVAILABLE_PROGRAMS).join(", ")}. DTrace programs require SIP disabled or dtrace entitlement. ALWAYS run cleanup_mac before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(AVAILABLE_PROGRAMS) as [string, ...string[]]).describe(
      "macOS post-exploitation program to execute. Options: " +
        Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z
      .number()
      .optional()
      .default(120)
      .describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "darwin") {
      return {
        title: `machook: ${params.program}`,
        output: `machook requires macOS. Current platform: ${process.platform}\n\nUse 'ebpf' for Linux post-exploitation or 'winhook' for Windows.`,
        metadata: { program: params.program, exitCode: -1, hasStderr: false },
      }
    }

    const scriptPath = path.join(MACHOOK_DIR, `${params.program}.py`)
    const file = Bun.file(scriptPath)
    if (!(await file.exists())) {
      return {
        title: `machook: ${params.program}`,
        output: `Program not found: ${params.program}.py\n\nAvailable programs:\n${Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `  ${k}: ${v.description}\n    Usage: ${v.args}`)
          .join("\n")}`,
        metadata: { program: params.program, exitCode: -1, hasStderr: false },
      }
    }

    const proc = Bun.spawn(["python3", scriptPath, ...params.args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })

    const timeout = setTimeout(() => {
      proc.kill()
    }, params.timeout_seconds * 1000)

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])

    clearTimeout(timeout)
    const exitCode = await proc.exited

    const output = [stdout]
    if (stderr.trim()) output.push(`\n--- stderr ---\n${stderr}`)
    if (exitCode !== 0) {
      output.push(`\nExit code: ${exitCode}`)
      if (exitCode === 1 && stderr.includes("root")) {
        output.push(
          "\n⚠ This program requires root privileges. Ensure you have escalated to root on the target before using machook tools.",
        )
      }
    }

    return {
      title: `machook: ${params.program}`,
      output: output.join(""),
      metadata: {
        program: params.program,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
