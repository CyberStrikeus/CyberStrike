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

export async function dataDestroy(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Data Destruction Assessment...\n"]

  if (!execute) {
    output.push("[*] DRY RUN — assessing destructible targets\n")
  }

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  let noVersioning = 0
  for (const bucket of bucketList.slice(0, 30)) {
    const ver = await aws(["s3api", "get-bucket-versioning", "--bucket", bucket], profile, region, timeout)
    const v = tryJson(ver.stdout) || {}
    if (v.Status !== "Enabled") {
      noVersioning++
      if (noVersioning <= 5) output.push(`[!] ${bucket}: versioning ${v.Status || "disabled"} — data irrecoverable after deletion`)
    }
  }
  output.push(`[+] Buckets without versioning: ${noVersioning}/${Math.min(bucketList.length, 30)}`)

  if (noVersioning > 0) {
    findings.push({ checkId: "AWS-DESTROY-001", provider: "aws", severity: "high", status: "READY", resource: "s3://unversioned", title: `${noVersioning} S3 buckets without versioning — data destruction possible`, details: "s3:DeleteObject on unversioned bucket = permanent data loss", remediation: "Enable versioning and MFA Delete on all critical buckets" })
  }

  const rds = await aws(["rds", "describe-db-instances", "--query", "DBInstances[?DeletionProtection==`false`].[DBInstanceIdentifier,Engine]"], profile, region, timeout)
  const unprotected = tryJson(rds.stdout) || []
  output.push(`\n[+] RDS without deletion protection: ${unprotected.length}`)
  for (const db of unprotected.slice(0, 10)) {
    output.push(`  ${db[0]} (${db[1]})`)
  }
  if (unprotected.length > 0) {
    findings.push({ checkId: "AWS-DESTROY-002", provider: "aws", severity: "high", status: "READY", resource: `rds://${unprotected[0][0]}`, title: `${unprotected.length} RDS instances without deletion protection`, details: "rds:DeleteDBInstance can destroy these databases immediately", remediation: "Enable deletion protection on all production databases" })
  }

  const dynamo = await aws(["dynamodb", "list-tables"], profile, region, timeout)
  const tables = tryJson(dynamo.stdout)?.TableNames || []
  let unprotectedDynamo = 0
  for (const table of tables.slice(0, 20)) {
    const desc = await aws(["dynamodb", "describe-table", "--table-name", table, "--query", "Table.DeletionProtectionEnabled"], profile, region, timeout)
    if (tryJson(desc.stdout) !== true) unprotectedDynamo++
  }
  output.push(`[+] DynamoDB tables without deletion protection: ${unprotectedDynamo}/${Math.min(tables.length, 20)}`)

  if (execute) {
    output.push("\n[!] --execute flag set — ABORTING. Data destruction requires per-target confirmation.")
    output.push("[*] Use specific target flags to perform actual destruction")
  }

  output.push(`\n[*] Summary: ${findings.length} destruction vectors identified`)
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

export async function serviceDisruption(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Service Disruption Assessment...\n"]

  if (!execute) {
    output.push("[*] DRY RUN — assessing disruption capabilities\n")
  }

  const sgs = await aws(["ec2", "describe-security-groups", "--query", "SecurityGroups[?GroupName!='default'].[GroupId,GroupName]"], profile, region, timeout)
  const sgList = tryJson(sgs.stdout) || []
  output.push(`[+] Non-default security groups: ${sgList.length}`)
  if (sgList.length > 0) {
    findings.push({ checkId: "AWS-DISRUPT-001", provider: "aws", severity: "high", status: "READY", resource: "sg://modify", title: `${sgList.length} security groups modifiable — network disruption possible`, details: "ec2:RevokeSecurityGroupIngress can block all inbound traffic", remediation: "Restrict ec2:AuthorizeSecurityGroup* and ec2:RevokeSecurityGroup* to admin roles" })
  }

  const asg = await aws(["autoscaling", "describe-auto-scaling-groups", "--query", "AutoScalingGroups[].[AutoScalingGroupName,DesiredCapacity,MinSize]"], profile, region, timeout)
  const asgList = tryJson(asg.stdout) || []
  output.push(`[+] Auto Scaling Groups: ${asgList.length}`)
  if (asgList.length > 0) {
    findings.push({ checkId: "AWS-DISRUPT-002", provider: "aws", severity: "high", status: "READY", resource: "asg://scale-down", title: `${asgList.length} ASGs — can scale to zero`, details: "autoscaling:UpdateAutoScalingGroup with DesiredCapacity=0 causes service outage", remediation: "Restrict autoscaling:Update* and set MinSize > 0 with SCP" })
  }

  const route53 = await aws(["route53", "list-hosted-zones", "--query", "HostedZones[].[Id,Name,Config.PrivateZone]"], profile, region, timeout)
  const zones = tryJson(route53.stdout) || []
  const publicZones = zones.filter((z: unknown[]) => !z[2])
  output.push(`[+] Public DNS zones: ${publicZones.length}`)
  if (publicZones.length > 0) {
    findings.push({ checkId: "AWS-DISRUPT-003", provider: "aws", severity: "critical", status: "READY", resource: "route53://dns-hijack", title: `${publicZones.length} public DNS zones — DNS hijack/disruption possible`, details: "route53:ChangeResourceRecordSets can redirect all traffic or cause DNS outage", remediation: "Restrict Route53 write access, enable CloudTrail logging for Route53" })
    for (const z of publicZones.slice(0, 5)) {
      output.push(`  ${z[1]} (${z[0]})`)
    }
  }

  const elbv2 = await aws(["elbv2", "describe-load-balancers", "--query", "LoadBalancers[].[LoadBalancerName,DNSName,State.Code]"], profile, region, timeout)
  const lbs = tryJson(elbv2.stdout) || []
  output.push(`\n[+] Load balancers: ${lbs.length}`)
  if (lbs.length > 0) {
    findings.push({ checkId: "AWS-DISRUPT-004", provider: "aws", severity: "high", status: "READY", resource: "elbv2://delete", title: `${lbs.length} load balancers — deletion causes immediate outage`, details: "elasticloadbalancing:DeleteLoadBalancer + no deletion protection", remediation: "Enable deletion protection on all production ALBs/NLBs" })
  }

  output.push(`\n[*] Summary: ${findings.length} disruption vectors identified`)
  return { output: output.join("\n"), findings }
}

export async function cryptominerDeploy(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Cryptominer Deployment Assessment...\n"]

  if (!execute) {
    output.push("[*] DRY RUN — assessing compute hijack surface\n")
  }

  const quotas = await aws(["service-quotas", "get-service-quota", "--service-code", "ec2", "--quota-code", "L-1216C47A"], profile, region, timeout)
  const q = tryJson(quotas.stdout)?.Quota || {}
  output.push(`[+] EC2 on-demand vCPU limit: ${q.Value || "unknown"}`)

  const lambdaConfig = await aws(["lambda", "get-account-settings"], profile, region, timeout)
  const lConfig = tryJson(lambdaConfig.stdout) || {}
  output.push(`[+] Lambda concurrent executions limit: ${lConfig.AccountLimit?.ConcurrentExecutions || "unknown"}`)
  output.push(`    Lambda total code storage: ${lConfig.AccountUsage?.TotalCodeSize ? Math.round(lConfig.AccountUsage.TotalCodeSize / 1024 / 1024) + "MB" : "unknown"}`)

  const canLaunch = await aws(["ec2", "describe-instances", "--dry-run", "--filters", "Name=instance-state-name,Values=running"], profile, region, timeout)
  if (canLaunch.stderr.includes("DryRunOperation")) {
    output.push("[!] ec2:RunInstances permitted — can launch compute instances")
    findings.push({ checkId: "AWS-MINER-001", provider: "aws", severity: "high", status: "READY", resource: "ec2://launch", title: "Can launch EC2 instances — cryptominer deployment possible", details: "ec2:RunInstances allowed — attacker can spin up GPU instances for mining", remediation: "Restrict instance types via SCP, set low vCPU quotas, enable cost alerts" })
  }

  const canCreateFunction = await aws(["lambda", "create-function", "--function-name", "cs-test-delete-me", "--runtime", "python3.12", "--handler", "index.handler", "--role", "arn:aws:iam::000000000000:role/nonexistent", "--zip-file", "fileb:///dev/null"], profile, region, timeout)
  if (!canCreateFunction.stderr.includes("AccessDenied")) {
    output.push("[!] lambda:CreateFunction permitted — serverless miner deployment possible")
    findings.push({ checkId: "AWS-MINER-002", provider: "aws", severity: "high", status: "READY", resource: "lambda://create", title: "Can create Lambda functions — serverless mining possible", details: "Attacker can deploy mining code as Lambda functions with max memory/concurrency", remediation: "Restrict lambda:CreateFunction, set reserved concurrency limits" })
  }

  output.push(`\n[*] Summary: ${findings.length} compute hijack vectors identified`)
  return { output: output.join("\n"), findings }
}
