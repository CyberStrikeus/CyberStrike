import z from "zod"
import { Tool } from "./tool"
import path from "path"

const EBPF_DIR = path.resolve(import.meta.dir, "../../data/ebpf")

const AVAILABLE_PROGRAMS: Record<string, { description: string; args: string }> = {
  pam_sniff: {
    description:
      "Hook pam_get_authtok via eBPF uprobe — capture cleartext passwords for every PAM-authenticated session (SSH, sudo, su, login, screen lock)",
    args: "[--duration SECONDS] [--json-output]",
  },
  ssl_sniff: {
    description:
      "Hook SSL_write/SSL_read via eBPF uprobe on libssl.so — capture TLS plaintext before encryption and after decryption",
    args: "[--pid PID] [--duration SECONDS] [--json-output]",
  },
  dep_scan: {
    description:
      "Scan all running processes for loaded shared libraries via sys_openat kprobe, report library paths and identify potentially vulnerable dependencies",
    args: "[--pid PID] [--json-output]",
  },
  proc_hide: {
    description: "Hide a process from ps, top, htop, and /proc enumeration by hooking sys_getdents64 on /proc",
    args: "--pid PID [--json-output]",
  },
  file_hide: {
    description: "Hide files or directories from ls, find, and directory listings by hooking sys_getdents64",
    args: "--name FILENAME [--json-output]",
  },
  conn_hide: {
    description: "Hide network connections from netstat, ss, and /proc/net/tcp by hooking sys_read on procfs",
    args: "--port PORT [--json-output]",
  },
  execve_sniff: {
    description:
      "Monitor all process executions system-wide via sys_execve tracepoint — capture PID, PPID, command, and arguments",
    args: "[--duration SECONDS] [--json-output]",
  },
  dns_sniff: {
    description:
      "Capture DNS queries at the kernel level by hooking udp_sendmsg on port 53 — extract query name, type, and destination",
    args: "[--duration SECONDS] [--json-output]",
  },
  keylog: {
    description:
      "Capture keystrokes from TTY file descriptors by hooking sys_read on /dev/tty — outputs PID, process name, and captured input",
    args: "[--duration SECONDS] [--json-output]",
  },
  cleanup: {
    description:
      "Enumerate and detach all CyberStrike eBPF programs and maps from the system. Always run this before exiting a target",
    args: "[--json-output]",
  },
  io_uring_sniff: {
    description:
      "Monitor io_uring ring buffer operations — detect file, socket, and connect operations that bypass classical syscall hooks via submission queue entries (kernel 5.1+)",
    args: "[--duration SECONDS] [--pid PID] [--json-output] [--dangerous-only]",
  },
  memfd_exec: {
    description:
      "Detect fileless execution via memfd_create + execveat — correlate memory-only file creation with execution to identify diskless payload delivery",
    args: "[--duration SECONDS] [--json-output]",
  },
  ptrace_sniff: {
    description:
      "Monitor ptrace-based process injection — capture ATTACH, POKEDATA, SETREGS operations and detect shellcode injection sequences",
    args: "[--duration SECONDS] [--pid PID] [--json-output]",
  },
  crossmem_sniff: {
    description:
      "Monitor cross-process memory operations via process_vm_writev/readv — detect stealthy memory injection that bypasses ptrace-based detection",
    args: "[--duration SECONDS] [--json-output]",
  },
  userfaultfd_sniff: {
    description:
      "Monitor userfaultfd creation and page fault handling — detect race condition exploit primitives that use userspace page fault handlers for timing control",
    args: "[--duration SECONDS] [--json-output]",
  },
  bpf_integrity: {
    description:
      "Monitor bpf() syscall for program load/attach/detach operations and verify integrity of CyberStrike eBPF programs — detect tampering, unauthorized BPF program injection, and hook evasion",
    args: "[--duration SECONDS] [--json-output] [--baseline] [--check-interval SECONDS]",
  },
  netlink_sniff: {
    description:
      "Monitor netlink socket messages for stealthy network configuration changes — detect route manipulation, firewall rule injection, and policy routing modifications",
    args: "[--duration SECONDS] [--json-output] [--route-only]",
  },
  seccomp_sniff: {
    description:
      "Monitor prctl and seccomp syscalls for security profile self-modification — detect processes weakening their own sandboxes, changing names for masquerading, or disabling privilege restrictions",
    args: "[--duration SECONDS] [--json-output]",
  },
}

export const EbpfTool = Tool.define("ebpf", {
  description: `Execute an eBPF program for kernel-level operations on Linux. Requires root privileges on the target. Available programs: ${Object.keys(AVAILABLE_PROGRAMS).join(", ")}. These tools operate below userland monitoring and leave minimal forensic artifacts. Advanced evasion monitors (io_uring_sniff, memfd_exec, ptrace_sniff, crossmem_sniff, userfaultfd_sniff, bpf_integrity, netlink_sniff, seccomp_sniff) detect attack primitives that bypass classical syscall hooks. ALWAYS run cleanup before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(AVAILABLE_PROGRAMS) as [string, ...string[]]).describe(
      "eBPF program to execute. Options: " +
        Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    const scriptPath = path.join(EBPF_DIR, `${params.program}.py`)
    const file = Bun.file(scriptPath)
    if (!(await file.exists())) {
      return {
        title: `ebpf: ${params.program}`,
        output: `eBPF program not found: ${params.program}.py\n\nAvailable programs:\n${Object.entries(
          AVAILABLE_PROGRAMS,
        )
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
          "\n⚠ This program requires root privileges. Ensure you have escalated to root on the target before using eBPF tools.",
        )
      }
    }

    return {
      title: `ebpf: ${params.program}`,
      output: output.join(""),
      metadata: {
        program: params.program,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
