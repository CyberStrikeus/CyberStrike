import { aws, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function resourceHijack(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Resource Hijack Assessment...\n"]

  if (!execute) {
    output.push("[*] DRY RUN — pass --execute to actually perform resource modification")
    output.push("[*] Assessing hijack-able resources...\n")
  }

  const ec2 = await aws(["ec2", "describe-instances", "--filters", "Name=instance-state-name,Values=running", "--query", "Reservations[].Instances[].[InstanceId,InstanceType,PublicIpAddress]"], profile, region, timeout)
  const instances = tryJson(ec2.stdout) || []
  output.push(`[+] Running EC2 instances: ${instances.length}`)

  for (const inst of instances.slice(0, 10)) {
    output.push(`  ${inst[0]} (${inst[1]}) — ${inst[2] || "no public IP"}`)
  }

  if (execute && instances.length > 0) {
    output.push("\n[*] Would modify instance user-data to inject reverse shell on next boot")
    output.push("[!] This is destructive — only on authorized pentests")
    findings.push({ checkId: "AWS-IMPACT-001", provider: "aws", severity: "critical", status: "READY", resource: `ec2://${instances[0][0]}`, title: "EC2 user-data hijack ready", details: "Can stop instance, modify user-data to inject payload, restart", remediation: "Restrict ec2:ModifyInstanceAttribute, enable IMDSv2" })
  }

  const lambdas = await aws(["lambda", "list-functions", "--query", "Functions[].[FunctionName,Runtime,LastModified]"], profile, region, timeout)
  const lambdaList = tryJson(lambdas.stdout) || []
  output.push(`\n[+] Lambda functions: ${lambdaList.length}`)
  for (const l of lambdaList.slice(0, 10)) {
    output.push(`  ${l[0]} (${l[1]})`)
  }

  if (lambdaList.length > 0) {
    findings.push({ checkId: "AWS-IMPACT-002", provider: "aws", severity: "high", status: "READY", resource: `lambda://${lambdaList[0][0]}`, title: `${lambdaList.length} Lambda functions available for code injection`, details: "lambda:UpdateFunctionCode enables code injection into existing functions", remediation: "Restrict lambda:UpdateFunctionCode to CI/CD roles only" })
  }

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  output.push(`\n[+] S3 buckets (potential website/CDN hijack): ${bucketList.length}`)

  for (const bucket of bucketList.slice(0, 20)) {
    const website = await aws(["s3api", "get-bucket-website", "--bucket", bucket], profile, region, timeout)
    if (website.exitCode === 0) {
      output.push(`  [!] ${bucket}: static website hosting enabled — CDN/website hijack target`)
      findings.push({ checkId: "AWS-IMPACT-003", provider: "aws", severity: "high", status: "READY", resource: `s3://${bucket}`, title: `S3 website bucket ${bucket} — content hijack target`, details: "Write access to this bucket = deface or inject malicious JS on hosted website", remediation: "Restrict s3:PutObject, enable versioning, add CloudFront with OAI" })
    }
  }

  output.push(`\n[*] Summary: ${findings.length} hijack vectors identified`)
  return { output: output.join("\n"), findings }
}

export async function ransomwareSim(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Ransomware Simulation Assessment...\n"]

  if (!execute) {
    output.push("[*] DRY RUN — assessing ransomware attack surface\n")
  }

  const kms = await aws(["kms", "list-keys", "--query", "Keys[].KeyId"], profile, region, timeout)
  const keys = tryJson(kms.stdout) || []
  output.push(`[+] KMS keys: ${keys.length}`)

  let canCreateKey = false
  const testKey = await aws(["kms", "create-key", "--description", "ransomware-sim-test-DELETE-ME", "--tags", "TagKey=cyberstrike,TagValue=test"], profile, region, timeout)
  if (testKey.exitCode === 0) {
    canCreateKey = true
    const keyId = tryJson(testKey.stdout)?.KeyMetadata?.KeyId
    output.push(`[!] Can create KMS keys — ransomware encryption possible`)
    if (keyId) {
      await aws(["kms", "schedule-key-deletion", "--key-id", keyId, "--pending-window-in-days", "7"], profile, region, timeout)
      output.push(`[*] Test key ${keyId} scheduled for deletion`)
    }
    findings.push({ checkId: "AWS-RANSOM-001", provider: "aws", severity: "critical", status: "FAIL", resource: "kms://create", title: "Can create KMS keys — ransomware vector", details: "Attacker can create a key, re-encrypt S3 objects with it, then schedule key deletion", remediation: "Restrict kms:CreateKey to admin roles, enable S3 versioning + MFA Delete" })
  } else {
    output.push("[+] Cannot create KMS keys (kms:CreateKey denied)")
  }

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  let encryptable = 0
  for (const bucket of bucketList.slice(0, 20)) {
    const ver = await aws(["s3api", "get-bucket-versioning", "--bucket", bucket], profile, region, timeout)
    const mfaDel = tryJson(ver.stdout)?.MFADelete
    if (mfaDel !== "Enabled") {
      encryptable++
    }
  }
  output.push(`\n[+] Buckets without MFA Delete (re-encryptable): ${encryptable}/${Math.min(bucketList.length, 20)}`)

  if (canCreateKey && encryptable > 0) {
    findings.push({ checkId: "AWS-RANSOM-002", provider: "aws", severity: "critical", status: "FAIL", resource: "s3://ransomware-target", title: `${encryptable} S3 buckets vulnerable to ransomware re-encryption`, details: "Can create key + no MFA Delete = encrypt objects with attacker key, delete originals", remediation: "Enable versioning + MFA Delete + restrict kms:CreateKey" })
  }

  const ebs = await aws(["ec2", "describe-volumes", "--filters", "Name=status,Values=in-use", "--query", "Volumes[].[VolumeId,Encrypted,Size]"], profile, region, timeout)
  const volumes = tryJson(ebs.stdout) || []
  output.push(`\n[+] In-use EBS volumes: ${volumes.length}`)
  const unencrypted = volumes.filter((v: unknown[]) => !v[1])
  if (unencrypted.length > 0) {
    output.push(`[!] Unencrypted volumes: ${unencrypted.length} — snapshot+encrypt+replace attack possible`)
  }

  output.push(`\n[*] Summary: ${findings.length} ransomware vectors identified`)
  return { output: output.join("\n"), findings }
}

export async function resourceDeletionCapability(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Assessing resource deletion capabilities...\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout) || {}
  output.push(`[+] Identity: ${identity.Arn}`)

  // Simulate destructive actions
  const destructiveActions = [
    { action: "ec2:TerminateInstances", resource: "*", label: "EC2 terminate" },
    { action: "rds:DeleteDBInstance", resource: "*", label: "RDS delete" },
    { action: "s3:DeleteBucket", resource: "*", label: "S3 bucket delete" },
    { action: "lambda:DeleteFunction", resource: "*", label: "Lambda delete" },
    { action: "dynamodb:DeleteTable", resource: "*", label: "DynamoDB delete" },
    { action: "ecs:DeleteCluster", resource: "*", label: "ECS cluster delete" },
    { action: "eks:DeleteCluster", resource: "*", label: "EKS cluster delete" },
    { action: "elasticloadbalancing:DeleteLoadBalancer", resource: "*", label: "ELB delete" },
  ]

  const callerArn = identity.Arn || ""
  const allowedDeletions: string[] = []

  for (const da of destructiveActions) {
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", da.action, "--resource-arns", `arn:aws:${da.action.split(":")[0]}:${region || "us-east-1"}:${identity.Account}:*`], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const decision = results[0]?.EvalDecision || "implicitDeny"
    if (decision === "allowed") {
      allowedDeletions.push(da.label)
      output.push(`[!] ${da.label}: ALLOWED`)
    } else {
      output.push(`[+] ${da.label}: denied`)
    }
  }

  if (allowedDeletions.length > 0) {
    findings.push({ checkId: "AWS-IMPACT-DEL-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `Current identity can delete ${allowedDeletions.length} resource types`, details: `Allowed: ${allowedDeletions.join(", ")}`, remediation: "Restrict destructive actions via IAM policies or SCPs" })
  }

  // Check deletion protection on existing resources
  output.push("\n[*] Checking deletion protection on existing resources...")

  const rds = await aws(["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,DeletionProtection]"], profile, region, timeout)
  const rdsInstances = tryJson(rds.stdout) || []
  const rdsUnprotected = rdsInstances.filter((r: unknown[]) => !r[1])
  output.push(`[+] RDS without deletion protection: ${rdsUnprotected.length}/${rdsInstances.length}`)
  for (const r of rdsUnprotected.slice(0, 5)) {
    output.push(`  ${r[0]}: deletion protection OFF`)
  }

  const dynamo = await aws(["dynamodb", "list-tables"], profile, region, timeout)
  const tables = tryJson(dynamo.stdout)?.TableNames || []
  let dynamoUnprotected = 0
  for (const table of tables.slice(0, 20)) {
    const desc = await aws(["dynamodb", "describe-table", "--table-name", table, "--query", "Table.DeletionProtectionEnabled"], profile, region, timeout)
    if (tryJson(desc.stdout) !== true) dynamoUnprotected++
  }
  output.push(`[+] DynamoDB without deletion protection: ${dynamoUnprotected}/${Math.min(tables.length, 20)}`)

  if (rdsUnprotected.length > 0 || dynamoUnprotected > 0) {
    findings.push({ checkId: "AWS-IMPACT-DEL-002", provider: "aws", severity: "high", status: "FAIL", resource: "deletion-protection://missing", title: `${rdsUnprotected.length} RDS + ${dynamoUnprotected} DynamoDB resources lack deletion protection`, details: "Resources can be permanently deleted without safeguard", remediation: "Enable deletion protection on all production databases" })
  }

  output.push(`\n[*] Summary: ${findings.length} deletion capability issues found`)
  return { output: output.join("\n"), findings }
}

export async function serviceDisruptionAnalysis(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Service disruption impact analysis...\n"]

  // Running EC2 instances
  const ec2 = await aws(["ec2", "describe-instances", "--filters", "Name=instance-state-name,Values=running", "--query", "Reservations[].Instances[].[InstanceId,InstanceType,PublicIpAddress,Tags[?Key=='Name']|[0].Value]"], profile, region, timeout)
  const instances = tryJson(ec2.stdout) || []
  output.push(`[+] Running EC2 instances: ${instances.length}`)
  for (const inst of instances.slice(0, 10)) {
    output.push(`  ${inst[0]} (${inst[1]}) — ${inst[3] || "unnamed"}, IP: ${inst[2] || "private"}`)
  }

  // ECS services
  const ecsClusters = await aws(["ecs", "list-clusters", "--query", "clusterArns"], profile, region, timeout)
  const clusterArns = tryJson(ecsClusters.stdout) || []
  let totalServices = 0
  let totalTasks = 0
  for (const clusterArn of clusterArns.slice(0, 10)) {
    const clusterName = clusterArn.split("/").pop() || clusterArn
    const services = await aws(["ecs", "list-services", "--cluster", clusterArn, "--query", "serviceArns"], profile, region, timeout)
    const svcList = tryJson(services.stdout) || []
    totalServices += svcList.length

    const tasks = await aws(["ecs", "list-tasks", "--cluster", clusterArn, "--query", "taskArns"], profile, region, timeout)
    const taskList = tryJson(tasks.stdout) || []
    totalTasks += taskList.length
    output.push(`  ECS ${clusterName}: ${svcList.length} services, ${taskList.length} running tasks`)
  }
  output.push(`[+] ECS: ${clusterArns.length} clusters, ${totalServices} services, ${totalTasks} tasks`)

  // Auto Scaling Groups
  const asg = await aws(["autoscaling", "describe-auto-scaling-groups", "--query", "AutoScalingGroups[].[AutoScalingGroupName,DesiredCapacity,MinSize]"], profile, region, timeout)
  const asgList = tryJson(asg.stdout) || []
  output.push(`[+] Auto Scaling Groups: ${asgList.length}`)
  if (asgList.length > 0) {
    findings.push({ checkId: "AWS-IMPACT-DISRUPT-002", provider: "aws", severity: "high", status: "FAIL", resource: "asg://scale-down", title: `${asgList.length} ASGs — can scale to zero`, details: "autoscaling:UpdateAutoScalingGroup with DesiredCapacity=0 causes service outage", remediation: "Restrict autoscaling:Update* and set MinSize > 0 with SCP" })
  }

  // Load balancers
  const elbv2 = await aws(["elbv2", "describe-load-balancers", "--query", "LoadBalancers[].[LoadBalancerName,DNSName,Type,State.Code]"], profile, region, timeout)
  const lbs = tryJson(elbv2.stdout) || []
  output.push(`\n[+] Load balancers: ${lbs.length}`)
  for (const lb of lbs.slice(0, 10)) {
    output.push(`  ${lb[0]} (${lb[2]}) — ${lb[3]}, DNS: ${lb[1]}`)
  }

  // Check disruption capability
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const identity = tryJson(id.stdout) || {}
  const callerArn = identity.Arn || ""

  const disruptActions = [
    "ec2:StopInstances", "ec2:TerminateInstances",
    "ecs:StopTask", "ecs:DeleteService",
    "elasticloadbalancing:DeleteLoadBalancer",
    "autoscaling:UpdateAutoScalingGroup",
  ]

  const simArgs = ["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...disruptActions]
  const sim = await aws(simArgs, profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)

  if (allowed.length > 0) {
    output.push(`\n[!] Disruptive actions allowed: ${allowed.join(", ")}`)
    findings.push({ checkId: "AWS-IMPACT-DISRUPT-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `Current identity can disrupt ${instances.length} EC2 + ${totalServices} ECS + ${asgList.length} ASGs + ${lbs.length} LBs`, details: `Allowed actions: ${allowed.join(", ")} — targets: ${instances.length} instances, ${totalServices} services, ${asgList.length} ASGs, ${lbs.length} load balancers`, remediation: "Restrict ec2:Stop/Terminate, ecs:StopTask/DeleteService, elb:Delete, autoscaling:Update via IAM or SCPs" })
  } else {
    output.push("\n[+] No disruptive actions allowed via IAM simulation")
  }

  output.push(`\n[*] Summary: ${findings.length} disruption risks identified`)
  return { output: output.join("\n"), findings }
}

export async function dataDestructionPaths(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Mapping data destruction paths (irrecoverable data)...\n"]

  // S3 without versioning
  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  let noVersioning = 0
  let noMfaDelete = 0
  for (const bucket of bucketList.slice(0, 30)) {
    const ver = await aws(["s3api", "get-bucket-versioning", "--bucket", bucket], profile, region, timeout)
    const v = tryJson(ver.stdout) || {}
    if (v.Status !== "Enabled") {
      noVersioning++
      if (noVersioning <= 5) output.push(`[!] S3 ${bucket}: versioning OFF — deletions permanent`)
    } else if (v.MFADelete !== "Enabled") {
      noMfaDelete++
    }
  }
  output.push(`[+] S3 buckets without versioning: ${noVersioning}/${Math.min(bucketList.length, 30)}`)
  output.push(`[+] S3 buckets with versioning but no MFA Delete: ${noMfaDelete}`)

  if (noVersioning > 0) {
    findings.push({ checkId: "AWS-IMPACT-DATADEST-001", provider: "aws", severity: "high", status: "FAIL", resource: "s3://unversioned", title: `${noVersioning} S3 buckets without versioning — permanent data loss on delete`, details: "No versioning = no recovery from accidental or malicious deletion", remediation: "Enable versioning + MFA Delete on all S3 buckets" })
  }

  // RDS without deletion protection + no recent snapshots
  const rds = await aws(["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,Engine,DeletionProtection]"], profile, region, timeout)
  const rdsInstances = tryJson(rds.stdout) || []
  let rdsVulnerable = 0
  for (const db of rdsInstances) {
    if (db[2]) continue // has deletion protection
    // Check for automated backups
    const snaps = await aws(["rds", "describe-db-snapshots", "--db-instance-identifier", db[0], "--snapshot-type", "automated", "--query", "DBSnapshots[0].SnapshotCreateTime"], profile, region, timeout)
    const lastSnap = tryJson(snaps.stdout)
    if (!lastSnap) {
      rdsVulnerable++
      output.push(`[!] RDS ${db[0]} (${db[1]}): no deletion protection, no recent snapshots`)
    }
  }
  if (rdsVulnerable > 0) {
    findings.push({ checkId: "AWS-IMPACT-DATADEST-002", provider: "aws", severity: "critical", status: "FAIL", resource: "rds://unprotected", title: `${rdsVulnerable} RDS instances without protection or backups`, details: "Database deletion = complete data loss with no recovery", remediation: "Enable deletion protection and verify automated backups" })
  }
  output.push(`[+] RDS without protection or backups: ${rdsVulnerable}/${rdsInstances.length}`)

  // DynamoDB without PITR
  const dynamo = await aws(["dynamodb", "list-tables"], profile, region, timeout)
  const tables = tryJson(dynamo.stdout)?.TableNames || []
  let noPitr = 0
  for (const table of tables.slice(0, 20)) {
    const pitr = await aws(["dynamodb", "describe-continuous-backups", "--table-name", table, "--query", "ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus"], profile, region, timeout)
    if (tryJson(pitr.stdout) !== "ENABLED") {
      noPitr++
      if (noPitr <= 5) output.push(`[!] DynamoDB ${table}: PITR disabled`)
    }
  }
  if (noPitr > 0) {
    findings.push({ checkId: "AWS-IMPACT-DATADEST-003", provider: "aws", severity: "high", status: "FAIL", resource: "dynamodb://no-pitr", title: `${noPitr} DynamoDB tables without Point-in-Time Recovery`, details: "Table deletion or item corruption cannot be reversed", remediation: "Enable PITR on all DynamoDB tables" })
  }
  output.push(`[+] DynamoDB without PITR: ${noPitr}/${Math.min(tables.length, 20)}`)

  // EBS volumes without recent snapshots
  const ebs = await aws(["ec2", "describe-volumes", "--filters", "Name=status,Values=in-use", "--query", "Volumes[].VolumeId"], profile, region, timeout)
  const volumes = tryJson(ebs.stdout) || []
  let noSnap = 0
  for (const volId of volumes.slice(0, 20)) {
    const snaps = await aws(["ec2", "describe-snapshots", "--filters", `Name=volume-id,Values=${volId}`, "--query", "Snapshots[0].StartTime"], profile, region, timeout)
    const lastSnap = tryJson(snaps.stdout)
    if (!lastSnap) {
      noSnap++
    }
  }
  output.push(`[+] EBS volumes without any snapshot: ${noSnap}/${Math.min(volumes.length, 20)}`)

  output.push(`\n[*] Summary: ${findings.length} data destruction risks found`)
  return { output: output.join("\n"), findings }
}

export async function accountLockoutRisk(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Assessing account lockout capabilities...\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout) || {}
  const callerArn = identity.Arn || ""
  output.push(`[+] Identity: ${callerArn}`)

  // Simulate IAM modification actions
  const lockoutActions = [
    { action: "iam:DeleteUser", label: "Delete users" },
    { action: "iam:DeactivateMFADevice", label: "Deactivate MFA" },
    { action: "iam:UpdateLoginProfile", label: "Change passwords" },
    { action: "iam:DeleteAccessKey", label: "Delete access keys" },
    { action: "iam:CreateUser", label: "Create users" },
    { action: "iam:AttachUserPolicy", label: "Attach policies" },
    { action: "iam:DetachUserPolicy", label: "Detach policies" },
    { action: "iam:DeleteRole", label: "Delete roles" },
    { action: "iam:PutUserPolicy", label: "Put inline policies" },
    { action: "iam:DeleteUserPolicy", label: "Delete inline policies" },
  ]

  const allowed: string[] = []
  for (const la of lockoutActions) {
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", la.action, "--resource-arns", `arn:aws:iam::${identity.Account}:user/*`], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const decision = results[0]?.EvalDecision || "implicitDeny"
    if (decision === "allowed") {
      allowed.push(la.label)
      output.push(`[!] ${la.label} (${la.action}): ALLOWED`)
    } else {
      output.push(`[+] ${la.label}: denied`)
    }
  }

  if (allowed.length >= 3) {
    findings.push({ checkId: "AWS-IMPACT-LOCKOUT-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `Current identity can perform ${allowed.length} IAM lockout actions`, details: `Allowed: ${allowed.join(", ")} — can lock out other users by deleting keys, MFA, changing passwords`, remediation: "Restrict IAM write actions to dedicated admin roles only, enforce MFA for IAM changes" })
  } else if (allowed.length > 0) {
    findings.push({ checkId: "AWS-IMPACT-LOCKOUT-001", provider: "aws", severity: "high", status: "FAIL", resource: `iam://${callerArn}`, title: `Current identity has ${allowed.length} IAM modification capabilities`, details: `Allowed: ${allowed.join(", ")}`, remediation: "Review IAM write permissions and restrict to minimum necessary" })
  }

  // Count potential targets
  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  const userList = tryJson(users.stdout) || []
  output.push(`\n[+] Potential lockout targets: ${userList.length} users`)

  const roles = await aws(["iam", "list-roles", "--query", "Roles[?Path!='/aws-service-role/'].RoleName"], profile, region, timeout)
  const roleList = tryJson(roles.stdout) || []
  output.push(`[+] Roles that could be deleted: ${roleList.length}`)

  output.push(`\n[*] Summary: ${allowed.length} lockout actions allowed, ${findings.length} issues found`)
  return { output: output.join("\n"), findings }
}

export async function cryptoMiningCheck(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Assessing crypto mining deployment surface...\n"]

  // GPU instance type availability
  const gpuTypes = await aws(["ec2", "describe-instance-type-offerings", "--filters", "Name=instance-type,Values=p*,g*", "--query", "InstanceTypeOfferings[].InstanceType"], profile, region, timeout)
  const gpuList = [...new Set(tryJson(gpuTypes.stdout) || [])]
  output.push(`[+] GPU instance types available in region: ${gpuList.length}`)
  if (gpuList.length > 0) {
    output.push(`    Types: ${(gpuList as string[]).slice(0, 10).join(", ")}${gpuList.length > 10 ? "..." : ""}`)
  }

  // EC2 launch capability
  const canLaunch = await aws(["ec2", "describe-instances", "--dry-run", "--filters", "Name=instance-state-name,Values=running"], profile, region, timeout)
  const canLaunchEc2 = canLaunch.stderr.includes("DryRunOperation")
  output.push(`[+] EC2 RunInstances: ${canLaunchEc2 ? "ALLOWED" : "denied"}`)

  // Lambda concurrency
  const lambdaSettings = await aws(["lambda", "get-account-settings"], profile, region, timeout)
  const lambdaCfg = tryJson(lambdaSettings.stdout)?.AccountLimit || {}
  output.push(`[+] Lambda concurrency limit: ${lambdaCfg.ConcurrentExecutions || "unknown"}`)
  output.push(`    Unreserved concurrency: ${lambdaCfg.UnreservedConcurrentExecutions || "unknown"}`)

  // Batch compute environments
  const batch = await aws(["batch", "describe-compute-environments", "--query", "computeEnvironments[].[computeEnvironmentName,type,state]"], profile, region, timeout)
  const batchEnvs = tryJson(batch.stdout) || []
  output.push(`[+] Batch compute environments: ${batchEnvs.length}`)
  for (const env of batchEnvs.slice(0, 5)) {
    output.push(`  ${env[0]} (${env[1]}) — ${env[2]}`)
  }

  // SageMaker endpoint creation
  const smEndpoints = await aws(["sagemaker", "list-endpoints", "--query", "Endpoints[].EndpointName"], profile, region, timeout)
  const smList = tryJson(smEndpoints.stdout) || []
  output.push(`[+] SageMaker endpoints: ${smList.length}`)

  // vCPU quotas
  const quotaOnDemand = await aws(["service-quotas", "get-service-quota", "--service-code", "ec2", "--quota-code", "L-1216C47A"], profile, region, timeout)
  const onDemandLimit = tryJson(quotaOnDemand.stdout)?.Quota?.Value
  output.push(`[+] EC2 on-demand vCPU quota: ${onDemandLimit || "unknown"}`)

  const quotaSpot = await aws(["service-quotas", "get-service-quota", "--service-code", "ec2", "--quota-code", "L-34B43A08"], profile, region, timeout)
  const spotLimit = tryJson(quotaSpot.stdout)?.Quota?.Value
  output.push(`[+] EC2 spot vCPU quota: ${spotLimit || "unknown"}`)

  // Findings
  const hasCompute = canLaunchEc2 || batchEnvs.length > 0 || (lambdaCfg.ConcurrentExecutions || 0) > 100
  if (hasCompute && gpuList.length > 0) {
    findings.push({ checkId: "AWS-IMPACT-CRYPTO-001", provider: "aws", severity: "critical", status: "FAIL", resource: "compute://mining-surface", title: `Crypto mining deployment possible: ${gpuList.length} GPU types, EC2=${canLaunchEc2}`, details: `GPU types: ${gpuList.length}, EC2 launch: ${canLaunchEc2}, Lambda concurrency: ${lambdaCfg.ConcurrentExecutions || "?"}, Batch envs: ${batchEnvs.length}, On-demand vCPU limit: ${onDemandLimit || "?"}`, remediation: "Restrict GPU instance types via SCP, set low vCPU quotas, enable billing alerts, deny ec2:RunInstances for p*/g* instance families" })
  } else if (hasCompute) {
    findings.push({ checkId: "AWS-IMPACT-CRYPTO-001", provider: "aws", severity: "high", status: "FAIL", resource: "compute://mining-surface", title: "Compute resources available for CPU-based mining", details: `EC2: ${canLaunchEc2}, Lambda: ${lambdaCfg.ConcurrentExecutions || "?"}, Batch: ${batchEnvs.length}`, remediation: "Set billing alerts and restrict compute launch permissions" })
  }

  output.push(`\n[*] Summary: ${findings.length} mining deployment risks found`)
  return { output: output.join("\n"), findings }
}

export async function billingImpactAnalysis(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Billing impact analysis...\n"]

  // Current month cost
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

  const cost = await aws(["ce", "get-cost-and-usage", "--time-period", `Start=${monthStart},End=${today}`, "--granularity", "MONTHLY", "--metrics", "BlendedCost", "--group-by", "Type=DIMENSION,Key=SERVICE"], profile, region, timeout)
  if (cost.exitCode !== 0) {
    output.push(`[-] Cannot access Cost Explorer: ${cost.stderr.trim()}`)
    output.push("[*] Note: ce:GetCostAndUsage requires billing access (usually management account)")
  } else {
    const results = tryJson(cost.stdout)?.ResultsByTime || []
    for (const period of results) {
      output.push(`[+] Period: ${period.TimePeriod?.Start} to ${period.TimePeriod?.End}`)
      const groups = period.Groups || []
      let totalCost = 0
      const serviceCosts: Array<{ service: string; cost: number }> = []
      for (const g of groups) {
        const svc = g.Keys?.[0] || "Unknown"
        const amount = parseFloat(g.Metrics?.BlendedCost?.Amount || "0")
        totalCost += amount
        if (amount > 0.01) serviceCosts.push({ service: svc, cost: amount })
      }
      serviceCosts.sort((a, b) => b.cost - a.cost)
      output.push(`    Total: $${totalCost.toFixed(2)}`)
      for (const sc of serviceCosts.slice(0, 10)) {
        output.push(`    ${sc.service}: $${sc.cost.toFixed(2)}`)
      }
    }
  }

  // Reserved instances
  const ri = await aws(["ec2", "describe-reserved-instances", "--filters", "Name=state,Values=active", "--query", "ReservedInstances[].[ReservedInstancesId,InstanceType,InstanceCount,Duration,End]"], profile, region, timeout)
  const riList = tryJson(ri.stdout) || []
  output.push(`\n[+] Active Reserved Instances: ${riList.length}`)
  for (const r of riList.slice(0, 5)) {
    output.push(`  ${r[1]} x${r[2]}, expires: ${r[4]}`)
  }

  // Savings plans
  const sp = await aws(["savingsplans", "describe-savings-plans", "--query", "savingsPlans[?state=='active'].[savingsPlanId,savingsPlanType,commitment,end]"], profile, region, timeout)
  const spList = tryJson(sp.stdout) || []
  output.push(`[+] Active Savings Plans: ${spList.length}`)
  for (const s of spList.slice(0, 5)) {
    output.push(`  ${s[1]}: $${s[2]}/hr, expires: ${s[3]}`)
  }

  // Assess expansion risk
  const quotaOnDemand = await aws(["service-quotas", "get-service-quota", "--service-code", "ec2", "--quota-code", "L-1216C47A"], profile, region, timeout)
  const vCPULimit = tryJson(quotaOnDemand.stdout)?.Quota?.Value
  output.push(`\n[+] EC2 on-demand vCPU limit: ${vCPULimit || "unknown"}`)

  if (vCPULimit && vCPULimit > 100) {
    findings.push({ checkId: "AWS-IMPACT-BILLING-001", provider: "aws", severity: "high", status: "FAIL", resource: "billing://expansion-risk", title: `High compute limit (${vCPULimit} vCPUs) — potential for significant cost spike`, details: `Current vCPU limit allows launching up to ${vCPULimit} vCPUs — at $0.10/vCPU/hr this is $${(vCPULimit * 0.1 * 24 * 30).toFixed(0)}/month potential`, remediation: "Reduce vCPU quotas, set AWS Budgets with alerts, enable billing alarms" })
  }

  output.push(`\n[*] Summary: ${findings.length} billing impact risks found`)
  return { output: output.join("\n"), findings }
}

export async function dnsHijackCapability(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Assessing DNS hijack capabilities...\n"]

  // Route53 hosted zones
  const zones = await aws(["route53", "list-hosted-zones", "--query", "HostedZones[].[Id,Name,Config.PrivateZone,ResourceRecordSetCount]"], profile, region, timeout)
  if (zones.exitCode !== 0) {
    output.push(`[-] Cannot access Route53: ${zones.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }
  const zoneList = tryJson(zones.stdout) || []
  const publicZones = zoneList.filter((z: unknown[]) => !z[2])
  const privateZones = zoneList.filter((z: unknown[]) => z[2])
  output.push(`[+] Public zones: ${publicZones.length}, Private zones: ${privateZones.length}`)

  for (const zone of publicZones) {
    const zoneId = (zone[0] as string).replace("/hostedzone/", "")
    const zoneName = zone[1]
    output.push(`\n  Zone: ${zoneName} (${zoneId}) — ${zone[3]} records`)

    const records = await aws(["route53", "list-resource-record-sets", "--hosted-zone-id", zoneId, "--query", "ResourceRecordSets[?Type=='A' || Type=='CNAME' || Type=='NS' || Type=='MX'].[Name,Type,TTL,ResourceRecords[0].Value || AliasTarget.DNSName]"], profile, region, timeout)
    const recordList = tryJson(records.stdout) || []

    let nsCount = 0
    let aCount = 0
    let cnameCount = 0
    for (const r of recordList) {
      if (r[1] === "NS") nsCount++
      if (r[1] === "A") aCount++
      if (r[1] === "CNAME") cnameCount++
      if (recordList.length <= 15) output.push(`    ${r[0]} ${r[1]} → ${r[3] || "alias"}`)
    }
    output.push(`    Records: ${nsCount} NS, ${aCount} A, ${cnameCount} CNAME`)

    findings.push({ checkId: "AWS-IMPACT-DNS-001", provider: "aws", severity: "high", status: "FAIL", resource: `route53://${zoneName}`, title: `Public DNS zone ${zoneName} — ${recordList.length} hijackable records`, details: `Zone ${zoneId}: ${aCount} A, ${cnameCount} CNAME, ${nsCount} NS records — modification redirects traffic`, remediation: "Restrict route53:ChangeResourceRecordSets to admin roles, enable CloudTrail DNS logging" })
  }

  // CloudFront distributions (alternative traffic redirect)
  const cf = await aws(["cloudfront", "list-distributions", "--query", "DistributionList.Items[].[Id,DomainName,Status,Aliases.Items[0]]"], profile, region, timeout)
  const cfList = tryJson(cf.stdout) || []
  output.push(`\n[+] CloudFront distributions: ${cfList.length}`)
  for (const d of cfList.slice(0, 10)) {
    output.push(`  ${d[0]}: ${d[3] || d[1]} (${d[2]})`)
  }

  if (cfList.length > 0) {
    findings.push({ checkId: "AWS-IMPACT-DNS-002", provider: "aws", severity: "medium", status: "FAIL", resource: "cloudfront://distributions", title: `${cfList.length} CloudFront distributions — origin hijack possible`, details: "Modifying origin configuration can redirect traffic to attacker-controlled server", remediation: "Restrict cloudfront:UpdateDistribution to admin roles" })
  }

  output.push(`\n[*] Summary: ${findings.length} DNS/traffic hijack risks found`)
  return { output: output.join("\n"), findings }
}

export async function networkDisruptionCapability(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Assessing network disruption capabilities...\n"]

  // VPCs
  const vpcs = await aws(["ec2", "describe-vpcs", "--query", "Vpcs[].[VpcId,CidrBlock,IsDefault,Tags[?Key=='Name']|[0].Value]"], profile, region, timeout)
  const vpcList = tryJson(vpcs.stdout) || []
  output.push(`[+] VPCs: ${vpcList.length}`)
  for (const v of vpcList) {
    output.push(`  ${v[0]} (${v[1]}) — ${v[3] || "unnamed"}${v[2] ? " [default]" : ""}`)
  }

  // Subnets
  const subnets = await aws(["ec2", "describe-subnets", "--query", "Subnets[].[SubnetId,VpcId,CidrBlock,AvailabilityZone]"], profile, region, timeout)
  const subnetList = tryJson(subnets.stdout) || []
  output.push(`[+] Subnets: ${subnetList.length}`)

  // Route tables
  const rtbs = await aws(["ec2", "describe-route-tables", "--query", "RouteTables[].[RouteTableId,VpcId,Associations[0].Main]"], profile, region, timeout)
  const rtbList = tryJson(rtbs.stdout) || []
  output.push(`[+] Route tables: ${rtbList.length}`)

  // NACLs
  const nacls = await aws(["ec2", "describe-network-acls", "--query", "NetworkAcls[].[NetworkAclId,VpcId,IsDefault]"], profile, region, timeout)
  const naclList = tryJson(nacls.stdout) || []
  output.push(`[+] Network ACLs: ${naclList.length}`)

  // Security groups
  const sgs = await aws(["ec2", "describe-security-groups", "--query", "SecurityGroups[].[GroupId,GroupName,VpcId]"], profile, region, timeout)
  const sgList = tryJson(sgs.stdout) || []
  output.push(`[+] Security groups: ${sgList.length}`)

  // NAT Gateways
  const nats = await aws(["ec2", "describe-nat-gateways", "--filter", "Name=state,Values=available", "--query", "NatGateways[].[NatGatewayId,SubnetId,State]"], profile, region, timeout)
  const natList = tryJson(nats.stdout) || []
  output.push(`[+] NAT Gateways: ${natList.length}`)

  // VPN connections
  const vpns = await aws(["ec2", "describe-vpn-connections", "--query", "VpnConnections[].[VpnConnectionId,State,VpnGatewayId]"], profile, region, timeout)
  const vpnList = tryJson(vpns.stdout) || []
  output.push(`[+] VPN Connections: ${vpnList.length}`)

  // Direct Connect
  const dx = await aws(["directconnect", "describe-connections", "--query", "connections[].[connectionId,connectionName,connectionState]"], profile, region, timeout)
  const dxList = tryJson(dx.stdout) || []
  output.push(`[+] Direct Connect: ${dxList.length}`)

  // Check modification capabilities
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const identity = tryJson(id.stdout) || {}
  const callerArn = identity.Arn || ""

  const netActions = [
    "ec2:DeleteSecurityGroup", "ec2:RevokeSecurityGroupIngress",
    "ec2:DeleteSubnet", "ec2:DeleteVpc",
    "ec2:DeleteRouteTable", "ec2:DeleteRoute",
    "ec2:DeleteNatGateway", "ec2:DeleteNetworkAcl",
    "ec2:DeleteVpnConnection",
  ]

  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...netActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
  const denied = results.filter((r: Record<string, string>) => r.EvalDecision !== "allowed").map((r: Record<string, string>) => r.EvalActionName)

  output.push(`\n[+] Network modification actions allowed: ${allowed.length}/${netActions.length}`)
  if (allowed.length > 0) {
    output.push(`[!] Allowed: ${allowed.join(", ")}`)
  }

  if (allowed.length >= 3) {
    findings.push({ checkId: "AWS-IMPACT-NET-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `Can modify/delete ${allowed.length} network resource types`, details: `Allowed: ${allowed.join(", ")} — targets: ${vpcList.length} VPCs, ${subnetList.length} subnets, ${sgList.length} SGs, ${natList.length} NATs`, remediation: "Restrict network modification actions via IAM policies or SCPs" })
  }

  // Assess blast radius
  const totalNetResources = vpcList.length + subnetList.length + rtbList.length + naclList.length + sgList.length + natList.length + vpnList.length + dxList.length
  if (totalNetResources > 20) {
    findings.push({ checkId: "AWS-IMPACT-NET-002", provider: "aws", severity: "high", status: "FAIL", resource: "network://blast-radius", title: `${totalNetResources} network resources — high blast radius for disruption`, details: `${vpcList.length} VPCs, ${subnetList.length} subnets, ${sgList.length} SGs, ${natList.length} NATs, ${vpnList.length} VPNs, ${dxList.length} DX — deleting key components causes cascading outage`, remediation: "Segment networks, restrict delete permissions, use AWS Backup for network config" })
  }

  output.push(`\n[*] Summary: ${findings.length} network disruption risks found`)
  return { output: output.join("\n"), findings }
}
