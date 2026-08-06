import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  github_actions_audit: {
    description:
      "Audit GitHub Actions workflows: dangerous triggers (pull_request_target, workflow_dispatch), script injection via untrusted input (${{ }}), excessive permissions",
    args: "--repo OWNER/REPO [--token TOKEN]",
  },
  github_permissions_audit: {
    description:
      "Check GITHUB_TOKEN permission scope in workflows: write-all defaults, per-job permission declarations, missing permissions block",
    args: "--repo OWNER/REPO [--token TOKEN]",
  },
  github_actions_pinning_audit: {
    description:
      "Check if GitHub Actions are pinned to SHA commits vs mutable tags. Detect unpinned third-party actions vulnerable to tag poisoning",
    args: "--repo OWNER/REPO [--token TOKEN]",
  },
  github_secrets_exposure_audit: {
    description:
      "Audit GitHub Actions for potential secret leakage: secrets in logs, env dump steps, artifact uploads with secrets, mask bypass patterns",
    args: "--repo OWNER/REPO [--token TOKEN]",
  },
  github_runner_audit: {
    description:
      "Check for self-hosted runner usage, runner labels, and workflows that run on self-hosted runners with dangerous triggers",
    args: "--repo OWNER/REPO [--token TOKEN]",
  },
  github_branch_protection_audit: {
    description:
      "Audit branch protection rules: required reviews, status checks, force push, deletion protection, signed commits, admin bypass",
    args: "--repo OWNER/REPO [--token TOKEN]",
  },
  dependency_audit: {
    description:
      "Check for dependency confusion risks: private package names in public registries, lockfile integrity, install scripts in dependencies",
    args: "[--path DIR] [--package-manager npm|yarn|pnpm|bun]",
  },
  supply_chain_audit: {
    description:
      "Audit software supply chain: Dependabot/Renovate config, SBOM generation, SLSA provenance, Sigstore signing, reproducible builds",
    args: "--repo OWNER/REPO [--token TOKEN] [--path DIR]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = { checkId: string; provider: string; severity: string; status: string; resource: string; title: string; details: string; remediation: string }
type AuditResult = { output: string; findings: Finding[] }

// ── Helpers ──

async function exec(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

function formatFindings(tool: string, findings: Finding[]): string {
  const crit = findings.filter(f => f.severity === "critical").length
  const high = findings.filter(f => f.severity === "high").length
  const med = findings.filter(f => f.severity === "medium").length
  const lines = [`\n${"=".repeat(60)}`, `${tool} — ${findings.length} finding(s) (critical: ${crit}, high: ${high}, medium: ${med})\n`]
  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.title}`)
    lines.push(`  Resource: ${f.resource}`)
    lines.push(`  ${f.details}`)
    lines.push(`  Fix: ${f.remediation}\n`)
  }
  return lines.join("\n")
}

// ── Programs ──

async function githubActionsAudit(args: string[], timeout: number): Promise<AuditResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing GitHub Actions workflows for ${repo}...\n`]

  const wf = await gh(["api", `repos/${repo}/contents/.github/workflows`, "--paginate"], token, timeout)
  if (wf.exitCode !== 0) {
    output.push(`[-] Cannot list workflows: ${wf.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings }
  }

  const files = tryJson(wf.stdout) || []
  output.push(`[*] Found ${files.length} workflow file(s)`)

  for (const file of files) {
    if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) continue
    const content = await gh(["api", `repos/${repo}/contents/${file.path}`, "--jq", ".content"], token, timeout)
    if (content.exitCode !== 0) continue
    const decoded = Buffer.from(content.stdout.trim(), "base64").toString("utf-8")
    const name = file.name

    if (decoded.includes("pull_request_target")) {
      output.push(`  [!] ${name}: uses pull_request_target trigger`)
      findings.push({
        checkId: "CI-GHA-001",
        provider: "github",
        severity: "critical",
        status: "FAIL",
        resource: `${repo}/.github/workflows/${name}`,
        title: `Dangerous trigger: pull_request_target in ${name}`,
        details: "pull_request_target runs in the context of the base branch with write access and secrets. Combined with checkout of PR code, this enables code execution with elevated privileges.",
        remediation: "Use pull_request trigger instead. If pull_request_target is needed, never checkout PR head code or use it in run steps.",
      })
    }

    const exprMatches = decoded.match(/\$\{\{\s*(github\.event\.(issue|pull_request|comment|review|discussion)\.(title|body|head\.ref)|github\.head_ref)/g) || []
    for (const expr of exprMatches) {
      findings.push({
        checkId: "CI-GHA-002",
        provider: "github",
        severity: "high",
        status: "FAIL",
        resource: `${repo}/.github/workflows/${name}`,
        title: `Script injection via untrusted input: ${expr}`,
        details: `Expression "${expr}" interpolates user-controlled input directly into a workflow step. An attacker can inject arbitrary commands via PR title, body, or branch name.`,
        remediation: "Store the value in an environment variable first, then reference $ENV_VAR. Never interpolate untrusted input directly in run: blocks.",
      })
      output.push(`  [!] ${name}: script injection — ${expr}`)
    }

    if (decoded.includes("workflow_dispatch") && decoded.includes("${{ github.event.inputs")) {
      findings.push({
        checkId: "CI-GHA-003",
        provider: "github",
        severity: "medium",
        status: "FAIL",
        resource: `${repo}/.github/workflows/${name}`,
        title: `Workflow dispatch input used unsafely in ${name}`,
        details: "workflow_dispatch inputs are interpolated via ${{ github.event.inputs.* }} which can contain shell metacharacters.",
        remediation: "Store dispatch inputs in environment variables before use in run: blocks.",
      })
    }

    if (decoded.includes("if: always()") || decoded.includes("if: ${{ always() }}")) {
      const hasSecrets = decoded.includes("secrets.") && decoded.includes("always()")
      if (hasSecrets) {
        findings.push({
          checkId: "CI-GHA-004",
          provider: "github",
          severity: "medium",
          status: "FAIL",
          resource: `${repo}/.github/workflows/${name}`,
          title: `Secrets used in always() step in ${name}`,
          details: "A step with if: always() that uses secrets will run even on cancelled/failed workflows, potentially exposing secrets in error paths.",
          remediation: "Avoid using secrets in steps with if: always(). Use if: success() or remove the condition.",
        })
      }
    }
  }

  output.push(formatFindings("github_actions_audit", findings))
  return { output: output.join("\n"), findings }
}

async function githubPermissionsAudit(args: string[], timeout: number): Promise<AuditResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing GITHUB_TOKEN permissions for ${repo}...\n`]

  const wf = await gh(["api", `repos/${repo}/contents/.github/workflows`, "--paginate"], token, timeout)
  if (wf.exitCode !== 0) return { output: `[-] Cannot list workflows: ${wf.stderr.slice(0, 200)}`, findings }

  const files = tryJson(wf.stdout) || []
  for (const file of files) {
    if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) continue
    const content = await gh(["api", `repos/${repo}/contents/${file.path}`, "--jq", ".content"], token, timeout)
    if (content.exitCode !== 0) continue
    const decoded = Buffer.from(content.stdout.trim(), "base64").toString("utf-8")
    const name = file.name

    if (!decoded.includes("permissions:")) {
      output.push(`  [!] ${name}: no permissions block — uses default (potentially write-all)`)
      findings.push({
        checkId: "CI-PERM-001",
        provider: "github",
        severity: "high",
        status: "FAIL",
        resource: `${repo}/.github/workflows/${name}`,
        title: `No permissions block in ${name}`,
        details: "Workflow has no top-level or job-level permissions declaration. It inherits the repository default, which may be write-all.",
        remediation: "Add a top-level permissions: block with minimum required scopes. Set repository default to read-all in Settings > Actions > General.",
      })
    }

    if (decoded.includes("permissions: write-all") || decoded.includes("permissions:\n      contents: write")) {
      output.push(`  [!] ${name}: has write permissions`)
    }

    const writePerms = ["contents: write", "packages: write", "deployments: write", "id-token: write", "actions: write", "security-events: write"]
    for (const perm of writePerms) {
      if (decoded.includes(perm)) {
        output.push(`  [*] ${name}: ${perm}`)
      }
    }
  }

  const defaultPerms = await gh(["api", `repos/${repo}`, "--jq", ".permissions"], token, timeout)
  if (defaultPerms.exitCode === 0) {
    output.push(`\n[*] Repository permissions: ${defaultPerms.stdout.trim()}`)
  }

  output.push(formatFindings("github_permissions_audit", findings))
  return { output: output.join("\n"), findings }
}

async function githubActionsPinningAudit(args: string[], timeout: number): Promise<AuditResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing GitHub Actions pinning for ${repo}...\n`]

  const wf = await gh(["api", `repos/${repo}/contents/.github/workflows`, "--paginate"], token, timeout)
  if (wf.exitCode !== 0) return { output: `[-] Cannot list workflows: ${wf.stderr.slice(0, 200)}`, findings }

  const files = tryJson(wf.stdout) || []
  for (const file of files) {
    if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) continue
    const content = await gh(["api", `repos/${repo}/contents/${file.path}`, "--jq", ".content"], token, timeout)
    if (content.exitCode !== 0) continue
    const decoded = Buffer.from(content.stdout.trim(), "base64").toString("utf-8")
    const name = file.name

    const usesMatches = decoded.match(/uses:\s*([^\s#]+)/g) || []
    for (const match of usesMatches) {
      const action = match.replace("uses:", "").trim()
      if (action.startsWith("./") || action.startsWith("docker://")) continue

      const parts = action.split("@")
      if (parts.length < 2) continue
      const ref = parts[1]

      if (/^[a-f0-9]{40}$/.test(ref)) {
        output.push(`  [+] ${name}: ${action} — pinned to SHA`)
        continue
      }

      if (parts[0].startsWith("actions/")) {
        if (ref === "v1" || ref === "v2" || ref === "v3" || ref === "v4" || ref === "v5") {
          output.push(`  [*] ${name}: ${action} — official action, major version tag`)
          continue
        }
      }

      output.push(`  [!] ${name}: ${action} — NOT pinned to SHA`)
      findings.push({
        checkId: "CI-PIN-001",
        provider: "github",
        severity: "high",
        status: "FAIL",
        resource: `${repo}/.github/workflows/${name}`,
        title: `Unpinned action: ${action}`,
        details: `Action "${parts[0]}" is referenced by tag "${ref}" instead of a commit SHA. A compromised or hijacked tag can inject malicious code into your pipeline.`,
        remediation: `Pin to a full SHA: uses: ${parts[0]}@<sha> # ${ref}. Use Dependabot or Renovate to keep SHAs updated.`,
      })
    }
  }

  output.push(formatFindings("github_actions_pinning_audit", findings))
  return { output: output.join("\n"), findings }
}

async function githubSecretsExposureAudit(args: string[], timeout: number): Promise<AuditResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing secret exposure risks for ${repo}...\n`]

  const wf = await gh(["api", `repos/${repo}/contents/.github/workflows`, "--paginate"], token, timeout)
  if (wf.exitCode !== 0) return { output: `[-] Cannot list workflows: ${wf.stderr.slice(0, 200)}`, findings }

  const files = tryJson(wf.stdout) || []
  for (const file of files) {
    if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) continue
    const content = await gh(["api", `repos/${repo}/contents/${file.path}`, "--jq", ".content"], token, timeout)
    if (content.exitCode !== 0) continue
    const decoded = Buffer.from(content.stdout.trim(), "base64").toString("utf-8")
    const name = file.name
    const lines = decoded.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/echo.*\$\{\{\s*secrets\./.test(line)) {
        findings.push({
          checkId: "CI-SEC-001",
          provider: "github",
          severity: "critical",
          status: "FAIL",
          resource: `${repo}/.github/workflows/${name}:${i + 1}`,
          title: `Secret echoed to log in ${name}:${i + 1}`,
          details: `Line contains echo with secrets interpolation. GitHub masks known secret values but echo can bypass masking via encoding or splitting.`,
          remediation: "Never echo secrets. Use them only in env: blocks or pass directly to commands.",
        })
        output.push(`  [!] ${name}:${i + 1}: echo with secrets`)
      }

      if (/printenv|env\s*$|set\s*$/.test(line) && decoded.includes("secrets.")) {
        findings.push({
          checkId: "CI-SEC-002",
          provider: "github",
          severity: "high",
          status: "FAIL",
          resource: `${repo}/.github/workflows/${name}:${i + 1}`,
          title: `Environment dump may expose secrets in ${name}:${i + 1}`,
          details: `Step dumps environment variables (printenv/env/set) which may contain secrets set via env: blocks.`,
          remediation: "Remove environment dump steps. If debugging is needed, list specific non-secret variables.",
        })
        output.push(`  [!] ${name}:${i + 1}: env dump with secrets in workflow`)
      }
    }

    if (decoded.includes("actions/upload-artifact") && decoded.includes("secrets.")) {
      findings.push({
        checkId: "CI-SEC-003",
        provider: "github",
        severity: "high",
        status: "FAIL",
        resource: `${repo}/.github/workflows/${name}`,
        title: `Artifact upload in workflow that uses secrets: ${name}`,
        details: "Workflow uploads artifacts and uses secrets. If secrets are written to files that get uploaded, they'll be accessible via artifact download.",
        remediation: "Ensure uploaded artifact paths don't include files that contain secrets. Use .gitignore patterns for sensitive files.",
      })
      output.push(`  [!] ${name}: artifact upload + secrets usage`)
    }
  }

  output.push(formatFindings("github_secrets_exposure_audit", findings))
  return { output: output.join("\n"), findings }
}

async function githubRunnerAudit(args: string[], timeout: number): Promise<AuditResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing GitHub Actions runners for ${repo}...\n`]

  const runners = await gh(["api", `repos/${repo}/actions/runners`, "--paginate"], token, timeout)
  if (runners.exitCode === 0) {
    const data = tryJson(runners.stdout)
    const count = data?.total_count || 0
    output.push(`[*] Self-hosted runners: ${count}`)
    for (const r of (data?.runners || [])) {
      output.push(`    ${r.name} — OS: ${r.os}, status: ${r.status}, labels: ${(r.labels || []).map((l: Record<string, string>) => l.name).join(",")}`)
    }
    if (count > 0) {
      findings.push({
        checkId: "CI-RUN-001",
        provider: "github",
        severity: "medium",
        status: "WARN",
        resource: `${repo}/runners`,
        title: `${count} self-hosted runner(s) detected`,
        details: "Self-hosted runners persist between jobs. Malicious workflows (from PRs) can leave backdoors, steal credentials, or pivot to internal networks.",
        remediation: "Use ephemeral runners (actions-runner-controller with ephemeral mode). Never use self-hosted runners on public repos.",
      })
    }
  }

  const wf = await gh(["api", `repos/${repo}/contents/.github/workflows`, "--paginate"], token, timeout)
  if (wf.exitCode === 0) {
    const files = tryJson(wf.stdout) || []
    for (const file of files) {
      if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) continue
      const content = await gh(["api", `repos/${repo}/contents/${file.path}`, "--jq", ".content"], token, timeout)
      if (content.exitCode !== 0) continue
      const decoded = Buffer.from(content.stdout.trim(), "base64").toString("utf-8")

      if (decoded.includes("self-hosted") && (decoded.includes("pull_request_target") || decoded.includes("pull_request"))) {
        findings.push({
          checkId: "CI-RUN-002",
          provider: "github",
          severity: "critical",
          status: "FAIL",
          resource: `${repo}/.github/workflows/${file.name}`,
          title: `Self-hosted runner with PR trigger in ${file.name}`,
          details: "Workflow runs on self-hosted runner and is triggered by pull requests. Fork PRs can execute arbitrary code on your infrastructure.",
          remediation: "Never use self-hosted runners with pull_request triggers on public repos. Use GitHub-hosted runners for PR workflows.",
        })
        output.push(`  [!] ${file.name}: self-hosted + PR trigger`)
      }
    }
  }

  output.push(formatFindings("github_runner_audit", findings))
  return { output: output.join("\n"), findings }
}

async function githubBranchProtectionAudit(args: string[], timeout: number): Promise<AuditResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  if (!repo) return { output: "[-] --repo OWNER/REPO required", findings: [] }
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing branch protection for ${repo}...\n`]

  const branches = await gh(["api", `repos/${repo}/branches?protected=true`, "--paginate"], token, timeout)
  if (branches.exitCode !== 0) {
    output.push(`[-] Cannot list branches: ${branches.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings }
  }

  const protectedBranches = tryJson(branches.stdout) || []
  output.push(`[*] Protected branches: ${protectedBranches.length}`)

  const defaultBranch = await gh(["api", `repos/${repo}`, "--jq", ".default_branch"], token, timeout)
  const defaultName = defaultBranch.exitCode === 0 ? defaultBranch.stdout.trim() : "main"
  const isDefaultProtected = protectedBranches.some((b: Record<string, string>) => b.name === defaultName)

  if (!isDefaultProtected) {
    findings.push({
      checkId: "CI-BP-001",
      provider: "github",
      severity: "critical",
      status: "FAIL",
      resource: `${repo}/branch/${defaultName}`,
      title: `Default branch "${defaultName}" is not protected`,
      details: `The default branch has no branch protection rules. Anyone with write access can force-push, delete, or push directly.`,
      remediation: "Enable branch protection on the default branch with required reviews, status checks, and force-push prevention.",
    })
    output.push(`  [!] Default branch "${defaultName}" is NOT protected!`)
  }

  for (const branch of protectedBranches) {
    const protection = await gh(["api", `repos/${repo}/branches/${branch.name}/protection`], token, timeout)
    if (protection.exitCode !== 0) continue
    const rules = tryJson(protection.stdout)
    if (!rules) continue
    const name = branch.name

    const reviews = rules.required_pull_request_reviews
    if (!reviews) {
      findings.push({
        checkId: "CI-BP-002",
        provider: "github",
        severity: "high",
        status: "FAIL",
        resource: `${repo}/branch/${name}`,
        title: `No required reviews on ${name}`,
        details: "Pull request reviews are not required. Code can be merged without peer review.",
        remediation: "Require at least 1 approving review before merging.",
      })
      output.push(`  [!] ${name}: no required reviews`)
    } else {
      output.push(`  [+] ${name}: required reviews=${reviews.required_approving_review_count}`)
      if (reviews.dismiss_stale_reviews !== true) {
        findings.push({
          checkId: "CI-BP-003",
          provider: "github",
          severity: "medium",
          status: "FAIL",
          resource: `${repo}/branch/${name}`,
          title: `Stale reviews not dismissed on ${name}`,
          details: "Approved reviews are not dismissed when new commits are pushed. An attacker can get approval then push malicious code.",
          remediation: "Enable 'Dismiss stale pull request approvals when new commits are pushed'.",
        })
      }
    }

    if (rules.allow_force_pushes?.enabled) {
      findings.push({
        checkId: "CI-BP-004",
        provider: "github",
        severity: "critical",
        status: "FAIL",
        resource: `${repo}/branch/${name}`,
        title: `Force push allowed on ${name}`,
        details: "Force push is enabled on a protected branch. History can be rewritten to inject malicious commits.",
        remediation: "Disable force push on all protected branches.",
      })
      output.push(`  [!] ${name}: force push allowed!`)
    }

    if (rules.allow_deletions?.enabled) {
      findings.push({
        checkId: "CI-BP-005",
        provider: "github",
        severity: "high",
        status: "FAIL",
        resource: `${repo}/branch/${name}`,
        title: `Branch deletion allowed on ${name}`,
        details: "Protected branch can be deleted. This can disrupt CI/CD and remove protection rules.",
        remediation: "Disable branch deletion on protected branches.",
      })
    }

    const checks = rules.required_status_checks
    if (!checks || (checks.contexts || []).length === 0) {
      findings.push({
        checkId: "CI-BP-006",
        provider: "github",
        severity: "medium",
        status: "FAIL",
        resource: `${repo}/branch/${name}`,
        title: `No required status checks on ${name}`,
        details: "No CI checks are required before merging. Broken or untested code can reach the protected branch.",
        remediation: "Require at least one status check (CI build/test) before merging.",
      })
    }
  }

  output.push(formatFindings("github_branch_protection_audit", findings))
  return { output: output.join("\n"), findings }
}

async function dependencyAudit(args: string[], timeout: number): Promise<AuditResult> {
  const dir = argVal(args, "--path") || "."
  const pm = argVal(args, "--package-manager")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing dependency security...\n"]

  const pkgFile = Bun.file(`${dir}/package.json`)
  if (await pkgFile.exists()) {
    const pkg = tryJson(await pkgFile.text())
    if (pkg) {
      output.push(`[*] Package: ${pkg.name || "unnamed"} — ${Object.keys(pkg.dependencies || {}).length} deps, ${Object.keys(pkg.devDependencies || {}).length} devDeps`)

      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      for (const [name, version] of Object.entries(allDeps)) {
        const v = String(version)
        if (v === "*" || v === "latest" || v === "") {
          findings.push({
            checkId: "CI-DEP-001",
            provider: "npm",
            severity: "high",
            status: "FAIL",
            resource: `${dir}/package.json#${name}`,
            title: `Unpinned dependency: ${name}@${v}`,
            details: `Dependency "${name}" uses "${v}" version specifier. Any version can be installed, including malicious ones.`,
            remediation: "Pin to a specific version or use a caret/tilde range.",
          })
          output.push(`  [!] ${name}: unpinned (${v})`)
        }

        if (v.startsWith("git+") || v.startsWith("git://") || v.startsWith("http")) {
          findings.push({
            checkId: "CI-DEP-002",
            provider: "npm",
            severity: "high",
            status: "FAIL",
            resource: `${dir}/package.json#${name}`,
            title: `Git/URL dependency: ${name}`,
            details: `Dependency "${name}" is installed from "${v}". Git/URL dependencies bypass registry integrity checks and can change without version bumps.`,
            remediation: "Publish the package to a private registry or pin to a specific commit SHA.",
          })
          output.push(`  [!] ${name}: git/URL dependency`)
        }
      }

      if (pkg.scripts) {
        const dangerous = ["preinstall", "postinstall", "preuninstall", "postuninstall"]
        for (const hook of dangerous) {
          if (pkg.scripts[hook]) {
            output.push(`  [*] Install hook: ${hook} = ${String(pkg.scripts[hook]).slice(0, 80)}`)
          }
        }
      }
    }
  }

  const lockFiles = [
    { file: "package-lock.json", pm: "npm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "bun.lock", pm: "bun" },
    { file: "bun.lockb", pm: "bun" },
  ]
  let hasLock = false
  for (const lf of lockFiles) {
    if (pm && pm !== lf.pm) continue
    if (await Bun.file(`${dir}/${lf.file}`).exists()) {
      output.push(`  [+] Lockfile found: ${lf.file}`)
      hasLock = true
    }
  }
  if (!hasLock) {
    findings.push({
      checkId: "CI-DEP-003",
      provider: "npm",
      severity: "high",
      status: "FAIL",
      resource: `${dir}`,
      title: "No lockfile found",
      details: "No package lockfile detected. Builds are not reproducible and vulnerable to dependency confusion attacks.",
      remediation: "Commit a lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml, or bun.lock).",
    })
    output.push("  [!] No lockfile found!")
  }

  const npmAudit = await exec(pm || "npm", ["audit", "--json"], timeout)
  if (npmAudit.exitCode === 0 || npmAudit.stdout.includes("vulnerabilities")) {
    const audit = tryJson(npmAudit.stdout)
    if (audit?.metadata?.vulnerabilities) {
      const v = audit.metadata.vulnerabilities
      output.push(`\n[*] npm audit: critical=${v.critical || 0}, high=${v.high || 0}, moderate=${v.moderate || 0}, low=${v.low || 0}`)
      if ((v.critical || 0) > 0 || (v.high || 0) > 0) {
        findings.push({
          checkId: "CI-DEP-004",
          provider: "npm",
          severity: v.critical > 0 ? "critical" : "high",
          status: "FAIL",
          resource: `${dir}/node_modules`,
          title: `${v.critical || 0} critical, ${v.high || 0} high vulnerabilities in dependencies`,
          details: `npm audit found known vulnerabilities in installed dependencies.`,
          remediation: "Run npm audit fix or update affected packages.",
        })
      }
    }
  }

  output.push(formatFindings("dependency_audit", findings))
  return { output: output.join("\n"), findings }
}

async function supplyChainAudit(args: string[], timeout: number): Promise<AuditResult> {
  const repo = argVal(args, "--repo")
  const token = argVal(args, "--token")
  const dir = argVal(args, "--path") || "."
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing software supply chain...\n"]

  if (repo) {
    const dependabot = await gh(["api", `repos/${repo}/contents/.github/dependabot.yml`, "--jq", ".content"], token, timeout)
    if (dependabot.exitCode !== 0) {
      const dependabotYaml = await gh(["api", `repos/${repo}/contents/.github/dependabot.yaml`, "--jq", ".content"], token, timeout)
      if (dependabotYaml.exitCode !== 0) {
        findings.push({
          checkId: "CI-SC-001",
          provider: "github",
          severity: "medium",
          status: "FAIL",
          resource: `${repo}/.github/dependabot.yml`,
          title: "No Dependabot configuration",
          details: "Repository has no .github/dependabot.yml. Dependency updates are not automated.",
          remediation: "Add a .github/dependabot.yml to automate security updates for all ecosystems used.",
        })
        output.push("  [!] No Dependabot config")
      }
    } else {
      output.push("  [+] Dependabot configured")
    }

    const renovate = await gh(["api", `repos/${repo}/contents/renovate.json`, "--jq", ".content"], token, timeout)
    if (renovate.exitCode === 0) output.push("  [+] Renovate configured")

    const codeowners = await gh(["api", `repos/${repo}/contents/.github/CODEOWNERS`], token, timeout)
    if (codeowners.exitCode !== 0) {
      findings.push({
        checkId: "CI-SC-002",
        provider: "github",
        severity: "low",
        status: "WARN",
        resource: `${repo}/.github/CODEOWNERS`,
        title: "No CODEOWNERS file",
        details: "No CODEOWNERS file found. Critical paths (CI configs, security configs) don't have enforced reviewers.",
        remediation: "Add a .github/CODEOWNERS file with owners for .github/workflows/, security configs, and other sensitive paths.",
      })
      output.push("  [!] No CODEOWNERS file")
    } else {
      output.push("  [+] CODEOWNERS exists")
    }

    const scorecard = await gh(["api", `repos/${repo}/contents/.github/workflows`, "--paginate"], token, timeout)
    if (scorecard.exitCode === 0) {
      const files = tryJson(scorecard.stdout) || []
      const hasScorecard = files.some((f: Record<string, string>) => f.name.includes("scorecard"))
      output.push(hasScorecard ? "  [+] OpenSSF Scorecard workflow detected" : "  [-] No OpenSSF Scorecard workflow")
    }
  }

  const npmrc = Bun.file(`${dir}/.npmrc`)
  if (await npmrc.exists()) {
    const content = await npmrc.text()
    if (content.includes("registry=") && !content.includes("registry=https://registry.npmjs.org")) {
      output.push(`  [*] Custom npm registry configured in .npmrc`)
    }
    if (content.includes("//") && content.includes(":_authToken=")) {
      findings.push({
        checkId: "CI-SC-003",
        provider: "npm",
        severity: "critical",
        status: "FAIL",
        resource: `${dir}/.npmrc`,
        title: "Auth token hardcoded in .npmrc",
        details: ".npmrc contains a hardcoded authentication token. This token may be committed to version control.",
        remediation: "Use environment variables for registry auth: //registry.npmjs.org/:_authToken=${NPM_TOKEN}",
      })
      output.push("  [!] Hardcoded auth token in .npmrc!")
    }
  }

  output.push(formatFindings("supply_chain_audit", findings))
  return { output: output.join("\n"), findings }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const CiAuditTool = Tool.define("ci_audit", {
  description: `Execute a READ-ONLY CI/CD pipeline security assessment. No repositories, workflows, or configurations are modified — all checks use GitHub API reads and local file inspection. Uses gh CLI and local filesystem. Programs: ${programKeys.join(", ")}`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "CI/CD audit program. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments for the program"),
    timeout_seconds: z.number().optional().default(300).describe("Max execution time (default: 300)"),
  }),
  async execute(params) {
    if (params.program !== "dependency_audit") {
      const check = await exec("which", ["gh"], 5)
      if (check.exitCode !== 0) {
        return {
          title: `ci_audit: ${params.program}`,
          output: "gh CLI not found. Install: https://cli.github.com/",
          metadata: { program: params.program, findings: [] as Finding[] },
        }
      }
    }

    const dispatch: Record<Program, () => Promise<AuditResult>> = {
      github_actions_audit: () => githubActionsAudit(params.args, params.timeout_seconds),
      github_permissions_audit: () => githubPermissionsAudit(params.args, params.timeout_seconds),
      github_actions_pinning_audit: () => githubActionsPinningAudit(params.args, params.timeout_seconds),
      github_secrets_exposure_audit: () => githubSecretsExposureAudit(params.args, params.timeout_seconds),
      github_runner_audit: () => githubRunnerAudit(params.args, params.timeout_seconds),
      github_branch_protection_audit: () => githubBranchProtectionAudit(params.args, params.timeout_seconds),
      dependency_audit: () => dependencyAudit(params.args, params.timeout_seconds),
      supply_chain_audit: () => supplyChainAudit(params.args, params.timeout_seconds),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `ci_audit: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return { title: `ci_audit: ${params.program}`, output: `Error: ${e instanceof Error ? e.message : String(e)}`, metadata: { program: params.program, findings: [] } }
    }
  },
})
