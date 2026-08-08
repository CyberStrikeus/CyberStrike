import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  verify_readonly: {
    description:
      "Safety check: confirms current credentials have no write/modify permissions via IAM policy simulation (AWS), role definition check (Azure), testIamPermissions (GCP). ALWAYS run first",
    args: "[--provider aws|azure|gcp|all]",
  },
  aws_iam_audit: {
    description:
      "Analyze IAM policies for overprivileged access, wildcard permissions, unused credentials, MFA status, cross-account trust relationships",
    args: "[--profile PROFILE] [--region REGION]",
  },
  azure_iam_audit: {
    description:
      "Analyze Entra ID role assignments, dangerous role assignments (Owner/Contributor), custom roles with wildcard actions",
    args: "[--subscription-id SUB]",
  },
  gcp_iam_audit: {
    description:
      "Analyze IAM bindings for excessive roles (Owner/Editor at project level), service account key age, primitive role usage",
    args: "[--project PROJECT_ID]",
  },
  aws_storage_audit: {
    description:
      "Check S3 bucket policies, ACLs, Block Public Access settings, default encryption status, versioning configuration",
    args: "[--profile PROFILE] [--region REGION]",
  },
  azure_storage_audit: {
    description: "Check Blob container public access levels, HTTPS-only enforcement, minimum TLS version",
    args: "[--subscription-id SUB]",
  },
  gcp_storage_audit: {
    description:
      "Check GCS bucket IAM for allUsers/allAuthenticatedUsers bindings, uniform bucket-level access, versioning",
    args: "[--project PROJECT_ID]",
  },
  aws_network_audit: {
    description:
      "Check security groups for unrestricted inbound (0.0.0.0/0) on dangerous ports, IMDSv1-enabled instances, VPC flow logs",
    args: "[--profile PROFILE] [--region REGION]",
  },
  azure_network_audit: {
    description: "Check NSGs for Any/Any inbound rules, public IPs attached to VMs, NSG flow log status",
    args: "[--subscription-id SUB]",
  },
  gcp_network_audit: {
    description: "Check firewall rules open to 0.0.0.0/0, external IP addresses on compute instances, legacy networks",
    args: "[--project PROJECT_ID]",
  },
  aws_encryption_audit: {
    description:
      "Check EBS volumes, RDS instances for encryption at rest. Verify KMS key rotation and CMK vs AWS-managed key usage",
    args: "[--profile PROFILE] [--region REGION]",
  },
  azure_encryption_audit: {
    description: "Check disk encryption type (platform vs customer-managed), Storage account encryption source",
    args: "[--subscription-id SUB]",
  },
  gcp_encryption_audit: {
    description: "Check disk and Cloud SQL encryption. Verify CMEK vs Google-managed keys, KMS key rotation status",
    args: "[--project PROJECT_ID]",
  },
  aws_logging_audit: {
    description: "Check CloudTrail multi-region configuration, GuardDuty enablement, and AWS Config recorder status",
    args: "[--profile PROFILE] [--region REGION]",
  },
  azure_logging_audit: {
    description: "Check Activity Log diagnostic settings, subscription-level logging configuration",
    args: "[--subscription-id SUB]",
  },
  gcp_logging_audit: {
    description: "Check audit log configuration, log sink destinations and filters, data access log enablement",
    args: "[--project PROJECT_ID]",
  },
  dns_audit: {
    description:
      "Enumerate DNS records, find dangling CNAMEs (subdomain takeover candidates), check DNSSEC and CAA records",
    args: "--domain DOMAIN [--nameserver NS]",
  },
  tls_audit: {
    description:
      "Check TLS protocol versions, certificate expiry and chain validity, cipher suite strength, HSTS headers",
    args: "--target HOST[:PORT]",
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
type AuditResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function exec(
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

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function tryJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function formatFindings(tool: string, provider: string, findings: Finding[]): string {
  const crit = findings.filter((f) => f.severity === "critical").length
  const high = findings.filter((f) => f.severity === "high").length
  const med = findings.filter((f) => f.severity === "medium").length
  const lines = [
    `\n${"=".repeat(60)}`,
    `${tool} — ${findings.length} finding(s) (critical: ${crit}, high: ${high}, medium: ${med})\n`,
  ]
  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.title}`)
    lines.push(`  Resource: ${f.resource}`)
    lines.push(`  ${f.details}`)
    lines.push(`  Fix: ${f.remediation}\n`)
  }
  return lines.join("\n")
}

// ── AWS programs (uses aws CLI) ──

async function awsCmd(args: string[], profile: string | undefined, region: string | undefined, timeout: number) {
  const extra = [
    ...(profile ? ["--profile", profile] : []),
    ...(region ? ["--region", region] : []),
    "--output",
    "json",
  ]
  return exec("aws", [...args, ...extra], timeout)
}

async function awsIamAudit(args: string[], timeout: number): Promise<AuditResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  const id = await awsCmd(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] AWS credentials not configured: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout)
  const output = [`[*] AWS IAM Audit — Account: ${identity?.Account}`, `[*] Identity: ${identity?.Arn}\n`]

  const summary = await awsCmd(["iam", "get-account-summary"], profile, region, timeout)
  if (summary.exitCode === 0) {
    const s = tryJson(summary.stdout)?.SummaryMap || {}
    if (s.AccountAccessKeysPresent > 0) {
      findings.push({
        checkId: "AWS-IAM-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "root",
        title: "Root account has active access keys",
        details: "Root access keys present — critical security risk",
        remediation: "Delete root access keys, use IAM users/roles",
      })
    }
    output.push(`[+] Users: ${s.Users}, Roles: ${s.Roles}, Groups: ${s.Groups}, Policies: ${s.Policies}`)
  }

  const users = await awsCmd(
    ["iam", "list-users", "--query", "Users[].UserName", "--output", "json"],
    profile,
    region,
    timeout,
  )
  if (users.exitCode === 0) {
    const userList = tryJson(users.stdout) || []
    for (const u of userList) {
      const mfa = await awsCmd(["iam", "list-mfa-devices", "--user-name", u], profile, region, timeout)
      const devices = tryJson(mfa.stdout)?.MFADevices || []
      if (devices.length === 0) {
        const login = await awsCmd(["iam", "get-login-profile", "--user-name", u], profile, region, timeout)
        if (login.exitCode === 0) {
          findings.push({
            checkId: "AWS-IAM-002",
            provider: "aws",
            severity: "high",
            status: "FAIL",
            resource: u,
            title: `IAM user without MFA: ${u}`,
            details: `User ${u} has console access but no MFA`,
            remediation: "Enable MFA for all console users",
          })
        }
      }
      const keys = await awsCmd(
        ["iam", "list-access-keys", "--user-name", u, "--query", "AccessKeyMetadata[?Status=='Active']"],
        profile,
        region,
        timeout,
      )
      const activeKeys = tryJson(keys.stdout) || []
      for (const k of activeKeys) {
        const lastUsed = await awsCmd(
          ["iam", "get-access-key-last-used", "--access-key-id", k.AccessKeyId],
          profile,
          region,
          timeout,
        )
        const lu = tryJson(lastUsed.stdout)?.AccessKeyLastUsed
        if (!lu?.LastUsedDate) {
          findings.push({
            checkId: "AWS-IAM-003",
            provider: "aws",
            severity: "medium",
            status: "FAIL",
            resource: `${u}/${k.AccessKeyId}`,
            title: `Unused access key: ${k.AccessKeyId}`,
            details: `Key for ${u} has never been used`,
            remediation: "Delete unused access keys",
          })
        }
      }
    }
    output.push(`[+] Checked ${userList.length} user(s)`)
  }

  output.push(formatFindings("aws_iam_audit", "aws", findings))
  return { output: output.join("\n"), findings }
}

async function awsStorageAudit(args: string[], timeout: number): Promise<AuditResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  const r = await awsCmd(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] Cannot list S3 buckets: ${r.stderr.trim()}`, findings }
  const buckets = tryJson(r.stdout) || []
  const output = [`[*] AWS S3 Storage Audit — ${buckets.length} bucket(s)\n`]

  for (const b of buckets) {
    const pab = await awsCmd(["s3api", "get-public-access-block", "--bucket", b], profile, region, timeout)
    if (pab.exitCode !== 0) {
      findings.push({
        checkId: "AWS-S3-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: b,
        title: `No Block Public Access: ${b}`,
        details: `Bucket ${b} has no Block Public Access configuration`,
        remediation: "Enable all four Block Public Access settings",
      })
    } else {
      const cfg = tryJson(pab.stdout)?.PublicAccessBlockConfiguration || {}
      if (!cfg.BlockPublicAcls || !cfg.IgnorePublicAcls || !cfg.BlockPublicPolicy || !cfg.RestrictPublicBuckets) {
        findings.push({
          checkId: "AWS-S3-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: b,
          title: `Incomplete Block Public Access: ${b}`,
          details: `Not all four settings enabled`,
          remediation: "Enable all Block Public Access settings",
        })
      }
    }
    const ver = await awsCmd(["s3api", "get-bucket-versioning", "--bucket", b], profile, region, timeout)
    if (ver.exitCode === 0) {
      const status = tryJson(ver.stdout)?.Status
      if (status !== "Enabled") {
        findings.push({
          checkId: "AWS-S3-002",
          provider: "aws",
          severity: "low",
          status: "FAIL",
          resource: b,
          title: `Versioning disabled: ${b}`,
          details: `Bucket versioning: ${status || "Disabled"}`,
          remediation: "Enable versioning for data protection",
        })
      }
    }
  }

  output.push(formatFindings("aws_storage_audit", "aws", findings))
  return { output: output.join("\n"), findings }
}

async function awsNetworkAudit(args: string[], timeout: number): Promise<AuditResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const dangerousPorts = [22, 3389, 3306, 5432, 1433, 27017, 6379, 9200]

  const sgs = await awsCmd(["ec2", "describe-security-groups"], profile, region, timeout)
  if (sgs.exitCode === 0) {
    for (const sg of tryJson(sgs.stdout)?.SecurityGroups || []) {
      for (const perm of sg.IpPermissions || []) {
        for (const cidr of perm.IpRanges || []) {
          if (cidr.CidrIp === "0.0.0.0/0") {
            const from = perm.FromPort ?? 0
            const to = perm.ToPort ?? 65535
            if (from === -1 || dangerousPorts.some((p) => p >= from && p <= to)) {
              findings.push({
                checkId: "AWS-NET-001",
                provider: "aws",
                severity: "high",
                status: "FAIL",
                resource: sg.GroupId,
                title: `SG open to 0.0.0.0/0: ${sg.GroupId} port ${from}-${to}`,
                details: `${sg.GroupName} in VPC ${sg.VpcId}`,
                remediation: "Restrict to specific IPs",
              })
            }
          }
        }
      }
    }
  }

  const instances = await awsCmd(
    ["ec2", "describe-instances", "--query", "Reservations[].Instances[]"],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode === 0) {
    for (const inst of tryJson(instances.stdout) || []) {
      const md = inst.MetadataOptions || {}
      if (md.HttpEndpoint === "enabled" && md.HttpTokens !== "required") {
        findings.push({
          checkId: "AWS-NET-002",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: inst.InstanceId,
          title: `IMDSv1 enabled: ${inst.InstanceId}`,
          details: "Vulnerable to SSRF credential theft",
          remediation: "Set HttpTokens to 'required' (IMDSv2)",
        })
      }
    }
  }

  const vpcs = await awsCmd(["ec2", "describe-vpcs", "--query", "Vpcs[].VpcId"], profile, region, timeout)
  if (vpcs.exitCode === 0) {
    for (const vpc of tryJson(vpcs.stdout) || []) {
      const fl = await awsCmd(
        ["ec2", "describe-flow-logs", "--filter", `Name=resource-id,Values=${vpc}`],
        profile,
        region,
        timeout,
      )
      if (fl.exitCode === 0 && (tryJson(fl.stdout)?.FlowLogs || []).length === 0) {
        findings.push({
          checkId: "AWS-NET-003",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: vpc,
          title: `No VPC flow logs: ${vpc}`,
          details: "No flow logs configured",
          remediation: "Enable VPC flow logs",
        })
      }
    }
  }

  return { output: `[*] AWS Network Audit\n${formatFindings("aws_network_audit", "aws", findings)}`, findings }
}

async function awsEncryptionAudit(args: string[], timeout: number): Promise<AuditResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  const vols = await awsCmd(
    ["ec2", "describe-volumes", "--query", "Volumes[?!Encrypted].[VolumeId,Size]"],
    profile,
    region,
    timeout,
  )
  if (vols.exitCode === 0) {
    for (const v of tryJson(vols.stdout) || []) {
      findings.push({
        checkId: "AWS-ENC-001",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: v[0],
        title: `Unencrypted EBS: ${v[0]}`,
        details: `${v[1]} GB volume not encrypted`,
        remediation: "Enable EBS encryption by default",
      })
    }
  }

  const rds = await awsCmd(
    ["rds", "describe-db-instances", "--query", "DBInstances[?!StorageEncrypted].[DBInstanceIdentifier,Engine]"],
    profile,
    region,
    timeout,
  )
  if (rds.exitCode === 0) {
    for (const db of tryJson(rds.stdout) || []) {
      findings.push({
        checkId: "AWS-ENC-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: db[0],
        title: `Unencrypted RDS: ${db[0]}`,
        details: `${db[1]} instance not encrypted`,
        remediation: "Enable encryption (requires snapshot + restore)",
      })
    }
  }

  return { output: `[*] AWS Encryption Audit\n${formatFindings("aws_encryption_audit", "aws", findings)}`, findings }
}

async function awsLoggingAudit(args: string[], timeout: number): Promise<AuditResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  const trails = await awsCmd(["cloudtrail", "describe-trails"], profile, region, timeout)
  if (trails.exitCode === 0) {
    const tl = tryJson(trails.stdout)?.trailList || []
    if (tl.length === 0) {
      findings.push({
        checkId: "AWS-LOG-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "account",
        title: "No CloudTrail trails",
        details: "API activity is not being recorded",
        remediation: "Create multi-region CloudTrail trail",
      })
    } else if (!tl.some((t: { IsMultiRegionTrail: boolean }) => t.IsMultiRegionTrail)) {
      findings.push({
        checkId: "AWS-LOG-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: "account",
        title: "No multi-region CloudTrail",
        details: "No trail covers all regions",
        remediation: "Enable multi-region on a trail",
      })
    }
  }

  const gd = await awsCmd(["guardduty", "list-detectors"], profile, region, timeout)
  if (gd.exitCode === 0 && (tryJson(gd.stdout)?.DetectorIds || []).length === 0) {
    findings.push({
      checkId: "AWS-LOG-003",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: "account",
      title: "GuardDuty not enabled",
      details: "No detectors found",
      remediation: "Enable GuardDuty",
    })
  }

  return { output: `[*] AWS Logging Audit\n${formatFindings("aws_logging_audit", "aws", findings)}`, findings }
}

// ── Azure programs (uses az CLI) ──

async function azCmd(args: string[], sub: string | undefined, timeout: number) {
  const extra = sub ? ["--subscription", sub] : []
  return exec("az", [...args, ...extra, "-o", "json"], timeout)
}

async function azureIamAudit(args: string[], timeout: number): Promise<AuditResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []

  const assignments = await azCmd(["role", "assignment", "list", "--all"], sub, timeout)
  if (assignments.exitCode !== 0)
    return { output: `[-] Cannot list role assignments: ${assignments.stderr.trim()}`, findings }
  const ra = tryJson(assignments.stdout) || []
  const output = [`[*] Azure IAM Audit — ${ra.length} role assignment(s)\n`]
  const dangerous = ["Owner", "Contributor", "User Access Administrator"]

  for (const a of ra) {
    const role = a.roleDefinitionName || ""
    if (dangerous.includes(role)) {
      findings.push({
        checkId: "AZURE-IAM-001",
        provider: "azure",
        severity: role === "Owner" ? "critical" : "high",
        status: "FAIL",
        resource: a.principalId || a.principalName || "unknown",
        title: `Dangerous role: ${role}`,
        details: `Principal has ${role} at scope ${a.scope}`,
        remediation: "Use custom roles with least-privilege",
      })
    }
  }

  output.push(formatFindings("azure_iam_audit", "azure", findings))
  return { output: output.join("\n"), findings }
}

async function azureStorageAudit(args: string[], timeout: number): Promise<AuditResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []

  const accts = await azCmd(["storage", "account", "list"], sub, timeout)
  if (accts.exitCode !== 0) return { output: `[-] Cannot list storage accounts: ${accts.stderr.trim()}`, findings }
  const accounts = tryJson(accts.stdout) || []
  const output = [`[*] Azure Storage Audit — ${accounts.length} account(s)\n`]

  for (const a of accounts) {
    if (!a.enableHttpsTrafficOnly)
      findings.push({
        checkId: "AZURE-STORAGE-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: a.name,
        title: `HTTPS not enforced: ${a.name}`,
        details: "Allows HTTP traffic",
        remediation: "Enable secure transfer required",
      })
    if (a.allowBlobPublicAccess)
      findings.push({
        checkId: "AZURE-STORAGE-002",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: a.name,
        title: `Blob public access allowed: ${a.name}`,
        details: "Account-level public access enabled",
        remediation: "Disable blob public access",
      })
    if (a.minimumTlsVersion && a.minimumTlsVersion !== "TLS1_2")
      findings.push({
        checkId: "AZURE-STORAGE-003",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: a.name,
        title: `TLS below 1.2: ${a.name}`,
        details: `Min TLS: ${a.minimumTlsVersion}`,
        remediation: "Set minimum TLS to 1.2",
      })
  }

  output.push(formatFindings("azure_storage_audit", "azure", findings))
  return { output: output.join("\n"), findings }
}

async function azureNetworkAudit(args: string[], timeout: number): Promise<AuditResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []

  const nsgs = await azCmd(["network", "nsg", "list"], sub, timeout)
  if (nsgs.exitCode === 0) {
    for (const nsg of tryJson(nsgs.stdout) || []) {
      for (const rule of nsg.securityRules || []) {
        if (
          rule.direction === "Inbound" &&
          rule.access === "Allow" &&
          ["*", "0.0.0.0/0", "Internet"].includes(rule.sourceAddressPrefix)
        ) {
          findings.push({
            checkId: "AZURE-NET-001",
            provider: "azure",
            severity: "high",
            status: "FAIL",
            resource: nsg.name,
            title: `NSG open inbound: ${nsg.name}/${rule.name}`,
            details: `Allows from ${rule.sourceAddressPrefix} to port ${rule.destinationPortRange}`,
            remediation: "Restrict source addresses",
          })
        }
      }
    }
  }

  const ips = await azCmd(["network", "public-ip", "list"], sub, timeout)
  if (ips.exitCode === 0) {
    for (const ip of tryJson(ips.stdout) || []) {
      if (ip.ipConfiguration)
        findings.push({
          checkId: "AZURE-NET-002",
          provider: "azure",
          severity: "medium",
          status: "FAIL",
          resource: ip.name,
          title: `Public IP attached: ${ip.ipAddress}`,
          details: `Attached to ${ip.ipConfiguration?.id?.split("/").pop() || "resource"}`,
          remediation: "Use private endpoints where possible",
        })
    }
  }

  return { output: `[*] Azure Network Audit\n${formatFindings("azure_network_audit", "azure", findings)}`, findings }
}

async function azureEncryptionAudit(args: string[], timeout: number): Promise<AuditResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []

  const disks = await azCmd(["disk", "list"], sub, timeout)
  if (disks.exitCode === 0) {
    for (const d of tryJson(disks.stdout) || []) {
      if (d.encryption?.type === "EncryptionAtRestWithPlatformKey") {
        findings.push({
          checkId: "AZURE-ENC-001",
          provider: "azure",
          severity: "low",
          status: "FAIL",
          resource: d.name,
          title: `Platform-managed key only: ${d.name}`,
          details: "Consider BYOK/CMK",
          remediation: "Use customer-managed key via Disk Encryption Set",
        })
      }
    }
  }

  return {
    output: `[*] Azure Encryption Audit\n${formatFindings("azure_encryption_audit", "azure", findings)}`,
    findings,
  }
}

async function azureLoggingAudit(args: string[], timeout: number): Promise<AuditResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []

  const subId = sub || tryJson((await exec("az", ["account", "show", "-o", "json"], timeout)).stdout)?.id
  if (subId) {
    const diag = await azCmd(
      ["monitor", "diagnostic-settings", "subscription", "list", "--subscription", subId],
      undefined,
      timeout,
    )
    if (diag.exitCode === 0 && (tryJson(diag.stdout)?.value || []).length === 0) {
      findings.push({
        checkId: "AZURE-LOG-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: subId,
        title: "No subscription diagnostic settings",
        details: "Activity Logs not exported",
        remediation: "Configure diagnostic settings for Activity Log export",
      })
    }
  }

  return { output: `[*] Azure Logging Audit\n${formatFindings("azure_logging_audit", "azure", findings)}`, findings }
}

// ── GCP programs (uses gcloud CLI) ──

async function gcpCmd(args: string[], project: string | undefined, timeout: number) {
  const extra = project ? ["--project", project] : []
  return exec("gcloud", [...args, ...extra, "--format=json"], timeout)
}

async function resolveGcpProject(provided?: string): Promise<string> {
  if (provided) return provided
  const r = await exec("gcloud", ["config", "get-value", "project", "--quiet"], 10)
  const p = r.stdout.trim()
  if (!p || r.exitCode !== 0)
    throw new Error("No GCP project set. Pass --project or run: gcloud config set project PROJECT_ID")
  return p
}

async function gcpIamAudit(args: string[], timeout: number): Promise<AuditResult> {
  const project = await resolveGcpProject(argVal(args, "--project"))
  const findings: Finding[] = []

  const policy = await gcpCmd(["projects", "get-iam-policy", project], undefined, timeout)
  if (policy.exitCode !== 0) return { output: `[-] Cannot read IAM policy: ${policy.stderr.trim()}`, findings }
  const bindings = tryJson(policy.stdout)?.bindings || []
  const output = [`[*] GCP IAM Audit — Project: ${project}\n`]

  for (const b of bindings) {
    if (b.role === "roles/owner" || b.role === "roles/editor") {
      for (const m of b.members || []) {
        findings.push({
          checkId: "GCP-IAM-001",
          provider: "gcp",
          severity: b.role === "roles/owner" ? "critical" : "high",
          status: "FAIL",
          resource: m,
          title: `Primitive role: ${b.role}`,
          details: `${m} has ${b.role} at project level`,
          remediation: "Replace with predefined or custom roles",
        })
      }
    }
  }

  const sas = await gcpCmd(["iam", "service-accounts", "list"], project, timeout)
  if (sas.exitCode === 0) {
    for (const sa of tryJson(sas.stdout) || []) {
      const keys = await gcpCmd(
        ["iam", "service-accounts", "keys", "list", "--iam-account", sa.email, "--managed-by=user"],
        project,
        timeout,
      )
      if (keys.exitCode === 0) {
        for (const k of tryJson(keys.stdout) || []) {
          const created = new Date(k.validAfterTime)
          const age = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24))
          if (age > 90) {
            findings.push({
              checkId: "GCP-IAM-002",
              provider: "gcp",
              severity: "medium",
              status: "FAIL",
              resource: `${sa.email}/${k.name.split("/").pop()}`,
              title: `SA key age ${age}d (>90d)`,
              details: `Key for ${sa.email} created ${k.validAfterTime}`,
              remediation: "Rotate service account keys every 90 days",
            })
          }
        }
      }
    }
  }

  output.push(formatFindings("gcp_iam_audit", "gcp", findings))
  return { output: output.join("\n"), findings }
}

async function gcpStorageAudit(args: string[], timeout: number): Promise<AuditResult> {
  const project = await resolveGcpProject(argVal(args, "--project"))
  const findings: Finding[] = []

  const buckets = await exec("gsutil", ["ls", "-p", project], timeout)
  if (buckets.exitCode !== 0) return { output: `[-] Cannot list buckets: ${buckets.stderr.trim()}`, findings }
  const bucketList = buckets.stdout.trim().split("\n").filter(Boolean)
  const output = [`[*] GCP Storage Audit — ${bucketList.length} bucket(s)\n`]

  for (const b of bucketList) {
    const name = b.replace("gs://", "").replace("/", "")
    const iam = await exec("gsutil", ["iam", "get", b], timeout)
    if (iam.exitCode === 0) {
      const text = iam.stdout
      if (text.includes("allUsers") || text.includes("allAuthenticatedUsers")) {
        findings.push({
          checkId: "GCP-STORAGE-001",
          provider: "gcp",
          severity: "critical",
          status: "FAIL",
          resource: name,
          title: `Public bucket: ${name}`,
          details: "Bucket has allUsers or allAuthenticatedUsers bindings",
          remediation: "Remove public IAM bindings",
        })
      }
    }
    const ubla = await exec("gsutil", ["uniformbucketlevelaccess", "get", b], timeout)
    if (ubla.exitCode === 0 && ubla.stdout.includes("Enabled: False")) {
      findings.push({
        checkId: "GCP-STORAGE-002",
        provider: "gcp",
        severity: "medium",
        status: "FAIL",
        resource: name,
        title: `No uniform access: ${name}`,
        details: "Uses legacy ACLs",
        remediation: "Enable uniform bucket-level access",
      })
    }
  }

  output.push(formatFindings("gcp_storage_audit", "gcp", findings))
  return { output: output.join("\n"), findings }
}

async function gcpNetworkAudit(args: string[], timeout: number): Promise<AuditResult> {
  const project = await resolveGcpProject(argVal(args, "--project"))
  const findings: Finding[] = []
  const dangerousPorts = [22, 3389, 3306, 5432, 1433, 27017, 6379, 9200]

  const rules = await gcpCmd(["compute", "firewall-rules", "list"], project, timeout)
  if (rules.exitCode === 0) {
    for (const rule of tryJson(rules.stdout) || []) {
      if (rule.direction === "INGRESS" && (rule.sourceRanges || []).includes("0.0.0.0/0")) {
        for (const allowed of rule.allowed || []) {
          const ports = (allowed.ports || []).flatMap((p: string) => {
            if (p.includes("-")) {
              const [a, b] = p.split("-")
              return Array.from({ length: Number(b) - Number(a) + 1 }, (_, i) => Number(a) + i)
            }
            return [Number(p)]
          })
          const dangerous =
            ports.length === 0 ? dangerousPorts : ports.filter((p: number) => dangerousPorts.includes(p))
          if (dangerous.length > 0 || ports.length === 0) {
            findings.push({
              checkId: "GCP-NET-001",
              provider: "gcp",
              severity: "high",
              status: "FAIL",
              resource: rule.name,
              title: `Firewall open to 0.0.0.0/0: ${rule.name}`,
              details: `${allowed.IPProtocol}:${dangerous.join(",")}`,
              remediation: "Restrict source ranges or use IAP",
            })
          }
        }
      }
    }
  }

  const instances = await gcpCmd(["compute", "instances", "list"], project, timeout)
  if (instances.exitCode === 0) {
    for (const inst of tryJson(instances.stdout) || []) {
      for (const nic of inst.networkInterfaces || []) {
        for (const ac of nic.accessConfigs || []) {
          if (ac.natIP)
            findings.push({
              checkId: "GCP-NET-002",
              provider: "gcp",
              severity: "medium",
              status: "FAIL",
              resource: inst.name,
              title: `External IP: ${inst.name}`,
              details: `IP: ${ac.natIP}`,
              remediation: "Use Cloud NAT or IAP instead",
            })
        }
      }
    }
  }

  return { output: `[*] GCP Network Audit\n${formatFindings("gcp_network_audit", "gcp", findings)}`, findings }
}

async function gcpEncryptionAudit(args: string[], timeout: number): Promise<AuditResult> {
  const project = await resolveGcpProject(argVal(args, "--project"))
  const findings: Finding[] = []

  const disks = await gcpCmd(["compute", "disks", "list"], project, timeout)
  if (disks.exitCode === 0) {
    for (const d of tryJson(disks.stdout) || []) {
      if (!d.diskEncryptionKey?.kmsKeyName) {
        findings.push({
          checkId: "GCP-ENC-001",
          provider: "gcp",
          severity: "low",
          status: "FAIL",
          resource: d.name,
          title: `Google-managed encryption: ${d.name}`,
          details: "No CMEK configured",
          remediation: "Consider CMEK for enhanced key control",
        })
      }
    }
  }

  const keyrings = await gcpCmd(["kms", "keyrings", "list", "--location=global"], project, timeout)
  if (keyrings.exitCode === 0) {
    for (const kr of tryJson(keyrings.stdout) || []) {
      const keys = await gcpCmd(
        ["kms", "keys", "list", "--keyring", kr.name.split("/").pop(), "--location=global"],
        project,
        timeout,
      )
      if (keys.exitCode === 0) {
        for (const k of tryJson(keys.stdout) || []) {
          if (k.purpose === "ENCRYPT_DECRYPT" && !k.rotationPeriod) {
            findings.push({
              checkId: "GCP-ENC-002",
              provider: "gcp",
              severity: "medium",
              status: "FAIL",
              resource: k.name.split("/").pop(),
              title: `KMS key without rotation`,
              details: `Key ${k.name.split("/").pop()} has no automatic rotation`,
              remediation: "Set rotation period to 90 days",
            })
          }
        }
      }
    }
  }

  return { output: `[*] GCP Encryption Audit\n${formatFindings("gcp_encryption_audit", "gcp", findings)}`, findings }
}

async function gcpLoggingAudit(args: string[], timeout: number): Promise<AuditResult> {
  const project = await resolveGcpProject(argVal(args, "--project"))
  const findings: Finding[] = []

  const policy = await gcpCmd(["projects", "get-iam-policy", project], undefined, timeout)
  if (policy.exitCode === 0) {
    const p = tryJson(policy.stdout)
    if (!p?.auditConfigs || p.auditConfigs.length === 0) {
      findings.push({
        checkId: "GCP-LOG-001",
        provider: "gcp",
        severity: "high",
        status: "FAIL",
        resource: project,
        title: "No audit log configuration",
        details: "Data access logs may not be captured",
        remediation: "Enable data access audit logs for allServices",
      })
    }
  }

  const sinks = await gcpCmd(["logging", "sinks", "list"], project, timeout)
  if (sinks.exitCode === 0) {
    const s = tryJson(sinks.stdout) || []
    if (s.length === 0) {
      findings.push({
        checkId: "GCP-LOG-002",
        provider: "gcp",
        severity: "medium",
        status: "FAIL",
        resource: project,
        title: "No log sinks configured",
        details: "Logs only in Cloud Logging with default retention",
        remediation: "Create log sinks to BigQuery/GCS/Pub/Sub",
      })
    }
  }

  return { output: `[*] GCP Logging Audit\n${formatFindings("gcp_logging_audit", "gcp", findings)}`, findings }
}

// ── Cross-cloud programs ──

async function verifyReadonly(args: string[], timeout: number): Promise<AuditResult> {
  const provider = argVal(args, "--provider") || "all"
  const output: string[] = ["[*] Credential safety verification\n"]
  const findings: Finding[] = []
  let anyFail = false

  if (provider === "aws" || provider === "all") {
    const r = await exec(
      "aws",
      [
        "iam",
        "simulate-principal-policy",
        "--policy-source-arn",
        "arn:aws:iam::root",
        "--action-names",
        "iam:CreateUser",
        "--output",
        "json",
      ],
      timeout,
    )
    if (r.exitCode === 0) {
      const results = tryJson(r.stdout)?.EvaluationResults || []
      const allowed = results.filter((e: { EvalDecision: string }) => e.EvalDecision === "allowed")
      if (allowed.length > 0) {
        output.push("[!] AWS: FAIL — write permissions detected")
        findings.push({
          checkId: "VERIFY-AWS-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: "credentials",
          title: "AWS credentials have write permissions",
          details: "iam:CreateUser simulation returned allowed",
          remediation: "Use read-only credentials for assessment",
        })
        anyFail = true
      } else output.push("[+] AWS: PASS — no dangerous write permissions")
    } else if (r.stderr.includes("Unable to locate credentials")) {
      output.push("[-] AWS: SKIP — no credentials")
    } else {
      output.push("[+] AWS: PASS (simulation denied — likely read-only)")
    }
  }

  if (provider === "azure" || provider === "all") {
    const r = await exec("az", ["role", "assignment", "list", "--assignee", "@me", "-o", "json"], timeout)
    if (r.exitCode === 0) {
      const roles = (tryJson(r.stdout) || []).map((a: { roleDefinitionName: string }) => a.roleDefinitionName)
      const dangerousRoles = roles.filter((r: string) =>
        ["Owner", "Contributor", "User Access Administrator"].includes(r),
      )
      if (dangerousRoles.length > 0) {
        output.push(`[!] Azure: FAIL — dangerous roles: ${dangerousRoles.join(", ")}`)
        findings.push({
          checkId: "VERIFY-AZURE-001",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: "credentials",
          title: `Azure credentials have dangerous roles: ${dangerousRoles.join(", ")}`,
          details: "Write/admin permissions detected",
          remediation: "Use Reader role for assessment",
        })
        anyFail = true
      } else output.push("[+] Azure: PASS — no dangerous roles")
    } else {
      output.push("[-] Azure: SKIP — not logged in")
    }
  }

  if (provider === "gcp" || provider === "all") {
    const project = await resolveGcpProject(argVal(args, "--project")).catch(() => null)
    if (project) {
      const r = await exec(
        "gcloud",
        [
          "projects",
          "test-iam-permissions",
          project,
          "--permissions=compute.instances.delete,iam.serviceAccounts.create,storage.buckets.delete",
          "--format=json",
        ],
        timeout,
      )
      if (r.exitCode === 0) {
        const granted = tryJson(r.stdout)?.permissions || []
        if (granted.length > 0) {
          output.push(`[!] GCP: FAIL — write permissions: ${granted.join(", ")}`)
          findings.push({
            checkId: "VERIFY-GCP-001",
            provider: "gcp",
            severity: "high",
            status: "FAIL",
            resource: "credentials",
            title: `GCP credentials have write permissions: ${granted.join(", ")}`,
            details: "Dangerous permissions detected via testIamPermissions",
            remediation: "Use Viewer role for assessment",
          })
          anyFail = true
        } else output.push("[+] GCP: PASS — no dangerous write permissions")
      }
    } else {
      output.push("[-] GCP: SKIP — no project configured")
    }
  }

  output.push(`\n${"=".repeat(60)}`)
  output.push(
    `Overall: ${anyFail ? "FAIL — credentials have write permissions" : "PASS — read-only credentials confirmed"}`,
  )
  return { output: output.join("\n"), findings }
}

async function dnsAudit(args: string[], timeout: number): Promise<AuditResult> {
  const domain = argVal(args, "--domain")
  if (!domain) return { output: "ERROR: --domain required", findings: [] }
  const ns = argVal(args, "--nameserver")
  const output: string[] = [`[*] DNS Audit — ${domain}\n`]
  const findings: Finding[] = []

  const recordTypes = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA"]
  for (const rtype of recordTypes) {
    const nsArgs = ns ? [`@${ns}`] : []
    const r = await exec("dig", ["+short", rtype, domain, ...nsArgs], timeout)
    if (r.exitCode === 0 && r.stdout.trim()) {
      output.push(`[+] ${rtype}: ${r.stdout.trim().split("\n").join(", ")}`)
    }
  }

  const cname = await exec("dig", ["+short", "CNAME", domain, ...(ns ? [`@${ns}`] : [])], timeout)
  if (cname.exitCode === 0 && cname.stdout.trim()) {
    const target = cname.stdout.trim().replace(/\.$/, "")
    const resolve = await exec("dig", ["+short", "A", target], timeout)
    if (resolve.exitCode === 0 && !resolve.stdout.trim()) {
      findings.push({
        checkId: "DNS-001",
        provider: "dns",
        severity: "critical",
        status: "FAIL",
        resource: domain,
        title: "Dangling CNAME — subdomain takeover",
        details: `${domain} → ${target} (NXDOMAIN)`,
        remediation: "Remove CNAME or reclaim target resource",
      })
    }
  }

  const dnssec = await exec("dig", ["+short", "DNSKEY", domain], timeout)
  if (dnssec.exitCode === 0 && !dnssec.stdout.trim()) {
    findings.push({
      checkId: "DNS-002",
      provider: "dns",
      severity: "medium",
      status: "FAIL",
      resource: domain,
      title: "DNSSEC not configured",
      details: "No DNSKEY records found",
      remediation: "Enable DNSSEC at registrar and DNS provider",
    })
  }

  const caa = await exec("dig", ["+short", "CAA", domain], timeout)
  if (caa.exitCode === 0 && !caa.stdout.trim()) {
    findings.push({
      checkId: "DNS-003",
      provider: "dns",
      severity: "medium",
      status: "FAIL",
      resource: domain,
      title: "No CAA records",
      details: "Any CA can issue certificates",
      remediation: "Add CAA records to restrict certificate issuance",
    })
  }

  output.push(formatFindings("dns_audit", "dns", findings))
  return { output: output.join("\n"), findings }
}

async function tlsAudit(args: string[], timeout: number): Promise<AuditResult> {
  const target = argVal(args, "--target")
  if (!target) return { output: "ERROR: --target required (HOST[:PORT])", findings: [] }
  const [host, portStr] = target.includes(":") ? [target.split(":")[0], target.split(":")[1]] : [target, "443"]
  const port = portStr
  const output: string[] = [`[*] TLS Audit — ${host}:${port}\n`]
  const findings: Finding[] = []

  const r = await exec("openssl", ["s_client", "-connect", `${host}:${port}`, "-servername", host, "-brief"], timeout)
  const certR = await exec("openssl", ["s_client", "-connect", `${host}:${port}`, "-servername", host], timeout)

  if (certR.exitCode === 0 || certR.stdout) {
    const combined = certR.stdout + certR.stderr
    const protoMatch = combined.match(/Protocol\s*:\s*(\S+)/i)
    const cipherMatch = combined.match(/Cipher\s*:\s*(\S+)/i)

    if (protoMatch) output.push(`[+] Protocol: ${protoMatch[1]}`)
    if (cipherMatch) output.push(`[+] Cipher: ${cipherMatch[1]}`)

    if (protoMatch && ["TLSv1", "TLSv1.1", "SSLv3"].includes(protoMatch[1])) {
      findings.push({
        checkId: "TLS-001",
        provider: "tls",
        severity: "high",
        status: "FAIL",
        resource: `${host}:${port}`,
        title: `Weak protocol: ${protoMatch[1]}`,
        details: "Vulnerable to known attacks",
        remediation: "Require TLS 1.2+",
      })
    }

    const dates = await exec("openssl", ["s_client", "-connect", `${host}:${port}`, "-servername", host], timeout)
    const certText = dates.stdout
    const endDate = certText.match(/notAfter=(.+)/)?.[1]
    if (endDate) {
      const expiry = new Date(endDate)
      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      output.push(`[+] Expires: ${endDate} (${daysLeft} days)`)
      if (daysLeft < 0)
        findings.push({
          checkId: "TLS-002",
          provider: "tls",
          severity: "critical",
          status: "FAIL",
          resource: `${host}:${port}`,
          title: `Certificate expired ${Math.abs(daysLeft)}d ago`,
          details: `Expired: ${endDate}`,
          remediation: "Renew certificate immediately",
        })
      else if (daysLeft < 30)
        findings.push({
          checkId: "TLS-003",
          provider: "tls",
          severity: "high",
          status: "FAIL",
          resource: `${host}:${port}`,
          title: `Certificate expiring in ${daysLeft}d`,
          details: `Expires: ${endDate}`,
          remediation: "Renew certificate",
        })
    }
  } else {
    findings.push({
      checkId: "TLS-004",
      provider: "tls",
      severity: "high",
      status: "FAIL",
      resource: `${host}:${port}`,
      title: "TLS connection failed",
      details: r.stderr.trim().split("\n")[0],
      remediation: "Check server TLS configuration",
    })
  }

  const hsts = await exec("curl", ["-sI", `https://${host}:${port}/`, "--max-time", "10"], timeout)
  if (hsts.exitCode === 0) {
    if (!hsts.stdout.toLowerCase().includes("strict-transport-security")) {
      findings.push({
        checkId: "TLS-005",
        provider: "tls",
        severity: "medium",
        status: "FAIL",
        resource: `${host}:${port}`,
        title: "No HSTS header",
        details: "Missing Strict-Transport-Security",
        remediation: "Add HSTS with max-age 31536000+",
      })
    }
  }

  output.push(formatFindings("tls_audit", "tls", findings))
  return { output: output.join("\n"), findings }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const CloudAuditTool = Tool.define("cloud_audit", {
  description: `Execute a READ-ONLY cloud security assessment. No resources are modified — all checks use describe/list/get CLI calls only. Uses native CLI tools (aws/az/gcloud/dig/openssl) — no Python dependency. Run verify_readonly first. Programs: ${programKeys.join(", ")}`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "Cloud audit program. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments for the program"),
    timeout_seconds: z.number().optional().default(300).describe("Max execution time (default: 300)"),
  }),
  async execute(params) {
    const dispatch: Record<Program, () => Promise<AuditResult>> = {
      verify_readonly: () => verifyReadonly(params.args, params.timeout_seconds),
      aws_iam_audit: () => awsIamAudit(params.args, params.timeout_seconds),
      azure_iam_audit: () => azureIamAudit(params.args, params.timeout_seconds),
      gcp_iam_audit: () => gcpIamAudit(params.args, params.timeout_seconds),
      aws_storage_audit: () => awsStorageAudit(params.args, params.timeout_seconds),
      azure_storage_audit: () => azureStorageAudit(params.args, params.timeout_seconds),
      gcp_storage_audit: () => gcpStorageAudit(params.args, params.timeout_seconds),
      aws_network_audit: () => awsNetworkAudit(params.args, params.timeout_seconds),
      azure_network_audit: () => azureNetworkAudit(params.args, params.timeout_seconds),
      gcp_network_audit: () => gcpNetworkAudit(params.args, params.timeout_seconds),
      aws_encryption_audit: () => awsEncryptionAudit(params.args, params.timeout_seconds),
      azure_encryption_audit: () => azureEncryptionAudit(params.args, params.timeout_seconds),
      gcp_encryption_audit: () => gcpEncryptionAudit(params.args, params.timeout_seconds),
      aws_logging_audit: () => awsLoggingAudit(params.args, params.timeout_seconds),
      azure_logging_audit: () => azureLoggingAudit(params.args, params.timeout_seconds),
      gcp_logging_audit: () => gcpLoggingAudit(params.args, params.timeout_seconds),
      dns_audit: () => dnsAudit(params.args, params.timeout_seconds),
      tls_audit: () => tlsAudit(params.args, params.timeout_seconds),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `cloud_audit: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return {
        title: `cloud_audit: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
