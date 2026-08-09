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

export type RunResult = { stdout: string; stderr: string; exitCode: number }

export async function run(cmd: string, args: string[], timeout: number): Promise<RunResult> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

export function aws(args: string[], profile: string | undefined, region: string | undefined, timeout: number) {
  const extra = [
    ...(profile ? ["--profile", profile] : []),
    ...(region ? ["--region", region] : []),
    "--output",
    "json",
  ]
  return run("aws", [...args, ...extra], timeout)
}

export function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

export function tryJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
