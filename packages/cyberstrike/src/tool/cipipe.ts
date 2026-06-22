import z from "zod"
import { Tool } from "./tool"
import path from "path"

const CIPIPE_DIR = path.resolve(import.meta.dir, "../../data/cipipe")

const AVAILABLE_PROGRAMS: Record<string, { description: string; args: string }> = {
  gh_secrets: {
    description:
      "Extract GitHub Actions secrets via workflow injection or log analysis. Creates dispatch workflow that exfiltrates secrets to controlled endpoint",
    args: "--repo OWNER/REPO [--token TOKEN] [--method dispatch|logs] [--json-output]",
  },
  jenkins_creds: {
    description:
      "Dump Jenkins credentials: access credentials.xml via API, execute Groovy scripts via Script Console, extract build environment variables",
    args: "--url JENKINS_URL [--username USER] [--token TOKEN] [--method api|console|env] [--json-output]",
  },
  pipeline_inject: {
    description:
      "Inject malicious steps into CI/CD pipeline configurations (.github/workflows, Jenkinsfile, .gitlab-ci.yml) via API",
    args: "--repo OWNER/REPO --callback-url URL [--platform github|gitlab] [--token TOKEN] [--json-output]",
  },
  gitlab_tokens: {
    description:
      "Extract GitLab CI/CD variables (project and group level), runner registration tokens, and personal access tokens via GitLab API",
    args: "--url GITLAB_URL --project-id ID [--token TOKEN] [--json-output]",
  },
  cleanup_ci: {
    description:
      "Remove injected pipeline modifications, close created PRs, delete branches, and revert workflow changes. ALWAYS run before leaving",
    args: "[--token TOKEN] [--json-output]",
  },
}

export const CipipeTool = Tool.define("cipipe", {
  description: `Execute a CI/CD pipeline attack program after gaining access to CI/CD systems (GitHub, Jenkins, GitLab). Available programs: ${Object.keys(AVAILABLE_PROGRAMS).join(", ")}. ALWAYS run cleanup_ci before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(AVAILABLE_PROGRAMS) as [string, ...string[]]).describe(
      "CI/CD program to execute. Options: " +
        Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const scriptPath = path.join(CIPIPE_DIR, `${params.program}.py`)
    const file = Bun.file(scriptPath)
    if (!(await file.exists())) {
      return {
        title: `cipipe: ${params.program}`,
        output: `CI/CD program not found: ${params.program}.py\n\nAvailable programs:\n${Object.entries(
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
      if (stderr.includes("ModuleNotFoundError") && stderr.includes("requests")) {
        output.push("\n⚠ requests library required. Install with: pip3 install requests")
      }
      if (stderr.includes("401") || stderr.includes("403") || stderr.includes("Unauthorized")) {
        output.push(
          "\n⚠ Authentication failed. Provide valid token via --token or set GITHUB_TOKEN/JENKINS_TOKEN/GITLAB_TOKEN",
        )
      }
    }

    return {
      title: `cipipe: ${params.program}`,
      output: output.join(""),
      metadata: {
        program: params.program,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
