// Types
export type Finding = {
  checkId: string
  provider: string
  severity: string
  status: string
  resource: string
  title: string
  details: string
  remediation: string
  cwe?: string
}
export type HookResult = { output: string; findings: Finding[] }

export type StealthMode = "base64" | "memfd" | "shm"
export let activeStealth: StealthMode | undefined
export function setStealthState(stealth: StealthMode | undefined) {
  activeStealth = stealth
}

export type ExecMethod = "bash" | "sh" | "python3" | "perl" | "busybox" | "auto"
export let activeExec: ExecMethod = "bash"
export function setExecMethod(method: ExecMethod) {
  activeExec = method
}

export type RunResult = { stdout: string; stderr: string; exitCode: number }

export type EnvInfo = {
  shell: string
  bashAvailable: boolean
  shAvailable: boolean
  python3Available: boolean
  perlAvailable: boolean
  busyboxAvailable: boolean
  isRoot: boolean
  uid: number
  sudoAvailable: boolean
  sudoNopasswd: boolean
  kernelVersion: string
  kernelMajor: number
  kernelMinor: number
  distro: string
  distroVersion: string
  arch: string
  selinuxStatus: "enforcing" | "permissive" | "disabled" | "unknown"
  apparmorStatus: "enforcing" | "complain" | "disabled" | "unknown"
  inContainer: boolean
  containerType: string
  initSystem: "systemd" | "sysvinit" | "upstart" | "openrc" | "busybox" | "unknown"
  packageManager: "apt" | "yum" | "dnf" | "pacman" | "apk" | "zypper" | "unknown"
  hasCurl: boolean
  hasWget: boolean
  hasNetcat: boolean
  hasSocat: boolean
  hasNmap: boolean
  hasGcc: boolean
  recommendedExec: ExecMethod
}

let cachedEnv: EnvInfo | undefined

// Helpers
export async function run(cmd: string, args: string[], timeout: number): Promise<RunResult> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  } catch (e) {
    return { stdout: "", stderr: e instanceof Error ? e.message : String(e), exitCode: 127 }
  }
  const ms = timeout * 1000
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    proc.kill(9)
  }, ms)
  const reads = Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ])
  const [stdout, stderr] = await Promise.race([
    reads,
    new Promise<[string, string]>((r) => setTimeout(() => r(["", "(timed out)"]), ms + 2000)),
  ])
  clearTimeout(timer)
  const exitCode = killed ? 124 : await proc.exited
  return { stdout, stderr, exitCode }
}

export function toBase64(script: string): string {
  return typeof btoa === "function" ? btoa(script) : Buffer.from(script).toString("base64")
}

export function bash(script: string, timeout: number, stealth?: StealthMode): Promise<RunResult> {
  const mode = stealth || activeStealth
  if (!mode) {
    return run("bash", ["-c", script], timeout)
  }
  if (mode === "base64") {
    const encoded = toBase64(script)
    return run("bash", ["-c", `eval "$(echo ${encoded} | base64 -d)"`], timeout)
  }
  if (mode === "memfd") {
    const py = `
import ctypes, os, sys
libc = ctypes.CDLL("libc.so.6")
fd = libc.memfd_create(b"", 1)
script = ${JSON.stringify(script)}.encode()
os.write(fd, b"#!/bin/bash\\n" + script)
os.execve(f"/proc/self/fd/{fd}", ["bash"], dict(os.environ))
`.trim()
    return run("python3", ["-c", py], timeout)
  }
  const id = Math.random().toString(36).slice(2, 8)
  const shmPath = `/dev/shm/.cs_${id}`
  const wrapped = `trap "rm -f ${shmPath}" EXIT; echo ${toBase64(script)} | base64 -d > ${shmPath} && chmod +x ${shmPath} && ${shmPath}`
  return run("bash", ["-c", wrapped], timeout)
}

export function sh(script: string, timeout: number): Promise<RunResult> {
  return run("sh", ["-c", script], timeout)
}

export function python3(script: string, timeout: number): Promise<RunResult> {
  return run("python3", ["-c", script], timeout)
}

export function perl(script: string, timeout: number): Promise<RunResult> {
  return run("perl", ["-e", script], timeout)
}

export function busyboxExec(command: string, timeout: number): Promise<RunResult> {
  return run("busybox", ["sh", "-c", command], timeout)
}

export async function detectEnv(timeout: number): Promise<EnvInfo> {
  if (cachedEnv) return cachedEnv

  const check = async (cmd: string, args: string[]): Promise<boolean> => {
    try {
      const r = await run(cmd, args, timeout)
      return r.exitCode === 0
    } catch {
      return false
    }
  }

  const shellResult = await run("sh", ["-c", "echo $SHELL"], timeout).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }))
  const shell = shellResult.stdout.trim() || "/bin/sh"

  const [bashAvailable, python3Available, perlAvailable, busyboxAvailable] = await Promise.all([
    check("bash", ["--version"]),
    check("python3", ["--version"]),
    check("perl", ["-v"]),
    check("busybox", ["--help"]),
  ])

  const idResult = await run("sh", ["-c", "id -u"], timeout).catch(() => ({ stdout: "65534", stderr: "", exitCode: 1 }))
  const uid = parseInt(idResult.stdout.trim()) || 65534
  const isRoot = uid === 0

  const sudoResult = await run("sh", ["-c", "command -v sudo"], timeout).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }))
  const sudoAvailable = sudoResult.exitCode === 0
  let sudoNopasswd = false
  if (sudoAvailable) {
    const nopass = await run("sudo", ["-n", "true"], timeout).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }))
    sudoNopasswd = nopass.exitCode === 0
  }

  const unameResult = await run("sh", ["-c", "uname -r"], timeout).catch(() => ({
    stdout: "0.0.0",
    stderr: "",
    exitCode: 1,
  }))
  const kernelVersion = unameResult.stdout.trim()
  const kparts = kernelVersion.split(".")
  const kernelMajor = parseInt(kparts[0]) || 0
  const kernelMinor = parseInt(kparts[1]) || 0

  const archResult = await run("sh", ["-c", "uname -m"], timeout).catch(() => ({
    stdout: "unknown",
    stderr: "",
    exitCode: 1,
  }))
  const arch = archResult.stdout.trim()

  const distroScript = `
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "$ID $VERSION_ID"
elif [ -f /etc/redhat-release ]; then
  echo "rhel $(cat /etc/redhat-release | grep -oP '\\d+\\.\\d+')"
elif [ -f /etc/alpine-release ]; then
  echo "alpine $(cat /etc/alpine-release)"
else
  echo "unknown unknown"
fi
`
  const distroResult = await run("sh", ["-c", distroScript], timeout).catch(() => ({
    stdout: "unknown unknown",
    stderr: "",
    exitCode: 1,
  }))
  const dparts = distroResult.stdout.trim().split(" ")
  const distro = dparts[0] || "unknown"
  const distroVersion = dparts[1] || "unknown"

  const selinuxScript = `
if command -v getenforce >/dev/null 2>&1; then
  getenforce 2>/dev/null | tr '[:upper:]' '[:lower:]'
elif [ -f /sys/fs/selinux/enforce ]; then
  cat /sys/fs/selinux/enforce | grep -q 1 && echo enforcing || echo permissive
else
  echo disabled
fi
`
  const seResult = await run("sh", ["-c", selinuxScript], timeout).catch(() => ({
    stdout: "unknown",
    stderr: "",
    exitCode: 1,
  }))
  const seRaw = seResult.stdout.trim()
  const selinuxStatus = (
    ["enforcing", "permissive", "disabled"].includes(seRaw) ? seRaw : "unknown"
  ) as EnvInfo["selinuxStatus"]

  const aaScript = `
if command -v aa-status >/dev/null 2>&1; then
  aa-status 2>/dev/null | head -1 | grep -qi "enabled" && echo enforcing || echo disabled
elif [ -d /sys/kernel/security/apparmor ]; then
  echo enforcing
else
  echo disabled
fi
`
  const aaResult = await run("sh", ["-c", aaScript], timeout).catch(() => ({
    stdout: "unknown",
    stderr: "",
    exitCode: 1,
  }))
  const aaRaw = aaResult.stdout.trim()
  const apparmorStatus = (
    ["enforcing", "complain", "disabled"].includes(aaRaw) ? aaRaw : "unknown"
  ) as EnvInfo["apparmorStatus"]

  const containerScript = `
if [ -f /.dockerenv ]; then echo docker
elif grep -qa 'docker\|lxc\|kubepods\|containerd' /proc/1/cgroup 2>/dev/null; then
  grep -qa kubepods /proc/1/cgroup && echo kubernetes || (grep -qa lxc /proc/1/cgroup && echo lxc || echo docker)
elif grep -qa 'microsoft' /proc/version 2>/dev/null; then echo wsl
elif [ -f /run/.containerenv ]; then echo podman
else echo none
fi
`
  const contResult = await run("sh", ["-c", containerScript], timeout).catch(() => ({
    stdout: "none",
    stderr: "",
    exitCode: 1,
  }))
  const containerType = contResult.stdout.trim() || "none"
  const inContainer = containerType !== "none"

  const initScript = `
if [ -d /run/systemd/system ]; then echo systemd
elif [ -f /sbin/openrc ]; then echo openrc
elif [ -f /sbin/upstart ] || [ -d /etc/init ]; then echo upstart
elif [ -x /sbin/init ] && /sbin/init --version 2>&1 | grep -qi sysv; then echo sysvinit
elif command -v busybox >/dev/null 2>&1 && [ "$(readlink /sbin/init 2>/dev/null)" = "/bin/busybox" ]; then echo busybox
else echo unknown
fi
`
  const initResult = await run("sh", ["-c", initScript], timeout).catch(() => ({
    stdout: "unknown",
    stderr: "",
    exitCode: 1,
  }))
  const initSystem = (initResult.stdout.trim() || "unknown") as EnvInfo["initSystem"]

  const pkgScript = `
if command -v apt-get >/dev/null 2>&1; then echo apt
elif command -v dnf >/dev/null 2>&1; then echo dnf
elif command -v yum >/dev/null 2>&1; then echo yum
elif command -v pacman >/dev/null 2>&1; then echo pacman
elif command -v apk >/dev/null 2>&1; then echo apk
elif command -v zypper >/dev/null 2>&1; then echo zypper
else echo unknown
fi
`
  const pkgResult = await run("sh", ["-c", pkgScript], timeout).catch(() => ({
    stdout: "unknown",
    stderr: "",
    exitCode: 1,
  }))
  const packageManager = (pkgResult.stdout.trim() || "unknown") as EnvInfo["packageManager"]

  const [hasCurl, hasWget, hasNetcat, hasSocat, hasNmap, hasGcc] = await Promise.all([
    check("sh", ["-c", "command -v curl"]),
    check("sh", ["-c", "command -v wget"]),
    check("sh", ["-c", "command -v nc || command -v ncat || command -v netcat"]),
    check("sh", ["-c", "command -v socat"]),
    check("sh", ["-c", "command -v nmap"]),
    check("sh", ["-c", "command -v gcc || command -v cc"]),
  ])

  let recommendedExec: ExecMethod = "bash"
  if (!bashAvailable && python3Available) recommendedExec = "python3"
  if (!bashAvailable && !python3Available && perlAvailable) recommendedExec = "perl"
  if (!bashAvailable && !python3Available && !perlAvailable && busyboxAvailable) recommendedExec = "busybox"
  if (!bashAvailable && !python3Available && !perlAvailable && !busyboxAvailable) recommendedExec = "sh"

  cachedEnv = {
    shell,
    bashAvailable,
    shAvailable: true,
    python3Available,
    perlAvailable,
    busyboxAvailable,
    isRoot,
    uid,
    sudoAvailable,
    sudoNopasswd,
    kernelVersion,
    kernelMajor,
    kernelMinor,
    distro,
    distroVersion,
    arch,
    selinuxStatus,
    apparmorStatus,
    inContainer,
    containerType,
    initSystem,
    packageManager,
    hasCurl,
    hasWget,
    hasNetcat,
    hasSocat,
    hasNmap,
    hasGcc,
    recommendedExec,
  }
  return cachedEnv
}

export function resetEnvCache() {
  cachedEnv = undefined
}

export function resolveExec(requested: ExecMethod, env?: EnvInfo): ExecMethod {
  if (requested !== "auto") return requested
  if (!env) return activeExec !== "auto" ? activeExec : "bash"
  if (env.bashAvailable) return "bash"
  if (env.python3Available) return "python3"
  if (env.perlAvailable) return "perl"
  if (env.busyboxAvailable) return "busybox"
  return "sh"
}

export function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}
