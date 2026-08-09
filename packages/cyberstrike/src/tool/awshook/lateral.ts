import { aws, argVal, hasFlag, tryJson } from "./shared"
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

  if (!task && !allTasks) {
    const r = await aws(["ecs", "list-clusters", "--query", "clusterArns"], profile, region, timeout)
    if (r.exitCode === 0) {
      const clusters = tryJson(r.stdout) || []
      const output = [`[*] ECS Clusters: ${clusters.length}\n`]
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
      return { output: output.join("\n"), findings }
    }
    return { output: "[-] Cannot list clusters", findings }
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

  const output = [`[*] ECS Exec — cluster: ${cluster}, targets: ${targetTasks.length}\n`]

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

  return { output: output.join("\n"), findings }
}

export async function crossAccountEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cross-Account Trust Enumeration\n"]

  const id = await aws(["sts", "get-caller-identity", "--query", "Account"], profile, region, timeout)
  const currentAccount = tryJson(id.stdout)
  output.push(`[+] Current account: ${currentAccount}\n`)

  const roles = await aws(
    ["iam", "list-roles", "--query", "Roles[].[RoleName,Arn]"],
    profile,
    region,
    timeout,
  )
  if (roles.exitCode !== 0) return { output: `[-] Cannot list roles: ${roles.stderr.trim()}`, findings }

  const rl = tryJson(roles.stdout) || []
  const crossAccountRoles: { name: string; arn: string; trusts: string[] }[] = []

  for (const r of rl) {
    const desc = await aws(["iam", "get-role", "--role-name", r[0], "--query", "Role.AssumeRolePolicyDocument"], profile, region, timeout)
    if (desc.exitCode !== 0) continue
    const trust = tryJson(desc.stdout)
    const statements = trust?.Statement || []
    for (const st of statements) {
      if (st.Effect !== "Allow") continue
      const principals = Array.isArray(st.Principal?.AWS) ? st.Principal.AWS : st.Principal?.AWS ? [st.Principal.AWS] : []
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

  return { output: output.join("\n"), findings }
}

export async function vpcPeeringEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] VPC Peering Enumeration for Lateral Movement\n"]

  const peerings = await aws(
    ["ec2", "describe-vpc-peering-connections"],
    profile,
    region,
    timeout,
  )
  if (peerings.exitCode !== 0) return { output: `[-] Cannot describe peering connections: ${peerings.stderr.trim()}`, findings }

  const pl = tryJson(peerings.stdout)?.VpcPeeringConnections || []
  output.push(`[+] VPC Peering Connections: ${pl.length}\n`)

  for (const p of pl) {
    const reqVpc = p.RequesterVpcInfo || {}
    const accVpc = p.AccepterVpcInfo || {}
    output.push(`    ${p.VpcPeeringConnectionId} (${p.Status?.Code})`)
    output.push(`      Requester: ${reqVpc.VpcId} (${reqVpc.CidrBlock}) — account: ${reqVpc.OwnerId} — region: ${reqVpc.Region}`)
    output.push(`      Accepter:  ${accVpc.VpcId} (${accVpc.CidrBlock}) — account: ${accVpc.OwnerId} — region: ${accVpc.Region}`)

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
          ["ec2", "search-transit-gateway-routes", "--transit-gateway-route-table-id", rt[0], "--filters", "Name=state,Values=active"],
          profile,
          region,
          timeout,
        )
        if (routes.exitCode === 0) {
          const routeList = tryJson(routes.stdout)?.Routes || []
          for (const route of routeList.slice(0, 10)) {
            output.push(`          ${route.DestinationCidrBlock} → ${route.Type} (${(route.TransitGatewayAttachments || []).map((a: Record<string, string>) => a.ResourceId).join(",")})`)
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function lightsailExec(args: string[], timeout: number): Promise<HookResult> {
  const instanceName = argVal(args, "--instance-name")
  const command = argVal(args, "--command")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Lightsail Instance Enumeration\n"]
  const findings: Finding[] = []

  const instances = await aws(
    ["lightsail", "get-instances", "--query", "instances[].[name,state.name,publicIpAddress,privateIpAddress,blueprintId,bundleId]"],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode !== 0) return { output: `[-] Cannot list Lightsail instances: ${instances.stderr.trim()}`, findings }

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

  const keyPair = await aws(
    ["lightsail", "download-default-key-pair"],
    profile,
    region,
    timeout,
  )
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
        for (const f of vpcFuncs) output.push(`    ${f[0]} (${f[1]}) — VPC: ${f[3]} — role: ${(f[2] || "").split("/").pop()}`)
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

  return { output: output.join("\n"), findings }
}
