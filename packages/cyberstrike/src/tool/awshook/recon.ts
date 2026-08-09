import { aws, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function iamEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] AWS credentials not configured: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout)
  const output = [`[*] AWS IAM Enumeration — Account: ${identity?.Account}`, `[*] Identity: ${identity?.Arn}\n`]

  const users = await aws(["iam", "list-users", "--query", "Users[].[UserName,CreateDate]"], profile, region, timeout)
  if (users.exitCode === 0) {
    const ul = tryJson(users.stdout) || []
    output.push(`[+] IAM Users: ${ul.length}`)
    for (const u of ul) output.push(`    ${u[0]} (created: ${u[1]})`)
  }

  const roles = await aws(["iam", "list-roles", "--query", "Roles[].[RoleName,Arn]"], profile, region, timeout)
  if (roles.exitCode === 0) {
    const rl = tryJson(roles.stdout) || []
    output.push(`[+] IAM Roles: ${rl.length}`)
    for (const r of rl) {
      const rp = await aws(
        ["iam", "list-attached-role-policies", "--role-name", r[0], "--query", "AttachedPolicies[].PolicyArn"],
        profile,
        region,
        timeout,
      )
      const policies = tryJson(rp.stdout) || []
      const hasAdmin = policies.some((p: string) => p.includes("AdministratorAccess"))
      if (hasAdmin) {
        output.push(`    [!] ${r[0]}: AdministratorAccess attached`)
        findings.push({
          checkId: "AWS-ENUM-001",
          provider: "aws",
          severity: "critical",
          status: "FAIL",
          resource: r[1],
          title: `Role with AdministratorAccess: ${r[0]}`,
          details: `${r[0]} has AdministratorAccess policy`,
          remediation: "Replace with least-privilege policy",
        })
      }
    }
  }

  const policies = await aws(
    ["iam", "list-policies", "--scope", "Local", "--query", "Policies[].[PolicyName,Arn]"],
    profile,
    region,
    timeout,
  )
  if (policies.exitCode === 0) {
    const pl = tryJson(policies.stdout) || []
    output.push(`[+] Custom Policies: ${pl.length}`)
    for (const p of pl) {
      const ver = await aws(
        ["iam", "get-policy", "--policy-arn", p[1], "--query", "Policy.DefaultVersionId"],
        profile,
        region,
        timeout,
      )
      const versionId = tryJson(ver.stdout)
      if (versionId) {
        const doc = await aws(
          [
            "iam",
            "get-policy-version",
            "--policy-arn",
            p[1],
            "--version-id",
            versionId,
            "--query",
            "PolicyVersion.Document",
          ],
          profile,
          region,
          timeout,
        )
        const d = tryJson(doc.stdout)
        const statements = Array.isArray(d?.Statement) ? d.Statement : []
        for (const st of statements) {
          if (st.Effect === "Allow" && st.Action === "*" && st.Resource === "*") {
            findings.push({
              checkId: "AWS-ENUM-002",
              provider: "aws",
              severity: "critical",
              status: "FAIL",
              resource: p[1],
              title: `Wildcard policy: ${p[0]}`,
              details: "Allow *:* — full admin equivalent",
              remediation: "Scope down actions and resources",
            })
          }
        }
      }
    }
  }

  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  if (summary.exitCode === 0) {
    const s = tryJson(summary.stdout)?.SummaryMap || {}
    if (s.AccountAccessKeysPresent > 0) {
      findings.push({
        checkId: "AWS-ENUM-003",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "root",
        title: "Root account has access keys",
        details: "Root access keys are active",
        remediation: "Delete root access keys",
      })
    }
    output.push(`\n[*] Account Summary: ${s.Users} users, ${s.Roles} roles, ${s.Groups} groups, ${s.Policies} policies`)
  }

  return { output: output.join("\n"), findings }
}

export async function ec2Enum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] EC2 Enumeration\n"]

  const instances = await aws(
    [
      "ec2",
      "describe-instances",
      "--query",
      "Reservations[].Instances[].[InstanceId,InstanceType,State.Name,PublicIpAddress,PrivateIpAddress,IamInstanceProfile.Arn,KeyName,PlatformDetails]",
    ],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode === 0) {
    const il = tryJson(instances.stdout) || []
    output.push(`[+] EC2 Instances: ${il.length}`)
    for (const i of il) {
      output.push(`    ${i[0]} (${i[1]}) — ${i[2]} — public: ${i[3] || "none"} — private: ${i[4]}`)
      if (i[5]) output.push(`      IAM Profile: ${i[5]}`)
      if (i[6]) output.push(`      Key: ${i[6]}`)
      if (i[3]) {
        findings.push({
          checkId: "AWS-EC2-001",
          provider: "aws",
          severity: "medium",
          status: "FOUND",
          resource: `ec2:${i[0]}`,
          title: `Public EC2 instance: ${i[0]}`,
          details: `Instance ${i[0]} has public IP ${i[3]}`,
          remediation: "Review if public exposure is necessary",
        })
      }
    }
  }

  const sgs = await aws(
    [
      "ec2",
      "describe-security-groups",
      "--query",
      "SecurityGroups[].[GroupId,GroupName,IpPermissions]",
    ],
    profile,
    region,
    timeout,
  )
  if (sgs.exitCode === 0) {
    const sgList = tryJson(sgs.stdout) || []
    output.push(`\n[+] Security Groups: ${sgList.length}`)
    for (const sg of sgList) {
      const perms = sg[2] || []
      for (const p of perms) {
        const ranges = [...(p.IpRanges || []), ...(p.Ipv6Ranges || [])]
        const open = ranges.filter((r: Record<string, string>) => r.CidrIp === "0.0.0.0/0" || r.CidrIpv6 === "::/0")
        if (open.length > 0) {
          const port = p.FromPort === p.ToPort ? `${p.FromPort}` : `${p.FromPort}-${p.ToPort}`
          output.push(`    [!] ${sg[0]} (${sg[1]}): ${port}/${p.IpProtocol} open to world`)
          findings.push({
            checkId: "AWS-EC2-002",
            provider: "aws",
            severity: p.FromPort === 22 || p.FromPort === 3389 ? "critical" : "high",
            status: "FAIL",
            resource: `ec2:sg:${sg[0]}`,
            title: `Security group ${sg[1]} open to world on port ${port}`,
            details: `Port ${port}/${p.IpProtocol} allows 0.0.0.0/0`,
            remediation: "Restrict to specific CIDR ranges",
          })
        }
      }
    }
  }

  const keys = await aws(
    ["ec2", "describe-key-pairs", "--query", "KeyPairs[].[KeyName,KeyPairId,KeyType]"],
    profile,
    region,
    timeout,
  )
  if (keys.exitCode === 0) {
    const kl = tryJson(keys.stdout) || []
    output.push(`\n[+] Key Pairs: ${kl.length}`)
    for (const k of kl) output.push(`    ${k[0]} (${k[1]}) — ${k[2]}`)
  }

  const amis = await aws(
    ["ec2", "describe-images", "--owners", "self", "--query", "Images[].[ImageId,Name,State,Public]"],
    profile,
    region,
    timeout,
  )
  if (amis.exitCode === 0) {
    const al = tryJson(amis.stdout) || []
    output.push(`\n[+] Custom AMIs: ${al.length}`)
    for (const a of al) {
      output.push(`    ${a[0]} — ${a[1]} (${a[2]})${a[3] ? " [PUBLIC]" : ""}`)
      if (a[3]) {
        findings.push({
          checkId: "AWS-EC2-003",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `ec2:ami:${a[0]}`,
          title: `Public AMI: ${a[0]}`,
          details: `AMI ${a[1]} is publicly shared`,
          remediation: "Make AMI private unless intentionally shared",
        })
      }
    }
  }

  const ud = await aws(
    ["ec2", "describe-instances", "--query", "Reservations[].Instances[].[InstanceId]"],
    profile,
    region,
    timeout,
  )
  if (ud.exitCode === 0) {
    const idList = tryJson(ud.stdout) || []
    for (const inst of idList.slice(0, 10)) {
      const udata = await aws(
        ["ec2", "describe-instance-attribute", "--instance-id", inst[0], "--attribute", "userData", "--query", "UserData.Value"],
        profile,
        region,
        timeout,
      )
      if (udata.exitCode === 0) {
        const encoded = tryJson(udata.stdout)
        if (encoded) {
          const decoded = Buffer.from(encoded, "base64").toString("utf-8")
          const secrets = decoded.match(/(password|secret|key|token|api_key)\s*[=:]\s*\S+/gi) || []
          if (secrets.length > 0) {
            output.push(`    [!] ${inst[0]} user-data contains secrets: ${secrets.length} match(es)`)
            findings.push({
              checkId: "AWS-EC2-004",
              provider: "aws",
              severity: "critical",
              status: "FAIL",
              resource: `ec2:${inst[0]}`,
              title: `Secrets in user-data: ${inst[0]}`,
              details: `Found ${secrets.length} potential secret(s) in instance user-data`,
              remediation: "Move secrets to Secrets Manager or SSM Parameter Store",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function s3Enum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] S3 Bucket Enumeration\n"]

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].[Name,CreationDate]"], profile, region, timeout)
  if (buckets.exitCode !== 0) return { output: `[-] Cannot list buckets: ${buckets.stderr.trim()}`, findings }
  const bl = tryJson(buckets.stdout) || []
  output.push(`[+] Buckets: ${bl.length}\n`)

  for (const b of bl) {
    output.push(`[*] ${b[0]} (created: ${b[1]})`)

    const pub = await aws(
      ["s3api", "get-public-access-block", "--bucket", b[0]],
      profile,
      region,
      timeout,
    )
    if (pub.exitCode === 0) {
      const cfg = tryJson(pub.stdout)?.PublicAccessBlockConfiguration || {}
      const allBlocked = cfg.BlockPublicAcls && cfg.IgnorePublicAcls && cfg.BlockPublicPolicy && cfg.RestrictPublicBuckets
      if (!allBlocked) {
        output.push(`    [!] Public access not fully blocked`)
        findings.push({
          checkId: "AWS-S3-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `s3:${b[0]}`,
          title: `S3 bucket public access not fully blocked: ${b[0]}`,
          details: `BlockPublicAcls=${cfg.BlockPublicAcls}, IgnorePublicAcls=${cfg.IgnorePublicAcls}`,
          remediation: "Enable all public access block settings",
        })
      }
    } else if (pub.stderr.includes("NoSuchPublicAccessBlockConfiguration")) {
      output.push(`    [!] No public access block configured`)
      findings.push({
        checkId: "AWS-S3-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `s3:${b[0]}`,
        title: `No public access block: ${b[0]}`,
        details: "Bucket has no public access block configuration",
        remediation: "Enable public access block on bucket",
      })
    }

    const enc = await aws(
      ["s3api", "get-bucket-encryption", "--bucket", b[0]],
      profile,
      region,
      timeout,
    )
    if (enc.exitCode !== 0) {
      output.push(`    [-] No encryption configured`)
      findings.push({
        checkId: "AWS-S3-003",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: `s3:${b[0]}`,
        title: `No encryption: ${b[0]}`,
        details: "Bucket does not have default encryption enabled",
        remediation: "Enable SSE-S3 or SSE-KMS encryption",
      })
    }

    const ver = await aws(
      ["s3api", "get-bucket-versioning", "--bucket", b[0]],
      profile,
      region,
      timeout,
    )
    if (ver.exitCode === 0) {
      const vs = tryJson(ver.stdout)
      if (vs?.Status !== "Enabled") output.push(`    [-] Versioning: ${vs?.Status || "disabled"}`)
    }

    const pol = await aws(["s3api", "get-bucket-policy", "--bucket", b[0]], profile, region, timeout)
    if (pol.exitCode === 0) {
      const doc = tryJson(tryJson(pol.stdout)?.Policy || "{}")
      const statements = doc?.Statement || []
      for (const st of statements) {
        if (st.Effect === "Allow" && st.Principal === "*") {
          output.push(`    [!] Bucket policy allows public access (Principal: *)`)
          findings.push({
            checkId: "AWS-S3-004",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: `s3:${b[0]}`,
            title: `Public bucket policy: ${b[0]}`,
            details: `Bucket policy allows Principal: * — ${(st.Action || []).join(",")}`,
            remediation: "Restrict bucket policy principal",
          })
        }
      }
    }

    const acl = await aws(["s3api", "get-bucket-acl", "--bucket", b[0]], profile, region, timeout)
    if (acl.exitCode === 0) {
      const grants = tryJson(acl.stdout)?.Grants || []
      for (const g of grants) {
        const uri = g.Grantee?.URI || ""
        if (uri.includes("AllUsers") || uri.includes("AuthenticatedUsers")) {
          output.push(`    [!] ACL grants access to ${uri.split("/").pop()}`)
          findings.push({
            checkId: "AWS-S3-005",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: `s3:${b[0]}`,
            title: `Public ACL: ${b[0]}`,
            details: `ACL grants ${g.Permission} to ${uri}`,
            remediation: "Remove public ACL grants",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function lambdaEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Lambda Enumeration\n"]

  const funcs = await aws(
    ["lambda", "list-functions", "--query", "Functions[].[FunctionName,Runtime,Role,CodeSize,LastModified]"],
    profile,
    region,
    timeout,
  )
  if (funcs.exitCode !== 0) return { output: `[-] Cannot list functions: ${funcs.stderr.trim()}`, findings }
  const fl = tryJson(funcs.stdout) || []
  output.push(`[+] Lambda Functions: ${fl.length}\n`)

  for (const f of fl) {
    output.push(`    ${f[0]} (${f[1]}) — role: ${(f[2] || "").split("/").pop()} — ${f[3]} bytes`)

    const cfg = await aws(
      ["lambda", "get-function-configuration", "--function-name", f[0]],
      profile,
      region,
      timeout,
    )
    if (cfg.exitCode === 0) {
      const config = tryJson(cfg.stdout)
      const envVars = config?.Environment?.Variables || {}
      const secretKeys = Object.keys(envVars).filter((k) =>
        /password|secret|key|token|api_key|database_url|conn/i.test(k),
      )
      if (secretKeys.length > 0) {
        output.push(`    [!] Secrets in env vars: ${secretKeys.join(", ")}`)
        for (const k of secretKeys) {
          output.push(`      ${k}=${String(envVars[k]).slice(0, 30)}${String(envVars[k]).length > 30 ? "..." : ""}`)
        }
        findings.push({
          checkId: `AWS-LAMBDA-001`,
          provider: "aws",
          severity: "critical",
          status: "FAIL",
          resource: `lambda:${f[0]}`,
          title: `Secrets in Lambda env vars: ${f[0]}`,
          details: `Found secrets: ${secretKeys.join(", ")}`,
          remediation: "Move secrets to Secrets Manager with dynamic reference",
        })
      }

      if (config?.VpcConfig?.SubnetIds?.length > 0) {
        output.push(`    VPC: ${config.VpcConfig.VpcId} (${config.VpcConfig.SubnetIds.length} subnets)`)
      }
    }
  }

  const layers = await aws(
    ["lambda", "list-layers", "--query", "Layers[].[LayerName,LatestMatchingVersion.LayerVersionArn]"],
    profile,
    region,
    timeout,
  )
  if (layers.exitCode === 0) {
    const ll = tryJson(layers.stdout) || []
    output.push(`\n[+] Lambda Layers: ${ll.length}`)
    for (const l of ll) output.push(`    ${l[0]} — ${l[1]}`)
  }

  const mappings = await aws(
    ["lambda", "list-event-source-mappings", "--query", "EventSourceMappings[].[FunctionArn,EventSourceArn,State]"],
    profile,
    region,
    timeout,
  )
  if (mappings.exitCode === 0) {
    const ml = tryJson(mappings.stdout) || []
    output.push(`\n[+] Event Source Mappings: ${ml.length}`)
    for (const m of ml) output.push(`    ${(m[0] || "").split(":").pop()} ← ${m[1]} (${m[2]})`)
  }

  return { output: output.join("\n"), findings }
}

export async function vpcEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] VPC Enumeration\n"]

  const vpcs = await aws(
    ["ec2", "describe-vpcs", "--query", "Vpcs[].[VpcId,CidrBlock,IsDefault,State]"],
    profile,
    region,
    timeout,
  )
  if (vpcs.exitCode !== 0) return { output: `[-] Cannot describe VPCs: ${vpcs.stderr.trim()}`, findings }
  const vl = tryJson(vpcs.stdout) || []
  output.push(`[+] VPCs: ${vl.length}`)
  for (const v of vl) output.push(`    ${v[0]} — ${v[1]} ${v[2] ? "(default)" : ""} — ${v[3]}`)

  const subnets = await aws(
    ["ec2", "describe-subnets", "--query", "Subnets[].[SubnetId,VpcId,CidrBlock,AvailabilityZone,MapPublicIpOnLaunch]"],
    profile,
    region,
    timeout,
  )
  if (subnets.exitCode === 0) {
    const sl = tryJson(subnets.stdout) || []
    output.push(`\n[+] Subnets: ${sl.length}`)
    for (const s of sl) {
      output.push(`    ${s[0]} (${s[1]}) — ${s[2]} — ${s[3]}${s[4] ? " [AUTO-PUBLIC]" : ""}`)
      if (s[4]) {
        findings.push({
          checkId: "AWS-VPC-001",
          provider: "aws",
          severity: "medium",
          status: "FOUND",
          resource: `vpc:subnet:${s[0]}`,
          title: `Auto-assign public IP: ${s[0]}`,
          details: `Subnet ${s[0]} in ${s[3]} auto-assigns public IPs`,
          remediation: "Disable auto-assign public IP unless required",
        })
      }
    }
  }

  const rtbs = await aws(
    ["ec2", "describe-route-tables", "--query", "RouteTables[].[RouteTableId,VpcId,Routes[].{dest:DestinationCidrBlock,gw:GatewayId,nat:NatGatewayId}]"],
    profile,
    region,
    timeout,
  )
  if (rtbs.exitCode === 0) {
    const rl = tryJson(rtbs.stdout) || []
    output.push(`\n[+] Route Tables: ${rl.length}`)
    for (const r of rl) {
      const routes = r[2] || []
      const hasIgw = routes.some((rt: Record<string, string>) => (rt.gw || "").startsWith("igw-"))
      output.push(`    ${r[0]} (${r[1]}) — ${routes.length} routes${hasIgw ? " [IGW]" : ""}`)
    }
  }

  const nats = await aws(
    ["ec2", "describe-nat-gateways", "--query", "NatGateways[].[NatGatewayId,VpcId,State,NatGatewayAddresses[0].PublicIp]"],
    profile,
    region,
    timeout,
  )
  if (nats.exitCode === 0) {
    const nl = tryJson(nats.stdout) || []
    output.push(`\n[+] NAT Gateways: ${nl.length}`)
    for (const n of nl) output.push(`    ${n[0]} (${n[1]}) — ${n[2]} — ${n[3] || "no public IP"}`)
  }

  const endpoints = await aws(
    ["ec2", "describe-vpc-endpoints", "--query", "VpcEndpoints[].[VpcEndpointId,VpcId,ServiceName,VpcEndpointType,State]"],
    profile,
    region,
    timeout,
  )
  if (endpoints.exitCode === 0) {
    const el = tryJson(endpoints.stdout) || []
    output.push(`\n[+] VPC Endpoints: ${el.length}`)
    for (const e of el) output.push(`    ${e[0]} (${e[1]}) — ${(e[2] || "").split(".").pop()} (${e[3]}) — ${e[4]}`)
  }

  const peerings = await aws(
    [
      "ec2",
      "describe-vpc-peering-connections",
      "--query",
      "VpcPeeringConnections[].[VpcPeeringConnectionId,RequesterVpcInfo.VpcId,AccepterVpcInfo.VpcId,Status.Code]",
    ],
    profile,
    region,
    timeout,
  )
  if (peerings.exitCode === 0) {
    const pl = tryJson(peerings.stdout) || []
    if (pl.length > 0) {
      output.push(`\n[+] VPC Peering: ${pl.length}`)
      for (const p of pl) output.push(`    ${p[0]}: ${p[1]} <-> ${p[2]} (${p[3]})`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function rdsEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] RDS Enumeration\n"]

  const dbs = await aws(
    [
      "rds",
      "describe-db-instances",
      "--query",
      "DBInstances[].[DBInstanceIdentifier,Engine,EngineVersion,DBInstanceStatus,Endpoint.Address,Endpoint.Port,PubliclyAccessible,StorageEncrypted,MultiAZ,MasterUsername]",
    ],
    profile,
    region,
    timeout,
  )
  if (dbs.exitCode === 0) {
    const dl = tryJson(dbs.stdout) || []
    output.push(`[+] RDS Instances: ${dl.length}`)
    for (const d of dl) {
      output.push(`    ${d[0]} (${d[1]} ${d[2]}) — ${d[3]}`)
      output.push(`      Endpoint: ${d[4] || "none"}:${d[5] || ""}`)
      output.push(`      Public: ${d[6]}, Encrypted: ${d[7]}, MultiAZ: ${d[8]}, User: ${d[9]}`)
      if (d[6]) {
        findings.push({
          checkId: "AWS-RDS-001",
          provider: "aws",
          severity: "critical",
          status: "FAIL",
          resource: `rds:${d[0]}`,
          title: `Publicly accessible RDS: ${d[0]}`,
          details: `${d[1]} instance ${d[0]} is publicly accessible at ${d[4]}`,
          remediation: "Disable public accessibility",
        })
      }
      if (!d[7]) {
        findings.push({
          checkId: "AWS-RDS-002",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `rds:${d[0]}`,
          title: `Unencrypted RDS: ${d[0]}`,
          details: `RDS instance ${d[0]} storage is not encrypted`,
          remediation: "Enable storage encryption (requires snapshot + restore)",
        })
      }
    }
  }

  const clusters = await aws(
    [
      "rds",
      "describe-db-clusters",
      "--query",
      "DBClusters[].[DBClusterIdentifier,Engine,Status,Endpoint,Port,StorageEncrypted,IAMDatabaseAuthenticationEnabled]",
    ],
    profile,
    region,
    timeout,
  )
  if (clusters.exitCode === 0) {
    const cl = tryJson(clusters.stdout) || []
    if (cl.length > 0) {
      output.push(`\n[+] RDS Clusters: ${cl.length}`)
      for (const c of cl) output.push(`    ${c[0]} (${c[1]}) — ${c[2]} — ${c[3]}:${c[4]}`)
    }
  }

  const snaps = await aws(
    [
      "rds",
      "describe-db-snapshots",
      "--query",
      "DBSnapshots[].[DBSnapshotIdentifier,DBInstanceIdentifier,Status,SnapshotType,Encrypted]",
    ],
    profile,
    region,
    timeout,
  )
  if (snaps.exitCode === 0) {
    const sl = tryJson(snaps.stdout) || []
    output.push(`\n[+] RDS Snapshots: ${sl.length}`)
    for (const s of sl) output.push(`    ${s[0]} (${s[1]}) — ${s[2]} — ${s[3]}${!s[4] ? " [UNENCRYPTED]" : ""}`)

    for (const s of sl) {
      const attr = await aws(
        ["rds", "describe-db-snapshot-attributes", "--db-snapshot-identifier", s[0], "--query", "DBSnapshotAttributesResult.DBSnapshotAttributes"],
        profile,
        region,
        timeout,
      )
      if (attr.exitCode === 0) {
        const attrs = tryJson(attr.stdout) || []
        for (const a of attrs) {
          if (a.AttributeName === "restore" && (a.AttributeValues || []).includes("all")) {
            output.push(`    [!] ${s[0]} is shared publicly`)
            findings.push({
              checkId: "AWS-RDS-003",
              provider: "aws",
              severity: "critical",
              status: "FAIL",
              resource: `rds:snapshot:${s[0]}`,
              title: `Public RDS snapshot: ${s[0]}`,
              details: "RDS snapshot is shared with all AWS accounts",
              remediation: "Remove public sharing from snapshot",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function ecsEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] ECS Enumeration\n"]

  const clusters = await aws(["ecs", "list-clusters", "--query", "clusterArns"], profile, region, timeout)
  if (clusters.exitCode !== 0) return { output: `[-] Cannot list clusters: ${clusters.stderr.trim()}`, findings }
  const cl = tryJson(clusters.stdout) || []
  output.push(`[+] ECS Clusters: ${cl.length}`)

  for (const arn of cl) {
    const name = arn.split("/").pop()
    const desc = await aws(
      ["ecs", "describe-clusters", "--clusters", arn, "--include", "SETTINGS"],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode === 0) {
      const cluster = (tryJson(desc.stdout)?.clusters || [])[0]
      if (cluster) {
        const execEnabled = (cluster.settings || []).some(
          (s: Record<string, string>) => s.name === "containerInsights" && s.value === "enabled",
        )
        output.push(`    ${name} — ${cluster.status} — tasks: ${cluster.runningTasksCount}${execEnabled ? " [INSIGHTS]" : ""}`)
      }
    }

    const services = await aws(
      ["ecs", "list-services", "--cluster", arn, "--query", "serviceArns"],
      profile,
      region,
      timeout,
    )
    if (services.exitCode === 0) {
      const svcs = tryJson(services.stdout) || []
      if (svcs.length > 0) {
        const svcDesc = await aws(
          ["ecs", "describe-services", "--cluster", arn, "--services", ...svcs.slice(0, 10)],
          profile,
          region,
          timeout,
        )
        if (svcDesc.exitCode === 0) {
          const svcList = tryJson(svcDesc.stdout)?.services || []
          for (const s of svcList) {
            const execEnabled = s.enableExecuteCommand
            output.push(`      svc: ${s.serviceName} — ${s.status} — tasks: ${s.runningCount}${execEnabled ? " [EXEC-ENABLED]" : ""}`)
            if (execEnabled) {
              findings.push({
                checkId: `AWS-ECS-001`,
                provider: "aws",
                severity: "medium",
                status: "FOUND",
                resource: `ecs:${name}/${s.serviceName}`,
                title: `ECS Exec enabled: ${s.serviceName}`,
                details: `Service ${s.serviceName} in cluster ${name} has ECS Exec enabled`,
                remediation: "Review if ECS Exec is required in production",
              })
            }
          }
        }
      }
    }

    const tasks = await aws(
      ["ecs", "list-tasks", "--cluster", arn, "--query", "taskArns"],
      profile,
      region,
      timeout,
    )
    if (tasks.exitCode === 0) {
      const tl = tryJson(tasks.stdout) || []
      if (tl.length > 0) {
        const taskDesc = await aws(
          ["ecs", "describe-tasks", "--cluster", arn, "--tasks", ...tl.slice(0, 10)],
          profile,
          region,
          timeout,
        )
        if (taskDesc.exitCode === 0) {
          const taskList = tryJson(taskDesc.stdout)?.tasks || []
          for (const t of taskList) {
            const containers = (t.containers || []).map((c: Record<string, string>) => c.name).join(",")
            output.push(`      task: ${(t.taskArn || "").split("/").pop()} — ${t.lastStatus} — [${containers}]`)
          }
        }
      }
    }
  }

  const taskDefs = await aws(
    ["ecs", "list-task-definitions", "--status", "ACTIVE", "--query", "taskDefinitionArns"],
    profile,
    region,
    timeout,
  )
  if (taskDefs.exitCode === 0) {
    const tdl = tryJson(taskDefs.stdout) || []
    output.push(`\n[+] Active Task Definitions: ${tdl.length}`)
    for (const td of tdl.slice(0, 20)) {
      output.push(`    ${td.split("/").pop()}`)
      const tdDesc = await aws(
        ["ecs", "describe-task-definition", "--task-definition", td, "--query", "taskDefinition"],
        profile,
        region,
        timeout,
      )
      if (tdDesc.exitCode === 0) {
        const def = tryJson(tdDesc.stdout)
        for (const c of def?.containerDefinitions || []) {
          const envSecrets = (c.environment || []).filter(
            (e: Record<string, string>) => /password|secret|key|token/i.test(e.name),
          )
          if (envSecrets.length > 0) {
            output.push(`      [!] Container ${c.name}: secrets in env vars — ${envSecrets.map((e: Record<string, string>) => e.name).join(",")}`)
            findings.push({
              checkId: `AWS-ECS-002`,
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: `ecs:taskdef:${td.split("/").pop()}`,
              title: `Secrets in task definition env: ${c.name}`,
              details: `Container ${c.name} has ${envSecrets.length} secret(s) in plaintext environment variables`,
              remediation: "Use ECS secrets from Secrets Manager or SSM",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function eksEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] EKS Enumeration\n"]

  const clusters = await aws(["eks", "list-clusters", "--query", "clusters"], profile, region, timeout)
  if (clusters.exitCode !== 0) return { output: `[-] Cannot list EKS clusters: ${clusters.stderr.trim()}`, findings }
  const cl = tryJson(clusters.stdout) || []
  output.push(`[+] EKS Clusters: ${cl.length}`)

  for (const name of cl) {
    const desc = await aws(["eks", "describe-cluster", "--name", name], profile, region, timeout)
    if (desc.exitCode !== 0) continue
    const cluster = tryJson(desc.stdout)?.cluster
    if (!cluster) continue

    output.push(`\n    ${name} — ${cluster.status} — k8s ${cluster.version}`)
    output.push(`      Endpoint: ${cluster.endpoint}`)
    output.push(`      Public: ${cluster.resourcesVpcConfig?.endpointPublicAccess}, Private: ${cluster.resourcesVpcConfig?.endpointPrivateAccess}`)

    if (cluster.resourcesVpcConfig?.endpointPublicAccess) {
      const publicCidrs = cluster.resourcesVpcConfig?.publicAccessCidrs || []
      if (publicCidrs.includes("0.0.0.0/0")) {
        output.push(`      [!] Public endpoint open to 0.0.0.0/0`)
        findings.push({
          checkId: "AWS-EKS-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `eks:${name}`,
          title: `EKS public endpoint unrestricted: ${name}`,
          details: "EKS API endpoint is publicly accessible from any IP",
          remediation: "Restrict publicAccessCidrs or disable public endpoint",
        })
      }
    }

    if (cluster.logging?.clusterLogging) {
      const enabled = cluster.logging.clusterLogging
        .filter((l: Record<string, boolean>) => l.enabled)
        .flatMap((l: Record<string, string[]>) => l.types || [])
      output.push(`      Logging: ${enabled.length > 0 ? enabled.join(",") : "none"}`)
    }

    const nodeGroups = await aws(
      ["eks", "list-nodegroups", "--cluster-name", name, "--query", "nodegroups"],
      profile,
      region,
      timeout,
    )
    if (nodeGroups.exitCode === 0) {
      const ngl = tryJson(nodeGroups.stdout) || []
      output.push(`      Node Groups: ${ngl.length}`)
      for (const ng of ngl) {
        const ngDesc = await aws(
          ["eks", "describe-nodegroup", "--cluster-name", name, "--nodegroup-name", ng],
          profile,
          region,
          timeout,
        )
        if (ngDesc.exitCode === 0) {
          const nodeGroup = tryJson(ngDesc.stdout)?.nodegroup
          if (nodeGroup) {
            output.push(`        ${ng}: ${nodeGroup.status} — ${nodeGroup.instanceTypes?.join(",")} — desired: ${nodeGroup.scalingConfig?.desiredSize}`)
          }
        }
      }
    }

    const fargateProfiles = await aws(
      ["eks", "list-fargate-profiles", "--cluster-name", name, "--query", "fargateProfileNames"],
      profile,
      region,
      timeout,
    )
    if (fargateProfiles.exitCode === 0) {
      const fpl = tryJson(fargateProfiles.stdout) || []
      if (fpl.length > 0) {
        output.push(`      Fargate Profiles: ${fpl.length}`)
        for (const fp of fpl) output.push(`        ${fp}`)
      }
    }

    const oidc = cluster.identity?.oidc?.issuer
    if (oidc) output.push(`      OIDC: ${oidc}`)
  }

  return { output: output.join("\n"), findings }
}

export async function ssoEnum(args: string[], timeout: number): Promise<HookResult> {
  const instanceArn = argVal(args, "--instance-arn")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS SSO / IAM Identity Center Enumeration\n"]

  const instances = await aws(["sso-admin", "list-instances"], profile, region, timeout)
  if (instances.exitCode !== 0)
    return {
      output: `[-] Cannot list SSO instances: ${instances.stderr.trim()}\n[*] SSO may not be configured or region may be wrong`,
      findings,
    }

  const instanceList = tryJson(instances.stdout)?.Instances || []
  output.push(`[+] SSO Instances: ${instanceList.length}`)

  const targetArn = instanceArn || instanceList[0]?.InstanceArn
  const identityStoreId = instanceList[0]?.IdentityStoreId
  if (!targetArn) return { output: output.join("\n") + "\n[-] No SSO instance found", findings }

  output.push(`[*] Using instance: ${targetArn}`)
  output.push(`[*] Identity Store: ${identityStoreId}\n`)

  const permSets = await aws(
    ["sso-admin", "list-permission-sets", "--instance-arn", targetArn],
    profile,
    region,
    timeout,
  )
  if (permSets.exitCode === 0) {
    const psArns = tryJson(permSets.stdout)?.PermissionSets || []
    output.push(`[+] Permission Sets: ${psArns.length}`)
    for (const psArn of psArns) {
      const desc = await aws(
        ["sso-admin", "describe-permission-set", "--instance-arn", targetArn, "--permission-set-arn", psArn],
        profile,
        region,
        timeout,
      )
      if (desc.exitCode === 0) {
        const ps = tryJson(desc.stdout)?.PermissionSet || {}
        output.push(`    ${ps.Name} — session: ${ps.SessionDuration || "default"} — ${psArn}`)
        if (ps.Name === "AdministratorAccess" || ps.Name === "PowerUserAccess") {
          findings.push({
            checkId: `AWS-SSO-${findings.length + 1}`,
            provider: "aws",
            severity: "high",
            status: "FOUND",
            resource: psArn,
            title: `High-privilege permission set: ${ps.Name}`,
            details: `SSO permission set ${ps.Name} grants broad access`,
            remediation: "Review who is assigned this permission set",
          })
        }
      }
    }
  }

  if (identityStoreId) {
    const users = await aws(
      ["identitystore", "list-users", "--identity-store-id", identityStoreId],
      profile,
      region,
      timeout,
    )
    if (users.exitCode === 0) {
      const userList = tryJson(users.stdout)?.Users || []
      output.push(`\n[+] Identity Store Users: ${userList.length}`)
      for (const u of userList.slice(0, 30)) {
        output.push(`    ${u.UserName || u.UserId} — ${u.DisplayName || ""} — ${u.Emails?.[0]?.Value || "no email"}`)
      }
    }

    const groups = await aws(
      ["identitystore", "list-groups", "--identity-store-id", identityStoreId],
      profile,
      region,
      timeout,
    )
    if (groups.exitCode === 0) {
      const groupList = tryJson(groups.stdout)?.Groups || []
      output.push(`\n[+] Identity Store Groups: ${groupList.length}`)
      for (const g of groupList) output.push(`    ${g.DisplayName} — ${g.GroupId}`)
    }
  }

  const accounts = await aws(
    ["organizations", "list-accounts", "--query", "Accounts[].[Id,Name,Status]"],
    profile,
    region,
    timeout,
  )
  if (accounts.exitCode === 0) {
    const acctList = tryJson(accounts.stdout) || []
    output.push(`\n[+] Organization Accounts: ${acctList.length}`)
    for (const a of acctList.slice(0, 20)) output.push(`    ${a[0]} — ${a[1]} (${a[2]})`)
  }

  return { output: output.join("\n"), findings }
}

export async function orgEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Organizations Enumeration\n"]

  const org = await aws(["organizations", "describe-organization"], profile, region, timeout)
  if (org.exitCode !== 0)
    return {
      output: `[-] Cannot describe organization: ${org.stderr.trim()}\n[*] This account may not be part of an Organization`,
      findings,
    }

  const orgInfo = tryJson(org.stdout)?.Organization || {}
  output.push(`[+] Organization: ${orgInfo.Id}`)
  output.push(`    Master Account: ${orgInfo.MasterAccountId} (${orgInfo.MasterAccountEmail})`)
  output.push(`    Feature Set: ${orgInfo.FeatureSet}`)

  const accounts = await aws(["organizations", "list-accounts"], profile, region, timeout)
  if (accounts.exitCode === 0) {
    const acctList = tryJson(accounts.stdout)?.Accounts || []
    output.push(`\n[+] Accounts: ${acctList.length}`)
    for (const a of acctList) {
      output.push(`    ${a.Id} — ${a.Name} (${a.Status}) — ${a.Email}`)
      if (a.Id === orgInfo.MasterAccountId) output.push(`      ^ MANAGEMENT ACCOUNT`)
    }
    findings.push({
      checkId: "AWS-ORG-001",
      provider: "aws",
      severity: "info",
      status: "ENUMERATED",
      resource: `org:${orgInfo.Id}`,
      title: `AWS Organization enumerated: ${acctList.length} accounts`,
      details: `Management account: ${orgInfo.MasterAccountId}, feature set: ${orgInfo.FeatureSet}`,
      remediation: "Review cross-account trust policies and SCPs",
    })
  }

  const roots = await aws(["organizations", "list-roots"], profile, region, timeout)
  if (roots.exitCode === 0) {
    const rootList = tryJson(roots.stdout)?.Roots || []
    for (const root of rootList) {
      output.push(`\n[+] Root: ${root.Id} (${root.Name})`)
      const enabledPolicies = (root.PolicyTypes || []).filter((p: Record<string, string>) => p.Status === "ENABLED")
      output.push(
        `    Enabled policy types: ${enabledPolicies.map((p: Record<string, string>) => p.Type).join(", ") || "none"}`,
      )

      const ous = await aws(
        ["organizations", "list-organizational-units-for-parent", "--parent-id", root.Id],
        profile,
        region,
        timeout,
      )
      if (ous.exitCode === 0) {
        const ouList = tryJson(ous.stdout)?.OrganizationalUnits || []
        output.push(`    OUs: ${ouList.length}`)
        for (const ou of ouList) {
          output.push(`      ${ou.Id} — ${ou.Name}`)
          const childOus = await aws(
            ["organizations", "list-organizational-units-for-parent", "--parent-id", ou.Id],
            profile,
            region,
            timeout,
          )
          if (childOus.exitCode === 0) {
            const children = tryJson(childOus.stdout)?.OrganizationalUnits || []
            for (const child of children) output.push(`        ${child.Id} — ${child.Name}`)
          }
        }
      }
    }
  }

  const scps = await aws(
    ["organizations", "list-policies", "--filter", "SERVICE_CONTROL_POLICY"],
    profile,
    region,
    timeout,
  )
  if (scps.exitCode === 0) {
    const scpList = tryJson(scps.stdout)?.Policies || []
    output.push(`\n[+] Service Control Policies: ${scpList.length}`)
    for (const scp of scpList) {
      output.push(`    ${scp.Id} — ${scp.Name} (${scp.AwsManaged ? "AWS Managed" : "Custom"})`)
      if (!scp.AwsManaged) {
        const content = await aws(
          ["organizations", "describe-policy", "--policy-id", scp.Id, "--query", "Policy.Content"],
          profile,
          region,
          timeout,
        )
        if (content.exitCode === 0) {
          const doc = tryJson(tryJson(content.stdout) || "{}")
          const statements = doc?.Statement || []
          const denies = statements.filter((s: Record<string, string>) => s.Effect === "Deny")
          output.push(`      Statements: ${statements.length} (${denies.length} deny)`)
        }
      }
    }
  }

  const delegated = await aws(["organizations", "list-delegated-administrators"], profile, region, timeout)
  if (delegated.exitCode === 0) {
    const delList = tryJson(delegated.stdout)?.DelegatedAdministrators || []
    if (delList.length > 0) {
      output.push(`\n[+] Delegated Administrators: ${delList.length}`)
      for (const d of delList) output.push(`    ${d.Id} — ${d.Name} — ${d.Email}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function route53Enum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Route 53 Enumeration\n"]

  const zones = await aws(
    ["route53", "list-hosted-zones", "--query", "HostedZones[].[Id,Name,Config.PrivateZone,ResourceRecordSetCount]"],
    profile,
    region,
    timeout,
  )
  if (zones.exitCode !== 0) return { output: `[-] Cannot list hosted zones: ${zones.stderr.trim()}`, findings }
  const zl = tryJson(zones.stdout) || []
  output.push(`[+] Hosted Zones: ${zl.length}`)

  for (const z of zl) {
    const zoneId = (z[0] || "").replace("/hostedzone/", "")
    output.push(`\n    ${z[1]} (${zoneId}) — ${z[2] ? "private" : "public"} — ${z[3]} records`)

    const records = await aws(
      ["route53", "list-resource-record-sets", "--hosted-zone-id", zoneId, "--query", "ResourceRecordSets[].[Name,Type,ResourceRecords[0].Value,AliasTarget.DNSName]"],
      profile,
      region,
      timeout,
    )
    if (records.exitCode === 0) {
      const rl = tryJson(records.stdout) || []
      for (const r of rl.slice(0, 30)) {
        const val = r[2] || r[3] || ""
        output.push(`      ${r[0]} ${r[1]} → ${val}`)
      }

      const dangling = rl.filter((r: string[]) => {
        const val = r[2] || r[3] || ""
        return (r[1] === "CNAME" || r[3]) && /elasticbeanstalk|s3-website|cloudfront/.test(val)
      })
      if (dangling.length > 0) {
        output.push(`\n    [!] Potential subdomain takeover targets: ${dangling.length}`)
        for (const d of dangling) {
          output.push(`      ${d[0]} → ${d[2] || d[3]}`)
          findings.push({
            checkId: `AWS-R53-001`,
            provider: "aws",
            severity: "high",
            status: "REVIEW",
            resource: `route53:${zoneId}:${d[0]}`,
            title: `Potential subdomain takeover: ${d[0]}`,
            details: `CNAME/Alias points to ${d[2] || d[3]} — verify target exists`,
            remediation: "Verify target resource exists or remove dangling record",
          })
        }
      }
    }
  }

  const healthChecks = await aws(
    ["route53", "list-health-checks", "--query", "HealthChecks[].[Id,HealthCheckConfig.FullyQualifiedDomainName,HealthCheckConfig.Port,HealthCheckConfig.Type]"],
    profile,
    region,
    timeout,
  )
  if (healthChecks.exitCode === 0) {
    const hl = tryJson(healthChecks.stdout) || []
    if (hl.length > 0) {
      output.push(`\n[+] Health Checks: ${hl.length}`)
      for (const h of hl) output.push(`    ${h[0]} — ${h[1] || "IP-based"}:${h[2] || ""} (${h[3]})`)
    }
  }

  const resolvers = await aws(
    ["route53resolver", "list-resolver-endpoints", "--query", "ResolverEndpoints[].[Id,Name,Direction,Status]"],
    profile,
    region,
    timeout,
  )
  if (resolvers.exitCode === 0) {
    const rl = tryJson(resolvers.stdout) || []
    if (rl.length > 0) {
      output.push(`\n[+] Resolver Endpoints: ${rl.length}`)
      for (const r of rl) output.push(`    ${r[0]} — ${r[1]} (${r[2]}) — ${r[3]}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function serviceRecon(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] AWS Account Service Reconnaissance\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] AWS credentials not configured: ${id.stderr.trim()}`, findings: [] }
  const identity = tryJson(id.stdout)
  output.push(`[+] Account: ${identity?.Account}`)
  output.push(`[+] Identity: ${identity?.Arn}`)
  output.push(`[+] UserId: ${identity?.UserId}\n`)

  const aliases = await aws(["iam", "list-account-aliases", "--query", "AccountAliases"], profile, region, timeout)
  if (aliases.exitCode === 0) {
    const al = tryJson(aliases.stdout) || []
    if (al.length > 0) output.push(`[+] Account Aliases: ${al.join(", ")}`)
  }

  const regions = await aws(
    ["ec2", "describe-regions", "--query", "Regions[].[RegionName,OptInStatus]"],
    profile,
    region,
    timeout,
  )
  if (regions.exitCode === 0) {
    const rl = tryJson(regions.stdout) || []
    const optedIn = rl.filter((r: string[]) => r[1] === "opt-in-not-required" || r[1] === "opted-in")
    output.push(`\n[+] Enabled Regions: ${optedIn.length}/${rl.length}`)
    for (const r of optedIn) output.push(`    ${r[0]} (${r[1]})`)
  }

  const services = [
    { name: "EC2", cmd: ["ec2", "describe-instances", "--query", "Reservations[].Instances[] | length(@)"] },
    { name: "S3", cmd: ["s3api", "list-buckets", "--query", "Buckets | length(@)"] },
    { name: "Lambda", cmd: ["lambda", "list-functions", "--query", "Functions | length(@)"] },
    { name: "RDS", cmd: ["rds", "describe-db-instances", "--query", "DBInstances | length(@)"] },
    { name: "ECS", cmd: ["ecs", "list-clusters", "--query", "clusterArns | length(@)"] },
    { name: "EKS", cmd: ["eks", "list-clusters", "--query", "clusters | length(@)"] },
    { name: "DynamoDB", cmd: ["dynamodb", "list-tables", "--query", "TableNames | length(@)"] },
    { name: "SNS", cmd: ["sns", "list-topics", "--query", "Topics | length(@)"] },
    { name: "SQS", cmd: ["sqs", "list-queues", "--query", "QueueUrls | length(@)"] },
    { name: "CloudFormation", cmd: ["cloudformation", "list-stacks", "--stack-status-filter", "CREATE_COMPLETE", "UPDATE_COMPLETE", "--query", "StackSummaries | length(@)"] },
  ]

  output.push(`\n[*] Service Usage Summary:`)
  for (const svc of services) {
    const r = await aws(svc.cmd, profile, region, timeout)
    if (r.exitCode === 0) {
      const count = tryJson(r.stdout) ?? 0
      output.push(`    ${svc.name}: ${count}`)
    } else {
      output.push(`    ${svc.name}: access denied or unavailable`)
    }
  }

  return { output: output.join("\n"), findings: [] }
}
