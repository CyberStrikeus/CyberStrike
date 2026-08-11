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

export async function run(cmd: string[], timeout = 30_000): Promise<RunResult> {
  const proc = Bun.spawnSync(cmd, { timeout })
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  }
}

export async function httpPost(
  url: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
  timeout = 15_000,
): Promise<{ status: number; body: string; headers: Headers }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await resp.text()
    return { status: resp.status, body: text, headers: resp.headers }
  } finally {
    clearTimeout(timer)
  }
}

export async function httpGet(
  url: string,
  headers?: Record<string, string>,
  timeout = 10_000,
): Promise<{ status: number; body: string; headers: Headers }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { ...headers },
      signal: controller.signal,
    })
    const text = await resp.text()
    return { status: resp.status, body: text, headers: resp.headers }
  } finally {
    clearTimeout(timer)
  }
}

export function argVal(args: string, flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const rest = args.slice(idx + flag.length).trim()
  const match = rest.match(/^"([^"]*)"/) || rest.match(/^(\S+)/)
  return match ? match[1] : undefined
}

export function hasFlag(args: string, flag: string): boolean {
  return args.includes(flag)
}
