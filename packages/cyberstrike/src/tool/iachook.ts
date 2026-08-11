import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  tf_state_secrets: {
    description:
      "Extract secrets from Terraform state files (.tfstate): database passwords, API keys, private keys, access tokens. Scans local and remote state",
    args: "[--path FILE] [--backend s3|gcs|azurerm|http]",
  },
  tf_plan_audit: {
    description:
      "Audit Terraform plan output for dangerous changes: security group modifications, IAM policy changes, encryption removal, public access enablement",
    args: "[--plan-file FILE] [--dir DIR]",
  },
  sg_audit: {
    description:
      "Audit security group / firewall rules across providers (AWS SG, Azure NSG, GCP firewall) for overly permissive ingress: 0.0.0.0/0, any port, any protocol",
    args: "[--provider aws|azure|gcp] [--dir DIR]",
  },
  s3_policy_audit: {
    description:
      "Audit S3/GCS/Azure Storage bucket policies and ACLs for public access, overly permissive principals, missing encryption requirements, and cross-account access",
    args: "[--dir DIR]",
  },
  encryption_audit: {
    description:
      "Check Terraform resources for missing encryption at rest: EBS volumes, RDS instances, S3 buckets, GCS buckets, Azure disks, Cosmos DB, DynamoDB tables",
    args: "[--dir DIR]",
  },
  iam_audit: {
    description:
      "Audit IAM resources in Terraform: wildcard actions (*), overprivileged policies, cross-account trust, missing MFA conditions, hardcoded credentials",
    args: "[--dir DIR]",
  },
  remote_state_exploit: {
    description:
      "Exploit misconfigured Terraform remote state backends: public S3 buckets, unauthenticated HTTP backends, GCS with allUsers, writable state for state injection",
    args: "--backend <s3|gcs|http> --target URL [--inject]",
  },
  tf_provider_creds: {
    description:
      "Extract provider credentials from .terraform/ directory, .terraformrc, terraform.rc, and environment variables (TF_VAR_*, AWS_*, GOOGLE_*, ARM_*). Scans backend configs for embedded credentials",
    args: "[--dir DIR]",
  },
  cfn_audit: {
    description:
      "Audit CloudFormation templates for security issues: hardcoded secrets in Parameters (missing NoEcho), open security groups, public S3 buckets, wildcard IAM policies, missing encryption",
    args: "[--dir DIR] [--file FILE]",
  },
  ansible_secrets: {
    description:
      "Extract secrets from Ansible: vault-encrypted files, plaintext passwords in playbooks/roles, group_vars/host_vars credentials, vault_password_file references",
    args: "[--dir DIR] [--vault-pass PASSWORD]",
  },
  logging_audit: {
    description:
      "Check IaC for missing logging/monitoring: CloudTrail, VPC Flow Logs, S3 access logging, GCP audit logs, Azure diagnostic settings",
    args: "[--dir DIR]",
  },
  network_audit: {
    description:
      "VPC/networking security audit in IaC: public subnets without NAT, permissive VPC peering, default VPC usage, missing flow logs, open NACLs, unused security groups",
    args: "[--dir DIR] [--provider aws|azure|gcp]",
  },
  cleanup_iac: {
    description:
      "Remove temporary files created during IaC auditing: extracted state files, plan outputs, cached configs. ALWAYS run when done",
    args: "[--dry-run]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = {
  checkId: string
  provider: string
  severity: string
  status: string
  resource: string
  title: string
  details: string
  remediation: string
}
type HookResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function run(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  const reads = Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ])
  const [stdout, stderr] = await Promise.race([
    reads,
    new Promise<[string, string]>((r) => setTimeout(() => r(["", "(timed out)"]), ms + 2000)),
  ])
  clearTimeout(timer)
  const exitCode = killed ? 124 : await proc.exited
  return { stdout, stderr, exitCode }
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function tryJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ── Programs ──

async function tfStateSecrets(args: string[], timeout: number): Promise<HookResult> {
  const statePath = argVal(args, "--path")
  const backend = argVal(args, "--backend")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting secrets from Terraform state...\n"]

  const secretPatterns =
    /(?:password|secret|api[_-]?key|token|credential|private[_-]?key|connection[_-]?string|access[_-]?key|master[_-]?password|admin[_-]?password)/i

  const stateFiles: string[] = []

  if (statePath) {
    stateFiles.push(statePath)
  } else if (backend === "s3") {
    output.push(`[*] Pulling state from S3 backend...`)
    const init = await run("terraform", ["init", "-backend=true", "-input=false"], timeout)
    if (init.exitCode === 0) {
      const pull = await run("terraform", ["state", "pull"], timeout)
      if (pull.exitCode === 0) {
        const tmpFile = "/tmp/cs-tfstate-pulled.json"
        await Bun.write(tmpFile, pull.stdout)
        stateFiles.push(tmpFile)
        output.push(`[+] State pulled from S3 backend`)
      }
    }
  } else {
    const find = await run(
      "find",
      [".", "-maxdepth", "5", "-name", "*.tfstate", "-o", "-name", "terraform.tfstate.backup"],
      timeout,
    )
    if (find.exitCode === 0) stateFiles.push(...find.stdout.trim().split("\n").filter(Boolean))
    const pull = await run("terraform", ["state", "pull"], timeout)
    if (pull.exitCode === 0 && pull.stdout.trim().startsWith("{")) {
      const tmpFile = "/tmp/cs-tfstate-current.json"
      await Bun.write(tmpFile, pull.stdout)
      stateFiles.push(tmpFile)
    }
  }

  output.push(`[+] State files found: ${stateFiles.length}`)

  for (const file of stateFiles) {
    const content = await run("cat", [file], 10)
    if (content.exitCode !== 0) continue
    const state = tryJson(content.stdout)
    if (!state) continue

    output.push(`\n── ${file} ──`)
    output.push(`    Version: ${state.version}, Serial: ${state.serial}`)

    const resources = state.resources || []
    output.push(`    Resources: ${resources.length}`)

    for (const res of resources) {
      const instances = res.instances || []
      for (const inst of instances) {
        const attrs = inst.attributes || {}
        for (const [key, val] of Object.entries(attrs)) {
          if (typeof val !== "string" || val.length < 4) continue
          if (secretPatterns.test(key) && val !== "" && val !== "null") {
            output.push(`    [!] ${res.type}.${res.name}.${key} = ${(val as string).substring(0, 80)}...`)
            findings.push({
              checkId: "IAC-STATE-001",
              provider: "terraform",
              severity: "critical",
              status: "EXTRACTED",
              resource: `${res.type}.${res.name}`,
              title: `Secret in state: ${res.type}.${res.name}.${key}`,
              details: `Value: ${(val as string).substring(0, 200)}`,
              remediation: "Use sensitive variables and ensure state is encrypted at rest",
            })
          }
        }
        const sensitive = inst.sensitive_attributes || []
        if (sensitive.length > 0) {
          output.push(`    [+] Sensitive attributes in ${res.type}.${res.name}: ${sensitive.length}`)
        }
      }
    }

    const outputs = state.outputs || {}
    for (const [key, val] of Object.entries(outputs)) {
      const v = val as Record<string, unknown>
      if (secretPatterns.test(key) || v.sensitive) {
        output.push(
          `    [!] Output: ${key} = ${String(v.value || "").substring(0, 80)}${v.sensitive ? " [SENSITIVE]" : ""}`,
        )
        if (!v.sensitive) {
          findings.push({
            checkId: "IAC-STATE-002",
            provider: "terraform",
            severity: "high",
            status: "FAIL",
            resource: `output.${key}`,
            title: `Secret output not marked sensitive: ${key}`,
            details: `Value: ${String(v.value || "").substring(0, 200)}`,
            remediation: "Add sensitive = true to the output block",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function tfPlanAudit(args: string[], timeout: number): Promise<HookResult> {
  const planFile = argVal(args, "--plan-file")
  const dir = argVal(args, "--dir") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing Terraform plan...\n`]

  let planJson = ""
  if (planFile) {
    const show = await run("terraform", ["show", "-json", planFile], timeout)
    if (show.exitCode === 0) planJson = show.stdout
  } else {
    const plan = await run("terraform", ["-chdir=" + dir, "plan", "-out=/tmp/cs-tfplan", "-input=false"], timeout)
    if (plan.exitCode === 0) {
      const show = await run("terraform", ["-chdir=" + dir, "show", "-json", "/tmp/cs-tfplan"], timeout)
      if (show.exitCode === 0) planJson = show.stdout
    }
  }

  if (!planJson) {
    output.push("[!] Could not generate or read plan")
    return { output: output.join("\n"), findings }
  }

  const plan = tryJson(planJson)
  if (!plan?.resource_changes) return { output: output.join("\n") + "\n[!] Invalid plan format", findings }

  const dangerousTypes = [
    "aws_security_group_rule",
    "aws_security_group",
    "azurerm_network_security_rule",
    "google_compute_firewall",
    "aws_iam_policy",
    "aws_iam_role_policy",
    "azurerm_role_assignment",
    "google_project_iam_member",
  ]
  const changes = plan.resource_changes || []

  output.push(`[+] Resource changes: ${changes.length}`)

  let creates = 0,
    updates = 0,
    deletes = 0
  for (const rc of changes) {
    const actions = rc.change?.actions || []
    if (actions.includes("create")) creates++
    if (actions.includes("update")) updates++
    if (actions.includes("delete")) deletes++

    if (dangerousTypes.includes(rc.type)) {
      const after = rc.change?.after || {}
      output.push(`\n  [!] ${actions.join("/")} ${rc.type}.${rc.name}`)

      if (rc.type.includes("security_group") || rc.type.includes("firewall")) {
        const cidr = after.cidr_blocks || after.source_address_prefix || after.source_ranges || []
        const cidrArr = Array.isArray(cidr) ? cidr : [cidr]
        if (cidrArr.some((c: string) => c === "0.0.0.0/0" || c === "*" || c === "::/0")) {
          findings.push({
            checkId: "IAC-PLAN-001",
            provider: "terraform",
            severity: "high",
            status: "FAIL",
            resource: `${rc.type}.${rc.name}`,
            title: `Open ingress rule: ${rc.type}.${rc.name}`,
            details: `CIDR: ${cidrArr.join(", ")}, Port: ${after.from_port || after.destination_port_range || "all"}`,
            remediation: "Restrict CIDR blocks to specific IP ranges",
          })
        }
      }

      if (rc.type.includes("iam")) {
        const policy = JSON.stringify(after.policy || after.policy_document || "")
        if (policy.includes('"*"') || policy.includes('"Action":"*"')) {
          findings.push({
            checkId: "IAC-PLAN-002",
            provider: "terraform",
            severity: "critical",
            status: "FAIL",
            resource: `${rc.type}.${rc.name}`,
            title: `Wildcard IAM action: ${rc.type}.${rc.name}`,
            details: `Policy contains * action`,
            remediation: "Use least-privilege: specify exact actions needed",
          })
        }
      }
    }
  }

  output.push(`\n[+] Summary: +${creates} ~${updates} -${deletes}`)

  return { output: output.join("\n"), findings }
}

async function sgAudit(args: string[], timeout: number): Promise<HookResult> {
  const provider = argVal(args, "--provider") || "aws"
  const dir = argVal(args, "--dir") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing security group / firewall rules (${provider})...\n`]

  const tfFiles = await run("find", [dir, "-maxdepth", "5", "-name", "*.tf"], timeout)
  if (tfFiles.exitCode !== 0 || !tfFiles.stdout.trim()) {
    output.push("[!] No .tf files found")
    return { output: output.join("\n"), findings }
  }

  const files = tfFiles.stdout.trim().split("\n")
  output.push(`[+] Scanning ${files.length} Terraform files`)

  const openCidrPatterns = /(?:0\.0\.0\.0\/0|::\/?0|\*|any)/
  const sgResourcePatterns: Record<string, RegExp> = {
    aws: /resource\s+"(?:aws_security_group(?:_rule)?|aws_vpc_security_group_ingress_rule)"/,
    azure: /resource\s+"azurerm_network_security_rule"/,
    gcp: /resource\s+"google_compute_firewall"/,
  }
  const pattern = sgResourcePatterns[provider] || sgResourcePatterns.aws

  for (const file of files) {
    const content = await run("cat", [file], 5)
    if (content.exitCode !== 0) continue
    if (!pattern.test(content.stdout)) continue

    const lines = content.stdout.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const blockStart = i
        let depth = 0
        let block = ""
        for (let j = i; j < Math.min(i + 50, lines.length); j++) {
          block += lines[j] + "\n"
          depth += (lines[j].match(/{/g) || []).length
          depth -= (lines[j].match(/}/g) || []).length
          if (depth <= 0 && j > i) break
        }
        if (openCidrPatterns.test(block)) {
          const resName = lines[blockStart].match(/"([^"]+)"\s*"([^"]+)"/)?.[2] || "unknown"
          output.push(`  [!] ${file}:${blockStart + 1} — open ingress in ${resName}`)
          findings.push({
            checkId: "IAC-SG-001",
            provider: "terraform",
            severity: "high",
            status: "FAIL",
            resource: `${file}:${blockStart + 1}`,
            title: `Open ingress: ${resName}`,
            details: block.substring(0, 500),
            remediation: "Restrict CIDR to specific IP ranges",
          })
        }
      }
    }
  }

  if (findings.length === 0) output.push("\n[+] No overly permissive rules found")

  return { output: output.join("\n"), findings }
}

async function s3PolicyAudit(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing storage bucket policies...\n`]

  const tfFiles = await run("find", [dir, "-maxdepth", "5", "-name", "*.tf"], timeout)
  if (tfFiles.exitCode !== 0) return { output: output.join("\n") + "[!] No .tf files found", findings }

  const files = tfFiles.stdout.trim().split("\n").filter(Boolean)
  const bucketPattern = /resource\s+"(?:aws_s3_bucket|google_storage_bucket|azurerm_storage_(?:account|container))"/
  const publicPatterns =
    /(?:public-read|public-read-write|allUsers|allAuthenticatedUsers|blob.*public|container.*public|\*.*Principal)/i

  for (const file of files) {
    const content = await run("cat", [file], 5)
    if (content.exitCode !== 0 || !bucketPattern.test(content.stdout)) continue

    const lines = content.stdout.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (!bucketPattern.test(lines[i])) continue
      const resName = lines[i].match(/"([^"]+)"\s*"([^"]+)"/)?.[2] || "unknown"
      let block = ""
      let depth = 0
      for (let j = i; j < Math.min(i + 80, lines.length); j++) {
        block += lines[j] + "\n"
        depth += (lines[j].match(/{/g) || []).length
        depth -= (lines[j].match(/}/g) || []).length
        if (depth <= 0 && j > i) break
      }
      if (publicPatterns.test(block)) {
        output.push(`  [!] ${file}:${i + 1} — public access in ${resName}`)
        findings.push({
          checkId: "IAC-S3-001",
          provider: "terraform",
          severity: "critical",
          status: "FAIL",
          resource: `${file}:${i + 1} ${resName}`,
          title: `Public storage bucket: ${resName}`,
          details: block.substring(0, 500),
          remediation: "Remove public access ACLs and enable Block Public Access",
        })
      }
    }
  }

  if (findings.length === 0) output.push("[+] No public access patterns found")
  return { output: output.join("\n"), findings }
}

async function encryptionAudit(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing encryption configuration...\n`]

  const tfFiles = await run("find", [dir, "-maxdepth", "5", "-name", "*.tf"], timeout)
  if (tfFiles.exitCode !== 0) return { output: output.join("\n") + "[!] No .tf files found", findings }

  const files = tfFiles.stdout.trim().split("\n").filter(Boolean)
  const encryptableResources: Record<string, { pattern: RegExp; encryptionField: string }> = {
    aws_ebs_volume: { pattern: /resource\s+"aws_ebs_volume"/, encryptionField: "encrypted" },
    aws_rds_instance: { pattern: /resource\s+"aws_db_instance"/, encryptionField: "storage_encrypted" },
    aws_s3_bucket: { pattern: /resource\s+"aws_s3_bucket"/, encryptionField: "server_side_encryption" },
    aws_dynamodb_table: { pattern: /resource\s+"aws_dynamodb_table"/, encryptionField: "server_side_encryption" },
    azurerm_managed_disk: { pattern: /resource\s+"azurerm_managed_disk"/, encryptionField: "encryption_type" },
    google_compute_disk: { pattern: /resource\s+"google_compute_disk"/, encryptionField: "disk_encryption_key" },
    google_sql_database_instance: {
      pattern: /resource\s+"google_sql_database_instance"/,
      encryptionField: "encryption_key_name",
    },
  }

  let scanned = 0
  for (const file of files) {
    const content = await run("cat", [file], 5)
    if (content.exitCode !== 0) continue

    for (const [resType, config] of Object.entries(encryptableResources)) {
      if (!config.pattern.test(content.stdout)) continue
      scanned++
      const lines = content.stdout.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (!config.pattern.test(lines[i])) continue
        const resName = lines[i].match(/"([^"]+)"\s*"([^"]+)"/)?.[2] || "unknown"
        let block = ""
        let depth = 0
        for (let j = i; j < Math.min(i + 60, lines.length); j++) {
          block += lines[j] + "\n"
          depth += (lines[j].match(/{/g) || []).length
          depth -= (lines[j].match(/}/g) || []).length
          if (depth <= 0 && j > i) break
        }
        if (!block.includes(config.encryptionField)) {
          output.push(`  [!] ${file}:${i + 1} — no encryption: ${resType}.${resName}`)
          findings.push({
            checkId: "IAC-ENC-001",
            provider: "terraform",
            severity: "high",
            status: "FAIL",
            resource: `${resType}.${resName}`,
            title: `Missing encryption: ${resType}.${resName}`,
            details: `Resource does not contain ${config.encryptionField}`,
            remediation: `Add ${config.encryptionField} configuration to ${resType}`,
          })
        }
      }
    }
  }

  output.push(`[+] Scanned ${scanned} encryptable resource blocks`)
  if (findings.length === 0) output.push("[+] All resources have encryption configured")

  return { output: output.join("\n"), findings }
}

async function iamAudit(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing IAM resources in Terraform...\n`]

  const tfFiles = await run("find", [dir, "-maxdepth", "5", "-name", "*.tf"], timeout)
  if (tfFiles.exitCode !== 0) return { output: output.join("\n") + "[!] No .tf files found", findings }

  const files = tfFiles.stdout.trim().split("\n").filter(Boolean)
  const iamPattern =
    /resource\s+"(?:aws_iam_(?:policy|role_policy|user_policy|group_policy)|azurerm_role_(?:assignment|definition)|google_(?:project|organization)_iam_(?:member|binding|policy))"/

  for (const file of files) {
    const content = await run("cat", [file], 5)
    if (content.exitCode !== 0 || !iamPattern.test(content.stdout)) continue

    const lines = content.stdout.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (!iamPattern.test(lines[i])) continue
      const resName = lines[i].match(/"([^"]+)"\s*"([^"]+)"/)?.[2] || "unknown"
      let block = ""
      let depth = 0
      for (let j = i; j < Math.min(i + 80, lines.length); j++) {
        block += lines[j] + "\n"
        depth += (lines[j].match(/{/g) || []).length
        depth -= (lines[j].match(/}/g) || []).length
        if (depth <= 0 && j > i) break
      }

      if (block.includes('"*"') && (block.includes("Action") || block.includes("actions"))) {
        output.push(`  [!] ${file}:${i + 1} — wildcard action in ${resName}`)
        findings.push({
          checkId: "IAC-IAM-001",
          provider: "terraform",
          severity: "critical",
          status: "FAIL",
          resource: `${file}:${i + 1} ${resName}`,
          title: `Wildcard IAM action: ${resName}`,
          details: "Policy uses * for actions — grants full access",
          remediation: "Replace * with specific action list",
        })
      }

      if (block.includes('"*"') && (block.includes("Resource") || block.includes("resource"))) {
        output.push(`  [!] ${file}:${i + 1} — wildcard resource in ${resName}`)
        findings.push({
          checkId: "IAC-IAM-002",
          provider: "terraform",
          severity: "high",
          status: "FAIL",
          resource: `${file}:${i + 1} ${resName}`,
          title: `Wildcard IAM resource: ${resName}`,
          details: "Policy uses * for resources — applies to everything",
          remediation: "Scope resources to specific ARNs",
        })
      }

      const hardcodedCreds = /(?:access_key|secret_key|password)\s*=\s*"[^"]+"/
      if (hardcodedCreds.test(block)) {
        output.push(`  [!] ${file}:${i + 1} — hardcoded credential in ${resName}`)
        findings.push({
          checkId: "IAC-IAM-003",
          provider: "terraform",
          severity: "critical",
          status: "FAIL",
          resource: `${file}:${i + 1} ${resName}`,
          title: `Hardcoded credential: ${resName}`,
          details: "Credentials should not be hardcoded in Terraform files",
          remediation: "Use variables with sensitive=true or a secrets manager",
        })
      }
    }
  }

  if (findings.length === 0) output.push("[+] No IAM issues found")
  return { output: output.join("\n"), findings }
}

async function remoteStateExploit(args: string[], timeout: number): Promise<HookResult> {
  const backend = argVal(args, "--backend")
  const target = argVal(args, "--target")
  const inject = hasFlag(args, "--inject")
  const findings: Finding[] = []
  const output: string[] = ["[*] Testing remote state backend security...\n"]

  if (!backend || !target) return { output: "[!] Required: --backend <s3|gcs|http> --target URL", findings }

  if (backend === "s3") {
    const bucket = target.replace("s3://", "").split("/")[0]
    const key = target.replace("s3://", "").split("/").slice(1).join("/") || "terraform.tfstate"

    const anonList = await run("aws", ["s3", "ls", `s3://${bucket}`, "--no-sign-request"], timeout)
    if (anonList.exitCode === 0) {
      output.push(`[+] Bucket ${bucket} allows anonymous listing!`)
      findings.push({
        checkId: "IAC-RS-001",
        provider: "terraform",
        severity: "critical",
        status: "FAIL",
        resource: `s3://${bucket}`,
        title: `Public Terraform state bucket: ${bucket}`,
        details: "State bucket allows unauthenticated access — full infrastructure exposure",
        remediation: "Enable Block Public Access on the S3 bucket",
      })
    }

    const getState = await run(
      "aws",
      ["s3", "cp", `s3://${bucket}/${key}`, "/tmp/cs-remote-state.json", "--no-sign-request"],
      timeout,
    )
    if (getState.exitCode === 0) {
      output.push(`[+] State file downloaded: ${key}`)
      output.push(`    Run tf_state_secrets --path /tmp/cs-remote-state.json to extract secrets`)
    }

    if (inject) {
      output.push(`\n[!] State injection is destructive — requires manual terraform apply on victim's next run`)
      output.push(
        `    Modify /tmp/cs-remote-state.json and upload with: aws s3 cp /tmp/cs-remote-state.json s3://${bucket}/${key} --no-sign-request`,
      )
    }
  }

  if (backend === "gcs") {
    const bucket = target.replace("gs://", "").split("/")[0]
    const getState = await run(
      "curl",
      ["-sk", `https://storage.googleapis.com/${bucket}/default.tfstate`, "--max-time", "15"],
      timeout,
    )
    if (getState.exitCode === 0 && getState.stdout.includes('"terraform_version"')) {
      output.push(`[+] GCS bucket ${bucket} serves state publicly!`)
      await Bun.write("/tmp/cs-gcs-state.json", getState.stdout)
      output.push(`    State saved to /tmp/cs-gcs-state.json`)
      findings.push({
        checkId: "IAC-RS-002",
        provider: "terraform",
        severity: "critical",
        status: "FAIL",
        resource: `gs://${bucket}`,
        title: `Public GCS state bucket: ${bucket}`,
        details: "Terraform state accessible via public URL",
        remediation: "Remove allUsers/allAuthenticatedUsers IAM binding",
      })
    }
  }

  if (backend === "http") {
    const getState = await run("curl", ["-sk", target, "--max-time", "15"], timeout)
    if (getState.exitCode === 0 && getState.stdout.includes('"terraform_version"')) {
      output.push(`[+] HTTP backend serves state without auth!`)
      await Bun.write("/tmp/cs-http-state.json", getState.stdout)
      findings.push({
        checkId: "IAC-RS-003",
        provider: "terraform",
        severity: "critical",
        status: "FAIL",
        resource: target,
        title: `Unauthenticated HTTP state backend`,
        details: `State accessible at ${target} without credentials`,
        remediation: "Add authentication to the HTTP backend",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

async function tfProviderCreds(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Extracting Terraform provider credentials in: ${dir}\n`]

  const secretPattern =
    /(?:password|secret|api[_-]?key|token|credential|private[_-]?key|access[_-]?key|client[_-]?secret)/i

  const tfDir = `${dir}/.terraform`
  const tfDirExists = await run("test", ["-d", tfDir], 5)
  if (tfDirExists.exitCode === 0) {
    output.push(`[+] .terraform/ directory found`)

    const providerLock = `${dir}/.terraform.lock.hcl`
    const lockContent = await run("cat", [providerLock], 5)
    if (lockContent.exitCode === 0) {
      const providers = lockContent.stdout.match(/provider\s+"([^"]+)"/g) || []
      output.push(`    Providers: ${providers.length}`)
      for (const p of providers) output.push(`      ${p}`)
    }

    const backendConfig = await run("find", [tfDir, "-name", "*.tfstate", "-o", "-name", "backend"], 10)
    if (backendConfig.exitCode === 0 && backendConfig.stdout.trim()) {
      const files = backendConfig.stdout.trim().split("\n").filter(Boolean)
      for (const f of files) {
        const content = await run("cat", [f], 5)
        if (content.exitCode !== 0) continue
        if (secretPattern.test(content.stdout)) {
          output.push(`    [!] Credentials in: ${f}`)
          findings.push({
            checkId: "IAC-PROV-001",
            provider: "terraform",
            severity: "critical",
            status: "EXTRACTED",
            resource: f,
            title: `Credential in .terraform: ${f.split("/").pop()}`,
            details: "Provider cache or backend config contains credentials",
            remediation: "Use environment variables or credential helper for provider auth",
          })
        }
      }
    }
  }

  const rcFiles = [
    `${process.env.HOME}/.terraformrc`,
    `${process.env.HOME}/terraform.rc`,
    `${process.env.APPDATA || ""}/terraform.rc`,
  ]
  for (const rc of rcFiles) {
    const content = await run("cat", [rc], 5)
    if (content.exitCode !== 0) continue
    output.push(`\n[+] Found: ${rc}`)
    if (content.stdout.includes("credentials") || content.stdout.includes("token")) {
      output.push(`    [!] Contains credential configuration`)
      const lines = content.stdout.split("\n")
      for (const line of lines) {
        if (/token|credentials/.test(line)) output.push(`      ${line.trim().substring(0, 150)}`)
      }
      findings.push({
        checkId: "IAC-PROV-002",
        provider: "terraform",
        severity: "high",
        status: "EXTRACTED",
        resource: rc,
        title: `Credentials in Terraform RC: ${rc}`,
        details: "Terraform RC file contains provider tokens",
        remediation: "Use credential helpers instead of storing tokens in RC files",
      })
    }
  }

  output.push(`\n[*] Checking environment variables...`)
  const envPrefixes = ["TF_VAR_", "AWS_", "GOOGLE_", "ARM_", "ALICLOUD_", "DO_"]
  const envVars = Object.keys(process.env).filter((k) => envPrefixes.some((p) => k.startsWith(p)))
  if (envVars.length > 0) {
    output.push(`[+] IaC-related env vars: ${envVars.length}`)
    for (const k of envVars) {
      const val = process.env[k] || ""
      const masked = val.length > 8 ? val.substring(0, 4) + "****" + val.substring(val.length - 4) : "****"
      output.push(`    ${k} = ${masked}`)
    }
  }

  const tfFiles = await run("find", [dir, "-maxdepth", "3", "-name", "*.tf"], timeout)
  if (tfFiles.exitCode === 0) {
    const files = tfFiles.stdout.trim().split("\n").filter(Boolean)
    for (const f of files) {
      const content = await run("cat", [f], 5)
      if (content.exitCode !== 0) continue
      if (!content.stdout.includes("provider")) continue
      const lines = content.stdout.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(access_key|secret_key|token|password|client_secret)\s*=\s*"[^"]+"/i.test(lines[i])) {
          output.push(`\n  [!] Hardcoded credential in ${f}:${i + 1}: ${lines[i].trim().substring(0, 100)}`)
          findings.push({
            checkId: "IAC-PROV-001",
            provider: "terraform",
            severity: "critical",
            status: "FAIL",
            resource: `${f}:${i + 1}`,
            title: `Hardcoded provider credential: ${f}`,
            details: lines[i].trim().substring(0, 300),
            remediation: "Use environment variables or a vault for provider credentials",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function cfnAudit(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const file = argVal(args, "--file")
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing CloudFormation templates...\n`]

  const cfnFiles: string[] = []
  if (file) {
    cfnFiles.push(file)
  } else {
    const find = await run(
      "find",
      [
        dir,
        "-maxdepth",
        "5",
        "(",
        "-name",
        "*.json",
        "-o",
        "-name",
        "*.yaml",
        "-o",
        "-name",
        "*.yml",
        ")",
        "-type",
        "f",
      ],
      timeout,
    )
    if (find.exitCode === 0) {
      const candidates = find.stdout.trim().split("\n").filter(Boolean)
      for (const f of candidates) {
        const head = await run("head", ["-5", f], 5)
        if (
          head.exitCode === 0 &&
          (head.stdout.includes("AWSTemplateFormatVersion") || head.stdout.includes("Resources"))
        ) {
          cfnFiles.push(f)
        }
      }
    }
  }

  output.push(`[+] CloudFormation templates found: ${cfnFiles.length}`)

  const secretPattern = /(?:password|secret|api[_-]?key|token|credential|private[_-]?key)/i
  const openCidrPattern = /(?:0\.0\.0\.0\/0|::\/?0)/
  const wildcardIam = /"(?:Action|Resource)"\s*:\s*"\*"/

  for (const f of cfnFiles) {
    const content = await run("cat", [f], 10)
    if (content.exitCode !== 0) continue
    const lines = content.stdout.split("\n")
    output.push(`\n── ${f} ──`)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (secretPattern.test(line) && /Default\s*[:=]/.test(line)) {
        const nearNoEcho = lines.slice(Math.max(0, i - 5), i + 5).some((l) => /NoEcho/i.test(l))
        if (!nearNoEcho) {
          output.push(`  [!] ${i + 1}: Parameter with default secret, no NoEcho: ${line.trim().substring(0, 150)}`)
          findings.push({
            checkId: "IAC-CFN-001",
            provider: "cloudformation",
            severity: "high",
            status: "FAIL",
            resource: `${f}:${i + 1}`,
            title: `Secret parameter without NoEcho: ${f}`,
            details: line.trim().substring(0, 300),
            remediation: "Add NoEcho: true to sensitive Parameters",
          })
        }
      }

      if (
        openCidrPattern.test(line) &&
        /Ingress|SecurityGroup|CidrIp/i.test(lines.slice(Math.max(0, i - 3), i + 1).join(""))
      ) {
        output.push(`  [!] ${i + 1}: Open ingress CIDR: ${line.trim().substring(0, 100)}`)
        findings.push({
          checkId: "IAC-CFN-002",
          provider: "cloudformation",
          severity: "high",
          status: "FAIL",
          resource: `${f}:${i + 1}`,
          title: `Open security group ingress: ${f}`,
          details: line.trim().substring(0, 300),
          remediation: "Restrict CidrIp to specific ranges",
        })
      }

      if (wildcardIam.test(line)) {
        output.push(`  [!] ${i + 1}: Wildcard IAM: ${line.trim().substring(0, 100)}`)
        findings.push({
          checkId: "IAC-CFN-003",
          provider: "cloudformation",
          severity: "critical",
          status: "FAIL",
          resource: `${f}:${i + 1}`,
          title: `Wildcard IAM in CloudFormation: ${f}`,
          details: line.trim().substring(0, 300),
          remediation: "Replace * with specific actions/resources",
        })
      }

      if (/PublicAccessBlockConfiguration/.test(line)) {
        const block = lines.slice(i, Math.min(i + 10, lines.length)).join("\n")
        if (/false/i.test(block)) {
          output.push(`  [!] ${i + 1}: Public S3 access enabled`)
        }
      }
    }
  }

  if (findings.length === 0) output.push("\n[+] No CloudFormation security issues found")
  return { output: output.join("\n"), findings }
}

async function ansibleSecrets(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const vaultPass = argVal(args, "--vault-pass")
  const findings: Finding[] = []
  const output: string[] = [`[*] Scanning Ansible for secrets in: ${dir}\n`]

  const secretPattern =
    /(?:password|secret|api[_-]?key|token|credential|private[_-]?key|ansible_become_pass|vault_password)/i

  const vaultFiles = await run(
    "grep",
    ["-rl", "ANSIBLE_VAULT", dir, "--include=*.yml", "--include=*.yaml", "--include=*.enc"],
    timeout,
  )
  if (vaultFiles.exitCode === 0 && vaultFiles.stdout.trim()) {
    const files = vaultFiles.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] Vault-encrypted files: ${files.length}`)
    for (const f of files) output.push(`    ${f}`)

    if (vaultPass && Bun.which("ansible-vault")) {
      output.push(`\n[*] Attempting vault decryption...`)
      for (const f of files) {
        const decrypt = await run("ansible-vault", ["view", f, "--vault-password", vaultPass], timeout)
        if (decrypt.exitCode === 0) {
          output.push(`  [+] Decrypted: ${f}`)
          const lines = decrypt.stdout.split("\n")
          for (const line of lines) {
            if (secretPattern.test(line)) output.push(`      [!] ${line.trim().substring(0, 150)}`)
          }
          findings.push({
            checkId: "IAC-ANS-001",
            provider: "ansible",
            severity: "critical",
            status: "EXTRACTED",
            resource: f,
            title: `Vault decrypted: ${f}`,
            details: "Vault file decrypted with provided password",
            remediation: "Rotate vault password and all contained secrets",
          })
        }
      }
    }
  }

  const vaultPassFiles = await run(
    "find",
    [dir, "-maxdepth", "3", "-name", ".vault_pass*", "-o", "-name", "vault_password*"],
    timeout,
  )
  if (vaultPassFiles.exitCode === 0 && vaultPassFiles.stdout.trim()) {
    const files = vaultPassFiles.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[!] Vault password files found:`)
    for (const f of files) {
      output.push(`    ${f}`)
      findings.push({
        checkId: "IAC-ANS-002",
        provider: "ansible",
        severity: "critical",
        status: "FAIL",
        resource: f,
        title: `Vault password file: ${f}`,
        details: "Ansible vault password stored in plaintext file",
        remediation: "Remove vault password file, use --ask-vault-pass or env var",
      })
    }
  }

  const playbookDirs = ["group_vars", "host_vars", "roles", "vars", "defaults"]
  for (const subdir of playbookDirs) {
    const yamlFiles = await run(
      "find",
      [`${dir}/${subdir}`, "-maxdepth", "3", "-name", "*.yml", "-o", "-name", "*.yaml"],
      10,
    )
    if (yamlFiles.exitCode !== 0) continue
    const files = yamlFiles.stdout.trim().split("\n").filter(Boolean)
    for (const f of files) {
      const content = await run("cat", [f], 5)
      if (content.exitCode !== 0) continue
      if (content.stdout.includes("ANSIBLE_VAULT")) continue
      const lines = content.stdout.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (secretPattern.test(lines[i]) && /:\s*\S/.test(lines[i]) && !lines[i].includes("vault")) {
          output.push(`  [!] ${f}:${i + 1}: ${lines[i].trim().substring(0, 150)}`)
          findings.push({
            checkId: "IAC-ANS-002",
            provider: "ansible",
            severity: "high",
            status: "FAIL",
            resource: `${f}:${i + 1}`,
            title: `Plaintext secret in Ansible: ${f.split("/").pop()}`,
            details: lines[i].trim().substring(0, 300),
            remediation: "Encrypt with ansible-vault or use a secrets manager lookup",
          })
        }
      }
    }
  }

  const cfgFiles = await run(
    "find",
    [dir, "-maxdepth", "2", "-name", "ansible.cfg", "-o", "-name", ".ansible.cfg"],
    timeout,
  )
  if (cfgFiles.exitCode === 0 && cfgFiles.stdout.trim()) {
    const files = cfgFiles.stdout.trim().split("\n").filter(Boolean)
    for (const f of files) {
      const content = await run("cat", [f], 5)
      if (content.exitCode !== 0) continue
      if (/vault_password_file/.test(content.stdout)) {
        const line = content.stdout.split("\n").find((l) => l.includes("vault_password_file"))
        output.push(`\n[+] ansible.cfg vault_password_file: ${line?.trim()}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function loggingAudit(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing logging/monitoring configuration in IaC...\n`]

  const tfFiles = await run("find", [dir, "-maxdepth", "5", "-name", "*.tf"], timeout)
  if (tfFiles.exitCode !== 0 || !tfFiles.stdout.trim()) {
    output.push("[!] No .tf files found")
    return { output: output.join("\n"), findings }
  }

  const files = tfFiles.stdout.trim().split("\n").filter(Boolean)
  const allContent = (
    await Promise.all(
      files.map(async (f) => {
        const c = await run("cat", [f], 5)
        return c.exitCode === 0 ? c.stdout : ""
      }),
    )
  ).join("\n")

  const loggingChecks: Array<{ resource: string; label: string; severity: string }> = [
    { resource: "aws_cloudtrail", label: "AWS CloudTrail", severity: "critical" },
    { resource: "aws_flow_log", label: "AWS VPC Flow Logs", severity: "high" },
    { resource: "aws_s3_bucket_logging", label: "S3 Access Logging", severity: "medium" },
    { resource: "aws_cloudwatch_log_group", label: "CloudWatch Log Groups", severity: "medium" },
    { resource: "google_logging_project_sink", label: "GCP Logging Sink", severity: "high" },
    { resource: "google_project_iam_audit_config", label: "GCP IAM Audit Config", severity: "high" },
    { resource: "azurerm_monitor_diagnostic_setting", label: "Azure Diagnostic Settings", severity: "high" },
    { resource: "azurerm_log_analytics_workspace", label: "Azure Log Analytics", severity: "medium" },
  ]

  const hasProvider: Record<string, boolean> = {
    aws: allContent.includes('provider "aws"') || allContent.includes("aws_"),
    gcp: allContent.includes('provider "google"') || allContent.includes("google_"),
    azure: allContent.includes('provider "azurerm"') || allContent.includes("azurerm_"),
  }

  for (const check of loggingChecks) {
    const providerPrefix = check.resource.startsWith("aws")
      ? "aws"
      : check.resource.startsWith("google")
        ? "gcp"
        : "azure"
    if (!hasProvider[providerPrefix]) continue

    const regex = new RegExp(`resource\\s+"${check.resource}"`)
    if (!regex.test(allContent)) {
      output.push(`  [!] Missing: ${check.label} (${check.resource})`)
      findings.push({
        checkId: "IAC-LOG-001",
        provider: "terraform",
        severity: check.severity,
        status: "FAIL",
        resource: check.resource,
        title: `Missing logging: ${check.label}`,
        details: `No ${check.resource} resource found in Terraform — ${check.label} not configured`,
        remediation: `Add ${check.resource} resource to enable ${check.label}`,
      })
    }
    if (regex.test(allContent)) {
      output.push(`  [+] Found: ${check.label}`)
    }
  }

  if (hasProvider.aws && allContent.includes("aws_cloudtrail")) {
    if (!allContent.includes("is_multi_region_trail") || allContent.includes("is_multi_region_trail = false")) {
      output.push(`  [!] CloudTrail is not multi-region`)
      findings.push({
        checkId: "IAC-LOG-001",
        provider: "terraform",
        severity: "high",
        status: "FAIL",
        resource: "aws_cloudtrail",
        title: "CloudTrail not multi-region",
        details: "is_multi_region_trail is missing or false",
        remediation: "Set is_multi_region_trail = true",
      })
    }
    if (
      !allContent.includes("enable_log_file_validation") ||
      allContent.includes("enable_log_file_validation = false")
    ) {
      output.push(`  [!] CloudTrail log validation disabled`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function networkAudit(args: string[], timeout: number): Promise<HookResult> {
  const dir = argVal(args, "--dir") || "."
  const provider = argVal(args, "--provider") || "aws"
  const findings: Finding[] = []
  const output: string[] = [`[*] Auditing network/VPC configuration (${provider})...\n`]

  const tfFiles = await run("find", [dir, "-maxdepth", "5", "-name", "*.tf"], timeout)
  if (tfFiles.exitCode !== 0 || !tfFiles.stdout.trim()) {
    output.push("[!] No .tf files found")
    return { output: output.join("\n"), findings }
  }

  const files = tfFiles.stdout.trim().split("\n").filter(Boolean)
  const allContent = (
    await Promise.all(
      files.map(async (f) => {
        const c = await run("cat", [f], 5)
        return c.exitCode === 0 ? `\n### FILE: ${f} ###\n${c.stdout}` : ""
      }),
    )
  ).join("\n")

  if (provider === "aws" || provider === "all") {
    if (allContent.includes("aws_default_vpc")) {
      output.push(`  [!] Default VPC resource used`)
      findings.push({
        checkId: "IAC-NET-001",
        provider: "terraform",
        severity: "medium",
        status: "FAIL",
        resource: "aws_default_vpc",
        title: "Default VPC in use",
        details: "Default VPCs have permissive configurations",
        remediation: "Create a custom VPC with proper network segmentation",
      })
    }

    if (allContent.includes("aws_default_security_group")) {
      output.push(`  [+] Default security group managed (good)`)
    }

    const naclPattern = /resource\s+"aws_network_acl_rule"/g
    const naclMatches = allContent.match(naclPattern)
    if (naclMatches) {
      output.push(`  [+] Network ACL rules: ${naclMatches.length}`)
      if (allContent.includes("cidr_block") && /cidr_block\s*=\s*"0\.0\.0\.0\/0"/.test(allContent)) {
        const context = allContent.match(/resource\s+"aws_network_acl_rule"[^}]*0\.0\.0\.0\/0[^}]*/g) || []
        for (const block of context) {
          if (block.includes("rule_action") && block.includes("allow") && !block.includes("egress")) {
            output.push(`  [!] Open NACL ingress rule (0.0.0.0/0 allow)`)
            findings.push({
              checkId: "IAC-NET-002",
              provider: "terraform",
              severity: "high",
              status: "FAIL",
              resource: "aws_network_acl_rule",
              title: "Open NACL ingress: 0.0.0.0/0",
              details: "Network ACL allows all inbound traffic",
              remediation: "Restrict NACL rules to specific CIDR ranges",
            })
          }
        }
      }
    }

    if (allContent.includes("aws_subnet")) {
      const publicSubnets = allContent.match(/map_public_ip_on_launch\s*=\s*true/g)
      if (publicSubnets) {
        output.push(`  [+] Public subnets (auto-assign IP): ${publicSubnets.length}`)
        if (!allContent.includes("aws_nat_gateway")) {
          output.push(`  [!] Public subnets exist but no NAT gateway found`)
          findings.push({
            checkId: "IAC-NET-001",
            provider: "terraform",
            severity: "medium",
            status: "FAIL",
            resource: "aws_nat_gateway",
            title: "No NAT gateway for private subnet outbound",
            details: "Public subnets exist but no NAT gateway — private subnets have no outbound path",
            remediation: "Add NAT gateway for private subnet internet access",
          })
        }
      }
    }

    if (allContent.includes("aws_vpc_peering_connection")) {
      output.push(`  [+] VPC peering connections found`)
      if (allContent.includes("auto_accept") && allContent.includes("auto_accept = true")) {
        output.push(`  [!] VPC peering with auto_accept = true`)
        findings.push({
          checkId: "IAC-NET-002",
          provider: "terraform",
          severity: "medium",
          status: "FAIL",
          resource: "aws_vpc_peering_connection",
          title: "VPC peering auto-accept enabled",
          details: "Auto-accepting peering can allow unauthorized network access",
          remediation: "Set auto_accept = false and manually accept peering requests",
        })
      }
    }

    if (!allContent.includes("aws_flow_log") && allContent.includes("aws_vpc")) {
      output.push(`  [!] VPCs defined but no flow logs`)
    }
  }

  if (provider === "azure" || provider === "all") {
    if (allContent.includes("azurerm_network_security_group")) {
      output.push(`  [+] Azure NSGs found`)
    }
    if (allContent.includes("azurerm_virtual_network")) {
      if (!allContent.includes("azurerm_network_watcher_flow_log")) {
        output.push(`  [!] Azure VNets without flow logs`)
      }
    }
  }

  if (provider === "gcp" || provider === "all") {
    if (allContent.includes("google_compute_network")) {
      if (allContent.includes("auto_create_subnetworks = true")) {
        output.push(`  [!] GCP network with auto-create subnets (less control)`)
      }
    }
  }

  if (findings.length === 0) output.push("\n[+] No network misconfigurations found")
  return { output: output.join("\n"), findings }
}

async function cleanupIac(_args: string[], _timeout: number): Promise<HookResult> {
  const dryRun = hasFlag(_args, "--dry-run")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cleaning up IaC audit artifacts...\n"]

  const tmpFiles = [
    "/tmp/cs-tfstate-pulled.json",
    "/tmp/cs-tfstate-current.json",
    "/tmp/cs-tfplan",
    "/tmp/cs-remote-state.json",
    "/tmp/cs-gcs-state.json",
    "/tmp/cs-http-state.json",
  ]

  for (const f of tmpFiles) {
    const check = await run("test", ["-f", f], 5)
    if (check.exitCode === 0) {
      output.push(`  ${dryRun ? "[dry-run]" : "[removed]"} ${f}`)
      if (!dryRun) await run("rm", ["-f", f], 5)
    }
  }

  return { output: output.join("\n"), findings }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const IachookTool = Tool.define("iachook", {
  description: `Audit Infrastructure-as-Code for security misconfigurations. 13 programs: Terraform state/plan/provider audit, CloudFormation template scan, Ansible vault/secrets, security groups, storage policies, encryption, IAM, remote state exploit, logging/monitoring gaps, network/VPC audit. Available: ${programKeys.join(", ")}. ALWAYS run cleanup_iac when done.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "IaC audit program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const needsTerraform = ["tf_state_secrets", "tf_plan_audit"]
    if (needsTerraform.includes(params.program) && !Bun.which("terraform")) {
      return {
        title: `iachook: ${params.program}`,
        output: "terraform CLI not found. Install: https://developer.hashicorp.com/terraform/install",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const dispatch: Record<Program, () => Promise<HookResult>> = {
      tf_state_secrets: () => tfStateSecrets(params.args, params.timeout_seconds),
      tf_plan_audit: () => tfPlanAudit(params.args, params.timeout_seconds),
      sg_audit: () => sgAudit(params.args, params.timeout_seconds),
      s3_policy_audit: () => s3PolicyAudit(params.args, params.timeout_seconds),
      encryption_audit: () => encryptionAudit(params.args, params.timeout_seconds),
      iam_audit: () => iamAudit(params.args, params.timeout_seconds),
      remote_state_exploit: () => remoteStateExploit(params.args, params.timeout_seconds),
      tf_provider_creds: () => tfProviderCreds(params.args, params.timeout_seconds),
      cfn_audit: () => cfnAudit(params.args, params.timeout_seconds),
      ansible_secrets: () => ansibleSecrets(params.args, params.timeout_seconds),
      logging_audit: () => loggingAudit(params.args, params.timeout_seconds),
      network_audit: () => networkAudit(params.args, params.timeout_seconds),
      cleanup_iac: () => cleanupIac(params.args, params.timeout_seconds),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `iachook: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return {
        title: `iachook: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
