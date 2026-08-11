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

export type RunResult = { stdout: string; stderr: string; exitCode: number }

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
  const reads = Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()])
  const [stdout, stderr] = await Promise.race([reads, new Promise<[string, string]>((r) => setTimeout(() => r(["", "(timed out)"]), ms + 2000))])
  clearTimeout(timer)
  const exitCode = killed ? 124 : await proc.exited
  return { stdout, stderr, exitCode }
}

export function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}
