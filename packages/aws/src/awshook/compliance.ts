import { aws, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

// ── 1. CIS Benchmark ──────────────────────────────────────────────────────────

export async function cisBenchmark(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] CIS AWS Foundations Benchmark Assessment\n"]

  // CIS 3.1 — CloudTrail enabled in all regions
  output.push("[*] Checking CloudTrail multi-region logging (CIS 3.1)...")
  const trails = await aws(["cloudtrail", "describe-trails"], profile, region, timeout)
  if (trails.exitCode === 0) {
    const list = tryJson(trails.stdout)?.trailList || []
    output.push(`[+] CloudTrail trails: ${list.length}`)
    const multiRegion = list.filter((t: Record<string, unknown>) => t.IsMultiRegionTrail === true)
    if (multiRegion.length === 0) {
      findings.push({
        checkId: "AWS-CIS-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "cloudtrail://all-regions",
        title: "No multi-region CloudTrail trail configured",
        details: "CIS 3.1 requires CloudTrail enabled in all regions. No trail with IsMultiRegionTrail=true found",
        remediation: "aws cloudtrail update-trail --name <trail> --is-multi-region-trail",
      })
    } else {
      let allLogging = true
      for (const t of multiRegion) {
        const name = t.Name || t.TrailARN || "unknown"
        const status = await aws(["cloudtrail", "get-trail-status", "--name", String(name)], profile, region, timeout)
        const st = tryJson(status.stdout) || {}
        if (!st.IsLogging) {
          allLogging = false
          findings.push({
            checkId: "AWS-CIS-001",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: `cloudtrail://${name}`,
            title: `Multi-region trail ${name} is not logging`,
            details: "Trail exists with IsMultiRegionTrail=true but IsLogging=false",
            remediation: `aws cloudtrail start-logging --name ${name}`,
          })
        }
        output.push(`  Trail: ${name} — MultiRegion: true, Logging: ${st.IsLogging}`)
      }
      if (allLogging && multiRegion.length > 0) {
        output.push("[+] CIS 3.1 PASS: Multi-region CloudTrail logging is active")
      }
    }
  } else {
    output.push(`[-] Failed to describe trails: ${trails.stderr.trim()}`)
  }

  // CIS 1.8-1.14 — Password policy
  output.push("\n[*] Checking IAM password policy (CIS 1.8-1.14)...")
  const policy = await aws(["iam", "get-account-password-policy"], profile, region, timeout)
  if (policy.exitCode === 0) {
    const p = tryJson(policy.stdout)?.PasswordPolicy || {}
    output.push(`[+] MinLength: ${p.MinimumPasswordLength}, MaxAge: ${p.MaxPasswordAge || "none"}, Reuse: ${p.PasswordReusePrevention || "none"}`)
    if ((p.MinimumPasswordLength || 0) < 14) {
      findings.push({
        checkId: "AWS-CIS-002",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: "iam://password-policy",
        title: `Password minimum length ${p.MinimumPasswordLength} is below CIS requirement of 14`,
        details: `CIS 1.8 requires minimum password length of 14 characters. Current: ${p.MinimumPasswordLength}`,
        remediation: "aws iam update-account-password-policy --minimum-password-length 14",
      })
    }
    if (!p.RequireSymbols || !p.RequireNumbers || !p.RequireUppercaseCharacters || !p.RequireLowercaseCharacters) {
      const missing = []
      if (!p.RequireSymbols) missing.push("symbols")
      if (!p.RequireNumbers) missing.push("numbers")
      if (!p.RequireUppercaseCharacters) missing.push("uppercase")
      if (!p.RequireLowercaseCharacters) missing.push("lowercase")
      output.push(`[!] Missing complexity requirements: ${missing.join(", ")}`)
    }
  } else {
    findings.push({
      checkId: "AWS-CIS-002",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: "iam://password-policy",
      title: "No IAM password policy configured",
      details: "CIS 1.8-1.14 all fail — no custom password policy is set",
      remediation: "aws iam update-account-password-policy --minimum-password-length 14 --require-symbols --require-numbers --require-uppercase-characters --require-lowercase-characters --max-password-age 90 --password-reuse-prevention 24",
    })
  }

  // CIS 1.5 — Root MFA
  output.push("\n[*] Checking root account MFA (CIS 1.5)...")
  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  if (summary.exitCode === 0) {
    const sum = tryJson(summary.stdout)?.SummaryMap || {}
    const rootMfa = sum.AccountMFAEnabled
    output.push(`[+] Root MFA enabled: ${rootMfa === 1 ? "YES" : "NO"}`)
    if (rootMfa !== 1) {
      findings.push({
        checkId: "AWS-CIS-003",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "iam://root",
        title: "Root account MFA is not enabled",
        details: "CIS 1.5 requires MFA on the root account. AccountMFAEnabled=0",
        remediation: "Enable hardware MFA for root account in IAM console",
      })
    }
  }

  // CIS 5.4 — Default security group restricts all traffic
  output.push("\n[*] Checking default security groups (CIS 5.4)...")
  const defaultSgs = await aws(
    ["ec2", "describe-security-groups", "--filters", "Name=group-name,Values=default"],
    profile,
    region,
    timeout,
  )
  if (defaultSgs.exitCode === 0) {
    const sgList = tryJson(defaultSgs.stdout)?.SecurityGroups || []
    output.push(`[+] Default security groups: ${sgList.length}`)
    for (const sg of sgList) {
      const ingressRules = sg.IpPermissions || []
      const egressRules = sg.IpPermissionsEgress || []
      const hasIngress = ingressRules.length > 0
      const vpcId = sg.VpcId || "unknown"
      if (hasIngress) {
        findings.push({
          checkId: "AWS-CIS-004",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `sg://${sg.GroupId}`,
          title: `Default SG in VPC ${vpcId} has ${ingressRules.length} inbound rule(s)`,
          details: `CIS 5.4 requires default SGs to restrict all traffic. GroupId: ${sg.GroupId}, VPC: ${vpcId}`,
          remediation: `Remove all inbound/outbound rules from default SG: aws ec2 revoke-security-group-ingress --group-id ${sg.GroupId} ...`,
        })
        output.push(`[!] ${sg.GroupId} (VPC ${vpcId}): ${ingressRules.length} inbound, ${egressRules.length} outbound rules`)
      } else {
        output.push(`[+] ${sg.GroupId} (VPC ${vpcId}): no inbound rules — PASS`)
      }
    }
  }

  output.push(`\n[*] CIS Benchmark Summary: ${findings.length} issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeTrails, GetTrailStatus, GetAccountPasswordPolicy, GetAccountSummary, DescribeSecurityGroups`)
  output.push(`  OPSEC: CIS benchmark scan generates events across IAM, CloudTrail, EC2 — high-volume audit footprint`)
  return { output: output.join("\n"), findings }
}

// ── 2. Access Key Rotation ────────────────────────────────────────────────────

export async function accessKeyRotation(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Access Key Rotation Audit\n"]

  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  if (users.exitCode !== 0) return { output: `[-] Failed to list users: ${users.stderr.trim()}`, findings }
  const userList = tryJson(users.stdout) || []
  output.push(`[+] IAM users: ${userList.length}\n`)

  const now = Date.now()
  const DAY_MS = 86400000
  let over90 = 0
  let over180 = 0
  let neverUsed = 0
  let totalKeys = 0

  for (const user of userList) {
    const keys = await aws(["iam", "list-access-keys", "--user-name", user], profile, region, timeout)
    if (keys.exitCode !== 0) continue
    const keyList = tryJson(keys.stdout)?.AccessKeyMetadata || []

    for (const key of keyList) {
      if (key.Status !== "Active") continue
      totalKeys++

      const createDate = new Date(key.CreateDate).getTime()
      const ageDays = Math.floor((now - createDate) / DAY_MS)

      // Check last used
      const lastUsed = await aws(
        ["iam", "get-access-key-last-used", "--access-key-id", key.AccessKeyId],
        profile,
        region,
        timeout,
      )
      const lu = tryJson(lastUsed.stdout)?.AccessKeyLastUsed || {}
      const lastUsedStr = lu.LastUsedDate || "never"
      const lastUsedDays = lu.LastUsedDate ? Math.floor((now - new Date(lu.LastUsedDate).getTime()) / DAY_MS) : -1

      if (ageDays > 180) {
        over180++
        findings.push({
          checkId: "AWS-KEYROT-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `iam://user/${user}/key/${key.AccessKeyId}`,
          title: `Access key ${key.AccessKeyId} is ${ageDays} days old (>180d)`,
          details: `User: ${user}, Created: ${key.CreateDate}, Age: ${ageDays}d, LastUsed: ${lastUsedStr}`,
          remediation: `Rotate key: aws iam create-access-key --user-name ${user} && aws iam delete-access-key --user-name ${user} --access-key-id ${key.AccessKeyId}`,
        })
        output.push(`[!] ${user}/${key.AccessKeyId}: ${ageDays}d old (CRITICAL >180d), LastUsed: ${lastUsedStr}`)
      } else if (ageDays > 90) {
        over90++
        findings.push({
          checkId: "AWS-KEYROT-002",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: `iam://user/${user}/key/${key.AccessKeyId}`,
          title: `Access key ${key.AccessKeyId} is ${ageDays} days old (>90d)`,
          details: `User: ${user}, Created: ${key.CreateDate}, Age: ${ageDays}d, LastUsed: ${lastUsedStr}`,
          remediation: `Schedule key rotation for ${user}`,
        })
        output.push(`[!] ${user}/${key.AccessKeyId}: ${ageDays}d old (WARN >90d), LastUsed: ${lastUsedStr}`)
      }

      if (lastUsedDays === -1 && ageDays > 30) {
        neverUsed++
        findings.push({
          checkId: "AWS-KEYROT-001",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: `iam://user/${user}/key/${key.AccessKeyId}`,
          title: `Access key ${key.AccessKeyId} never used but ${ageDays} days old`,
          details: `User: ${user}, Created: ${key.CreateDate}, Age: ${ageDays}d, LastUsed: never`,
          remediation: `Delete unused key: aws iam delete-access-key --user-name ${user} --access-key-id ${key.AccessKeyId}`,
        })
      } else if (lastUsedDays > 90) {
        findings.push({
          checkId: "AWS-KEYROT-002",
          provider: "aws",
          severity: "low",
          status: "WARN",
          resource: `iam://user/${user}/key/${key.AccessKeyId}`,
          title: `Access key ${key.AccessKeyId} last used ${lastUsedDays} days ago`,
          details: `User: ${user}, LastUsed: ${lastUsedStr}, potentially stale`,
          remediation: `Review if key is still needed for ${user}`,
        })
      }
    }
  }

  output.push(`\n[*] Summary: ${totalKeys} active keys, ${over90} >90d, ${over180} >180d, ${neverUsed} never used, ${findings.length} findings`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListUsers, ListAccessKeys, GetAccessKeyLastUsed`)
  output.push(`  OPSEC: Per-user key enumeration generates N×ListAccessKeys + N×GetAccessKeyLastUsed events — burst visible in CloudTrail`)
  return { output: output.join("\n"), findings }
}

// ── 3. MFA Audit ──────────────────────────────────────────────────────────────

export async function mfaAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] MFA Compliance Audit\n"]

  // Root MFA check
  output.push("[*] Checking root account MFA...")
  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  if (summary.exitCode === 0) {
    const sum = tryJson(summary.stdout)?.SummaryMap || {}
    const rootMfa = sum.AccountMFAEnabled
    output.push(`[+] Root MFA: ${rootMfa === 1 ? "enabled" : "DISABLED"}`)
    output.push(`[+] Users: ${sum.Users}, MFA devices in use: ${sum.MFADevicesInUse}`)
    if (rootMfa !== 1) {
      findings.push({
        checkId: "AWS-MFA-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "iam://root",
        title: "Root account MFA is not enabled",
        details: "The root account has unrestricted access and must have MFA enabled",
        remediation: "Enable hardware MFA on the root account via IAM console",
      })
    }
  }

  // Virtual MFA devices
  output.push("\n[*] Enumerating virtual MFA devices...")
  const vMfa = await aws(["iam", "list-virtual-mfa-devices"], profile, region, timeout)
  if (vMfa.exitCode === 0) {
    const devices = tryJson(vMfa.stdout)?.VirtualMFADevices || []
    const rootVmfa = devices.filter((d: Record<string, unknown>) => {
      const serial = String(d.SerialNumber || "")
      return serial.includes("root-account-mfa-device")
    })
    if (rootVmfa.length > 0) {
      findings.push({
        checkId: "AWS-MFA-003",
        provider: "aws",
        severity: "medium",
        status: "WARN",
        resource: "iam://root/mfa",
        title: "Root account uses virtual MFA instead of hardware MFA",
        details: "Virtual MFA is less secure than hardware MFA (U2F/FIDO2) for root",
        remediation: "Replace virtual MFA with hardware MFA for root account",
      })
      output.push("[!] Root account uses virtual MFA — hardware MFA recommended")
    }
    output.push(`[+] Virtual MFA devices: ${devices.length}`)
  }

  // Per-user MFA check
  output.push("\n[*] Checking MFA for IAM users with console access...")
  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  if (users.exitCode !== 0) return { output: output.join("\n") + "\n[-] Failed to list users", findings }
  const userList = tryJson(users.stdout) || []

  let noMfaCount = 0
  let consoleUsers = 0

  for (const user of userList) {
    // Check if user has console access
    const loginProfile = await aws(["iam", "get-login-profile", "--user-name", user], profile, region, timeout)
    if (loginProfile.exitCode !== 0) continue
    consoleUsers++

    const mfa = await aws(["iam", "list-mfa-devices", "--user-name", user], profile, region, timeout)
    if (mfa.exitCode !== 0) continue
    const devices = tryJson(mfa.stdout)?.MFADevices || []

    if (devices.length === 0) {
      noMfaCount++
      findings.push({
        checkId: "AWS-MFA-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `iam://user/${user}`,
        title: `IAM user ${user} has console access without MFA`,
        details: `User ${user} has a login profile (console access) but no MFA device registered`,
        remediation: `Enable MFA for user: aws iam enable-mfa-device --user-name ${user} --serial-number <arn> --authentication-code1 <code1> --authentication-code2 <code2>`,
      })
      output.push(`[!] ${user}: console access WITHOUT MFA`)
    } else {
      const mfaTypes = devices.map((d: Record<string, string>) => {
        const serial = d.SerialNumber || ""
        if (serial.includes("mfa/")) return "virtual"
        if (serial.includes("u2f/")) return "u2f"
        return "hardware"
      })
      output.push(`[+] ${user}: MFA enabled (${mfaTypes.join(", ")})`)
    }
  }

  output.push(`\n[*] Summary: ${consoleUsers} console users, ${noMfaCount} without MFA, ${findings.length} findings`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetAccountSummary, ListVirtualMFADevices, ListUsers, GetLoginProfile, ListMFADevices`)
  output.push(`  OPSEC: Per-user GetLoginProfile + ListMFADevices generates N events; high volume from non-admin identity is unusual`)
  return { output: output.join("\n"), findings }
}

// ── 4. Password Policy Check ──────────────────────────────────────────────────

export async function passwordPolicyCheck(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] IAM Password Policy Compliance Check\n"]

  const policy = await aws(["iam", "get-account-password-policy"], profile, region, timeout)
  if (policy.exitCode !== 0) {
    findings.push({
      checkId: "AWS-PWPOL-001",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: "iam://password-policy",
      title: "No IAM password policy configured",
      details: "Default password policy is in effect — allows weak passwords with no rotation or reuse controls",
      remediation: "aws iam update-account-password-policy --minimum-password-length 14 --require-symbols --require-numbers --require-uppercase-characters --require-lowercase-characters --max-password-age 90 --password-reuse-prevention 24",
    })
    output.push("[-] No custom password policy set — all checks FAIL")
    return { output: output.join("\n"), findings }
  }

  const p = tryJson(policy.stdout)?.PasswordPolicy || {}
  output.push("[+] Current password policy:")
  output.push(`    MinimumPasswordLength: ${p.MinimumPasswordLength}`)
  output.push(`    RequireSymbols: ${p.RequireSymbols}`)
  output.push(`    RequireNumbers: ${p.RequireNumbers}`)
  output.push(`    RequireUppercaseCharacters: ${p.RequireUppercaseCharacters}`)
  output.push(`    RequireLowercaseCharacters: ${p.RequireLowercaseCharacters}`)
  output.push(`    MaxPasswordAge: ${p.MaxPasswordAge || "none"}`)
  output.push(`    PasswordReusePrevention: ${p.PasswordReusePrevention || "none"}`)
  output.push(`    ExpirePasswords: ${p.ExpirePasswords}`)
  output.push(`    HardExpiry: ${p.HardExpiry}`)

  // Check 1: MinimumPasswordLength >= 14
  if ((p.MinimumPasswordLength || 0) < 14) {
    findings.push({
      checkId: "AWS-PWPOL-001",
      provider: "aws",
      severity: "medium",
      status: "FAIL",
      resource: "iam://password-policy",
      title: `Password minimum length ${p.MinimumPasswordLength} is below 14`,
      details: `CIS recommends minimum 14 characters. Current: ${p.MinimumPasswordLength}`,
      remediation: "aws iam update-account-password-policy --minimum-password-length 14",
    })
  }

  // Check 2: RequireSymbols
  if (!p.RequireSymbols) {
    findings.push({
      checkId: "AWS-PWPOL-002",
      provider: "aws",
      severity: "low",
      status: "FAIL",
      resource: "iam://password-policy",
      title: "Password policy does not require symbols",
      details: "Symbols are not required, reducing password complexity",
      remediation: "aws iam update-account-password-policy --require-symbols",
    })
  }

  // Check 3: RequireNumbers
  if (!p.RequireNumbers) {
    findings.push({
      checkId: "AWS-PWPOL-003",
      provider: "aws",
      severity: "low",
      status: "FAIL",
      resource: "iam://password-policy",
      title: "Password policy does not require numbers",
      details: "Numbers are not required, reducing password complexity",
      remediation: "aws iam update-account-password-policy --require-numbers",
    })
  }

  // Check 4: RequireUppercaseCharacters
  if (!p.RequireUppercaseCharacters) {
    findings.push({
      checkId: "AWS-PWPOL-004",
      provider: "aws",
      severity: "low",
      status: "FAIL",
      resource: "iam://password-policy",
      title: "Password policy does not require uppercase characters",
      details: "Uppercase characters are not required, reducing password complexity",
      remediation: "aws iam update-account-password-policy --require-uppercase-characters",
    })
  }

  // Check 5: RequireLowercaseCharacters
  if (!p.RequireLowercaseCharacters) {
    findings.push({
      checkId: "AWS-PWPOL-005",
      provider: "aws",
      severity: "low",
      status: "FAIL",
      resource: "iam://password-policy",
      title: "Password policy does not require lowercase characters",
      details: "Lowercase characters are not required, reducing password complexity",
      remediation: "aws iam update-account-password-policy --require-lowercase-characters",
    })
  }

  // Check 6: MaxPasswordAge <= 90
  const maxAge = p.MaxPasswordAge || 999
  if (maxAge > 90) {
    findings.push({
      checkId: "AWS-PWPOL-006",
      provider: "aws",
      severity: "medium",
      status: "FAIL",
      resource: "iam://password-policy",
      title: `Max password age ${maxAge === 999 ? "unlimited" : maxAge} exceeds 90 days`,
      details: `CIS recommends max password age of 90 days. Current: ${maxAge === 999 ? "no limit" : maxAge}`,
      remediation: "aws iam update-account-password-policy --max-password-age 90",
    })
  }

  // Check 7: PasswordReusePrevention >= 24
  const reuse = p.PasswordReusePrevention || 0
  if (reuse < 24) {
    findings.push({
      checkId: "AWS-PWPOL-007",
      provider: "aws",
      severity: "medium",
      status: "FAIL",
      resource: "iam://password-policy",
      title: `Password reuse prevention ${reuse || "disabled"} is below 24`,
      details: `CIS recommends preventing reuse of the last 24 passwords. Current: ${reuse || "disabled"}`,
      remediation: "aws iam update-account-password-policy --password-reuse-prevention 24",
    })
  }

  const passCount = 7 - findings.length
  output.push(`\n[*] Summary: ${passCount}/7 checks passed, ${findings.length} findings`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetAccountPasswordPolicy`)
  output.push(`  OPSEC: Single read-only call — minimal footprint, standard admin activity`)
  return { output: output.join("\n"), findings }
}

// ── 5. Root Account Audit ─────────────────────────────────────────────────────

export async function rootAccountAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Root Account Security Audit\n"]

  // Root access keys and MFA
  output.push("[*] Checking root account summary...")
  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  if (summary.exitCode !== 0) return { output: `[-] Failed to get account summary: ${summary.stderr.trim()}`, findings }

  const sum = tryJson(summary.stdout)?.SummaryMap || {}
  output.push(`[+] AccountAccessKeysPresent: ${sum.AccountAccessKeysPresent}`)
  output.push(`[+] AccountMFAEnabled: ${sum.AccountMFAEnabled}`)
  output.push(`[+] AccountSigningCertificatesPresent: ${sum.AccountSigningCertificatesPresent}`)

  // AWS-ROOT-001: Root access keys should not exist
  if ((sum.AccountAccessKeysPresent || 0) > 0) {
    findings.push({
      checkId: "AWS-ROOT-001",
      provider: "aws",
      severity: "critical",
      status: "FAIL",
      resource: "iam://root/access-keys",
      title: "Root account has active access keys",
      details: `AccountAccessKeysPresent=${sum.AccountAccessKeysPresent}. Root access keys should never exist — use IAM users/roles instead`,
      remediation: "Delete root access keys via IAM console: Security credentials > Access keys > Delete",
    })
  } else {
    output.push("[+] ROOT-001 PASS: No root access keys present")
  }

  // AWS-ROOT-002: Root MFA must be enabled
  if (sum.AccountMFAEnabled !== 1) {
    findings.push({
      checkId: "AWS-ROOT-002",
      provider: "aws",
      severity: "critical",
      status: "FAIL",
      resource: "iam://root/mfa",
      title: "Root account MFA is not enabled",
      details: "Root account has unrestricted access to all AWS services and resources. MFA is mandatory",
      remediation: "Enable hardware MFA (U2F/FIDO2) for root account in IAM console",
    })
  } else {
    output.push("[+] ROOT-002 PASS: Root MFA is enabled")
  }

  // AWS-ROOT-003: Credential report analysis
  output.push("\n[*] Generating credential report for root analysis...")
  await aws(["iam", "generate-credential-report"], profile, region, timeout)
  // Wait briefly for report generation
  const report = await aws(["iam", "get-credential-report"], profile, region, timeout)
  if (report.exitCode === 0) {
    const reportData = tryJson(report.stdout)
    if (reportData && reportData.Content) {
      const csv = Buffer.from(reportData.Content, "base64").toString("utf-8")
      const lines = csv.split("\n")
      const headers = lines[0]?.split(",") || []
      const rootIdx = lines.findIndex((l) => l.startsWith("<root_account>"))
      if (rootIdx >= 0) {
        const fields = lines[rootIdx].split(",")
        const headerMap: Record<string, string> = {}
        for (let i = 0; i < headers.length; i++) {
          headerMap[headers[i]] = fields[i] || ""
        }

        output.push(`[+] Root password last used: ${headerMap["password_last_used"] || "N/A"}`)
        output.push(`[+] Root password last changed: ${headerMap["password_last_changed"] || "N/A"}`)
        output.push(`[+] Root access_key_1_active: ${headerMap["access_key_1_active"] || "N/A"}`)
        output.push(`[+] Root access_key_2_active: ${headerMap["access_key_2_active"] || "N/A"}`)
        output.push(`[+] Root mfa_active: ${headerMap["mfa_active"] || "N/A"}`)

        // Check if root was used recently (indicates active root usage — bad practice)
        const rootLastUsed = headerMap["password_last_used"]
        if (rootLastUsed && rootLastUsed !== "no_information" && rootLastUsed !== "N/A") {
          const lastUsedDate = new Date(rootLastUsed).getTime()
          const daysSince = Math.floor((Date.now() - lastUsedDate) / 86400000)
          if (daysSince < 30) {
            findings.push({
              checkId: "AWS-ROOT-003",
              provider: "aws",
              severity: "high",
              status: "WARN",
              resource: "iam://root/usage",
              title: `Root account was used ${daysSince} day(s) ago`,
              details: `Root password last used: ${rootLastUsed}. Root should only be used for account-level tasks`,
              remediation: "Use IAM users/roles for daily operations. Reserve root for billing and account-level changes only",
            })
          }
        }

        // Check for active access keys from credential report
        if (headerMap["access_key_1_active"] === "true" || headerMap["access_key_2_active"] === "true") {
          output.push("[!] Root access keys confirmed active via credential report")
        }
      }
    }
  } else {
    output.push("[-] Could not retrieve credential report (may need time to generate)")
  }

  output.push(`\n[*] Summary: ${findings.length} root account security issues`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetAccountSummary, GenerateCredentialReport, GetCredentialReport`)
  output.push(`  OPSEC: Root account queries and credential report generation are high-signal — uncommon outside audits`)
  return { output: output.join("\n"), findings }
}

// ── 6. Encryption Audit ───────────────────────────────────────────────────────

export async function encryptionAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Encryption-at-Rest Compliance Audit\n"]

  // AWS-ENC-001: EBS default encryption
  output.push("[*] Checking EBS default encryption...")
  const ebs = await aws(["ec2", "get-ebs-encryption-by-default"], profile, region, timeout)
  if (ebs.exitCode === 0) {
    const ebsEnc = tryJson(ebs.stdout)?.EbsEncryptionByDefault
    output.push(`[+] EBS default encryption: ${ebsEnc ? "enabled" : "DISABLED"}`)
    if (!ebsEnc) {
      findings.push({
        checkId: "AWS-ENC-001",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: "ebs://default-encryption",
        title: "EBS default encryption is not enabled",
        details: "New EBS volumes will not be encrypted unless explicitly specified at creation time",
        remediation: "aws ec2 enable-ebs-encryption-by-default",
      })
    }
  }

  // AWS-ENC-002: S3 bucket encryption
  output.push("\n[*] Checking S3 bucket default encryption...")
  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (buckets.exitCode === 0) {
    const bucketList = tryJson(buckets.stdout) || []
    output.push(`[+] Total S3 buckets: ${bucketList.length}`)
    let noEnc = 0
    for (const bucket of bucketList.slice(0, 50)) {
      const enc = await aws(["s3api", "get-bucket-encryption", "--bucket", bucket], profile, region, timeout)
      if (enc.exitCode !== 0) {
        noEnc++
        if (noEnc <= 5) output.push(`[!] ${bucket}: no default encryption`)
        findings.push({
          checkId: "AWS-ENC-002",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `s3://${bucket}`,
          title: `S3 bucket ${bucket} has no default encryption`,
          details: "Objects stored without encryption unless explicitly specified by the caller",
          remediation: `aws s3api put-bucket-encryption --bucket ${bucket} --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"},"BucketKeyEnabled":true}]}'`,
        })
      }
    }
    if (noEnc > 5) output.push(`  ... and ${noEnc - 5} more`)
    output.push(`[+] Buckets without encryption: ${noEnc}/${Math.min(bucketList.length, 50)}`)
  }

  // AWS-ENC-003: RDS encryption
  output.push("\n[*] Checking RDS instance encryption...")
  const rds = await aws(
    ["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,Engine,StorageEncrypted]"],
    profile,
    region,
    timeout,
  )
  if (rds.exitCode === 0) {
    const dbList = tryJson(rds.stdout) || []
    output.push(`[+] RDS instances: ${dbList.length}`)
    for (const db of dbList) {
      if (db[2] === false) {
        findings.push({
          checkId: "AWS-ENC-003",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `rds://${db[0]}`,
          title: `RDS instance ${db[0]} is not encrypted`,
          details: `Engine: ${db[1]}, StorageEncrypted: false. Data at rest is unprotected`,
          remediation: "Create encrypted snapshot, restore from it, and swap endpoints",
        })
        output.push(`[!] ${db[0]} (${db[1]}): NOT encrypted`)
      }
    }
  }

  // AWS-ENC-004: DynamoDB encryption
  output.push("\n[*] Checking DynamoDB table encryption...")
  const tables = await aws(["dynamodb", "list-tables", "--query", "TableNames"], profile, region, timeout)
  if (tables.exitCode === 0) {
    const tableList = tryJson(tables.stdout) || []
    output.push(`[+] DynamoDB tables: ${tableList.length}`)
    for (const table of tableList.slice(0, 30)) {
      const desc = await aws(["dynamodb", "describe-table", "--table-name", table, "--query", "Table.SSEDescription"], profile, region, timeout)
      const sse = tryJson(desc.stdout)
      if (!sse || sse.Status !== "ENABLED") {
        // DynamoDB uses AWS-owned CMK by default (free), but check for customer-managed
        output.push(`  ${table}: using default encryption (AWS-owned CMK)`)
      } else {
        output.push(`  ${table}: SSE ${sse.Status} (${sse.SSEType || "KMS"})`)
      }
    }
  }

  // AWS-ENC-005: EFS encryption
  output.push("\n[*] Checking EFS file system encryption...")
  const efs = await aws(
    ["efs", "describe-file-systems", "--query", "FileSystems[].[FileSystemId,Name,Encrypted]"],
    profile,
    region,
    timeout,
  )
  if (efs.exitCode === 0) {
    const efsList = tryJson(efs.stdout) || []
    output.push(`[+] EFS file systems: ${efsList.length}`)
    for (const fs of efsList) {
      if (fs[2] === false) {
        findings.push({
          checkId: "AWS-ENC-005",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `efs://${fs[0]}`,
          title: `EFS file system ${fs[0]} is not encrypted`,
          details: `Name: ${fs[1] || "unnamed"}, Encrypted: false. EFS encryption cannot be enabled after creation`,
          remediation: "Create a new encrypted EFS file system and migrate data",
        })
        output.push(`[!] ${fs[0]} (${fs[1] || "unnamed"}): NOT encrypted`)
      }
    }
  }

  // AWS-ENC-006: SQS KMS encryption
  output.push("\n[*] Checking SQS queue encryption...")
  const queues = await aws(["sqs", "list-queues", "--query", "QueueUrls"], profile, region, timeout)
  if (queues.exitCode === 0) {
    const queueList = tryJson(queues.stdout) || []
    output.push(`[+] SQS queues: ${queueList.length}`)
    let noKms = 0
    for (const url of queueList.slice(0, 30)) {
      const qAttrs = await aws(
        ["sqs", "get-queue-attributes", "--queue-url", url, "--attribute-names", "KmsMasterKeyId", "SqsManagedSseEnabled"],
        profile,
        region,
        timeout,
      )
      if (qAttrs.exitCode === 0) {
        const attrs = tryJson(qAttrs.stdout)?.Attributes || {}
        if (!attrs.KmsMasterKeyId && attrs.SqsManagedSseEnabled !== "true") {
          noKms++
          const name = String(url).split("/").pop() || url
          findings.push({
            checkId: "AWS-ENC-006",
            provider: "aws",
            severity: "medium",
            status: "FAIL",
            resource: `sqs://${name}`,
            title: `SQS queue ${name} has no encryption`,
            details: "Queue has neither KMS encryption nor SQS-managed SSE enabled",
            remediation: `aws sqs set-queue-attributes --queue-url ${url} --attributes KmsMasterKeyId=alias/aws/sqs`,
          })
        }
      }
    }
    if (noKms > 0) output.push(`[!] SQS queues without encryption: ${noKms}`)
  }

  output.push(`\n[*] Summary: ${findings.length} encryption issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetEbsEncryptionByDefault, ListBuckets, GetBucketEncryption, DescribeDBInstances, ListTables, DescribeTable, DescribeFileSystems, ListQueues, GetQueueAttributes`)
  output.push(`  OPSEC: Cross-service encryption audit — events span EC2, S3, RDS, DynamoDB, EFS, SQS; pattern may trigger anomaly rules`)
  return { output: output.join("\n"), findings }
}

// ── 7. Public Access Audit ────────────────────────────────────────────────────

export async function publicAccessAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Public Access Compliance Audit\n"]

  // AWS-PUBACC-001: S3 account-level public access block
  output.push("[*] Checking S3 account-level public access block...")
  const identity = await aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile, region, timeout)
  const accountId = identity.exitCode === 0 ? identity.stdout.trim() : ""
  if (accountId) {
    const acctBlock = await aws(["s3control", "get-public-access-block", "--account-id", accountId], profile, region, timeout)
    if (acctBlock.exitCode !== 0) {
      findings.push({
        checkId: "AWS-PUBACC-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: "s3://account-level-block",
        title: "S3 account-level public access block is not configured",
        details: "Without account-level block, individual buckets can be made public",
        remediation: `aws s3control put-public-access-block --account-id ${accountId} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`,
      })
      output.push("[-] Account-level S3 public access block: NOT SET")
    } else {
      const block = tryJson(acctBlock.stdout)?.PublicAccessBlockConfiguration || {}
      const allSet = block.BlockPublicAcls && block.IgnorePublicAcls && block.BlockPublicPolicy && block.RestrictPublicBuckets
      output.push(`[+] Account S3 block: BlockAcls=${block.BlockPublicAcls}, IgnoreAcls=${block.IgnorePublicAcls}, BlockPolicy=${block.BlockPublicPolicy}, Restrict=${block.RestrictPublicBuckets}`)
      if (!allSet) {
        findings.push({
          checkId: "AWS-PUBACC-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: "s3://account-level-block",
          title: "S3 account-level public access block is incomplete",
          details: `Not all four settings are enabled: BlockAcls=${block.BlockPublicAcls}, IgnoreAcls=${block.IgnorePublicAcls}, BlockPolicy=${block.BlockPublicPolicy}, Restrict=${block.RestrictPublicBuckets}`,
          remediation: "Enable all four S3 public access block settings at account level",
        })
      }
    }
  }

  // AWS-PUBACC-002: Per-bucket public access block
  output.push("\n[*] Checking per-bucket public access blocks...")
  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (buckets.exitCode === 0) {
    const bucketList = tryJson(buckets.stdout) || []
    let noBlock = 0
    for (const bucket of bucketList.slice(0, 50)) {
      const block = await aws(["s3api", "get-public-access-block", "--bucket", bucket], profile, region, timeout)
      if (block.exitCode !== 0) {
        noBlock++
        findings.push({
          checkId: "AWS-PUBACC-002",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `s3://${bucket}`,
          title: `S3 bucket ${bucket} has no public access block`,
          details: "No bucket-level public access block — may inherit permissive account settings",
          remediation: `aws s3api put-public-access-block --bucket ${bucket} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`,
        })
      }
    }
    output.push(`[+] Buckets without public access block: ${noBlock}/${Math.min(bucketList.length, 50)}`)
  }

  // AWS-PUBACC-003: RDS public access
  output.push("\n[*] Checking RDS public accessibility...")
  const rds = await aws(
    ["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,Engine,PubliclyAccessible,Endpoint.Address]"],
    profile,
    region,
    timeout,
  )
  if (rds.exitCode === 0) {
    const dbList = tryJson(rds.stdout) || []
    for (const db of dbList) {
      if (db[2] === true) {
        findings.push({
          checkId: "AWS-PUBACC-003",
          provider: "aws",
          severity: "critical",
          status: "FAIL",
          resource: `rds://${db[0]}`,
          title: `RDS instance ${db[0]} is publicly accessible`,
          details: `Engine: ${db[1]}, Endpoint: ${db[3] || "N/A"}, PubliclyAccessible: true`,
          remediation: `aws rds modify-db-instance --db-instance-identifier ${db[0]} --no-publicly-accessible`,
        })
        output.push(`[!] ${db[0]} (${db[1]}): publicly accessible at ${db[3] || "N/A"}`)
      }
    }
  }

  // AWS-PUBACC-004: EC2 instances with public IPs
  output.push("\n[*] Checking EC2 public IP exposure...")
  const ec2 = await aws(
    ["ec2", "describe-instances", "--query", "Reservations[].Instances[].[InstanceId,PublicIpAddress,State.Name]"],
    profile,
    region,
    timeout,
  )
  if (ec2.exitCode === 0) {
    const instList = tryJson(ec2.stdout) || []
    const publicInstances = instList.filter((i: (string | null)[]) => i[1] && i[2] === "running")
    output.push(`[+] Running EC2 instances with public IP: ${publicInstances.length}`)
    if (publicInstances.length > 0) {
      findings.push({
        checkId: "AWS-PUBACC-004",
        provider: "aws",
        severity: "medium",
        status: "INFO",
        resource: "ec2://public-instances",
        title: `${publicInstances.length} running EC2 instance(s) have public IPs`,
        details: `Instances: ${publicInstances.slice(0, 10).map((i: string[]) => `${i[0]}(${i[1]})`).join(", ")}`,
        remediation: "Review if public IPs are necessary — use private subnets with NAT or ALB",
      })
    }
  }

  // AWS-PUBACC-005: Redshift public access
  output.push("\n[*] Checking Redshift public accessibility...")
  const redshift = await aws(
    ["redshift", "describe-clusters", "--query", "Clusters[].[ClusterIdentifier,PubliclyAccessible,Endpoint.Address]"],
    profile,
    region,
    timeout,
  )
  if (redshift.exitCode === 0) {
    const clusters = tryJson(redshift.stdout) || []
    for (const c of clusters) {
      if (c[1] === true) {
        findings.push({
          checkId: "AWS-PUBACC-005",
          provider: "aws",
          severity: "critical",
          status: "FAIL",
          resource: `redshift://${c[0]}`,
          title: `Redshift cluster ${c[0]} is publicly accessible`,
          details: `Endpoint: ${c[2] || "N/A"}, PubliclyAccessible: true`,
          remediation: `aws redshift modify-cluster --cluster-identifier ${c[0]} --no-publicly-accessible`,
        })
        output.push(`[!] ${c[0]}: publicly accessible at ${c[2] || "N/A"}`)
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} public access issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetCallerIdentity, GetPublicAccessBlock (S3 + S3Control), ListBuckets, DescribeDBInstances, DescribeInstances, DescribeClusters (Redshift)`)
  output.push(`  GuardDuty: Recon:EC2/PortProbeUnprotectedPort`)
  output.push(`  OPSEC: Cross-service public exposure scan — events span STS, S3, S3Control, RDS, EC2, Redshift`)
  return { output: output.join("\n"), findings }
}

// ── 8. Logging Audit ──────────────────────────────────────────────────────────

export async function loggingAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Logging Compliance Audit\n"]

  // AWS-LOGAUDIT-001: CloudTrail multi-region with custom selectors
  output.push("[*] Checking CloudTrail configuration...")
  const trails = await aws(["cloudtrail", "describe-trails"], profile, region, timeout)
  if (trails.exitCode === 0) {
    const list = tryJson(trails.stdout)?.trailList || []
    const multiRegion = list.filter((t: Record<string, unknown>) => t.IsMultiRegionTrail)
    output.push(`[+] CloudTrail trails: ${list.length} total, ${multiRegion.length} multi-region`)

    if (multiRegion.length === 0) {
      findings.push({
        checkId: "AWS-LOGAUDIT-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "cloudtrail://multi-region",
        title: "No multi-region CloudTrail trail configured",
        details: "API activity in non-primary regions will not be logged",
        remediation: "aws cloudtrail create-trail --name org-trail --s3-bucket-name <bucket> --is-multi-region-trail",
      })
    }

    for (const t of list) {
      const name = t.Name || "unknown"
      const selectors = await aws(["cloudtrail", "get-event-selectors", "--trail-name", name], profile, region, timeout)
      if (selectors.exitCode === 0) {
        const sel = tryJson(selectors.stdout)
        const hasCustom = (sel?.EventSelectors || []).length > 0 || (sel?.AdvancedEventSelectors || []).length > 0
        output.push(`  ${name}: MultiRegion=${t.IsMultiRegionTrail}, CustomSelectors=${hasCustom}`)
      }
    }
  }

  // AWS-LOGAUDIT-002: VPC Flow Logs coverage
  output.push("\n[*] Checking VPC Flow Logs coverage...")
  const vpcs = await aws(["ec2", "describe-vpcs", "--query", "Vpcs[].VpcId"], profile, region, timeout)
  if (vpcs.exitCode === 0) {
    const vpcList = tryJson(vpcs.stdout) || []
    output.push(`[+] VPCs: ${vpcList.length}`)
    let uncovered = 0
    for (const vpcId of vpcList) {
      const flows = await aws(
        ["ec2", "describe-flow-logs", "--filter", `Name=resource-id,Values=${vpcId}`, "--query", "FlowLogs[].FlowLogId"],
        profile,
        region,
        timeout,
      )
      const flowList = tryJson(flows.stdout) || []
      if (flowList.length === 0) {
        uncovered++
        findings.push({
          checkId: "AWS-LOGAUDIT-002",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `vpc://${vpcId}`,
          title: `VPC ${vpcId} has no flow logs`,
          details: "Network traffic for this VPC is not being captured for analysis",
          remediation: `aws ec2 create-flow-logs --resource-type VPC --resource-ids ${vpcId} --traffic-type ALL --log-destination-type cloud-watch-logs --log-group-name vpc-flow-logs/${vpcId}`,
        })
        output.push(`[-] ${vpcId}: NO flow logs`)
      } else {
        output.push(`[+] ${vpcId}: ${flowList.length} flow log(s)`)
      }
    }
    output.push(`[+] VPCs without flow logs: ${uncovered}/${vpcList.length}`)
  }

  // AWS-LOGAUDIT-003: ALB/NLB access logs
  output.push("\n[*] Checking ELBv2 access logging...")
  const elbs = await aws(
    ["elbv2", "describe-load-balancers", "--query", "LoadBalancers[].[LoadBalancerArn,LoadBalancerName,Type]"],
    profile,
    region,
    timeout,
  )
  if (elbs.exitCode === 0) {
    const elbList = tryJson(elbs.stdout) || []
    output.push(`[+] Load balancers: ${elbList.length}`)
    for (const lb of elbList) {
      const attrs = await aws(
        ["elbv2", "describe-load-balancer-attributes", "--load-balancer-arn", lb[0], "--query", "Attributes"],
        profile,
        region,
        timeout,
      )
      if (attrs.exitCode === 0) {
        const attrList = tryJson(attrs.stdout) || []
        const accessLogs = attrList.find((a: Record<string, string>) => a.Key === "access_logs.s3.enabled")
        const enabled = accessLogs?.Value === "true"
        if (!enabled) {
          findings.push({
            checkId: "AWS-LOGAUDIT-003",
            provider: "aws",
            severity: "low",
            status: "FAIL",
            resource: `elbv2://${lb[1]}`,
            title: `Load balancer ${lb[1]} has access logging disabled`,
            details: `Type: ${lb[2]}, access_logs.s3.enabled=false`,
            remediation: `aws elbv2 modify-load-balancer-attributes --load-balancer-arn ${lb[0]} --attributes Key=access_logs.s3.enabled,Value=true Key=access_logs.s3.bucket,Value=<bucket>`,
          })
          output.push(`[-] ${lb[1]} (${lb[2]}): access logs DISABLED`)
        } else {
          output.push(`[+] ${lb[1]} (${lb[2]}): access logs enabled`)
        }
      }
    }
  }

  // AWS-LOGAUDIT-004: S3 server access logging
  output.push("\n[*] Checking S3 server access logging...")
  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (buckets.exitCode === 0) {
    const bucketList = tryJson(buckets.stdout) || []
    let noLogging = 0
    for (const bucket of bucketList.slice(0, 30)) {
      const logging = await aws(["s3api", "get-bucket-logging", "--bucket", bucket, "--query", "LoggingEnabled"], profile, region, timeout)
      if (!tryJson(logging.stdout)) noLogging++
    }
    output.push(`[+] S3 buckets without access logging: ${noLogging}/${Math.min(bucketList.length, 30)}`)
    if (noLogging > 0) {
      findings.push({
        checkId: "AWS-LOGAUDIT-004",
        provider: "aws",
        severity: "low",
        status: "FAIL",
        resource: "s3://access-logging",
        title: `${noLogging} S3 bucket(s) without server access logging`,
        details: "S3 access logs provide detailed request records for security analysis and audit trails",
        remediation: "Enable server access logging on sensitive buckets targeting a dedicated log bucket",
      })
    }
  }

  // AWS-LOGAUDIT-005: RDS CloudWatch logs exports
  output.push("\n[*] Checking RDS CloudWatch log exports...")
  const rds = await aws(
    ["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,Engine,EnabledCloudwatchLogsExports]"],
    profile,
    region,
    timeout,
  )
  if (rds.exitCode === 0) {
    const dbList = tryJson(rds.stdout) || []
    for (const db of dbList) {
      const exports = db[2] || []
      if (exports.length === 0) {
        findings.push({
          checkId: "AWS-LOGAUDIT-005",
          provider: "aws",
          severity: "low",
          status: "FAIL",
          resource: `rds://${db[0]}`,
          title: `RDS instance ${db[0]} has no CloudWatch log exports`,
          details: `Engine: ${db[1]}, no database logs are exported to CloudWatch`,
          remediation: `aws rds modify-db-instance --db-instance-identifier ${db[0]} --cloudwatch-logs-export-configuration '{"EnableLogTypes":["audit","error","general","slowquery"]}'`,
        })
        output.push(`[-] ${db[0]} (${db[1]}): no CloudWatch log exports`)
      } else {
        output.push(`[+] ${db[0]} (${db[1]}): exports ${exports.join(", ")}`)
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} logging issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeTrails, GetEventSelectors, DescribeVpcs, DescribeFlowLogs, ListBuckets, GetBucketLogging, DescribeLoadBalancers, DescribeLoadBalancerAttributes, DescribeDBInstances`)
  output.push(`  OPSEC: Meta — auditing the audit trail itself; defenders may alert on CloudTrail/FlowLog enumeration`)
  return { output: output.join("\n"), findings }
}

// ── 9. Network Segmentation Audit ─────────────────────────────────────────────

export async function networkSegmentationAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Network Segmentation Compliance Audit\n"]

  // AWS-NETSEG-001: Default VPCs in use
  output.push("[*] Checking for default VPCs...")
  const vpcs = await aws(
    ["ec2", "describe-vpcs", "--query", "Vpcs[].[VpcId,IsDefault,CidrBlock]"],
    profile,
    region,
    timeout,
  )
  if (vpcs.exitCode === 0) {
    const vpcList = tryJson(vpcs.stdout) || []
    const defaultVpcs = vpcList.filter((v: (string | boolean)[]) => v[1] === true)
    output.push(`[+] VPCs: ${vpcList.length} total, ${defaultVpcs.length} default`)

    for (const vpc of defaultVpcs) {
      // Check if any instances are running in the default VPC
      const instances = await aws(
        ["ec2", "describe-instances", "--filters", `Name=vpc-id,Values=${vpc[0]}`, "--query", "Reservations[].Instances[].InstanceId"],
        profile,
        region,
        timeout,
      )
      const instList = tryJson(instances.stdout) || []
      if (instList.length > 0) {
        findings.push({
          checkId: "AWS-NETSEG-001",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `vpc://${vpc[0]}`,
          title: `Default VPC ${vpc[0]} has ${instList.length} instance(s) running`,
          details: `Default VPC (${vpc[2]}) should not be used for production. Instances: ${instList.slice(0, 5).join(", ")}`,
          remediation: "Migrate resources to custom VPCs with proper network segmentation",
        })
        output.push(`[!] Default VPC ${vpc[0]}: ${instList.length} instances running — should not use default VPC`)
      } else {
        output.push(`[+] Default VPC ${vpc[0]}: no instances (consider deleting)`)
      }
    }
  }

  // AWS-NETSEG-002: Security groups with overly permissive ingress
  output.push("\n[*] Checking security groups for overly permissive rules...")
  const sgs = await aws(
    ["ec2", "describe-security-groups", "--query", "SecurityGroups[].[GroupId,GroupName,IpPermissions,VpcId]"],
    profile,
    region,
    timeout,
  )
  if (sgs.exitCode === 0) {
    const sgList = tryJson(sgs.stdout) || []
    output.push(`[+] Security groups: ${sgList.length}`)

    for (const sg of sgList) {
      const perms = sg[2] || []
      for (const perm of perms) {
        const ranges = [...(perm.IpRanges || []), ...(perm.Ipv6Ranges || [])]
        const openWorld = ranges.filter(
          (r: Record<string, string>) => r.CidrIp === "0.0.0.0/0" || r.CidrIpv6 === "::/0",
        )
        if (openWorld.length === 0) continue

        const fromPort = perm.FromPort
        const toPort = perm.ToPort
        const proto = perm.IpProtocol

        // Allow 80 and 443 — flag everything else
        if (proto === "-1") {
          findings.push({
            checkId: "AWS-NETSEG-002",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: `sg://${sg[0]}`,
            title: `SG ${sg[1]} allows ALL traffic from 0.0.0.0/0`,
            details: `GroupId: ${sg[0]}, VPC: ${sg[3]}, Protocol: ALL, Ports: ALL`,
            remediation: `Restrict security group ${sg[0]} to specific ports and CIDR ranges`,
          })
          output.push(`[!] ${sg[0]} (${sg[1]}): ALL/ALL open to 0.0.0.0/0`)
        } else if (fromPort !== 80 && fromPort !== 443 && toPort !== 80 && toPort !== 443) {
          // Non-web ports open to the world
          const portStr = fromPort === toPort ? `${fromPort}` : `${fromPort}-${toPort}`
          const severity = (fromPort <= 22 && toPort >= 22) || (fromPort <= 3389 && toPort >= 3389) ? "high" : "medium"
          findings.push({
            checkId: "AWS-NETSEG-002",
            provider: "aws",
            severity,
            status: "FAIL",
            resource: `sg://${sg[0]}`,
            title: `SG ${sg[1]} allows ${proto}/${portStr} from 0.0.0.0/0`,
            details: `GroupId: ${sg[0]}, VPC: ${sg[3]}, non-standard port open to internet`,
            remediation: `Restrict port ${portStr} to known CIDR ranges on SG ${sg[0]}`,
          })
          output.push(`[!] ${sg[0]} (${sg[1]}): ${proto}/${portStr} open to 0.0.0.0/0`)
        }
      }
    }
  }

  // AWS-NETSEG-003: NACLs with allow-all rules
  output.push("\n[*] Checking NACLs for allow-all rules...")
  const nacls = await aws(
    ["ec2", "describe-network-acls", "--query", "NetworkAcls[].[NetworkAclId,VpcId,IsDefault,Entries]"],
    profile,
    region,
    timeout,
  )
  if (nacls.exitCode === 0) {
    const naclList = tryJson(nacls.stdout) || []
    output.push(`[+] Network ACLs: ${naclList.length}`)
    for (const nacl of naclList) {
      const entries = nacl[3] || []
      const allowAll = entries.filter(
        (e: Record<string, unknown>) =>
          e.RuleAction === "allow" &&
          e.CidrBlock === "0.0.0.0/0" &&
          e.Protocol === "-1" &&
          !e.Egress &&
          (e.RuleNumber as number) !== 32767, // skip default deny
      )
      if (allowAll.length > 0) {
        findings.push({
          checkId: "AWS-NETSEG-003",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `nacl://${nacl[0]}`,
          title: `NACL ${nacl[0]} has allow-all inbound rule`,
          details: `VPC: ${nacl[1]}, Default: ${nacl[2]}, ${allowAll.length} allow-all inbound rule(s) for all protocols`,
          remediation: "Replace allow-all NACL rules with specific port/CIDR allowances",
        })
        output.push(`[!] ${nacl[0]} (VPC ${nacl[1]}): allow-all inbound rules detected`)
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} network segmentation issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeVpcs, DescribeSecurityGroups, DescribeNetworkAcls, DescribeInstances`)
  output.push(`  OPSEC: Standard EC2 read calls — low individual signal, but network-focused enumeration pattern may trigger anomaly rules`)
  return { output: output.join("\n"), findings }
}

// ── 10. Data Classification Audit ─────────────────────────────────────────────

export async function dataClassificationAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Data Classification & Protection Audit\n"]

  // AWS-DATACLASS-001: Unencrypted EBS volumes
  output.push("[*] Checking EBS volume encryption...")
  const volumes = await aws(
    ["ec2", "describe-volumes", "--query", "Volumes[].[VolumeId,Encrypted,Size,State,Attachments[0].InstanceId]"],
    profile,
    region,
    timeout,
  )
  if (volumes.exitCode === 0) {
    const volList = tryJson(volumes.stdout) || []
    const unencrypted = volList.filter((v: (string | boolean | number | null)[]) => v[1] === false)
    output.push(`[+] EBS volumes: ${volList.length} total, ${unencrypted.length} unencrypted`)

    if (unencrypted.length > 0) {
      const totalUnencSize = unencrypted.reduce((sum: number, v: (string | boolean | number | null)[]) => sum + ((v[2] as number) || 0), 0)
      findings.push({
        checkId: "AWS-DATACLASS-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: "ebs://unencrypted-volumes",
        title: `${unencrypted.length} EBS volume(s) are not encrypted (${totalUnencSize} GiB total)`,
        details: `Volumes: ${unencrypted.slice(0, 10).map((v: (string | boolean | number | null)[]) => `${v[0]}(${v[2]}GiB,${v[4] || "detached"})`).join(", ")}`,
        remediation: "Create encrypted snapshots and restore, or enable EBS default encryption for new volumes",
      })
      for (const v of unencrypted.slice(0, 5)) {
        output.push(`[!] ${v[0]}: ${v[2]} GiB, ${v[3]}, attached to ${v[4] || "none"} — NOT encrypted`)
      }
      if (unencrypted.length > 5) output.push(`  ... and ${unencrypted.length - 5} more`)
    }
  }

  // AWS-DATACLASS-002: RDS unencrypted instances
  output.push("\n[*] Checking RDS encryption...")
  const rds = await aws(
    ["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,Engine,StorageEncrypted,AllocatedStorage]"],
    profile,
    region,
    timeout,
  )
  if (rds.exitCode === 0) {
    const dbList = tryJson(rds.stdout) || []
    const unencrypted = dbList.filter((d: (string | boolean | number)[]) => d[2] === false)
    output.push(`[+] RDS instances: ${dbList.length} total, ${unencrypted.length} unencrypted`)

    for (const db of unencrypted) {
      findings.push({
        checkId: "AWS-DATACLASS-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `rds://${db[0]}`,
        title: `RDS instance ${db[0]} storage is not encrypted`,
        details: `Engine: ${db[1]}, Storage: ${db[3]} GiB, Encrypted: false`,
        remediation: `Create encrypted snapshot of ${db[0]}, restore from encrypted snapshot, and swap endpoints`,
      })
      output.push(`[!] ${db[0]} (${db[1]}, ${db[3]} GiB): NOT encrypted`)
    }
  }

  // AWS-DATACLASS-003: Macie status
  output.push("\n[*] Checking Amazon Macie status...")
  const macie = await aws(["macie2", "get-macie-session"], profile, region, timeout)
  if (macie.exitCode === 0) {
    const session = tryJson(macie.stdout)
    const status = session?.status || "unknown"
    output.push(`[+] Macie status: ${status}`)
    if (status !== "ENABLED") {
      findings.push({
        checkId: "AWS-DATACLASS-003",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: "macie://session",
        title: "Amazon Macie is not enabled for sensitive data discovery",
        details: `Macie status: ${status}. Without Macie, sensitive data in S3 (PII, credentials, financial data) is not automatically discovered`,
        remediation: "aws macie2 enable-macie",
      })
    }
  } else {
    findings.push({
      checkId: "AWS-DATACLASS-003",
      provider: "aws",
      severity: "medium",
      status: "FAIL",
      resource: "macie://session",
      title: "Amazon Macie is not enabled",
      details: "Macie is not configured in this region — no automated sensitive data discovery",
      remediation: "aws macie2 enable-macie",
    })
    output.push("[-] Macie not enabled in this region")
  }

  output.push(`\n[*] Summary: ${findings.length} data classification issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeVolumes, GetMacieSession, DescribeDBInstances`)
  output.push(`  OPSEC: Macie session check reveals whether automated sensitive data discovery is active`)
  return { output: output.join("\n"), findings }
}

// ── 11. Backup Compliance Audit ───────────────────────────────────────────────

export async function backupComplianceAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Backup Compliance Audit\n"]

  // AWS-BKPCOMP-001: RDS backup retention
  output.push("[*] Checking RDS backup retention periods...")
  const rds = await aws(
    ["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,Engine,BackupRetentionPeriod,MultiAZ]"],
    profile,
    region,
    timeout,
  )
  if (rds.exitCode === 0) {
    const dbList = tryJson(rds.stdout) || []
    output.push(`[+] RDS instances: ${dbList.length}`)
    for (const db of dbList) {
      const retention = db[2] || 0
      if (retention === 0) {
        findings.push({
          checkId: "AWS-BKPCOMP-001",
          provider: "aws",
          severity: "critical",
          status: "FAIL",
          resource: `rds://${db[0]}`,
          title: `RDS instance ${db[0]} has automated backups DISABLED`,
          details: `Engine: ${db[1]}, BackupRetentionPeriod: 0, MultiAZ: ${db[3]}. No point-in-time recovery possible`,
          remediation: `aws rds modify-db-instance --db-instance-identifier ${db[0]} --backup-retention-period 7`,
        })
        output.push(`[!] ${db[0]} (${db[1]}): backups DISABLED (retention=0)`)
      } else if (retention < 7) {
        findings.push({
          checkId: "AWS-BKPCOMP-001",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: `rds://${db[0]}`,
          title: `RDS instance ${db[0]} has short backup retention (${retention} days)`,
          details: `Engine: ${db[1]}, BackupRetentionPeriod: ${retention}. Recommended: >=7 days`,
          remediation: `aws rds modify-db-instance --db-instance-identifier ${db[0]} --backup-retention-period 7`,
        })
        output.push(`[!] ${db[0]} (${db[1]}): retention=${retention}d (short)`)
      } else {
        output.push(`[+] ${db[0]} (${db[1]}): retention=${retention}d`)
      }
    }
  }

  // AWS-BKPCOMP-002: DynamoDB PITR
  output.push("\n[*] Checking DynamoDB point-in-time recovery...")
  const tables = await aws(["dynamodb", "list-tables", "--query", "TableNames"], profile, region, timeout)
  if (tables.exitCode === 0) {
    const tableList = tryJson(tables.stdout) || []
    output.push(`[+] DynamoDB tables: ${tableList.length}`)
    for (const table of tableList.slice(0, 30)) {
      const pitr = await aws(
        ["dynamodb", "describe-continuous-backups", "--table-name", table, "--query", "ContinuousBackupsDescription.PointInTimeRecoveryDescription"],
        profile,
        region,
        timeout,
      )
      if (pitr.exitCode === 0) {
        const pitrDesc = tryJson(pitr.stdout) || {}
        const status = pitrDesc.PointInTimeRecoveryStatus || "DISABLED"
        if (status !== "ENABLED") {
          findings.push({
            checkId: "AWS-BKPCOMP-002",
            provider: "aws",
            severity: "medium",
            status: "FAIL",
            resource: `dynamodb://${table}`,
            title: `DynamoDB table ${table} has PITR disabled`,
            details: `PointInTimeRecoveryStatus: ${status}. Without PITR, data can only be recovered from on-demand backups`,
            remediation: `aws dynamodb update-continuous-backups --table-name ${table} --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true`,
          })
          output.push(`[-] ${table}: PITR ${status}`)
        } else {
          output.push(`[+] ${table}: PITR ENABLED`)
        }
      }
    }
  }

  // AWS-BKPCOMP-003: S3 versioning
  output.push("\n[*] Checking S3 bucket versioning...")
  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (buckets.exitCode === 0) {
    const bucketList = tryJson(buckets.stdout) || []
    let noVersioning = 0
    for (const bucket of bucketList.slice(0, 50)) {
      const ver = await aws(["s3api", "get-bucket-versioning", "--bucket", bucket], profile, region, timeout)
      if (ver.exitCode === 0) {
        const vs = tryJson(ver.stdout)
        if (vs?.Status !== "Enabled") {
          noVersioning++
        }
      }
    }
    output.push(`[+] S3 buckets without versioning: ${noVersioning}/${Math.min(bucketList.length, 50)}`)
    if (noVersioning > 0) {
      findings.push({
        checkId: "AWS-BKPCOMP-003",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: "s3://versioning",
        title: `${noVersioning} S3 bucket(s) without versioning enabled`,
        details: "Without versioning, deleted or overwritten objects cannot be recovered",
        remediation: "aws s3api put-bucket-versioning --bucket <bucket> --versioning-configuration Status=Enabled",
      })
    }
  }

  // AWS-BKPCOMP-004: AWS Backup plans
  output.push("\n[*] Checking AWS Backup plans...")
  const plans = await aws(["backup", "list-backup-plans"], profile, region, timeout)
  if (plans.exitCode === 0) {
    const planList = tryJson(plans.stdout)?.BackupPlansList || []
    output.push(`[+] Backup plans: ${planList.length}`)
    if (planList.length === 0) {
      findings.push({
        checkId: "AWS-BKPCOMP-004",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: "backup://plans",
        title: "No AWS Backup plans configured",
        details: "No centralized backup strategy — individual services may have their own backups but no unified plan exists",
        remediation: "Create an AWS Backup plan covering critical resources: aws backup create-backup-plan --backup-plan ...",
      })
    } else {
      for (const p of planList) {
        output.push(`  ${p.BackupPlanName} (${p.BackupPlanId})`)
      }
      // Check protected resources
      const protected_ = await aws(["backup", "list-protected-resources", "--max-results", "100"], profile, region, timeout)
      if (protected_.exitCode === 0) {
        const protectedList = tryJson(protected_.stdout)?.Results || []
        output.push(`[+] Protected resources: ${protectedList.length}`)
      }
    }
  } else {
    output.push("[-] AWS Backup not accessible or not configured")
  }

  output.push(`\n[*] Summary: ${findings.length} backup compliance issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListBackupPlans, ListProtectedResources, DescribeDBInstances, ListBuckets, GetBucketVersioning, ListTables, DescribeContinuousBackups`)
  output.push(`  OPSEC: Cross-service backup enumeration — ListBackupPlans + ListProtectedResources reveal disaster recovery posture`)
  return { output: output.join("\n"), findings }
}

// ── 12. IAM Best Practices ────────────────────────────────────────────────────

export async function iamBestPractices(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] IAM Best Practices Audit\n"]

  const users = await aws(["iam", "list-users", "--query", "Users[].[UserName,Arn]"], profile, region, timeout)
  if (users.exitCode !== 0) return { output: `[-] Failed to list users: ${users.stderr.trim()}`, findings }
  const userList = tryJson(users.stdout) || []
  output.push(`[+] IAM users: ${userList.length}\n`)

  // AWS-IAMBP-001: Users with inline policies (should use managed policies via groups)
  output.push("[*] Checking for inline policies on users...")
  let inlineCount = 0
  for (const user of userList) {
    const inlinePolicies = await aws(
      ["iam", "list-user-policies", "--user-name", user[0], "--query", "PolicyNames"],
      profile,
      region,
      timeout,
    )
    if (inlinePolicies.exitCode === 0) {
      const policies = tryJson(inlinePolicies.stdout) || []
      if (policies.length > 0) {
        inlineCount++
        findings.push({
          checkId: "AWS-IAMBP-001",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `iam://user/${user[0]}`,
          title: `IAM user ${user[0]} has ${policies.length} inline policy(ies)`,
          details: `Inline policies: ${policies.join(", ")}. Inline policies are harder to audit and manage at scale`,
          remediation: `Convert inline policies to managed policies and assign via groups for ${user[0]}`,
        })
        output.push(`[!] ${user[0]}: ${policies.length} inline policies (${policies.join(", ")})`)
      }
    }
  }
  output.push(`[+] Users with inline policies: ${inlineCount}/${userList.length}`)

  // AWS-IAMBP-002: Direct policy attachment (should use groups)
  output.push("\n[*] Checking for directly attached policies on users...")
  let directCount = 0
  for (const user of userList) {
    const attached = await aws(
      ["iam", "list-attached-user-policies", "--user-name", user[0], "--query", "AttachedPolicies[].PolicyName"],
      profile,
      region,
      timeout,
    )
    if (attached.exitCode === 0) {
      const policies = tryJson(attached.stdout) || []
      if (policies.length > 0) {
        directCount++
        findings.push({
          checkId: "AWS-IAMBP-002",
          provider: "aws",
          severity: "low",
          status: "FAIL",
          resource: `iam://user/${user[0]}`,
          title: `IAM user ${user[0]} has ${policies.length} directly attached policy(ies)`,
          details: `Direct policies: ${policies.join(", ")}. Best practice: assign policies via IAM groups for centralized management`,
          remediation: `Create/use an IAM group with these policies and add ${user[0]} to the group`,
        })
        output.push(`[!] ${user[0]}: ${policies.length} direct policies (${policies.join(", ")})`)
      }
    }
  }
  output.push(`[+] Users with directly attached policies: ${directCount}/${userList.length}`)

  // AWS-IAMBP-003: Empty IAM groups
  output.push("\n[*] Checking for empty IAM groups...")
  const groups = await aws(["iam", "list-groups", "--query", "Groups[].GroupName"], profile, region, timeout)
  if (groups.exitCode === 0) {
    const groupList = tryJson(groups.stdout) || []
    output.push(`[+] IAM groups: ${groupList.length}`)
    let emptyGroups = 0
    for (const group of groupList) {
      const members = await aws(
        ["iam", "get-group", "--group-name", group, "--query", "Users[].UserName"],
        profile,
        region,
        timeout,
      )
      if (members.exitCode === 0) {
        const memberList = tryJson(members.stdout) || []
        if (memberList.length === 0) {
          emptyGroups++
          output.push(`[-] ${group}: empty group`)
        }
      }
    }
    if (emptyGroups > 0) {
      findings.push({
        checkId: "AWS-IAMBP-003",
        provider: "aws",
        severity: "info",
        status: "INFO",
        resource: "iam://groups/empty",
        title: `${emptyGroups} empty IAM group(s) found`,
        details: "Empty groups add clutter and may indicate incomplete IAM setup or stale configurations",
        remediation: "Review and delete unused IAM groups, or assign users to them",
      })
    }
  }

  // AWS-IAMBP-004: Unused service access (via service-last-accessed)
  output.push("\n[*] Checking for unused service access on users (sampling up to 10)...")
  for (const user of userList.slice(0, 10)) {
    const jobReq = await aws(
      ["iam", "generate-service-last-accessed-details", "--arn", user[1]],
      profile,
      region,
      timeout,
    )
    if (jobReq.exitCode === 0) {
      const jobId = tryJson(jobReq.stdout)?.JobId
      if (jobId) {
        // Brief wait then check — service-last-accessed can take a moment
        const details = await aws(
          ["iam", "get-service-last-accessed-details", "--job-id", jobId],
          profile,
          region,
          timeout,
        )
        if (details.exitCode === 0) {
          const data = tryJson(details.stdout)
          if (data?.JobStatus === "COMPLETED") {
            const services = data.ServicesLastAccessed || []
            const neverUsed = services.filter((s: Record<string, unknown>) => !s.LastAuthenticated)
            const totalAccessed = services.length - neverUsed.length
            if (neverUsed.length > 0 && totalAccessed > 0) {
              const ratio = Math.round((neverUsed.length / services.length) * 100)
              if (ratio > 80) {
                findings.push({
                  checkId: "AWS-IAMBP-004",
                  provider: "aws",
                  severity: "low",
                  status: "WARN",
                  resource: `iam://user/${user[0]}`,
                  title: `IAM user ${user[0]} has access to ${services.length} services but only used ${totalAccessed}`,
                  details: `${neverUsed.length}/${services.length} (${ratio}%) services were never accessed — overly broad permissions`,
                  remediation: `Review and reduce permissions for ${user[0]} to only services actually used`,
                })
              }
            }
          }
        }
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} IAM best practice issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListUsers, ListUserPolicies, ListAttachedUserPolicies, ListGroups, GetGroup, GenerateServiceLastAccessedDetails, GetServiceLastAccessedDetails`)
  output.push(`  OPSEC: Comprehensive IAM audit — per-user policy enumeration generates high event volume`)
  return { output: output.join("\n"), findings }
}

// ── 13. VPC Flow Log Audit ────────────────────────────────────────────────────

export async function vpcFlowLogAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] VPC Flow Log Coverage Audit\n"]

  const vpcs = await aws(
    ["ec2", "describe-vpcs", "--query", "Vpcs[].[VpcId,CidrBlock,IsDefault,State]"],
    profile,
    region,
    timeout,
  )
  if (vpcs.exitCode !== 0) return { output: `[-] Failed to describe VPCs: ${vpcs.stderr.trim()}`, findings }
  const vpcList = tryJson(vpcs.stdout) || []
  output.push(`[+] VPCs: ${vpcList.length}\n`)

  let covered = 0
  let uncovered = 0

  for (const vpc of vpcList) {
    const vpcId = vpc[0]
    const cidr = vpc[1]
    const isDefault = vpc[2]

    const flows = await aws(
      ["ec2", "describe-flow-logs", "--filter", `Name=resource-id,Values=${vpcId}`],
      profile,
      region,
      timeout,
    )
    if (flows.exitCode !== 0) continue
    const flowLogs = tryJson(flows.stdout)?.FlowLogs || []

    if (flowLogs.length === 0) {
      uncovered++
      findings.push({
        checkId: "AWS-VPCFL-001",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: `vpc://${vpcId}`,
        title: `VPC ${vpcId} has no flow logs configured`,
        details: `CIDR: ${cidr}, Default: ${isDefault}. Network traffic is not being captured for security analysis, forensics, or anomaly detection`,
        remediation: `aws ec2 create-flow-logs --resource-type VPC --resource-ids ${vpcId} --traffic-type ALL --log-destination-type cloud-watch-logs --log-group-name vpc-flow-logs/${vpcId}`,
      })
      output.push(`[-] ${vpcId} (${cidr}${isDefault ? ", default" : ""}): NO flow logs`)
    } else {
      covered++
      output.push(`[+] ${vpcId} (${cidr}${isDefault ? ", default" : ""}):`)
      for (const fl of flowLogs) {
        const dest = fl.LogDestinationType || "cloud-watch-logs"
        const trafficType = fl.TrafficType || "ALL"
        const status = fl.FlowLogStatus || "ACTIVE"
        output.push(`    ${fl.FlowLogId}: ${dest}, traffic=${trafficType}, status=${status}`)

        // Check for REJECT-only or ACCEPT-only — should capture ALL
        if (trafficType !== "ALL") {
          findings.push({
            checkId: "AWS-VPCFL-001",
            provider: "aws",
            severity: "low",
            status: "WARN",
            resource: `vpc://${vpcId}/flow-log/${fl.FlowLogId}`,
            title: `VPC flow log ${fl.FlowLogId} only captures ${trafficType} traffic`,
            details: `Capturing only ${trafficType} traffic may miss important network activity. Recommended: ALL`,
            remediation: `Create additional flow log with TrafficType=ALL for comprehensive visibility`,
          })
        }

        // Check for inactive flow logs
        if (status !== "ACTIVE") {
          findings.push({
            checkId: "AWS-VPCFL-001",
            provider: "aws",
            severity: "high",
            status: "FAIL",
            resource: `vpc://${vpcId}/flow-log/${fl.FlowLogId}`,
            title: `VPC flow log ${fl.FlowLogId} is not active`,
            details: `Status: ${status}. Flow log exists but is not actively capturing traffic`,
            remediation: "Investigate and fix flow log delivery errors, or recreate the flow log",
          })
        }
      }
    }
  }

  output.push(`\n[*] Summary: ${covered} VPCs with flow logs, ${uncovered} without, ${findings.length} findings`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeVpcs, DescribeFlowLogs`)
  output.push(`  OPSEC: Low-signal reads — but enumerating flow log coverage reveals network monitoring gaps to attackers`)
  return { output: output.join("\n"), findings }
}

// ── 14. S3 Public Audit ───────────────────────────────────────────────────────

export async function s3PublicAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] S3 Public Exposure Audit\n"]

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (buckets.exitCode !== 0) return { output: `[-] Failed to list buckets: ${buckets.stderr.trim()}`, findings }
  const bucketList = tryJson(buckets.stdout) || []
  output.push(`[+] Total S3 buckets: ${bucketList.length}\n`)

  for (const bucket of bucketList.slice(0, 50)) {
    output.push(`[*] Analyzing ${bucket}...`)

    // AWS-S3PUB-001: Bucket policy with Principal: *
    const pol = await aws(["s3api", "get-bucket-policy", "--bucket", bucket], profile, region, timeout)
    if (pol.exitCode === 0) {
      const rawPolicy = tryJson(pol.stdout)?.Policy
      const doc = rawPolicy ? tryJson(rawPolicy) : null
      if (doc) {
        const statements = doc.Statement || []
        for (const stmt of statements) {
          const principal = stmt.Principal
          const isPublic = principal === "*" ||
            (typeof principal === "object" && (principal.AWS === "*" || (Array.isArray(principal.AWS) && principal.AWS.includes("*"))))
          if (stmt.Effect === "Allow" && isPublic) {
            const actions = Array.isArray(stmt.Action) ? stmt.Action.join(", ") : (stmt.Action || "*")
            const hasCondition = stmt.Condition && Object.keys(stmt.Condition).length > 0
            findings.push({
              checkId: "AWS-S3PUB-001",
              provider: "aws",
              severity: hasCondition ? "medium" : "critical",
              status: "FAIL",
              resource: `s3://${bucket}`,
              title: `S3 bucket ${bucket} policy allows Principal:*${hasCondition ? " (with conditions)" : ""}`,
              details: `Actions: ${actions}, Effect: Allow, Condition: ${hasCondition ? JSON.stringify(stmt.Condition) : "none"}`,
              remediation: `Review and restrict bucket policy for ${bucket} — remove or condition Principal:*`,
            })
            output.push(`  [!] Policy: Principal:* ALLOW ${actions}${hasCondition ? " (conditioned)" : ""}`)
          }
        }
      }
    }

    // AWS-S3PUB-002: Bucket ACL with public grants
    const acl = await aws(["s3api", "get-bucket-acl", "--bucket", bucket], profile, region, timeout)
    if (acl.exitCode === 0) {
      const grants = tryJson(acl.stdout)?.Grants || []
      for (const g of grants) {
        const uri = g.Grantee?.URI || ""
        if (uri.includes("AllUsers") || uri.includes("AuthenticatedUsers")) {
          const grantee = uri.includes("AllUsers") ? "Everyone (AllUsers)" : "Any authenticated AWS user (AuthenticatedUsers)"
          findings.push({
            checkId: "AWS-S3PUB-002",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: `s3://${bucket}`,
            title: `S3 bucket ${bucket} ACL grants ${g.Permission} to ${grantee}`,
            details: `Grantee URI: ${uri}, Permission: ${g.Permission}`,
            remediation: `Remove public ACL grant: aws s3api put-bucket-acl --bucket ${bucket} --acl private`,
          })
          output.push(`  [!] ACL: ${g.Permission} to ${grantee}`)
        }
      }
    }

    // AWS-S3PUB-003: Static website hosting enabled
    const website = await aws(["s3api", "get-bucket-website", "--bucket", bucket], profile, region, timeout)
    if (website.exitCode === 0) {
      const ws = tryJson(website.stdout)
      if (ws) {
        findings.push({
          checkId: "AWS-S3PUB-003",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: `s3://${bucket}`,
          title: `S3 bucket ${bucket} has static website hosting enabled`,
          details: `IndexDocument: ${ws.IndexDocument?.Suffix || "N/A"}, ErrorDocument: ${ws.ErrorDocument?.Key || "N/A"}. Website hosting exposes bucket content via HTTP`,
          remediation: "Review if website hosting is intentional. Consider using CloudFront with OAI instead",
        })
        output.push(`  [!] Website hosting: index=${ws.IndexDocument?.Suffix || "?"}, error=${ws.ErrorDocument?.Key || "?"}`)
      }
    }

    // AWS-S3PUB-004: Policy status IsPublic
    const policyStatus = await aws(["s3api", "get-bucket-policy-status", "--bucket", bucket], profile, region, timeout)
    if (policyStatus.exitCode === 0) {
      const ps = tryJson(policyStatus.stdout)?.PolicyStatus || {}
      if (ps.IsPublic === true) {
        findings.push({
          checkId: "AWS-S3PUB-004",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `s3://${bucket}`,
          title: `S3 bucket ${bucket} is marked as PUBLIC by AWS policy evaluation`,
          details: "AWS S3 evaluated the bucket policy and determined it grants public access",
          remediation: `Review and fix bucket policy: aws s3api get-bucket-policy --bucket ${bucket}`,
        })
        output.push(`  [!] PolicyStatus: IsPublic=true`)
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} S3 public exposure issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListBuckets, GetBucketPolicyStatus, GetBucketAcl, GetBucketPolicy, GetBucketWebsite`)
  output.push(`  OPSEC: Per-bucket policy/ACL enumeration generates N events; S3 data events trail may log these reads`)
  return { output: output.join("\n"), findings }
}

// ── 15. RDS Public Audit ──────────────────────────────────────────────────────

export async function rdsPublicAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] RDS Security & Public Exposure Audit\n"]

  const rds = await aws(["rds", "describe-db-instances"], profile, region, timeout)
  if (rds.exitCode !== 0) return { output: `[-] Failed to describe RDS instances: ${rds.stderr.trim()}`, findings }
  const dbList = tryJson(rds.stdout)?.DBInstances || []
  output.push(`[+] RDS instances: ${dbList.length}\n`)

  for (const db of dbList) {
    const id = db.DBInstanceIdentifier || "unknown"
    const engine = db.Engine || "unknown"
    const endpoint = db.Endpoint?.Address || "N/A"

    output.push(`[*] ${id} (${engine} ${db.EngineVersion || ""})`)
    output.push(`    Endpoint: ${endpoint}:${db.Endpoint?.Port || ""}`)

    // AWS-RDSPUB-001: PubliclyAccessible
    if (db.PubliclyAccessible === true) {
      findings.push({
        checkId: "AWS-RDSPUB-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: `rds://${id}`,
        title: `RDS instance ${id} is publicly accessible`,
        details: `Engine: ${engine}, Endpoint: ${endpoint}, PubliclyAccessible: true. Database is reachable from the internet`,
        remediation: `aws rds modify-db-instance --db-instance-identifier ${id} --no-publicly-accessible`,
      })
      output.push(`    [!] PubliclyAccessible: TRUE`)
    } else {
      output.push(`    PubliclyAccessible: false`)
    }

    // AWS-RDSPUB-002: StorageEncrypted
    if (db.StorageEncrypted === false) {
      findings.push({
        checkId: "AWS-RDSPUB-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `rds://${id}`,
        title: `RDS instance ${id} storage is not encrypted`,
        details: `Engine: ${engine}, StorageEncrypted: false. Data at rest is unprotected`,
        remediation: "Create encrypted snapshot, restore from it, and swap endpoints",
      })
      output.push(`    [!] StorageEncrypted: FALSE`)
    }

    // AWS-RDSPUB-003: DeletionProtection
    if (db.DeletionProtection !== true) {
      findings.push({
        checkId: "AWS-RDSPUB-003",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: `rds://${id}`,
        title: `RDS instance ${id} has deletion protection disabled`,
        details: `Engine: ${engine}, DeletionProtection: false. Instance can be accidentally deleted`,
        remediation: `aws rds modify-db-instance --db-instance-identifier ${id} --deletion-protection`,
      })
      output.push(`    [!] DeletionProtection: FALSE`)
    }

    // AWS-RDSPUB-004: AutoMinorVersionUpgrade
    if (db.AutoMinorVersionUpgrade !== true) {
      findings.push({
        checkId: "AWS-RDSPUB-004",
        provider: "aws",
        severity: "low",
        status: "FAIL",
        resource: `rds://${id}`,
        title: `RDS instance ${id} has auto minor version upgrade disabled`,
        details: `Engine: ${engine} ${db.EngineVersion}, AutoMinorVersionUpgrade: false. Security patches won't be auto-applied`,
        remediation: `aws rds modify-db-instance --db-instance-identifier ${id} --auto-minor-version-upgrade`,
      })
      output.push(`    [!] AutoMinorVersionUpgrade: FALSE`)
    }

    // AWS-RDSPUB-005: Enhanced monitoring
    const monitoringInterval = db.MonitoringInterval || 0
    if (monitoringInterval === 0) {
      findings.push({
        checkId: "AWS-RDSPUB-005",
        provider: "aws",
        severity: "low",
        status: "FAIL",
        resource: `rds://${id}`,
        title: `RDS instance ${id} has no enhanced monitoring`,
        details: `Engine: ${engine}, MonitoringInterval: 0. Enhanced monitoring provides OS-level metrics`,
        remediation: `aws rds modify-db-instance --db-instance-identifier ${id} --monitoring-interval 60 --monitoring-role-arn <role>`,
      })
      output.push(`    [!] MonitoringInterval: 0 (no enhanced monitoring)`)
    }

    // AWS-RDSPUB-006: Backup retention + CloudWatch exports
    const retention = db.BackupRetentionPeriod || 0
    const logExports = db.EnabledCloudwatchLogsExports || []
    if (retention === 0) {
      findings.push({
        checkId: "AWS-RDSPUB-006",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `rds://${id}`,
        title: `RDS instance ${id} has automated backups disabled`,
        details: `Engine: ${engine}, BackupRetentionPeriod: 0, CloudWatch exports: ${logExports.length > 0 ? logExports.join(", ") : "none"}`,
        remediation: `aws rds modify-db-instance --db-instance-identifier ${id} --backup-retention-period 7`,
      })
    }

    output.push(`    Retention: ${retention}d, MultiAZ: ${db.MultiAZ}, Exports: ${logExports.join(", ") || "none"}`)
  }

  output.push(`\n[*] Summary: ${findings.length} RDS security issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeDBInstances`)
  output.push(`  OPSEC: Single DescribeDBInstances call — minimal footprint, standard operational query`)
  return { output: output.join("\n"), findings }
}

// ── 16. Secret Rotation Audit ─────────────────────────────────────────────────

export async function secretRotationAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Secret & Key Rotation Audit\n"]

  const now = Date.now()
  const DAY_MS = 86400000

  // AWS-SECROT-001: Secrets Manager rotation
  output.push("[*] Checking Secrets Manager rotation configuration...")
  const secrets = await aws(["secretsmanager", "list-secrets"], profile, region, timeout)
  if (secrets.exitCode === 0) {
    const secretList = tryJson(secrets.stdout)?.SecretList || []
    output.push(`[+] Secrets Manager secrets: ${secretList.length}`)

    let noRotation = 0
    let staleRotation = 0

    for (const s of secretList) {
      const name = s.Name || "unknown"
      const rotationEnabled = s.RotationEnabled === true
      const lastRotated = s.LastRotatedDate
      const lastChanged = s.LastChangedDate

      if (!rotationEnabled) {
        noRotation++
        findings.push({
          checkId: "AWS-SECROT-001",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `secretsmanager://${name}`,
          title: `Secret ${name} has automatic rotation disabled`,
          details: `RotationEnabled: false, LastChanged: ${lastChanged || "unknown"}. Secrets should be rotated regularly`,
          remediation: `Enable rotation: aws secretsmanager rotate-secret --secret-id ${name} --rotation-lambda-arn <arn> --rotation-rules AutomaticallyAfterDays=90`,
        })
        output.push(`[-] ${name}: rotation DISABLED`)
      } else if (lastRotated) {
        const rotatedDate = new Date(lastRotated).getTime()
        const daysSince = Math.floor((now - rotatedDate) / DAY_MS)
        if (daysSince > 90) {
          staleRotation++
          findings.push({
            checkId: "AWS-SECROT-001",
            provider: "aws",
            severity: "high",
            status: "FAIL",
            resource: `secretsmanager://${name}`,
            title: `Secret ${name} was last rotated ${daysSince} days ago`,
            details: `RotationEnabled: true but LastRotatedDate: ${lastRotated} (${daysSince} days ago). Rotation may be failing`,
            remediation: `Check rotation Lambda logs and trigger manual rotation: aws secretsmanager rotate-secret --secret-id ${name}`,
          })
          output.push(`[!] ${name}: last rotated ${daysSince}d ago (stale)`)
        } else {
          output.push(`[+] ${name}: rotated ${daysSince}d ago`)
        }
      }
    }
    output.push(`[+] No rotation: ${noRotation}, Stale rotation: ${staleRotation}`)
  } else {
    output.push(`[-] Could not list secrets: ${secrets.stderr.trim()}`)
  }

  // AWS-SECROT-002: KMS key rotation
  output.push("\n[*] Checking KMS customer-managed key rotation...")
  const keys = await aws(
    ["kms", "list-keys", "--query", "Keys[].KeyId"],
    profile,
    region,
    timeout,
  )
  if (keys.exitCode === 0) {
    const keyList = tryJson(keys.stdout) || []
    output.push(`[+] KMS keys: ${keyList.length}`)

    for (const keyId of keyList) {
      // Only check customer-managed keys (skip AWS-managed)
      const desc = await aws(["kms", "describe-key", "--key-id", keyId, "--query", "KeyMetadata"], profile, region, timeout)
      if (desc.exitCode !== 0) continue
      const meta = tryJson(desc.stdout) || {}

      // Skip AWS managed keys and disabled keys
      if (meta.KeyManager !== "CUSTOMER") continue
      if (meta.KeyState !== "Enabled") continue

      const alias = meta.Description || keyId
      const rotation = await aws(["kms", "get-key-rotation-status", "--key-id", keyId], profile, region, timeout)
      if (rotation.exitCode === 0) {
        const rotStatus = tryJson(rotation.stdout)
        if (rotStatus?.KeyRotationEnabled !== true) {
          findings.push({
            checkId: "AWS-SECROT-002",
            provider: "aws",
            severity: "medium",
            status: "FAIL",
            resource: `kms://${keyId}`,
            title: `KMS key ${keyId} does not have automatic rotation enabled`,
            details: `Description: ${alias}, KeyRotationEnabled: false. AWS recommends annual rotation for CMKs`,
            remediation: `aws kms enable-key-rotation --key-id ${keyId}`,
          })
          output.push(`[-] ${keyId}: rotation DISABLED (${alias})`)
        } else {
          output.push(`[+] ${keyId}: rotation enabled (${alias})`)
        }
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} rotation issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListSecrets, ListKeys, DescribeKey, GetKeyRotationStatus`)
  output.push(`  OPSEC: KMS key and Secrets Manager enumeration reveals cryptographic and secret infrastructure — DescribeKey on many keys is unusual`)
  return { output: output.join("\n"), findings }
}

// ── 17. Service Quota Audit ───────────────────────────────────────────────────

export async function serviceQuotaAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Service Quota Utilization Audit\n"]

  // Define quota checks: service code, quota name, describe command for current usage
  const quotaChecks = [
    {
      service: "ec2",
      quotaCode: "L-1216C47A",
      label: "Running On-Demand Standard instances",
      usageCmd: ["ec2", "describe-instances", "--filters", "Name=instance-state-name,Values=running", "--query", "Reservations[].Instances[] | length(@)"],
    },
    {
      service: "ec2",
      quotaCode: "L-0263D0A3",
      label: "Elastic IP addresses",
      usageCmd: ["ec2", "describe-addresses", "--query", "Addresses | length(@)"],
    },
    {
      service: "vpc",
      quotaCode: "L-F678F1CE",
      label: "VPCs per Region",
      usageCmd: ["ec2", "describe-vpcs", "--query", "Vpcs | length(@)"],
    },
    {
      service: "ec2",
      quotaCode: "L-E79EC296",
      label: "Security groups per VPC",
      usageCmd: ["ec2", "describe-security-groups", "--query", "SecurityGroups | length(@)"],
    },
  ]

  for (const check of quotaChecks) {
    output.push(`\n[*] Checking ${check.label} (${check.service})...`)

    // Get the quota limit
    const quota = await aws(
      ["service-quotas", "get-service-quota", "--service-code", check.service, "--quota-code", check.quotaCode],
      profile,
      region,
      timeout,
    )

    let limit = 0
    if (quota.exitCode === 0) {
      const q = tryJson(quota.stdout)?.Quota || {}
      limit = q.Value || 0
      output.push(`[+] Quota limit: ${limit}`)
    } else {
      // Try default quota
      const defaultQuota = await aws(
        ["service-quotas", "get-aws-default-service-quota", "--service-code", check.service, "--quota-code", check.quotaCode],
        profile,
        region,
        timeout,
      )
      if (defaultQuota.exitCode === 0) {
        const dq = tryJson(defaultQuota.stdout)?.Quota || {}
        limit = dq.Value || 0
        output.push(`[+] Default quota limit: ${limit}`)
      } else {
        output.push(`[-] Could not retrieve quota for ${check.label}`)
        continue
      }
    }

    // Get current usage
    const usage = await aws(check.usageCmd, profile, region, timeout)
    if (usage.exitCode === 0) {
      const current = tryJson(usage.stdout) ?? 0
      const utilization = limit > 0 ? Math.round((current / limit) * 100) : 0
      output.push(`[+] Current usage: ${current}/${limit} (${utilization}%)`)

      if (utilization > 80) {
        findings.push({
          checkId: "AWS-QUOTA-001",
          provider: "aws",
          severity: utilization > 95 ? "high" : "medium",
          status: utilization > 95 ? "FAIL" : "WARN",
          resource: `quota://${check.service}/${check.quotaCode}`,
          title: `${check.label}: ${utilization}% utilization (${current}/${limit})`,
          details: `Service: ${check.service}, Quota: ${check.label}, Usage: ${current}/${limit} (${utilization}%). High utilization may cause launch failures`,
          remediation: `Request quota increase: aws service-quotas request-service-quota-increase --service-code ${check.service} --quota-code ${check.quotaCode} --desired-value <new-limit>`,
        })
      }
    }
  }

  // IAM-specific quotas
  output.push("\n[*] Checking IAM quotas...")
  const iamSummary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  if (iamSummary.exitCode === 0) {
    const sum = tryJson(iamSummary.stdout)?.SummaryMap || {}
    const iamChecks = [
      { label: "IAM Users", current: sum.Users || 0, limit: sum.UsersQuota || 5000 },
      { label: "IAM Groups", current: sum.Groups || 0, limit: sum.GroupsQuota || 300 },
      { label: "IAM Roles", current: sum.Roles || 0, limit: sum.RolesQuota || 1000 },
      { label: "IAM Policies", current: sum.Policies || 0, limit: sum.PoliciesQuota || 1500 },
      { label: "IAM Server Certificates", current: sum.ServerCertificates || 0, limit: sum.ServerCertificatesQuota || 20 },
    ]

    for (const check of iamChecks) {
      const utilization = check.limit > 0 ? Math.round((check.current / check.limit) * 100) : 0
      output.push(`[+] ${check.label}: ${check.current}/${check.limit} (${utilization}%)`)
      if (utilization > 80) {
        findings.push({
          checkId: "AWS-QUOTA-001",
          provider: "aws",
          severity: utilization > 95 ? "high" : "medium",
          status: utilization > 95 ? "FAIL" : "WARN",
          resource: `quota://iam/${check.label.toLowerCase().replace(/ /g, "-")}`,
          title: `${check.label}: ${utilization}% utilization (${check.current}/${check.limit})`,
          details: `High IAM ${check.label.toLowerCase()} utilization may indicate resource sprawl or limit approaching`,
          remediation: "Review and clean up unused IAM resources, or request a quota increase",
        })
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} quota utilization warnings`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetServiceQuota, GetAWSDefaultServiceQuota, DescribeInstances, DescribeAddresses, DescribeVpcs, DescribeSecurityGroups, GetAccountSummary`)
  output.push(`  OPSEC: Quota queries are low-signal; the usage commands (Describe*) are standard operational calls`)
  return { output: output.join("\n"), findings }
}

// ── 18. Account Security Audit ────────────────────────────────────────────────

export async function accountSecurityAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Account-Level Security Audit\n"]

  // AWS-ACCTSEC-001: EBS default encryption
  output.push("[*] Checking EBS default encryption...")
  const ebs = await aws(["ec2", "get-ebs-encryption-by-default"], profile, region, timeout)
  if (ebs.exitCode === 0) {
    const ebsEnc = tryJson(ebs.stdout)?.EbsEncryptionByDefault
    output.push(`[+] EBS default encryption: ${ebsEnc ? "enabled" : "DISABLED"}`)
    if (!ebsEnc) {
      findings.push({
        checkId: "AWS-ACCTSEC-001",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: "account://ebs-encryption",
        title: "EBS default encryption is not enabled at account level",
        details: "New EBS volumes will be unencrypted unless explicitly specified. This is a region-level setting",
        remediation: "aws ec2 enable-ebs-encryption-by-default",
      })
    }
  }

  // AWS-ACCTSEC-002: S3 account-level public access block
  output.push("\n[*] Checking S3 account-level public access block...")
  const identity = await aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile, region, timeout)
  const accountId = identity.exitCode === 0 ? identity.stdout.trim() : ""
  if (accountId) {
    output.push(`[+] Account ID: ${accountId}`)
    const s3Block = await aws(["s3control", "get-public-access-block", "--account-id", accountId], profile, region, timeout)
    if (s3Block.exitCode !== 0) {
      findings.push({
        checkId: "AWS-ACCTSEC-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: "account://s3-public-access-block",
        title: "S3 account-level public access block is not configured",
        details: "Without account-level S3 public access block, individual buckets can be made public",
        remediation: `aws s3control put-public-access-block --account-id ${accountId} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`,
      })
      output.push("[-] S3 account-level public access block: NOT SET")
    } else {
      const block = tryJson(s3Block.stdout)?.PublicAccessBlockConfiguration || {}
      const allSet = block.BlockPublicAcls && block.IgnorePublicAcls && block.BlockPublicPolicy && block.RestrictPublicBuckets
      output.push(`[+] BlockAcls=${block.BlockPublicAcls}, IgnoreAcls=${block.IgnorePublicAcls}, BlockPolicy=${block.BlockPublicPolicy}, Restrict=${block.RestrictPublicBuckets}`)
      if (!allSet) {
        findings.push({
          checkId: "AWS-ACCTSEC-002",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: "account://s3-public-access-block",
          title: "S3 account-level public access block is incomplete",
          details: `Not all four block settings are enabled. Current: BlockAcls=${block.BlockPublicAcls}, IgnoreAcls=${block.IgnorePublicAcls}, BlockPolicy=${block.BlockPublicPolicy}, Restrict=${block.RestrictPublicBuckets}`,
          remediation: "Enable all four settings at account level",
        })
      }
    }
  }

  // AWS-ACCTSEC-003: IMDSv2 enforcement (check instance metadata defaults)
  output.push("\n[*] Checking EC2 instance metadata defaults (IMDSv2)...")
  const defaults = await aws(
    ["ec2", "get-instance-metadata-defaults"],
    profile,
    region,
    timeout,
  )
  if (defaults.exitCode === 0) {
    const meta = tryJson(defaults.stdout)?.AccountLevel || {}
    const httpTokens = meta.HttpTokens || "optional"
    output.push(`[+] Account IMDS defaults: HttpTokens=${httpTokens}`)
    if (httpTokens !== "required") {
      findings.push({
        checkId: "AWS-ACCTSEC-003",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: "account://imds-defaults",
        title: "IMDSv2 is not enforced as account default",
        details: `HttpTokens: ${httpTokens}. New instances can launch with IMDSv1 enabled, which is vulnerable to SSRF-based credential theft`,
        remediation: "aws ec2 modify-instance-metadata-defaults --http-tokens required --http-put-response-hop-limit 2",
      })
    }
  } else {
    // Fallback: check running instances for IMDSv1
    output.push("[-] Could not get account IMDS defaults — checking running instances...")
    const instances = await aws(
      ["ec2", "describe-instances", "--query", "Reservations[].Instances[].[InstanceId,MetadataOptions.HttpTokens,State.Name]"],
      profile,
      region,
      timeout,
    )
    if (instances.exitCode === 0) {
      const instList = tryJson(instances.stdout) || []
      const v1Instances = instList.filter(
        (i: (string | null)[]) => i[1] === "optional" && i[2] === "running",
      )
      if (v1Instances.length > 0) {
        findings.push({
          checkId: "AWS-ACCTSEC-003",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: "ec2://imdsv1-instances",
          title: `${v1Instances.length} running instance(s) allow IMDSv1`,
          details: `Instances with HttpTokens=optional: ${v1Instances.slice(0, 10).map((i: string[]) => i[0]).join(", ")}. IMDSv1 is vulnerable to SSRF-based credential theft`,
          remediation: "Enforce IMDSv2: aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required",
        })
        output.push(`[!] ${v1Instances.length} instances allow IMDSv1`)
      }
    }
  }

  // AWS-ACCTSEC-004: AWS Organizations membership
  output.push("\n[*] Checking AWS Organizations membership...")
  const org = await aws(["organizations", "describe-organization"], profile, region, timeout)
  if (org.exitCode === 0) {
    const orgInfo = tryJson(org.stdout)?.Organization || {}
    output.push(`[+] Organization: ${orgInfo.Id}`)
    output.push(`[+] Master Account: ${orgInfo.MasterAccountId}`)
    output.push(`[+] Feature Set: ${orgInfo.FeatureSet}`)

    if (orgInfo.FeatureSet !== "ALL") {
      findings.push({
        checkId: "AWS-ACCTSEC-004",
        provider: "aws",
        severity: "medium",
        status: "WARN",
        resource: `org://${orgInfo.Id}`,
        title: "AWS Organization using consolidated-billing-only feature set",
        details: `FeatureSet: ${orgInfo.FeatureSet}. Without ALL features, SCPs and other governance controls cannot be applied`,
        remediation: "Upgrade to ALL features: aws organizations enable-all-features",
      })
    }

    // Check for SCPs
    const scps = await aws(["organizations", "list-policies", "--filter", "SERVICE_CONTROL_POLICY"], profile, region, timeout)
    if (scps.exitCode === 0) {
      const scpList = tryJson(scps.stdout)?.Policies || []
      const customScps = scpList.filter((p: Record<string, boolean>) => !p.AwsManaged)
      output.push(`[+] SCPs: ${scpList.length} total, ${customScps.length} custom`)
      if (customScps.length === 0) {
        findings.push({
          checkId: "AWS-ACCTSEC-004",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: `org://${orgInfo.Id}/scps`,
          title: "No custom Service Control Policies (SCPs) defined",
          details: "Only the default FullAWSAccess SCP exists. Custom SCPs provide guardrails against privilege abuse",
          remediation: "Create SCPs to restrict dangerous actions (e.g., deny region, deny leaving org, deny disabling CloudTrail)",
        })
      }
    }
  } else {
    output.push("[-] This account is not part of an AWS Organization")
    findings.push({
      checkId: "AWS-ACCTSEC-004",
      provider: "aws",
      severity: "low",
      status: "INFO",
      resource: "account://organization",
      title: "Account is not part of an AWS Organization",
      details: "Standalone account — no centralized governance, billing consolidation, or SCP controls",
      remediation: "Consider creating an AWS Organization for centralized management and security guardrails",
    })
  }

  // Check IAM authorization details for overly permissive policies
  output.push("\n[*] Checking for overly permissive IAM policies...")
  const authDetails = await aws(
    ["iam", "get-account-authorization-details", "--filter", "LocalManagedPolicy", "--query", "Policies[].{Name:PolicyName,Arn:Arn,DefaultVersionId:DefaultVersionId}"],
    profile,
    region,
    timeout,
  )
  if (authDetails.exitCode === 0) {
    const policies = tryJson(authDetails.stdout) || []
    output.push(`[+] Local managed policies: ${policies.length}`)
    let wildcardCount = 0
    for (const p of policies.slice(0, 50)) {
      const ver = await aws(
        ["iam", "get-policy-version", "--policy-arn", p.Arn, "--version-id", p.DefaultVersionId, "--query", "PolicyVersion.Document"],
        profile,
        region,
        timeout,
      )
      if (ver.exitCode === 0) {
        const doc = tryJson(ver.stdout)
        const statements = Array.isArray(doc?.Statement) ? doc.Statement : []
        for (const stmt of statements) {
          if (stmt.Effect === "Allow" && stmt.Action === "*" && stmt.Resource === "*") {
            wildcardCount++
            output.push(`[!] ${p.Name}: Allow *:* (full admin equivalent)`)
          }
        }
      }
    }
    if (wildcardCount > 0) {
      findings.push({
        checkId: "AWS-ACCTSEC-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: "iam://wildcard-policies",
        title: `${wildcardCount} custom policy(ies) with Allow *:* (full admin equivalent)`,
        details: "Custom managed policies granting full admin access defeat the purpose of IAM least privilege",
        remediation: "Scope down wildcard policies to specific actions and resources needed",
      })
    }
  }

  output.push(`\n[*] Summary: ${findings.length} account security issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetCallerIdentity, DescribeOrganization, ListPolicies, GetPublicAccessBlock, GetEbsEncryptionByDefault, GetInstanceMetadataDefaults, GetAccountAuthorizationDetails, GetPolicyVersion, DescribeInstances`)
  output.push(`  OPSEC: Account-level security posture audit — GetAccountAuthorizationDetails returns full IAM dump, very high-signal`)
  return { output: output.join("\n"), findings }
}
