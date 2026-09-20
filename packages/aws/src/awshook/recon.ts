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
    ["ec2", "describe-security-groups", "--query", "SecurityGroups[].[GroupId,GroupName,IpPermissions]"],
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
        [
          "ec2",
          "describe-instance-attribute",
          "--instance-id",
          inst[0],
          "--attribute",
          "userData",
          "--query",
          "UserData.Value",
        ],
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

  const buckets = await aws(
    ["s3api", "list-buckets", "--query", "Buckets[].[Name,CreationDate]"],
    profile,
    region,
    timeout,
  )
  if (buckets.exitCode !== 0) return { output: `[-] Cannot list buckets: ${buckets.stderr.trim()}`, findings }
  const bl = tryJson(buckets.stdout) || []
  output.push(`[+] Buckets: ${bl.length}\n`)

  for (const b of bl) {
    output.push(`[*] ${b[0]} (created: ${b[1]})`)

    const pub = await aws(["s3api", "get-public-access-block", "--bucket", b[0]], profile, region, timeout)
    if (pub.exitCode === 0) {
      const cfg = tryJson(pub.stdout)?.PublicAccessBlockConfiguration || {}
      const allBlocked =
        cfg.BlockPublicAcls && cfg.IgnorePublicAcls && cfg.BlockPublicPolicy && cfg.RestrictPublicBuckets
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

    const enc = await aws(["s3api", "get-bucket-encryption", "--bucket", b[0]], profile, region, timeout)
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

    const ver = await aws(["s3api", "get-bucket-versioning", "--bucket", b[0]], profile, region, timeout)
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

    const cfg = await aws(["lambda", "get-function-configuration", "--function-name", f[0]], profile, region, timeout)
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
    [
      "ec2",
      "describe-route-tables",
      "--query",
      "RouteTables[].[RouteTableId,VpcId,Routes[].{dest:DestinationCidrBlock,gw:GatewayId,nat:NatGatewayId}]",
    ],
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
    [
      "ec2",
      "describe-nat-gateways",
      "--query",
      "NatGateways[].[NatGatewayId,VpcId,State,NatGatewayAddresses[0].PublicIp]",
    ],
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
    [
      "ec2",
      "describe-vpc-endpoints",
      "--query",
      "VpcEndpoints[].[VpcEndpointId,VpcId,ServiceName,VpcEndpointType,State]",
    ],
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
        [
          "rds",
          "describe-db-snapshot-attributes",
          "--db-snapshot-identifier",
          s[0],
          "--query",
          "DBSnapshotAttributesResult.DBSnapshotAttributes",
        ],
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
        output.push(
          `    ${name} — ${cluster.status} — tasks: ${cluster.runningTasksCount}${execEnabled ? " [INSIGHTS]" : ""}`,
        )
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
            output.push(
              `      svc: ${s.serviceName} — ${s.status} — tasks: ${s.runningCount}${execEnabled ? " [EXEC-ENABLED]" : ""}`,
            )
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

    const tasks = await aws(["ecs", "list-tasks", "--cluster", arn, "--query", "taskArns"], profile, region, timeout)
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
          const envSecrets = (c.environment || []).filter((e: Record<string, string>) =>
            /password|secret|key|token/i.test(e.name),
          )
          if (envSecrets.length > 0) {
            output.push(
              `      [!] Container ${c.name}: secrets in env vars — ${envSecrets.map((e: Record<string, string>) => e.name).join(",")}`,
            )
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
    output.push(
      `      Public: ${cluster.resourcesVpcConfig?.endpointPublicAccess}, Private: ${cluster.resourcesVpcConfig?.endpointPrivateAccess}`,
    )

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
            output.push(
              `        ${ng}: ${nodeGroup.status} — ${nodeGroup.instanceTypes?.join(",")} — desired: ${nodeGroup.scalingConfig?.desiredSize}`,
            )
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
      [
        "route53",
        "list-resource-record-sets",
        "--hosted-zone-id",
        zoneId,
        "--query",
        "ResourceRecordSets[].[Name,Type,ResourceRecords[0].Value,AliasTarget.DNSName]",
      ],
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
    [
      "route53",
      "list-health-checks",
      "--query",
      "HealthChecks[].[Id,HealthCheckConfig.FullyQualifiedDomainName,HealthCheckConfig.Port,HealthCheckConfig.Type]",
    ],
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
    {
      name: "CloudFormation",
      cmd: [
        "cloudformation",
        "list-stacks",
        "--stack-status-filter",
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE",
        "--query",
        "StackSummaries | length(@)",
      ],
    },
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

export async function cfnEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudFormation Stack Enumeration\n"]

  const stacks = await aws(
    [
      "cloudformation",
      "list-stacks",
      "--stack-status-filter",
      "CREATE_COMPLETE",
      "UPDATE_COMPLETE",
      "ROLLBACK_COMPLETE",
      "--query",
      "StackSummaries[].[StackName,StackStatus,CreationTime,TemplateDescription]",
    ],
    profile,
    region,
    timeout,
  )
  if (stacks.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: cloudformation:ListStacks", findings }

  const sl = tryJson(stacks.stdout) || []
  output.push(`[+] Stacks found: ${sl.length}\n`)

  const secretPattern = /(?:password|secret|key|token|api.?key|credential|connexion|db.?pass|rds.?pass|auth)/i

  for (const s of sl) {
    output.push(`  Stack: ${s[0]}  Status: ${s[1]}  Created: ${s[2]}`)
    if (s[3]) output.push(`    Description: ${s[3]}`)

    const tpl = await aws(
      ["cloudformation", "get-template", "--stack-name", s[0], "--query", "TemplateBody"],
      profile,
      region,
      timeout,
    )
    if (tpl.exitCode === 0) {
      const body = tpl.stdout
      const matches = body.match(secretPattern)
      if (matches) {
        output.push(`    [!] Template contains potential secrets (matched: ${matches.slice(0, 3).join(", ")})`)
        findings.push({
          checkId: "AWS-CFN-001",
          provider: "aws",
          severity: "high",
          status: "FOUND",
          resource: `cfn:stack:${s[0]}`,
          title: `CloudFormation template may contain secrets: ${s[0]}`,
          details: `Template matched secret patterns: ${matches.slice(0, 5).join(", ")}`,
          remediation: "Use dynamic references (SSM/Secrets Manager) instead of hardcoded secrets in templates",
        })
      }

      const noEchoCheck = /NoEcho.*true/i.test(body)
      if (noEchoCheck) {
        output.push(`    [!] Template has NoEcho parameters — values hidden in console but readable via get-template`)
        findings.push({
          checkId: "AWS-CFN-002",
          provider: "aws",
          severity: "medium",
          status: "FOUND",
          resource: `cfn:stack:${s[0]}`,
          title: `NoEcho parameters in stack (still readable via API): ${s[0]}`,
          details: "NoEcho hides values in console/describe-stacks but get-template returns the raw template",
          remediation: "Use SSM SecureString or Secrets Manager dynamic references",
        })
      }
    }

    const params = await aws(
      [
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        s[0],
        "--query",
        "Stacks[0].Parameters[].[ParameterKey,ParameterValue]",
      ],
      profile,
      region,
      timeout,
    )
    if (params.exitCode === 0) {
      const pl = tryJson(params.stdout) || []
      for (const p of pl) {
        if (secretPattern.test(p[0]) && p[1] && p[1] !== "****") {
          output.push(`    [!] Parameter ${p[0]} = ${p[1].slice(0, 20)}...`)
          findings.push({
            checkId: "AWS-CFN-003",
            provider: "aws",
            severity: "critical",
            status: "EXPOSED",
            resource: `cfn:param:${s[0]}:${p[0]}`,
            title: `Exposed secret parameter: ${p[0]} in stack ${s[0]}`,
            details: `Parameter value readable: ${p[1].slice(0, 40)}...`,
            remediation: "Rotate exposed credential and use SSM SecureString reference",
          })
        }
      }
    }

    const outputs = await aws(
      [
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        s[0],
        "--query",
        "Stacks[0].Outputs[].[OutputKey,OutputValue,ExportName]",
      ],
      profile,
      region,
      timeout,
    )
    if (outputs.exitCode === 0) {
      const ol = tryJson(outputs.stdout) || []
      for (const o of ol) {
        output.push(`    Output: ${o[0]} = ${o[1]}${o[2] ? ` (export: ${o[2]})` : ""}`)
        if (secretPattern.test(o[0])) {
          findings.push({
            checkId: "AWS-CFN-004",
            provider: "aws",
            severity: "high",
            status: "EXPOSED",
            resource: `cfn:output:${s[0]}:${o[0]}`,
            title: `Potential secret in stack output: ${o[0]}`,
            details: `Output value: ${String(o[1]).slice(0, 40)}...`,
            remediation: "Do not export secrets via CloudFormation outputs",
          })
        }
      }
    }

    const resources = await aws(
      [
        "cloudformation",
        "list-stack-resources",
        "--stack-name",
        s[0],
        "--query",
        "StackResourceSummaries[].[ResourceType,LogicalResourceId,PhysicalResourceId]",
      ],
      profile,
      region,
      timeout,
    )
    if (resources.exitCode === 0) {
      const rl = tryJson(resources.stdout) || []
      const iamResources = rl.filter((r: string[]) => r[0]?.startsWith("AWS::IAM::"))
      if (iamResources.length) {
        output.push(
          `    [!] IAM resources in stack: ${iamResources.map((r: string[]) => `${r[0]}:${r[1]}`).join(", ")}`,
        )
      }
    }
    output.push("")
  }

  const exports = await aws(
    ["cloudformation", "list-exports", "--query", "Exports[].[Name,Value,ExportingStackId]"],
    profile,
    region,
    timeout,
  )
  if (exports.exitCode === 0) {
    const el = tryJson(exports.stdout) || []
    if (el.length) {
      output.push(`\n[+] Cross-Stack Exports: ${el.length}`)
      for (const e of el) output.push(`    ${e[0]} = ${e[1]}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function apigwEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] API Gateway Enumeration\n"]

  const rest = await aws(
    ["apigateway", "get-rest-apis", "--query", "items[].[id,name,endpointConfiguration.types[0],createdDate]"],
    profile,
    region,
    timeout,
  )
  if (rest.exitCode === 0) {
    const apis = tryJson(rest.stdout) || []
    output.push(`[+] REST APIs: ${apis.length}`)
    for (const a of apis) {
      output.push(`\n  API: ${a[1]} (${a[0]})  Type: ${a[2]}  Created: ${a[3]}`)

      const stages = await aws(
        [
          "apigateway",
          "get-stages",
          "--rest-api-id",
          a[0],
          "--query",
          "item[].[stageName,deploymentId,cacheClusterEnabled]",
        ],
        profile,
        region,
        timeout,
      )
      if (stages.exitCode === 0) {
        for (const st of tryJson(stages.stdout) || []) {
          const url = `https://${a[0]}.execute-api.${region || "us-east-1"}.amazonaws.com/${st[0]}`
          output.push(`    Stage: ${st[0]}  URL: ${url}`)
        }
      }

      const resources = await aws(
        ["apigateway", "get-resources", "--rest-api-id", a[0], "--query", "items[].[path,resourceMethods]"],
        profile,
        region,
        timeout,
      )
      if (resources.exitCode === 0) {
        const rl = tryJson(resources.stdout) || []
        for (const r of rl) {
          if (r[1]) {
            const methods = Object.keys(r[1])
            output.push(`    ${r[0]}  Methods: ${methods.join(", ")}`)
          }
        }
      }

      const keys = await aws(
        ["apigateway", "get-api-keys", "--include-values", "--query", "items[].[name,id,value,enabled]"],
        profile,
        region,
        timeout,
      )
      if (keys.exitCode === 0) {
        const kl = tryJson(keys.stdout) || []
        if (kl.length) {
          output.push(`    [!] API Keys with values:`)
          for (const k of kl) {
            output.push(`      ${k[0]} (${k[1]}): ${k[2]}  enabled=${k[3]}`)
            findings.push({
              checkId: "AWS-APIGW-001",
              provider: "aws",
              severity: "high",
              status: "EXTRACTED",
              resource: `apigateway:key:${k[1]}`,
              title: `API Key extracted: ${k[0]}`,
              details: `Value: ${String(k[2]).slice(0, 12)}... enabled=${k[3]}`,
              remediation: "Rotate API key and restrict --include-values permission",
            })
          }
        }
      }

      const authorizers = await aws(
        ["apigateway", "get-authorizers", "--rest-api-id", a[0], "--query", "items[].[name,type,authorizerUri]"],
        profile,
        region,
        timeout,
      )
      if (authorizers.exitCode === 0) {
        const al = tryJson(authorizers.stdout) || []
        if (al.length) {
          output.push(`    Authorizers:`)
          for (const auth of al) output.push(`      ${auth[0]}  Type: ${auth[1]}  URI: ${auth[2] || "N/A"}`)
        }
        if (!al.length) {
          output.push(`    [!] No authorizers configured — endpoints may be open`)
          findings.push({
            checkId: "AWS-APIGW-002",
            provider: "aws",
            severity: "medium",
            status: "MISSING",
            resource: `apigateway:${a[0]}`,
            title: `API Gateway ${a[1]} has no authorizers`,
            details: "No authorization configured — endpoints may accept unauthenticated requests",
            remediation: "Configure Cognito, Lambda, or IAM authorizer",
          })
        }
      }
    }
  }

  output.push("\n")
  const v2 = await aws(
    ["apigatewayv2", "get-apis", "--query", "Items[].[ApiId,Name,ProtocolType,ApiEndpoint]"],
    profile,
    region,
    timeout,
  )
  if (v2.exitCode === 0) {
    const v2apis = tryJson(v2.stdout) || []
    output.push(`[+] HTTP/WebSocket APIs (v2): ${v2apis.length}`)
    for (const a of v2apis) {
      output.push(`  ${a[1]} (${a[0]})  Protocol: ${a[2]}  Endpoint: ${a[3]}`)

      const routes = await aws(
        ["apigatewayv2", "get-routes", "--api-id", a[0], "--query", "Items[].[RouteKey,AuthorizationType,Target]"],
        profile,
        region,
        timeout,
      )
      if (routes.exitCode === 0) {
        for (const r of tryJson(routes.stdout) || []) {
          output.push(`    Route: ${r[0]}  Auth: ${r[1] || "NONE"}  Target: ${r[2] || "N/A"}`)
          if (!r[1] || r[1] === "NONE") {
            findings.push({
              checkId: "AWS-APIGW-003",
              provider: "aws",
              severity: "medium",
              status: "OPEN",
              resource: `apigatewayv2:${a[0]}:${r[0]}`,
              title: `Unauthenticated route: ${r[0]} on ${a[1]}`,
              details: `Route has AuthorizationType=NONE`,
              remediation: "Add JWT, Lambda, or IAM authorizer to route",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function snsSqsEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] SNS/SQS Enumeration\n"]

  const topics = await aws(["sns", "list-topics", "--query", "Topics[].TopicArn"], profile, region, timeout)
  if (topics.exitCode === 0) {
    const tl = tryJson(topics.stdout) || []
    output.push(`[+] SNS Topics: ${tl.length}`)
    for (const arn of tl) {
      const name = String(arn).split(":").pop()
      output.push(`\n  Topic: ${name}`)
      output.push(`    ARN: ${arn}`)

      const attrs = await aws(
        [
          "sns",
          "get-topic-attributes",
          "--topic-arn",
          arn,
          "--query",
          "{Policy:Attributes.Policy,KmsMasterKeyId:Attributes.KmsMasterKeyId,SubscriptionsConfirmed:Attributes.SubscriptionsConfirmed}",
        ],
        profile,
        region,
        timeout,
      )
      if (attrs.exitCode === 0) {
        const a = tryJson(attrs.stdout)
        if (a) {
          output.push(`    Subscriptions: ${a.SubscriptionsConfirmed || 0}  KMS: ${a.KmsMasterKeyId || "none"}`)
          if (a.Policy) {
            const policy = tryJson(a.Policy) || a.Policy
            const pStr = typeof policy === "string" ? policy : JSON.stringify(policy)
            if (pStr.includes('"*"') || pStr.includes('"AWS":"*"')) {
              output.push(`    [!] Topic policy allows public access`)
              findings.push({
                checkId: "AWS-SNS-001",
                provider: "aws",
                severity: "high",
                status: "OPEN",
                resource: `sns:${arn}`,
                title: `SNS topic with wildcard principal: ${name}`,
                details: "Topic policy contains Principal:* allowing any AWS account to publish/subscribe",
                remediation: "Restrict SNS topic policy to specific accounts/services",
              })
            }
          }
        }
      }

      const subs = await aws(
        [
          "sns",
          "list-subscriptions-by-topic",
          "--topic-arn",
          arn,
          "--query",
          "Subscriptions[].[Protocol,Endpoint,SubscriptionArn]",
        ],
        profile,
        region,
        timeout,
      )
      if (subs.exitCode === 0) {
        for (const sub of tryJson(subs.stdout) || []) {
          output.push(`    Sub: ${sub[0]}  →  ${sub[1]}`)
          if (sub[0] === "email" || sub[0] === "email-json" || sub[0] === "http") {
            findings.push({
              checkId: "AWS-SNS-002",
              provider: "aws",
              severity: "medium",
              status: "FOUND",
              resource: `sns:sub:${sub[2]}`,
              title: `Interesting SNS subscription: ${sub[0]} → ${sub[1]}`,
              details: `External delivery channel (${sub[0]}) can be used for data exfiltration`,
              remediation: "Review SNS subscriptions for unauthorized endpoints",
            })
          }
        }
      }
    }
  }

  output.push("\n")
  const queues = await aws(["sqs", "list-queues", "--query", "QueueUrls"], profile, region, timeout)
  if (queues.exitCode === 0) {
    const ql = tryJson(queues.stdout) || []
    output.push(`[+] SQS Queues: ${ql.length}`)
    for (const url of ql) {
      const name = String(url).split("/").pop()
      output.push(`\n  Queue: ${name}`)
      output.push(`    URL: ${url}`)

      const qattrs = await aws(
        [
          "sqs",
          "get-queue-attributes",
          "--queue-url",
          url,
          "--attribute-names",
          "All",
          "--query",
          "{Policy:Attributes.Policy,KmsMasterKeyId:Attributes.KmsMasterKeyId,ApproximateNumberOfMessages:Attributes.ApproximateNumberOfMessages,RedrivePolicy:Attributes.RedrivePolicy}",
        ],
        profile,
        region,
        timeout,
      )
      if (qattrs.exitCode === 0) {
        const qa = tryJson(qattrs.stdout)
        if (qa) {
          output.push(`    Messages: ${qa.ApproximateNumberOfMessages || 0}  KMS: ${qa.KmsMasterKeyId || "none"}`)
          if (qa.RedrivePolicy) output.push(`    DLQ: ${qa.RedrivePolicy}`)
          if (qa.Policy) {
            const pStr = typeof qa.Policy === "string" ? qa.Policy : JSON.stringify(qa.Policy)
            if (pStr.includes('"*"') || pStr.includes('"AWS":"*"')) {
              output.push(`    [!] Queue policy allows public access`)
              findings.push({
                checkId: "AWS-SQS-001",
                provider: "aws",
                severity: "high",
                status: "OPEN",
                resource: `sqs:${name}`,
                title: `SQS queue with wildcard principal: ${name}`,
                details: "Queue policy contains Principal:* allowing any account to send/receive",
                remediation: "Restrict SQS queue policy to specific accounts",
              })
            }
          }
          if (!qa.KmsMasterKeyId) {
            findings.push({
              checkId: "AWS-SQS-002",
              provider: "aws",
              severity: "low",
              status: "UNENCRYPTED",
              resource: `sqs:${name}`,
              title: `SQS queue without KMS encryption: ${name}`,
              details: "Queue uses SSE-SQS or no encryption — messages readable with queue access",
              remediation: "Enable KMS encryption on SQS queue",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function cloudwatchEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudWatch Enumeration\n"]

  const groups = await aws(
    ["logs", "describe-log-groups", "--query", "logGroups[].[logGroupName,storedBytes,retentionInDays,kmsKeyId]"],
    profile,
    region,
    timeout,
  )
  if (groups.exitCode === 0) {
    const gl = tryJson(groups.stdout) || []
    output.push(`[+] Log Groups: ${gl.length}`)

    const interestingPrefixes = ["/aws/lambda/", "/aws/apigateway/", "/aws/rds/", "/ecs/", "cloudtrail", "vpc-flow"]
    for (const g of gl) {
      const sizeMB = Math.round((g[1] || 0) / 1024 / 1024)
      const retention = g[2] || "never expires"
      output.push(`  ${g[0]}  Size: ${sizeMB}MB  Retention: ${retention}  KMS: ${g[3] || "none"}`)

      if (interestingPrefixes.some((p) => String(g[0]).toLowerCase().includes(p))) {
        findings.push({
          checkId: "AWS-CW-001",
          provider: "aws",
          severity: "info",
          status: "FOUND",
          resource: `cloudwatch:loggroup:${g[0]}`,
          title: `Interesting log group: ${g[0]}`,
          details: `Contains ${sizeMB}MB of logs, retention: ${retention}`,
          remediation: "Review log group for sensitive data exposure",
        })
      }

      if (!g[3]) {
        findings.push({
          checkId: "AWS-CW-002",
          provider: "aws",
          severity: "low",
          status: "UNENCRYPTED",
          resource: `cloudwatch:loggroup:${g[0]}`,
          title: `Log group without KMS encryption: ${g[0]}`,
          details: "Log data is not encrypted with customer-managed KMS key",
          remediation: "Associate KMS key with log group",
        })
      }
    }
  }

  const alarms = await aws(
    [
      "cloudwatch",
      "describe-alarms",
      "--query",
      "MetricAlarms[].[AlarmName,MetricName,Namespace,StateValue,ActionsEnabled,AlarmActions]",
    ],
    profile,
    region,
    timeout,
  )
  if (alarms.exitCode === 0) {
    const al = tryJson(alarms.stdout) || []
    output.push(`\n[+] CloudWatch Alarms: ${al.length}`)
    for (const a of al) {
      output.push(`  ${a[0]}  Metric: ${a[2]}/${a[1]}  State: ${a[3]}  Actions: ${a[4] ? "enabled" : "DISABLED"}`)
      if (!a[4]) {
        findings.push({
          checkId: "AWS-CW-003",
          provider: "aws",
          severity: "medium",
          status: "DISABLED",
          resource: `cloudwatch:alarm:${a[0]}`,
          title: `CloudWatch alarm with actions disabled: ${a[0]}`,
          details: `Alarm monitoring ${a[2]}/${a[1]} has actions disabled — alerts won't fire`,
          remediation: "Enable alarm actions or investigate why disabled",
        })
      }
      if (a[5]) {
        for (const action of a[5]) output.push(`    Action: ${action}`)
      }
    }
  }

  const dashboards = await aws(
    ["cloudwatch", "list-dashboards", "--query", "DashboardEntries[].[DashboardName,Size,LastModified]"],
    profile,
    region,
    timeout,
  )
  if (dashboards.exitCode === 0) {
    const dl = tryJson(dashboards.stdout) || []
    if (dl.length) {
      output.push(`\n[+] Dashboards: ${dl.length}`)
      for (const d of dl) output.push(`  ${d[0]}  Size: ${d[1]}B  Modified: ${d[2]}`)
    }
  }

  const metrics = await aws(["cloudwatch", "list-metrics", "--query", "Metrics | length(@)"], profile, region, timeout)
  if (metrics.exitCode === 0) {
    const count = tryJson(metrics.stdout) ?? 0
    output.push(`\n[+] Total custom metrics: ${count}`)
  }

  return { output: output.join("\n"), findings }
}

export async function elasticacheEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] ElastiCache Enumeration (Redis/Memcached)\n"]

  const clusters = await aws(
    [
      "elasticache",
      "describe-cache-clusters",
      "--show-cache-node-info",
      "--query",
      "CacheClusters[].[CacheClusterId,Engine,EngineVersion,CacheNodeType,NumCacheNodes,CacheClusterStatus,TransitEncryptionEnabled,AtRestEncryptionEnabled,AuthTokenEnabled,ConfigurationEndpoint.Address,CacheNodes[0].Endpoint.Address,CacheNodes[0].Endpoint.Port]",
    ],
    profile,
    region,
    timeout,
  )
  if (clusters.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: elasticache:DescribeCacheClusters", findings }

  const cl = tryJson(clusters.stdout) || []
  output.push(`[+] Cache clusters: ${cl.length}`)

  for (const c of cl) {
    output.push(`\n  Cluster: ${c[0]}  Engine: ${c[1]} ${c[2]}  Type: ${c[3]}  Nodes: ${c[4]}  Status: ${c[5]}`)
    output.push(`    Endpoint: ${c[10] || c[9] || "N/A"}:${c[11] || "N/A"}`)
    output.push(
      `    Transit encryption: ${c[6] || false}  At-rest encryption: ${c[7] || false}  Auth: ${c[8] || false}`,
    )

    if (!c[8]) {
      output.push(`    [!] No AUTH — anyone with network access can read/write data`)
      findings.push({
        checkId: "AWS-ELASTICACHE-001",
        provider: "aws",
        severity: "critical",
        status: "NO_AUTH",
        resource: `elasticache:${c[0]}`,
        title: `ElastiCache cluster without AUTH: ${c[0]} (${c[1]})`,
        details: `${c[1]} ${c[2]} on ${c[3]} — no authentication required. Network access = full data access`,
        remediation: "Enable AUTH token (Redis) or use IAM authentication",
      })
    }

    if (!c[6]) {
      findings.push({
        checkId: "AWS-ELASTICACHE-002",
        provider: "aws",
        severity: "high",
        status: "UNENCRYPTED",
        resource: `elasticache:${c[0]}`,
        title: `ElastiCache without transit encryption: ${c[0]}`,
        details: "Data transmitted in plaintext — credentials/session tokens readable via network sniffing",
        remediation: "Enable in-transit encryption (TLS)",
      })
    }

    if (!c[7]) {
      findings.push({
        checkId: "AWS-ELASTICACHE-003",
        provider: "aws",
        severity: "medium",
        status: "UNENCRYPTED",
        resource: `elasticache:${c[0]}`,
        title: `ElastiCache without at-rest encryption: ${c[0]}`,
        details: "Snapshot and backup data stored unencrypted",
        remediation: "Enable at-rest encryption",
      })
    }
  }

  const repl = await aws(
    [
      "elasticache",
      "describe-replication-groups",
      "--query",
      "ReplicationGroups[].[ReplicationGroupId,Description,Status,MemberClusters,NodeGroups[0].PrimaryEndpoint.Address,NodeGroups[0].PrimaryEndpoint.Port,TransitEncryptionEnabled,AtRestEncryptionEnabled,AuthTokenEnabled,AutomaticFailover]",
    ],
    profile,
    region,
    timeout,
  )
  if (repl.exitCode === 0) {
    const rl = tryJson(repl.stdout) || []
    if (rl.length) {
      output.push(`\n[+] Replication groups: ${rl.length}`)
      for (const r of rl) {
        output.push(`  ${r[0]}  Status: ${r[2]}  Endpoint: ${r[4] || "N/A"}:${r[5] || "N/A"}  Failover: ${r[9]}`)
        output.push(`    Members: ${(r[3] || []).join(", ")}  Auth: ${r[8] || false}`)
      }
    }
  }

  const sgroupsList = await aws(
    [
      "elasticache",
      "describe-cache-subnet-groups",
      "--query",
      "CacheSubnetGroups[].[CacheSubnetGroupName,VpcId,Subnets[].SubnetIdentifier]",
    ],
    profile,
    region,
    timeout,
  )
  if (sgroupsList.exitCode === 0) {
    const sgl = tryJson(sgroupsList.stdout) || []
    if (sgl.length) {
      output.push(`\n[+] Subnet groups: ${sgl.length}`)
      for (const sg of sgl) output.push(`  ${sg[0]}  VPC: ${sg[1]}  Subnets: ${(sg[2] || []).join(", ")}`)
    }
  }

  const snapshots = await aws(
    ["elasticache", "describe-snapshots", "--query", "Snapshots[].[SnapshotName,CacheClusterId,SnapshotStatus,Engine]"],
    profile,
    region,
    timeout,
  )
  if (snapshots.exitCode === 0) {
    const snl = tryJson(snapshots.stdout) || []
    if (snl.length) {
      output.push(`\n[+] Snapshots: ${snl.length}`)
      for (const sn of snl) output.push(`  ${sn[0]}  Cluster: ${sn[1]}  Status: ${sn[2]}  Engine: ${sn[3]}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function redshiftEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Redshift Data Warehouse Enumeration\n"]

  const clusters = await aws(
    [
      "redshift",
      "describe-clusters",
      "--query",
      "Clusters[].[ClusterIdentifier,NodeType,NumberOfNodes,ClusterStatus,DBName,MasterUsername,Endpoint.Address,Endpoint.Port,PubliclyAccessible,Encrypted,EnhancedVpcRouting,ClusterSubnetGroupName,VpcId]",
    ],
    profile,
    region,
    timeout,
  )
  if (clusters.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: redshift:DescribeClusters", findings }

  const cl = tryJson(clusters.stdout) || []
  output.push(`[+] Redshift clusters: ${cl.length}`)

  for (const c of cl) {
    output.push(`\n  Cluster: ${c[0]}  Type: ${c[1]}  Nodes: ${c[2]}  Status: ${c[3]}`)
    output.push(`    DB: ${c[4]}  User: ${c[5]}  Endpoint: ${c[6]}:${c[7]}`)
    output.push(`    Public: ${c[8]}  Encrypted: ${c[9]}  Enhanced VPC: ${c[10]}  VPC: ${c[12]}`)

    if (c[8]) {
      output.push(`    [!] Publicly accessible — connect from internet`)
      findings.push({
        checkId: "AWS-REDSHIFT-001",
        provider: "aws",
        severity: "critical",
        status: "PUBLIC",
        resource: `redshift:${c[0]}`,
        title: `Publicly accessible Redshift cluster: ${c[0]}`,
        details: `Endpoint: ${c[6]}:${c[7]}, DB: ${c[4]}, Master user: ${c[5]}`,
        remediation: "Disable public accessibility and restrict via security groups",
      })
    }

    if (!c[9]) {
      findings.push({
        checkId: "AWS-REDSHIFT-002",
        provider: "aws",
        severity: "high",
        status: "UNENCRYPTED",
        resource: `redshift:${c[0]}`,
        title: `Unencrypted Redshift cluster: ${c[0]}`,
        details: "Data warehouse stored without encryption — full data exposure if storage compromised",
        remediation: "Enable encryption (requires cluster recreation or snapshot restore)",
      })
    }

    const logging = await aws(
      ["redshift", "describe-logging-status", "--cluster-identifier", c[0]],
      profile,
      region,
      timeout,
    )
    if (logging.exitCode === 0) {
      const l = tryJson(logging.stdout)
      if (l && !l.LoggingEnabled) {
        output.push(`    [!] Audit logging disabled`)
        findings.push({
          checkId: "AWS-REDSHIFT-003",
          provider: "aws",
          severity: "medium",
          status: "DISABLED",
          resource: `redshift:${c[0]}`,
          title: `Redshift audit logging disabled: ${c[0]}`,
          details: "Query activity not logged — SQL injection and data exfil untracked",
          remediation: "Enable audit logging to S3",
        })
      }
    }

    const users = await aws(
      ["redshift", "describe-cluster-db-revisions", "--cluster-identifier", c[0]],
      profile,
      region,
      timeout,
    )
    if (users.exitCode === 0) {
      output.push(`    [+] Database revisions accessible`)
    }
  }

  const snapshots = await aws(
    [
      "redshift",
      "describe-cluster-snapshots",
      "--query",
      "Snapshots[].[SnapshotIdentifier,ClusterIdentifier,Status,SnapshotType,Encrypted,AccountsWithRestoreAccess]",
    ],
    profile,
    region,
    timeout,
  )
  if (snapshots.exitCode === 0) {
    const sl = tryJson(snapshots.stdout) || []
    if (sl.length) {
      output.push(`\n[+] Snapshots: ${sl.length}`)
      for (const s of sl) {
        output.push(`  ${s[0]}  Cluster: ${s[1]}  Type: ${s[3]}  Encrypted: ${s[4]}`)
        if (s[5] && s[5].length) {
          output.push(
            `    [!] Shared with accounts: ${s[5].map((a: Record<string, string>) => a.AccountId).join(", ")}`,
          )
          findings.push({
            checkId: "AWS-REDSHIFT-004",
            provider: "aws",
            severity: "high",
            status: "SHARED",
            resource: `redshift:snapshot:${s[0]}`,
            title: `Redshift snapshot shared cross-account: ${s[0]}`,
            details: `Cluster ${s[1]} snapshot shared with external accounts`,
            remediation: "Revoke cross-account snapshot sharing",
          })
        }
      }
    }
  }

  const serverless = await aws(
    [
      "redshift-serverless",
      "list-workgroups",
      "--query",
      "workgroups[].[workgroupName,status,baseCapacity,endpoint.address,endpoint.port,publiclyAccessible]",
    ],
    profile,
    region,
    timeout,
  )
  if (serverless.exitCode === 0) {
    const wl = tryJson(serverless.stdout) || []
    if (wl.length) {
      output.push(`\n[+] Redshift Serverless workgroups: ${wl.length}`)
      for (const w of wl) {
        output.push(`  ${w[0]}  Status: ${w[1]}  Capacity: ${w[2]}  Endpoint: ${w[3]}:${w[4]}  Public: ${w[5]}`)
        if (w[5]) {
          findings.push({
            checkId: "AWS-REDSHIFT-005",
            provider: "aws",
            severity: "critical",
            status: "PUBLIC",
            resource: `redshift-serverless:${w[0]}`,
            title: `Publicly accessible Redshift Serverless: ${w[0]}`,
            details: `Endpoint: ${w[3]}:${w[4]}`,
            remediation: "Disable public accessibility",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function multiRegionScan(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const primary = argVal(args, "--region") || "us-east-1"
  const findings: Finding[] = []
  const output: string[] = ["[*] Multi-Region Resource Scan\n"]

  const regionsR = await aws(["ec2", "describe-regions", "--query", "Regions[].RegionName"], profile, primary, timeout)
  if (regionsR.exitCode !== 0) return { output: `[-] Cannot list regions: ${regionsR.stderr.trim()}`, findings }
  const regions = (tryJson(regionsR.stdout) || []) as string[]
  output.push(`[+] Enabled regions: ${regions.length}\n`)

  const services = [
    { label: "EC2", cmd: ["ec2", "describe-instances", "--query", "Reservations[].Instances[] | length(@)"] },
    { label: "Lambda", cmd: ["lambda", "list-functions", "--query", "Functions | length(@)"] },
    { label: "RDS", cmd: ["rds", "describe-db-instances", "--query", "DBInstances | length(@)"] },
    { label: "ECS", cmd: ["ecs", "list-clusters", "--query", "clusterArns | length(@)"] },
  ]

  const summary: Record<string, Record<string, number>> = {}
  for (const region of regions) {
    const counts: Record<string, number> = {}
    for (const svc of services) {
      const r = await aws(svc.cmd, profile, region, Math.min(timeout, 30))
      counts[svc.label] = r.exitCode === 0 ? tryJson(r.stdout) || 0 : 0
    }
    summary[region] = counts
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    if (total > 0) {
      const parts = Object.entries(counts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
      output.push(`[+] ${region}: ${parts.join(", ")}`)
      if (region !== primary) {
        findings.push({
          checkId: "AWS-REGION-001",
          provider: "aws",
          severity: "medium",
          status: "INFO",
          resource: region,
          title: `Resources in non-primary region: ${region}`,
          details: `Found ${total} resource(s): ${parts.join(", ")}`,
          remediation: "Verify these resources are expected — attackers use non-primary regions to hide",
        })
      }
    }
  }

  const bucketsR = await aws(["s3api", "list-buckets", "--query", "Buckets | length(@)"], profile, primary, timeout)
  if (bucketsR.exitCode === 0) output.push(`\n[+] S3 Buckets (global): ${tryJson(bucketsR.stdout) || 0}`)

  const active = Object.entries(summary).filter(([, c]) => Object.values(c).some((v) => v > 0))
  output.push(`\n[*] Summary: resources in ${active.length}/${regions.length} regions`)

  return { output: output.join("\n"), findings }
}

export async function kmsEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] KMS Key Enumeration\n"]

  const keysR = await aws(["kms", "list-keys", "--query", "Keys[].KeyId"], profile, region, timeout)
  if (keysR.exitCode !== 0) return { output: `[-] Cannot list KMS keys: ${keysR.stderr.trim()}`, findings }
  const keyIds = (tryJson(keysR.stdout) || []) as string[]
  output.push(`[+] KMS Keys: ${keyIds.length}\n`)

  const aliasR = await aws(
    ["kms", "list-aliases", "--query", "Aliases[].{KeyId:TargetKeyId,Alias:AliasName}"],
    profile,
    region,
    timeout,
  )
  const aliases = (tryJson(aliasR.stdout) || []) as Array<{ KeyId: string; Alias: string }>
  const aliasMap = new Map<string, string>()
  for (const a of aliases) if (a.KeyId) aliasMap.set(a.KeyId, a.Alias)

  for (const keyId of keyIds) {
    const desc = await aws(
      ["kms", "describe-key", "--key-id", keyId, "--query", "KeyMetadata"],
      profile,
      region,
      timeout,
    )
    const meta = tryJson(desc.stdout)
    if (!meta) continue

    const alias = aliasMap.get(keyId) || "(no alias)"
    const manager = meta.KeyManager || "unknown"
    if (manager === "AWS") continue

    output.push(`[+] ${alias} (${keyId.slice(0, 8)}...)`)
    output.push(`    State: ${meta.KeyState}, Origin: ${meta.Origin}, Manager: ${manager}`)
    output.push(`    Created: ${meta.CreationDate}, Spec: ${meta.KeySpec}`)

    const policyR = await aws(
      ["kms", "get-key-policy", "--key-id", keyId, "--policy-name", "default", "--query", "Policy"],
      profile,
      region,
      timeout,
    )
    if (policyR.exitCode === 0) {
      const policyStr = tryJson(policyR.stdout) || policyR.stdout.trim()
      const policy = typeof policyStr === "string" ? tryJson(policyStr) : policyStr
      if (policy?.Statement) {
        for (const stmt of policy.Statement) {
          const principal = JSON.stringify(stmt.Principal || "")
          if (principal.includes('"*"') && stmt.Effect === "Allow") {
            output.push(`    [!] OPEN policy: Principal=* in statement ${stmt.Sid || "unnamed"}`)
            findings.push({
              checkId: "AWS-KMS-001",
              provider: "aws",
              severity: "critical",
              status: "FAIL",
              resource: `${alias} (${keyId})`,
              title: "KMS key with Principal: *",
              details: `Statement ${stmt.Sid || "unnamed"} allows all principals — anyone can use this key`,
              remediation: "Restrict KMS key policy to specific accounts/roles",
            })
          }
        }
      }
    }

    const grantsR = await aws(
      ["kms", "list-grants", "--key-id", keyId, "--query", "Grants[]"],
      profile,
      region,
      timeout,
    )
    const grants = (tryJson(grantsR.stdout) || []) as Array<Record<string, unknown>>
    if (grants.length > 0) {
      output.push(`    Grants: ${grants.length}`)
      for (const g of grants) {
        const grantee = (g.GranteePrincipal || "") as string
        const ops = (g.Operations || []) as string[]
        const grantId = (g.GrantId || "") as string
        output.push(`      ${grantId.slice(0, 16)}... → ${grantee} (${ops.join(",")})`)
        const keyAccount = (meta.Arn || "").split(":")[4] || ""
        const granteeAccount = grantee.split(":")[4] || ""
        if (keyAccount && granteeAccount && keyAccount !== granteeAccount) {
          findings.push({
            checkId: "AWS-KMS-002",
            provider: "aws",
            severity: "high",
            status: "FAIL",
            resource: `${alias} (${keyId})`,
            title: `Cross-account KMS grant to ${granteeAccount}`,
            details: `Grant ${grantId} gives ${grantee} access to key in account ${keyAccount}`,
            remediation: "Review cross-account KMS grants for least privilege",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function opensearchEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] OpenSearch / Elasticsearch Domain Enumeration\n"]

  const domainsR = await aws(
    ["opensearch", "list-domain-names", "--query", "DomainNames[].DomainName"],
    profile,
    region,
    timeout,
  )
  if (domainsR.exitCode !== 0) return { output: `[-] Cannot list domains: ${domainsR.stderr.trim()}`, findings }
  const domains = (tryJson(domainsR.stdout) || []) as string[]
  output.push(`[+] Domains: ${domains.length}\n`)

  for (const name of domains) {
    const descR = await aws(
      ["opensearch", "describe-domain", "--domain-name", name, "--query", "DomainStatus"],
      profile,
      region,
      timeout,
    )
    const domain = tryJson(descR.stdout)
    if (!domain) continue

    output.push(`[+] ${name}`)
    output.push(`    Engine: ${domain.EngineVersion}, ARN: ${domain.ARN}`)
    output.push(`    Endpoint: ${domain.Endpoint || domain.Endpoints?.vpc || "(none)"}`)

    const hasVpc = !!domain.VPCOptions?.VPCId
    output.push(`    VPC: ${hasVpc ? domain.VPCOptions.VPCId : "PUBLIC"}`)
    if (!hasVpc) {
      findings.push({
        checkId: "AWS-OS-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: name,
        title: `OpenSearch domain publicly accessible: ${name}`,
        details: `Domain ${name} has no VPC configuration — accessible from the internet`,
        remediation: "Deploy OpenSearch domain within a VPC",
      })
    }

    const encrypted = domain.EncryptionAtRestOptions?.Enabled
    const nodeEncrypted = domain.NodeToNodeEncryptionOptions?.Enabled
    output.push(`    Encryption at rest: ${encrypted ? "YES" : "NO"}, Node-to-node: ${nodeEncrypted ? "YES" : "NO"}`)
    if (!encrypted) {
      findings.push({
        checkId: "AWS-OS-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: name,
        title: `OpenSearch domain without encryption at rest: ${name}`,
        details: "Data stored in the domain is not encrypted",
        remediation: "Enable encryption at rest for OpenSearch domain",
      })
    }

    const fgac = domain.AdvancedSecurityOptions?.Enabled
    output.push(`    Fine-grained access control: ${fgac ? "YES" : "NO"}`)
    if (!fgac) {
      findings.push({
        checkId: "AWS-OS-003",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: name,
        title: `OpenSearch domain without fine-grained access control: ${name}`,
        details: "No FGAC — access is controlled only by resource policy",
        remediation: "Enable fine-grained access control with IAM or internal user database",
      })
    }

    const policyStr = domain.AccessPolicies
    if (policyStr) {
      const policy = tryJson(policyStr)
      if (policy?.Statement) {
        for (const stmt of policy.Statement) {
          const principal = JSON.stringify(stmt.Principal || "")
          if (principal.includes('"*"') && stmt.Effect === "Allow" && !stmt.Condition) {
            output.push(`    [!] OPEN access policy: Principal=*`)
            findings.push({
              checkId: "AWS-OS-004",
              provider: "aws",
              severity: "critical",
              status: "FAIL",
              resource: name,
              title: `OpenSearch open access policy: ${name}`,
              details: "Access policy allows Principal: * without conditions — anyone can read/write",
              remediation: "Restrict access policy to specific IAM principals or IP ranges",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function efsEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] EFS File System Enumeration\n"]

  const fsR = await aws(["efs", "describe-file-systems", "--query", "FileSystems[]"], profile, region, timeout)
  if (fsR.exitCode !== 0) return { output: `[-] Cannot list EFS: ${fsR.stderr.trim()}`, findings }
  const fileSystems = (tryJson(fsR.stdout) || []) as Array<Record<string, unknown>>
  output.push(`[+] EFS File Systems: ${fileSystems.length}\n`)

  for (const fs of fileSystems) {
    const fsId = fs.FileSystemId as string
    const name = (fs.Name as string) || "(unnamed)"
    const encrypted = fs.Encrypted as boolean
    const size = ((fs.SizeInBytes as Record<string, number>)?.Value || 0) / (1024 * 1024 * 1024)

    output.push(`[+] ${name} (${fsId})`)
    output.push(`    Size: ${size.toFixed(2)} GB, Lifecycle: ${fs.LifeCycleState}, Performance: ${fs.PerformanceMode}`)
    output.push(`    Encrypted: ${encrypted ? "YES" : "NO"}`)

    if (!encrypted) {
      findings.push({
        checkId: "AWS-EFS-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `${name} (${fsId})`,
        title: `EFS without encryption: ${name}`,
        details: `File system ${fsId} is not encrypted at rest`,
        remediation: "Create a new encrypted EFS and migrate data — encryption cannot be enabled after creation",
      })
    }

    const mtR = await aws(
      ["efs", "describe-mount-targets", "--file-system-id", fsId, "--query", "MountTargets[]"],
      profile,
      region,
      timeout,
    )
    const mounts = (tryJson(mtR.stdout) || []) as Array<Record<string, string>>
    output.push(`    Mount targets: ${mounts.length}`)

    for (const mt of mounts) {
      output.push(
        `      ${mt.MountTargetId} — subnet: ${mt.SubnetId}, AZ: ${mt.AvailabilityZoneName}, IP: ${mt.IpAddress}`,
      )
      const sgR = await aws(
        [
          "efs",
          "describe-mount-target-security-groups",
          "--mount-target-id",
          mt.MountTargetId,
          "--query",
          "SecurityGroups",
        ],
        profile,
        region,
        timeout,
      )
      const sgs = (tryJson(sgR.stdout) || []) as string[]
      if (sgs.length > 0) {
        output.push(`        Security groups: ${sgs.join(", ")}`)
        for (const sg of sgs) {
          const sgDesc = await aws(
            ["ec2", "describe-security-groups", "--group-ids", sg, "--query", "SecurityGroups[0].IpPermissions[]"],
            profile,
            region,
            timeout,
          )
          const rules = (tryJson(sgDesc.stdout) || []) as Array<Record<string, unknown>>
          for (const rule of rules) {
            const ranges = (rule.IpRanges || []) as Array<Record<string, string>>
            for (const range of ranges) {
              if (range.CidrIp === "0.0.0.0/0" && (rule.FromPort === 2049 || rule.IpProtocol === "-1")) {
                findings.push({
                  checkId: "AWS-EFS-002",
                  provider: "aws",
                  severity: "critical",
                  status: "FAIL",
                  resource: `${name} (${fsId})`,
                  title: `EFS mount target open to 0.0.0.0/0`,
                  details: `Mount target ${mt.MountTargetId} SG ${sg} allows NFS (2049) from anywhere`,
                  remediation: "Restrict NFS access to specific VPC CIDRs",
                })
              }
            }
          }
        }
      }
    }

    const policyR = await aws(
      ["efs", "describe-file-system-policy", "--file-system-id", fsId],
      profile,
      region,
      timeout,
    )
    if (policyR.exitCode === 0) {
      const policyData = tryJson(policyR.stdout)
      const policy = policyData?.Policy ? tryJson(policyData.Policy) : null
      if (policy?.Statement) {
        for (const stmt of policy.Statement) {
          const principal = JSON.stringify(stmt.Principal || "")
          if (principal.includes('"*"') && stmt.Effect === "Allow") {
            output.push(`    [!] Open file system policy: Principal=*`)
            findings.push({
              checkId: "AWS-EFS-003",
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: `${name} (${fsId})`,
              title: `EFS open resource policy: ${name}`,
              details: "File system policy allows Principal: * — any authenticated AWS principal can mount",
              remediation: "Restrict EFS resource policy to specific accounts/roles",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function elbEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Load Balancer Enumeration\n"]

  const v2R = await aws(["elbv2", "describe-load-balancers", "--query", "LoadBalancers[]"], profile, region, timeout)
  if (v2R.exitCode === 0) {
    const lbs = (tryJson(v2R.stdout) || []) as Array<Record<string, unknown>>
    output.push(`[+] ALB/NLB/GWLB: ${lbs.length}`)

    for (const lb of lbs) {
      const name = lb.LoadBalancerName as string
      const scheme = lb.Scheme as string
      const lbType = lb.Type as string
      const arn = lb.LoadBalancerArn as string
      const dns = lb.DNSName as string

      output.push(`\n  [+] ${name} (${lbType}, ${scheme})`)
      output.push(`      DNS: ${dns}`)
      output.push(
        `      VPC: ${lb.VpcId}, AZs: ${((lb.AvailabilityZones || []) as Array<Record<string, string>>).map((az) => az.ZoneName).join(",")}`,
      )

      if (scheme === "internet-facing") {
        findings.push({
          checkId: "AWS-ELB-001",
          provider: "aws",
          severity: "medium",
          status: "INFO",
          resource: name,
          title: `Internet-facing load balancer: ${name}`,
          details: `${lbType} ${name} is publicly accessible at ${dns}`,
          remediation: "Ensure only intended services are exposed via internet-facing LBs",
        })
      }

      const listenersR = await aws(
        ["elbv2", "describe-listeners", "--load-balancer-arn", arn, "--query", "Listeners[]"],
        profile,
        region,
        timeout,
      )
      const listeners = (tryJson(listenersR.stdout) || []) as Array<Record<string, unknown>>
      for (const l of listeners) {
        const proto = l.Protocol as string
        const port = l.Port as number
        output.push(`      Listener: ${proto}:${port}`)

        if (proto === "HTTPS" || proto === "TLS") {
          const sslPolicy = l.SslPolicy as string
          output.push(`        SSL Policy: ${sslPolicy}`)
          const weak = ["ELBSecurityPolicy-2016-08", "ELBSecurityPolicy-TLS-1-0-2015-04"]
          if (weak.includes(sslPolicy)) {
            findings.push({
              checkId: "AWS-ELB-002",
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: name,
              title: `Weak SSL policy on ${name}`,
              details: `Listener ${proto}:${port} uses ${sslPolicy} which supports TLS 1.0/weak ciphers`,
              remediation: "Upgrade to ELBSecurityPolicy-TLS13-1-2-2021-06 or newer",
            })
          }
        }

        if (proto === "HTTP" && scheme === "internet-facing") {
          const actions = (l.DefaultActions || []) as Array<Record<string, string>>
          const hasRedirect = actions.some((a) => a.Type === "redirect")
          if (!hasRedirect) {
            findings.push({
              checkId: "AWS-ELB-003",
              provider: "aws",
              severity: "medium",
              status: "FAIL",
              resource: name,
              title: `HTTP without redirect on internet-facing ${name}`,
              details: `Listener HTTP:${port} serves traffic without HTTPS redirect`,
              remediation: "Add HTTP→HTTPS redirect action",
            })
          }
        }
      }

      const sgs = (lb.SecurityGroups || []) as string[]
      if (sgs.length > 0) output.push(`      Security Groups: ${sgs.join(", ")}`)
    }
  }

  const classicR = await aws(
    ["elb", "describe-load-balancers", "--query", "LoadBalancerDescriptions[]"],
    profile,
    region,
    timeout,
  )
  if (classicR.exitCode === 0) {
    const clbs = (tryJson(classicR.stdout) || []) as Array<Record<string, unknown>>
    if (clbs.length > 0) {
      output.push(`\n[+] Classic ELB: ${clbs.length}`)
      for (const clb of clbs) {
        const name = clb.LoadBalancerName as string
        const scheme = clb.Scheme as string
        const dns = clb.DNSName as string
        output.push(`  [+] ${name} (classic, ${scheme})`)
        output.push(`      DNS: ${dns}`)

        const listeners = (clb.ListenerDescriptions || []) as Array<Record<string, Record<string, unknown>>>
        for (const ld of listeners) {
          const l = ld.Listener || {}
          output.push(`      Listener: ${l.Protocol}:${l.LoadBalancerPort} → ${l.InstanceProtocol}:${l.InstancePort}`)
        }

        if (scheme === "internet-facing") {
          findings.push({
            checkId: "AWS-ELB-004",
            provider: "aws",
            severity: "medium",
            status: "INFO",
            resource: name,
            title: `Internet-facing Classic ELB: ${name}`,
            details: `Classic ELB ${name} is publicly accessible — consider migrating to ALB/NLB`,
            remediation: "Migrate Classic ELBs to ALB/NLB for modern security features",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dynamodbEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] DynamoDB Table Enumeration\n"]

  const tables = await aws(["dynamodb", "list-tables"], profile, region, timeout)
  if (tables.exitCode !== 0) return { output: `[-] Cannot list DynamoDB tables: ${tables.stderr.trim()}`, findings }
  const tableNames = (tryJson(tables.stdout)?.TableNames || []) as string[]
  output.push(`[+] DynamoDB Tables: ${tableNames.length}\n`)

  for (const name of tableNames) {
    const desc = await aws(["dynamodb", "describe-table", "--table-name", name], profile, region, timeout)
    if (desc.exitCode !== 0) {
      output.push(`  [-] ${name}: failed to describe`)
      continue
    }
    const table = tryJson(desc.stdout)?.Table as Record<string, unknown> | undefined
    if (!table) continue

    const status = table.TableStatus as string
    const itemCount = table.ItemCount as number
    const sizeBytes = table.TableSizeBytes as number
    const billing = (table.BillingModeSummary as Record<string, unknown>)?.BillingMode || "PROVISIONED"
    output.push(`  [+] ${name} (${status}, ${billing})`)
    output.push(`      Items: ${itemCount}, Size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`)

    const sse = table.SSEDescription as Record<string, unknown> | undefined
    if (!sse || sse.Status !== "ENABLED") {
      output.push(`      [!] Server-side encryption: NOT using KMS`)
      findings.push({
        checkId: "AWS-DYNAMO-001",
        provider: "aws",
        severity: "medium",
        status: "WARN",
        resource: `dynamodb:table:${name}`,
        title: `DynamoDB table without KMS encryption: ${name}`,
        details: `Table ${name} uses default encryption (AWS owned key) instead of customer-managed KMS`,
        remediation: "Enable SSE with a customer-managed KMS key for sensitive tables",
      })
    } else {
      output.push(`      Encryption: ${sse.SSEType} (${sse.Status})`)
    }

    const streams = table.StreamSpecification as Record<string, unknown> | undefined
    if (streams?.StreamEnabled) {
      output.push(`      Streams: ${streams.StreamViewType}`)
    }

    const gsis = (table.GlobalSecondaryIndexes || []) as Array<Record<string, unknown>>
    if (gsis.length > 0) {
      output.push(`      GSIs: ${gsis.map((g) => g.IndexName).join(", ")}`)
    }

    const backup = await aws(
      ["dynamodb", "describe-continuous-backups", "--table-name", name],
      profile,
      region,
      timeout,
    )
    if (backup.exitCode === 0) {
      const cb = tryJson(backup.stdout)?.ContinuousBackupsDescription as Record<string, unknown> | undefined
      const pitr = cb?.PointInTimeRecoveryDescription as Record<string, unknown> | undefined
      if (!pitr || pitr.PointInTimeRecoveryStatus !== "ENABLED") {
        output.push(`      [!] Point-in-Time Recovery: DISABLED`)
        findings.push({
          checkId: "AWS-DYNAMO-002",
          provider: "aws",
          severity: "medium",
          status: "FAIL",
          resource: `dynamodb:table:${name}`,
          title: `PITR disabled: ${name}`,
          details: `Table ${name} does not have Point-in-Time Recovery enabled — data loss risk`,
          remediation: "Enable PITR for critical DynamoDB tables",
        })
      } else {
        output.push(`      PITR: ENABLED`)
      }
    }

    if (billing === "PROVISIONED") {
      const rcu = (table.ProvisionedThroughput as Record<string, unknown>)?.ReadCapacityUnits
      const wcu = (table.ProvisionedThroughput as Record<string, unknown>)?.WriteCapacityUnits
      output.push(`      Throughput: RCU=${rcu}, WCU=${wcu}`)
    }
  }

  if (tableNames.length > 0 && findings.length === 0) {
    findings.push({
      checkId: "AWS-DYNAMO-003",
      provider: "aws",
      severity: "info",
      status: "INFO",
      resource: "dynamodb",
      title: `DynamoDB: ${tableNames.length} table(s) enumerated`,
      details: `All ${tableNames.length} tables passed basic security checks (encryption, PITR)`,
      remediation: "Continue monitoring DynamoDB security posture",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function cognitoEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cognito Enumeration\n"]

  const pools = await aws(
    ["cognito-idp", "list-user-pools", "--max-results", "60"],
    profile,
    region,
    timeout,
  )
  if (pools.exitCode === 0) {
    const userPools = (tryJson(pools.stdout)?.UserPools || []) as Array<Record<string, unknown>>
    output.push(`[+] User Pools: ${userPools.length}`)

    for (const pool of userPools) {
      const poolId = pool.Id as string
      const poolName = pool.Name as string
      output.push(`\n  [+] ${poolName} (${poolId})`)

      const desc = await aws(
        ["cognito-idp", "describe-user-pool", "--user-pool-id", poolId],
        profile,
        region,
        timeout,
      )
      if (desc.exitCode !== 0) continue
      const up = tryJson(desc.stdout)?.UserPool as Record<string, unknown> | undefined
      if (!up) continue

      const mfa = up.MfaConfiguration as string
      output.push(`      MFA: ${mfa}`)
      if (mfa === "OFF") {
        findings.push({
          checkId: "AWS-COGNITO-ENUM-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `cognito:user-pool:${poolId}`,
          title: `Cognito User Pool MFA disabled: ${poolName}`,
          details: `User Pool ${poolName} (${poolId}) has MFA set to OFF`,
          remediation: "Enable MFA (OPTIONAL or ON) for the user pool",
        })
      }

      const pwPolicy = up.Policies as Record<string, Record<string, unknown>> | undefined
      const pp = pwPolicy?.PasswordPolicy
      if (pp) {
        output.push(
          `      Password Policy: min=${pp.MinimumLength}, upper=${pp.RequireUppercase}, lower=${pp.RequireLowercase}, numbers=${pp.RequireNumbers}, symbols=${pp.RequireSymbols}`,
        )
        if ((pp.MinimumLength as number) < 12) {
          findings.push({
            checkId: "AWS-COGNITO-ENUM-001",
            provider: "aws",
            severity: "medium",
            status: "WARN",
            resource: `cognito:user-pool:${poolId}`,
            title: `Weak password policy: ${poolName}`,
            details: `Minimum password length is ${pp.MinimumLength} (recommended: 12+)`,
            remediation: "Increase minimum password length to at least 12 characters",
          })
        }
      }

      const triggers = up.LambdaConfig as Record<string, unknown> | undefined
      if (triggers && Object.keys(triggers).length > 0) {
        output.push(`      Lambda Triggers: ${Object.keys(triggers).join(", ")}`)
      }
    }
  } else {
    output.push(`[-] Cannot list user pools: ${pools.stderr.trim()}`)
  }

  const idPools = await aws(
    ["cognito-identity", "list-identity-pools", "--max-results", "60"],
    profile,
    region,
    timeout,
  )
  if (idPools.exitCode === 0) {
    const identityPools = (tryJson(idPools.stdout)?.IdentityPools || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Identity Pools: ${identityPools.length}`)

    for (const ip of identityPools) {
      const ipId = ip.IdentityPoolId as string
      const ipName = ip.IdentityPoolName as string

      const desc = await aws(
        ["cognito-identity", "describe-identity-pool", "--identity-pool-id", ipId],
        profile,
        region,
        timeout,
      )
      if (desc.exitCode !== 0) continue
      const pool = tryJson(desc.stdout) as Record<string, unknown> | null
      if (!pool) continue

      const allowUnauth = pool.AllowUnauthenticatedIdentities as boolean
      output.push(`  [+] ${ipName} (${ipId}) — unauthenticated: ${allowUnauth}`)

      if (allowUnauth) {
        findings.push({
          checkId: "AWS-COGNITO-ENUM-002",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `cognito:identity-pool:${ipId}`,
          title: `Unauthenticated identities allowed: ${ipName}`,
          details: `Identity Pool ${ipName} (${ipId}) allows unauthenticated access — attackers can obtain temporary AWS credentials`,
          remediation: "Disable AllowUnauthenticatedIdentities unless explicitly required",
        })
      }

      const providers = (pool.CognitoIdentityProviders || []) as Array<Record<string, unknown>>
      if (providers.length > 0) {
        output.push(`      Providers: ${providers.map((p) => p.ProviderName).join(", ")}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function stsEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] STS/Federation Enumeration\n"]

  const oidcProviders = await aws(
    ["iam", "list-open-id-connect-providers", "--query", "OpenIDConnectProviderList[].Arn"],
    profile,
    region,
    timeout,
  )
  if (oidcProviders.exitCode === 0) {
    const arns = (tryJson(oidcProviders.stdout) || []) as string[]
    output.push(`[+] OIDC Providers: ${arns.length}`)

    for (const arn of arns) {
      const detail = await aws(
        ["iam", "get-open-id-connect-provider", "--open-id-connect-provider-arn", arn],
        profile,
        region,
        timeout,
      )
      if (detail.exitCode !== 0) continue
      const provider = tryJson(detail.stdout) as Record<string, unknown> | null
      if (!provider) continue

      const url = provider.Url as string
      const thumbprints = (provider.ThumbprintList || []) as string[]
      const audiences = (provider.ClientIDList || []) as string[]
      output.push(`\n  [+] OIDC: ${url}`)
      output.push(`      Thumbprints: ${thumbprints.length}`)
      output.push(`      Audiences: ${audiences.join(", ")}`)

      if (thumbprints.length === 0) {
        findings.push({
          checkId: "AWS-STS-ENUM-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: arn,
          title: `OIDC provider missing thumbprint validation: ${url}`,
          details: `OIDC provider ${url} has no thumbprints configured — certificate validation may be bypassed`,
          remediation: "Add valid thumbprints to the OIDC provider for certificate pinning",
        })
      }
    }
  }

  const samlProviders = await aws(
    ["iam", "list-saml-providers", "--query", "SAMLProviderList[]"],
    profile,
    region,
    timeout,
  )
  if (samlProviders.exitCode === 0) {
    const spList = (tryJson(samlProviders.stdout) || []) as Array<Record<string, unknown>>
    output.push(`\n[+] SAML Providers: ${spList.length}`)

    for (const sp of spList) {
      const arn = sp.Arn as string
      const created = sp.CreateDate as string
      const valid = sp.ValidUntil as string
      output.push(`  [+] ${arn}`)
      output.push(`      Created: ${created}, Valid Until: ${valid}`)

      if (valid) {
        const expiry = new Date(valid)
        const now = new Date()
        if (expiry < now) {
          findings.push({
            checkId: "AWS-STS-ENUM-001",
            provider: "aws",
            severity: "medium",
            status: "WARN",
            resource: arn,
            title: `Expired SAML provider: ${arn}`,
            details: `SAML provider metadata expired on ${valid}`,
            remediation: "Update SAML provider metadata with current certificate",
          })
        }
      }

      const detail = await aws(
        ["iam", "get-saml-provider", "--saml-provider-arn", arn],
        profile,
        region,
        timeout,
      )
      if (detail.exitCode === 0) {
        const saml = tryJson(detail.stdout) as Record<string, unknown> | null
        if (saml) {
          const metadata = saml.SAMLMetadataDocument as string | undefined
          if (metadata) {
            output.push(`      Metadata: ${metadata.length} bytes`)
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function secretsManagerEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Secrets Manager Enumeration\n"]

  const secrets = await aws(["secretsmanager", "list-secrets"], profile, region, timeout)
  if (secrets.exitCode !== 0) return { output: `[-] Cannot list secrets: ${secrets.stderr.trim()}`, findings }
  const secretList = (tryJson(secrets.stdout)?.SecretList || []) as Array<Record<string, unknown>>
  output.push(`[+] Secrets: ${secretList.length}\n`)

  const now = Date.now()
  const dayMs = 86400000

  for (const s of secretList) {
    const name = s.Name as string
    const arn = s.ARN as string
    const rotationEnabled = s.RotationEnabled as boolean
    const lastRotated = s.LastRotatedDate as string | undefined
    const lastAccessed = s.LastAccessedDate as string | undefined

    output.push(`  [+] ${name}`)
    output.push(`      ARN: ${arn}`)
    output.push(`      Rotation: ${rotationEnabled ? "ENABLED" : "DISABLED"}`)

    if (!rotationEnabled) {
      findings.push({
        checkId: "AWS-SM-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: arn,
        title: `Secret without rotation: ${name}`,
        details: `Secret ${name} does not have automatic rotation enabled`,
        remediation: "Enable automatic rotation with a Lambda rotation function",
      })
    }

    if (lastRotated) {
      const age = Math.floor((now - new Date(lastRotated).getTime()) / dayMs)
      output.push(`      Last Rotated: ${lastRotated} (${age} days ago)`)
    }

    if (lastAccessed) {
      const age = Math.floor((now - new Date(lastAccessed).getTime()) / dayMs)
      output.push(`      Last Accessed: ${lastAccessed} (${age} days ago)`)
      if (age > 90) {
        findings.push({
          checkId: "AWS-SM-002",
          provider: "aws",
          severity: "low",
          status: "WARN",
          resource: arn,
          title: `Stale secret: ${name}`,
          details: `Secret ${name} was last accessed ${age} days ago — may be unused`,
          remediation: "Review if this secret is still needed; delete unused secrets",
        })
      }
    }

    const policy = await aws(
      ["secretsmanager", "get-resource-policy", "--secret-id", arn],
      profile,
      region,
      timeout,
    )
    if (policy.exitCode === 0) {
      const rp = tryJson(policy.stdout) as Record<string, unknown> | null
      if (rp?.ResourcePolicy) {
        const policyDoc = typeof rp.ResourcePolicy === "string" ? rp.ResourcePolicy : JSON.stringify(rp.ResourcePolicy)
        if (policyDoc.includes('"*"') || policyDoc.includes("\"*\"")) {
          output.push(`      [!] Resource policy allows broad access`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function ssmEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] SSM Enumeration\n"]

  const instances = await aws(
    ["ssm", "describe-instance-information"],
    profile,
    region,
    timeout,
  )
  if (instances.exitCode === 0) {
    const instList = (tryJson(instances.stdout)?.InstanceInformationList || []) as Array<Record<string, unknown>>
    output.push(`[+] Managed Instances: ${instList.length}`)
    for (const inst of instList) {
      const id = inst.InstanceId as string
      const platform = inst.PlatformType as string
      const version = inst.PlatformVersion as string
      const agentVer = inst.AgentVersion as string
      const pingStatus = inst.PingStatus as string
      output.push(`  [+] ${id} (${platform} ${version}, Agent: ${agentVer}, Ping: ${pingStatus})`)
    }
  }

  const docs = await aws(
    ["ssm", "list-documents", "--document-filter-list", "Key=Owner,Values=Self"],
    profile,
    region,
    timeout,
  )
  if (docs.exitCode === 0) {
    const docList = (tryJson(docs.stdout)?.DocumentIdentifiers || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Custom SSM Documents: ${docList.length}`)
    for (const doc of docList) {
      const name = doc.Name as string
      const docType = doc.DocumentType as string
      const format = doc.DocumentFormat as string
      output.push(`  [+] ${name} (${docType}, ${format})`)
    }
  }

  const params = await aws(
    ["ssm", "describe-parameters", "--query", "Parameters[].{Name:Name,Type:Type}"],
    profile,
    region,
    timeout,
  )
  if (params.exitCode === 0) {
    const paramList = (tryJson(params.stdout) || []) as Array<Record<string, unknown>>
    output.push(`\n[+] SSM Parameters: ${paramList.length}`)
    let secureCount = 0
    let stringCount = 0
    for (const p of paramList) {
      if (p.Type === "SecureString") secureCount++
      else stringCount++
    }
    output.push(`      SecureString: ${secureCount}, String/StringList: ${stringCount}`)
    if (stringCount > 0) {
      output.push(`      [!] ${stringCount} parameter(s) stored as plain String (not SecureString)`)
    }
  }

  const mw = await aws(["ssm", "describe-maintenance-windows"], profile, region, timeout)
  if (mw.exitCode === 0) {
    const windows = (tryJson(mw.stdout)?.WindowIdentities || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Maintenance Windows: ${windows.length}`)
    for (const w of windows) {
      const name = w.Name as string
      const enabled = w.Enabled as boolean
      output.push(`  [+] ${name} (enabled: ${enabled})`)
    }
  }

  findings.push({
    checkId: "AWS-SSM-ENUM-001",
    provider: "aws",
    severity: "info",
    status: "INFO",
    resource: "ssm",
    title: "SSM inventory enumerated",
    details: "SSM managed instances, documents, parameters, and maintenance windows inventoried",
    remediation: "Review SSM configuration for least-privilege document access",
  })

  return { output: output.join("\n"), findings }
}

export async function sagemakerEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] SageMaker Enumeration\n"]

  const notebooks = await aws(
    ["sagemaker", "list-notebook-instances"],
    profile,
    region,
    timeout,
  )
  if (notebooks.exitCode === 0) {
    const nbList = (tryJson(notebooks.stdout)?.NotebookInstances || []) as Array<Record<string, unknown>>
    output.push(`[+] Notebook Instances: ${nbList.length}`)

    for (const nb of nbList) {
      const name = nb.NotebookInstanceName as string
      const status = nb.NotebookInstanceStatus as string
      const arn = nb.NotebookInstanceArn as string
      output.push(`\n  [+] ${name} (${status})`)

      const desc = await aws(
        ["sagemaker", "describe-notebook-instance", "--notebook-instance-name", name],
        profile,
        region,
        timeout,
      )
      if (desc.exitCode !== 0) continue
      const detail = tryJson(desc.stdout) as Record<string, unknown> | null
      if (!detail) continue

      const rootAccess = detail.RootAccess as string
      const directInternet = detail.DirectInternetAccess as string
      const kmsKey = detail.KmsKeyId as string | undefined
      const instanceType = detail.InstanceType as string
      const subnet = detail.SubnetId as string | undefined

      output.push(`      Type: ${instanceType}`)
      output.push(`      Root Access: ${rootAccess}`)
      output.push(`      Direct Internet: ${directInternet}`)
      output.push(`      KMS Key: ${kmsKey || "None (default encryption)"}`)
      output.push(`      Subnet: ${subnet || "No VPC"}`)

      if (rootAccess === "Enabled" && directInternet === "Enabled") {
        findings.push({
          checkId: "AWS-SAGEMAKER-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: arn,
          title: `SageMaker notebook root+internet: ${name}`,
          details: `Notebook ${name} has both root access and direct internet access enabled — high risk for code execution`,
          remediation: "Disable RootAccess and/or DirectInternetAccess; use VPC networking",
        })
      } else if (rootAccess === "Enabled") {
        findings.push({
          checkId: "AWS-SAGEMAKER-001",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: arn,
          title: `SageMaker notebook root access enabled: ${name}`,
          details: `Notebook ${name} has root access enabled`,
          remediation: "Disable root access unless required for development",
        })
      }

      if (!kmsKey) {
        findings.push({
          checkId: "AWS-SAGEMAKER-002",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: arn,
          title: `SageMaker notebook without KMS encryption: ${name}`,
          details: `Notebook ${name} does not use a customer-managed KMS key`,
          remediation: "Configure a KMS key for notebook instance encryption",
        })
      }
    }
  }

  const endpoints = await aws(["sagemaker", "list-endpoints"], profile, region, timeout)
  if (endpoints.exitCode === 0) {
    const epList = (tryJson(endpoints.stdout)?.Endpoints || []) as Array<Record<string, unknown>>
    output.push(`\n[+] SageMaker Endpoints: ${epList.length}`)
    for (const ep of epList) {
      const name = ep.EndpointName as string
      const status = ep.EndpointStatus as string
      output.push(`  [+] ${name} (${status})`)
    }
  }

  const jobs = await aws(
    ["sagemaker", "list-training-jobs", "--sort-by", "CreationTime", "--sort-order", "Descending", "--max-results", "10"],
    profile,
    region,
    timeout,
  )
  if (jobs.exitCode === 0) {
    const jobList = (tryJson(jobs.stdout)?.TrainingJobSummaries || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Recent Training Jobs: ${jobList.length}`)
    for (const j of jobList) {
      const name = j.TrainingJobName as string
      const status = j.TrainingJobStatus as string
      output.push(`  [+] ${name} (${status})`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function stepFunctionsEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Step Functions Enumeration\n"]

  const machines = await aws(["stepfunctions", "list-state-machines"], profile, region, timeout)
  if (machines.exitCode !== 0) return { output: `[-] Cannot list state machines: ${machines.stderr.trim()}`, findings }
  const smList = (tryJson(machines.stdout)?.stateMachines || []) as Array<Record<string, unknown>>
  output.push(`[+] State Machines: ${smList.length}\n`)

  for (const sm of smList) {
    const arn = sm.stateMachineArn as string
    const name = sm.name as string
    const smType = sm.type as string
    output.push(`  [+] ${name} (${smType})`)

    const desc = await aws(
      ["stepfunctions", "describe-state-machine", "--state-machine-arn", arn],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode !== 0) continue
    const detail = tryJson(desc.stdout) as Record<string, unknown> | null
    if (!detail) continue

    const roleArn = detail.roleArn as string
    const logging = detail.loggingConfiguration as Record<string, unknown> | undefined
    const logLevel = logging?.level as string | undefined

    output.push(`      Role: ${roleArn}`)
    output.push(`      Logging Level: ${logLevel || "OFF"}`)

    if (!logLevel || logLevel === "OFF") {
      findings.push({
        checkId: "AWS-STEPFN-001",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: arn,
        title: `Step Functions without logging: ${name}`,
        details: `State machine ${name} has logging disabled — no audit trail for execution`,
        remediation: "Enable CloudWatch Logs logging at ALL or ERROR level",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function glueEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Glue Enumeration\n"]

  const dbs = await aws(["glue", "get-databases"], profile, region, timeout)
  if (dbs.exitCode === 0) {
    const dbList = (tryJson(dbs.stdout)?.DatabaseList || []) as Array<Record<string, unknown>>
    output.push(`[+] Glue Databases: ${dbList.length}`)
    for (const db of dbList) {
      output.push(`  [+] ${db.Name} — ${db.Description || "(no description)"}`)
    }
  }

  const crawlers = await aws(["glue", "get-crawlers"], profile, region, timeout)
  if (crawlers.exitCode === 0) {
    const crawlerList = (tryJson(crawlers.stdout)?.Crawlers || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Glue Crawlers: ${crawlerList.length}`)
    for (const c of crawlerList) {
      const name = c.Name as string
      const state = c.State as string
      const role = c.Role as string
      output.push(`  [+] ${name} (${state}, Role: ${role})`)
    }
  }

  const jobs = await aws(["glue", "get-jobs"], profile, region, timeout)
  if (jobs.exitCode === 0) {
    const jobList = (tryJson(jobs.stdout)?.Jobs || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Glue Jobs: ${jobList.length}`)
    for (const j of jobList) {
      const name = j.Name as string
      const secConfig = j.SecurityConfiguration as string | undefined
      const role = j.Role as string
      output.push(`  [+] ${name} (Role: ${role})`)
      if (!secConfig) {
        output.push(`      [!] No SecurityConfiguration attached`)
        findings.push({
          checkId: "AWS-GLUE-001",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: `glue:job:${name}`,
          title: `Glue job without security configuration: ${name}`,
          details: `Glue job ${name} has no SecurityConfiguration — data at rest/transit may not be encrypted`,
          remediation: "Attach a SecurityConfiguration with encryption settings to the Glue job",
        })
      } else {
        output.push(`      Security Config: ${secConfig}`)
      }
    }
  }

  const devEndpoints = await aws(["glue", "get-dev-endpoints"], profile, region, timeout)
  if (devEndpoints.exitCode === 0) {
    const epList = (tryJson(devEndpoints.stdout)?.DevEndpoints || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Glue Dev Endpoints: ${epList.length}`)
    for (const ep of epList) {
      const name = ep.EndpointName as string
      const status = ep.Status as string
      const subnet = ep.SubnetId as string | undefined
      const publicKey = ep.PublicKey as string | undefined
      output.push(`  [+] ${name} (${status})`)
      output.push(`      Subnet: ${subnet || "No VPC (PUBLIC)"}`)

      if (!subnet) {
        findings.push({
          checkId: "AWS-GLUE-002",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `glue:dev-endpoint:${name}`,
          title: `Public Glue Dev Endpoint: ${name}`,
          details: `Dev Endpoint ${name} has no SubnetId — exposed to public internet`,
          remediation: "Move Dev Endpoint into a VPC subnet or decommission it",
        })
      }

      if (publicKey) {
        output.push(`      Public Key: configured`)
      }
    }
  } else if (!devEndpoints.stderr.includes("AccessDeniedException")) {
    output.push(`\n[-] Cannot list dev endpoints: ${devEndpoints.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function codepipelineEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] CodePipeline Enumeration\n"]

  const pipelines = await aws(["codepipeline", "list-pipelines"], profile, region, timeout)
  if (pipelines.exitCode !== 0) return { output: `[-] Cannot list pipelines: ${pipelines.stderr.trim()}`, findings }
  const pipeList = (tryJson(pipelines.stdout)?.pipelines || []) as Array<Record<string, unknown>>
  output.push(`[+] Pipelines: ${pipeList.length}\n`)

  for (const p of pipeList) {
    const name = p.name as string
    output.push(`  [+] ${name}`)

    const detail = await aws(["codepipeline", "get-pipeline", "--name", name], profile, region, timeout)
    if (detail.exitCode !== 0) continue
    const pipeline = tryJson(detail.stdout)?.pipeline as Record<string, unknown> | undefined
    if (!pipeline) continue

    const stages = (pipeline.stages || []) as Array<Record<string, unknown>>
    output.push(`      Stages: ${stages.length}`)

    const artifactStore = pipeline.artifactStore as Record<string, unknown> | undefined
    if (artifactStore) {
      const storeType = artifactStore.type as string
      const encKey = artifactStore.encryptionKey as Record<string, unknown> | undefined
      output.push(`      Artifact Store: ${storeType}`)
      if (!encKey) {
        output.push(`      [!] Artifact store uses default encryption`)
        findings.push({
          checkId: "AWS-CODEPIPELINE-001",
          provider: "aws",
          severity: "medium",
          status: "WARN",
          resource: `codepipeline:${name}`,
          title: `Unencrypted artifact store: ${name}`,
          details: `Pipeline ${name} uses default S3 encryption for artifacts — no KMS key configured`,
          remediation: "Configure a KMS encryption key on the pipeline artifact store",
        })
      }
    }

    for (const stage of stages) {
      const stageName = stage.name as string
      const actions = (stage.actions || []) as Array<Record<string, unknown>>
      for (const action of actions) {
        const actionName = action.name as string
        const config = action.configuration as Record<string, unknown> | undefined
        const roleArn = action.roleArn as string | undefined

        if (roleArn && roleArn.includes(":iam::") && config) {
          const actionAccountId = roleArn.split(":")[4]
          const pipelineRoleArn = pipeline.roleArn as string
          const pipelineAccountId = pipelineRoleArn ? pipelineRoleArn.split(":")[4] : ""
          if (actionAccountId && pipelineAccountId && actionAccountId !== pipelineAccountId) {
            output.push(`      [!] Cross-account action: ${stageName}/${actionName} → account ${actionAccountId}`)
            findings.push({
              checkId: "AWS-CODEPIPELINE-002",
              provider: "aws",
              severity: "medium",
              status: "INFO",
              resource: `codepipeline:${name}:${stageName}:${actionName}`,
              title: `Cross-account pipeline action: ${name}/${stageName}/${actionName}`,
              details: `Action assumes role in account ${actionAccountId} (pipeline is in ${pipelineAccountId})`,
              remediation: "Verify cross-account IAM roles follow least-privilege principle",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function eventbridgeEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] EventBridge Enumeration\n"]

  const buses = await aws(["events", "list-event-buses"], profile, region, timeout)
  if (buses.exitCode !== 0) return { output: `[-] Cannot list event buses: ${buses.stderr.trim()}`, findings }
  const busList = (tryJson(buses.stdout)?.EventBuses || []) as Array<Record<string, unknown>>
  output.push(`[+] Event Buses: ${busList.length}\n`)

  for (const bus of busList) {
    const name = bus.Name as string
    const arn = bus.Arn as string
    const policy = bus.Policy as string | undefined
    output.push(`  [+] ${name}`)
    output.push(`      ARN: ${arn}`)

    if (policy) {
      const policyDoc = tryJson(policy) as Record<string, unknown> | null
      if (policyDoc) {
        const statements = (policyDoc.Statement || []) as Array<Record<string, unknown>>
        for (const stmt of statements) {
          const principal = stmt.Principal as unknown
          const effect = stmt.Effect as string
          const principalStr = typeof principal === "string" ? principal : JSON.stringify(principal)
          if (effect === "Allow" && (principalStr === '"*"' || principalStr === "*" || principalStr.includes('"*"'))) {
            output.push(`      [!] Event bus policy allows Principal: *`)
            findings.push({
              checkId: "AWS-EB-001",
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: arn,
              title: `EventBridge bus open policy: ${name}`,
              details: `Event bus ${name} has a policy with Principal: * — any AWS account can send events`,
              remediation: "Restrict the event bus policy to specific accounts/principals",
            })
          }
        }
      }
    }
  }

  const rules = await aws(["events", "list-rules"], profile, region, timeout)
  if (rules.exitCode === 0) {
    const ruleList = (tryJson(rules.stdout)?.Rules || []) as Array<Record<string, unknown>>
    output.push(`\n[+] EventBridge Rules: ${ruleList.length}`)
    for (const rule of ruleList) {
      const name = rule.Name as string
      const state = rule.State as string
      const bus = rule.EventBusName as string
      output.push(`  [+] ${name} (${state}, bus: ${bus})`)

      const targets = await aws(
        ["events", "list-targets-by-rule", "--rule", name, "--event-bus-name", bus],
        profile,
        region,
        timeout,
      )
      if (targets.exitCode === 0) {
        const targetList = (tryJson(targets.stdout)?.Targets || []) as Array<Record<string, unknown>>
        output.push(`      Targets: ${targetList.length}`)
        for (const t of targetList) {
          output.push(`        → ${t.Arn}`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function wafEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] WAF v2 Enumeration\n"]

  const regionalAcls = await aws(
    ["wafv2", "list-web-acls", "--scope", "REGIONAL"],
    profile,
    region,
    timeout,
  )
  if (regionalAcls.exitCode === 0) {
    const acls = (tryJson(regionalAcls.stdout)?.WebACLs || []) as Array<Record<string, unknown>>
    output.push(`[+] Regional Web ACLs: ${acls.length}`)

    for (const acl of acls) {
      const name = acl.Name as string
      const id = acl.Id as string
      const arn = acl.ARN as string
      output.push(`\n  [+] ${name} (${id})`)

      const detail = await aws(
        ["wafv2", "get-web-acl", "--name", name, "--scope", "REGIONAL", "--id", id],
        profile,
        region,
        timeout,
      )
      if (detail.exitCode !== 0) continue
      const webAcl = tryJson(detail.stdout)?.WebACL as Record<string, unknown> | undefined
      if (!webAcl) continue

      const rules = (webAcl.Rules || []) as Array<Record<string, unknown>>
      const defaultAction = webAcl.DefaultAction as Record<string, unknown>
      output.push(`      Rules: ${rules.length}`)
      output.push(`      Default Action: ${Object.keys(defaultAction || {}).join(",")}`)

      for (const rule of rules) {
        const rName = rule.Name as string
        const stmt = rule.Statement as Record<string, unknown>
        if (stmt?.ManagedRuleGroupStatement) {
          const mrg = stmt.ManagedRuleGroupStatement as Record<string, unknown>
          output.push(`      Managed Rule: ${mrg.VendorName}/${mrg.Name}`)
        } else {
          output.push(`      Rule: ${rName}`)
        }
      }
    }
  }

  const cfAcls = await aws(
    ["wafv2", "list-web-acls", "--scope", "CLOUDFRONT", "--region", "us-east-1"],
    profile,
    undefined,
    timeout,
  )
  if (cfAcls.exitCode === 0) {
    const acls = (tryJson(cfAcls.stdout)?.WebACLs || []) as Array<Record<string, unknown>>
    output.push(`\n[+] CloudFront Web ACLs: ${acls.length}`)

    for (const acl of acls) {
      const name = acl.Name as string
      const id = acl.Id as string
      output.push(`  [+] ${name} (${id})`)

      const detail = await aws(
        ["wafv2", "get-web-acl", "--name", name, "--scope", "CLOUDFRONT", "--id", id, "--region", "us-east-1"],
        profile,
        undefined,
        timeout,
      )
      if (detail.exitCode !== 0) continue
      const webAcl = tryJson(detail.stdout)?.WebACL as Record<string, unknown> | undefined
      if (!webAcl) continue

      const rules = (webAcl.Rules || []) as Array<Record<string, unknown>>
      output.push(`      Rules: ${rules.length}`)
    }
  }

  const ipSets = await aws(
    ["wafv2", "list-ip-sets", "--scope", "REGIONAL"],
    profile,
    region,
    timeout,
  )
  if (ipSets.exitCode === 0) {
    const sets = (tryJson(ipSets.stdout)?.IPSets || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Regional IP Sets: ${sets.length}`)
    for (const s of sets) {
      output.push(`  [+] ${s.Name} (${s.Id})`)
    }
  }

  findings.push({
    checkId: "AWS-WAF-ENUM-001",
    provider: "aws",
    severity: "info",
    status: "INFO",
    resource: "wafv2",
    title: "WAF configuration enumerated",
    details: "WAFv2 Web ACLs, rules, managed rule groups, and IP sets inventoried",
    remediation: "Review WAF rules for coverage against OWASP Top 10",
  })

  return { output: output.join("\n"), findings }
}

export async function cloudtrailEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudTrail Enumeration\n"]

  const trails = await aws(["cloudtrail", "describe-trails"], profile, region, timeout)
  if (trails.exitCode !== 0) return { output: `[-] Cannot describe trails: ${trails.stderr.trim()}`, findings }
  const trailList = (tryJson(trails.stdout)?.trailList || []) as Array<Record<string, unknown>>
  output.push(`[+] CloudTrail Trails: ${trailList.length}\n`)

  if (trailList.length === 0) {
    findings.push({
      checkId: "AWS-CT-ENUM-001",
      provider: "aws",
      severity: "critical",
      status: "FAIL",
      resource: "cloudtrail",
      title: "No CloudTrail trails configured",
      details: "No CloudTrail trails exist in this region — API activity is not being logged",
      remediation: "Create a multi-region CloudTrail trail with S3 and CloudWatch Logs delivery",
    })
    return { output: output.join("\n"), findings }
  }

  for (const trail of trailList) {
    const name = trail.Name as string
    const arn = trail.TrailARN as string
    const isMultiRegion = trail.IsMultiRegionTrail as boolean
    const logGroup = trail.CloudWatchLogsLogGroupArn as string | undefined
    const s3Bucket = trail.S3BucketName as string
    const isOrg = trail.IsOrganizationTrail as boolean
    const kmsKey = trail.KmsKeyId as string | undefined

    output.push(`  [+] ${name}`)
    output.push(`      ARN: ${arn}`)
    output.push(`      Multi-Region: ${isMultiRegion}`)
    output.push(`      Organization Trail: ${isOrg}`)
    output.push(`      S3 Bucket: ${s3Bucket}`)
    output.push(`      CloudWatch Logs: ${logGroup || "None"}`)
    output.push(`      KMS Key: ${kmsKey || "None (SSE-S3)"}`)

    if (!isMultiRegion) {
      findings.push({
        checkId: "AWS-CT-ENUM-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: arn,
        title: `CloudTrail not multi-region: ${name}`,
        details: `Trail ${name} is single-region — API calls in other regions are not captured`,
        remediation: "Enable multi-region logging for comprehensive audit coverage",
      })
    }

    const status = await aws(
      ["cloudtrail", "get-trail-status", "--name", name],
      profile,
      region,
      timeout,
    )
    if (status.exitCode === 0) {
      const st = tryJson(status.stdout) as Record<string, unknown> | null
      if (st) {
        const isLogging = st.IsLogging as boolean
        output.push(`      Is Logging: ${isLogging}`)

        if (!isLogging) {
          findings.push({
            checkId: "AWS-CT-ENUM-002",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: arn,
            title: `CloudTrail not logging: ${name}`,
            details: `Trail ${name} exists but logging is stopped — no audit events being recorded`,
            remediation: "Start logging immediately: aws cloudtrail start-logging --name " + name,
          })
        }

        if (st.LatestDeliveryError) {
          output.push(`      [!] Delivery Error: ${st.LatestDeliveryError}`)
        }
      }
    }

    const selectors = await aws(
      ["cloudtrail", "get-event-selectors", "--trail-name", name],
      profile,
      region,
      timeout,
    )
    if (selectors.exitCode === 0) {
      const sel = tryJson(selectors.stdout) as Record<string, unknown> | null
      if (sel) {
        const eventSelectors = (sel.EventSelectors || []) as Array<Record<string, unknown>>
        const advancedSelectors = (sel.AdvancedEventSelectors || []) as Array<Record<string, unknown>>
        output.push(`      Event Selectors: ${eventSelectors.length}, Advanced: ${advancedSelectors.length}`)

        let hasInsights = false
        if (sel.InsightSelectors) {
          const insights = sel.InsightSelectors as Array<Record<string, unknown>>
          hasInsights = insights.length > 0
        }

        if (!hasInsights) {
          findings.push({
            checkId: "AWS-CT-ENUM-003",
            provider: "aws",
            severity: "low",
            status: "WARN",
            resource: arn,
            title: `No insight selectors: ${name}`,
            details: `Trail ${name} does not have CloudTrail Insights enabled for anomaly detection`,
            remediation: "Enable CloudTrail Insights to detect unusual API activity",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function configEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Config Enumeration\n"]

  const recorders = await aws(
    ["configservice", "describe-configuration-recorders"],
    profile,
    region,
    timeout,
  )
  if (recorders.exitCode === 0) {
    const recList = (tryJson(recorders.stdout)?.ConfigurationRecorders || []) as Array<Record<string, unknown>>
    output.push(`[+] Configuration Recorders: ${recList.length}`)

    if (recList.length === 0) {
      findings.push({
        checkId: "AWS-CONFIG-ENUM-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: "configservice",
        title: "No AWS Config recorders configured",
        details: "No configuration recorders exist — resource changes are not being tracked",
        remediation: "Create an AWS Config configuration recorder to track resource changes",
      })
    }

    for (const rec of recList) {
      const name = rec.name as string
      const roleArn = rec.roleARN as string
      const recording = rec.recordingGroup as Record<string, unknown> | undefined
      output.push(`  [+] ${name}`)
      output.push(`      Role: ${roleArn}`)
      if (recording) {
        output.push(`      All Resources: ${recording.allSupported}`)
        output.push(`      Include Global: ${recording.includeGlobalResourceTypes}`)
      }
    }
  }

  const recorderStatus = await aws(
    ["configservice", "describe-configuration-recorder-status"],
    profile,
    region,
    timeout,
  )
  if (recorderStatus.exitCode === 0) {
    const statusList = (tryJson(recorderStatus.stdout)?.ConfigurationRecordersStatus || []) as Array<Record<string, unknown>>
    for (const st of statusList) {
      const name = st.name as string
      const recording = st.recording as boolean
      const lastStatus = st.lastStatus as string
      output.push(`\n      Recorder ${name}: recording=${recording}, lastStatus=${lastStatus}`)

      if (!recording) {
        findings.push({
          checkId: "AWS-CONFIG-ENUM-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `configservice:recorder:${name}`,
          title: `Config recorder not recording: ${name}`,
          details: `Configuration recorder ${name} exists but is not currently recording`,
          remediation: "Start the configuration recorder: aws configservice start-configuration-recorder",
        })
      }
    }
  }

  const channels = await aws(
    ["configservice", "describe-delivery-channels"],
    profile,
    region,
    timeout,
  )
  if (channels.exitCode === 0) {
    const chList = (tryJson(channels.stdout)?.DeliveryChannels || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Delivery Channels: ${chList.length}`)
    for (const ch of chList) {
      const name = ch.name as string
      const bucket = ch.s3BucketName as string
      const sns = ch.snsTopicARN as string | undefined
      output.push(`  [+] ${name} → S3: ${bucket}${sns ? ", SNS: " + sns : ""}`)
    }
  }

  const compliance = await aws(
    ["configservice", "describe-compliance-by-config-rule", "--compliance-types", "NON_COMPLIANT"],
    profile,
    region,
    timeout,
  )
  if (compliance.exitCode === 0) {
    const rules = (tryJson(compliance.stdout)?.ComplianceByConfigRules || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Non-Compliant Config Rules: ${rules.length}`)
    for (const r of rules) {
      const ruleName = r.ConfigRuleName as string
      output.push(`  [!] ${ruleName}: NON_COMPLIANT`)
    }

    if (rules.length > 0) {
      findings.push({
        checkId: "AWS-CONFIG-ENUM-002",
        provider: "aws",
        severity: "medium",
        status: "WARN",
        resource: "configservice",
        title: `${rules.length} non-compliant Config rules`,
        details: `Found ${rules.length} Config rules in NON_COMPLIANT state: ${rules.slice(0, 5).map((r) => r.ConfigRuleName).join(", ")}${rules.length > 5 ? "..." : ""}`,
        remediation: "Review and remediate non-compliant Config rules",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function guarddutyEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] GuardDuty Enumeration\n"]

  const detectors = await aws(["guardduty", "list-detectors"], profile, region, timeout)
  if (detectors.exitCode !== 0) return { output: `[-] Cannot list detectors: ${detectors.stderr.trim()}`, findings }
  const detectorIds = (tryJson(detectors.stdout)?.DetectorIds || []) as string[]
  output.push(`[+] GuardDuty Detectors: ${detectorIds.length}`)

  if (detectorIds.length === 0) {
    findings.push({
      checkId: "AWS-GD-ENUM-001",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: "guardduty",
      title: "GuardDuty not enabled",
      details: "No GuardDuty detectors found in this region — threat detection is disabled",
      remediation: "Enable GuardDuty to detect malicious activity and unauthorized behavior",
    })
    return { output: output.join("\n"), findings }
  }

  for (const id of detectorIds) {
    const detail = await aws(
      ["guardduty", "get-detector", "--detector-id", id],
      profile,
      region,
      timeout,
    )
    if (detail.exitCode !== 0) continue
    const det = tryJson(detail.stdout) as Record<string, unknown> | null
    if (!det) continue

    const status = det.Status as string
    const created = det.CreatedAt as string
    const updated = det.UpdatedAt as string
    output.push(`\n  [+] Detector: ${id}`)
    output.push(`      Status: ${status}`)
    output.push(`      Created: ${created}`)
    output.push(`      Updated: ${updated}`)

    if (status !== "ENABLED") {
      findings.push({
        checkId: "AWS-GD-ENUM-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `guardduty:detector:${id}`,
        title: `GuardDuty detector disabled: ${id}`,
        details: `GuardDuty detector ${id} exists but status is ${status}`,
        remediation: "Enable the GuardDuty detector",
      })
    }

    const features = (det.Features || []) as Array<Record<string, unknown>>
    if (features.length > 0) {
      output.push(`      Features:`)
      for (const f of features) {
        output.push(`        ${f.Name}: ${f.Status}`)
      }
    }

    const findingsStats = await aws(
      ["guardduty", "get-findings-statistics", "--detector-id", id, "--finding-statistic-types", "COUNT_BY_SEVERITY"],
      profile,
      region,
      timeout,
    )
    if (findingsStats.exitCode === 0) {
      const stats = tryJson(findingsStats.stdout)?.FindingStatistics as Record<string, unknown> | undefined
      if (stats?.CountBySeverity) {
        const bySev = stats.CountBySeverity as Record<string, number>
        output.push(`      Finding Counts by Severity:`)
        let highCount = 0
        for (const [sev, count] of Object.entries(bySev)) {
          output.push(`        Severity ${sev}: ${count}`)
          const sevNum = parseFloat(sev)
          if (sevNum >= 7) highCount += count
        }

        if (highCount > 0) {
          findings.push({
            checkId: "AWS-GD-ENUM-002",
            provider: "aws",
            severity: "high",
            status: "FAIL",
            resource: `guardduty:detector:${id}`,
            title: `GuardDuty high-severity findings: ${highCount}`,
            details: `GuardDuty detected ${highCount} high/critical severity finding(s) that require investigation`,
            remediation: "Review and triage high-severity GuardDuty findings immediately",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function securityHubEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Security Hub Enumeration\n"]

  const hub = await aws(["securityhub", "describe-hub"], profile, region, timeout)
  if (hub.exitCode !== 0) {
    output.push(`[-] Security Hub not enabled: ${hub.stderr.trim()}`)
    findings.push({
      checkId: "AWS-SECHUB-ENUM-001",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: "securityhub",
      title: "Security Hub not enabled",
      details: "AWS Security Hub is not enabled in this region",
      remediation: "Enable Security Hub for centralized security findings and compliance checks",
    })
    return { output: output.join("\n"), findings }
  }

  const hubInfo = tryJson(hub.stdout) as Record<string, unknown> | null
  if (hubInfo) {
    output.push(`[+] Security Hub: ENABLED`)
    output.push(`    Hub ARN: ${hubInfo.HubArn}`)
    output.push(`    Subscribed: ${hubInfo.SubscribedAt}`)
    output.push(`    Auto-Enable Controls: ${hubInfo.AutoEnableControls}`)
  }

  const standards = await aws(["securityhub", "get-enabled-standards"], profile, region, timeout)
  if (standards.exitCode === 0) {
    const stdList = (tryJson(standards.stdout)?.StandardsSubscriptions || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Enabled Standards: ${stdList.length}`)
    for (const std of stdList) {
      const arn = std.StandardsArn as string
      const status = std.StandardsStatus as string
      output.push(`  [+] ${arn} (${status})`)
    }
  }

  const criticalFindings = await aws(
    [
      "securityhub",
      "get-findings",
      "--filters",
      '{"SeverityLabel":[{"Value":"CRITICAL","Comparison":"EQUALS"}]}',
      "--max-results",
      "20",
    ],
    profile,
    region,
    timeout,
  )
  if (criticalFindings.exitCode === 0) {
    const fList = (tryJson(criticalFindings.stdout)?.Findings || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Critical Findings (up to 20): ${fList.length}`)
    for (const f of fList) {
      const title = f.Title as string
      const resource = (f.Resources as Array<Record<string, unknown>>)?.[0]
      output.push(`  [!] ${title}`)
      if (resource) output.push(`      Resource: ${resource.Type} — ${resource.Id}`)
    }

    if (fList.length > 0) {
      findings.push({
        checkId: "AWS-SECHUB-ENUM-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "securityhub",
        title: `Security Hub: ${fList.length} critical finding(s)`,
        details: `Found ${fList.length} CRITICAL severity findings in Security Hub`,
        remediation: "Review and remediate critical Security Hub findings immediately",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function inspectorEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Inspector v2 Enumeration\n"]

  const status = await aws(["inspector2", "batch-get-account-status"], profile, region, timeout)
  if (status.exitCode !== 0) {
    output.push(`[-] Inspector v2 not available: ${status.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const accounts = (tryJson(status.stdout)?.accounts || []) as Array<Record<string, unknown>>
  for (const acct of accounts) {
    const accountId = acct.accountId as string
    const state = acct.state as Record<string, unknown> | undefined
    const stateStatus = state?.status as string
    output.push(`[+] Account ${accountId}: ${stateStatus}`)

    const resourceState = acct.resourceState as Record<string, unknown> | undefined
    if (resourceState) {
      const ec2 = resourceState.ec2 as Record<string, unknown> | undefined
      const ecr = resourceState.ecr as Record<string, unknown> | undefined
      const lambda = resourceState.lambda as Record<string, unknown> | undefined
      output.push(`    EC2 scanning: ${(ec2?.status as string) || "UNKNOWN"}`)
      output.push(`    ECR scanning: ${(ecr?.status as string) || "UNKNOWN"}`)
      output.push(`    Lambda scanning: ${(lambda?.status as string) || "UNKNOWN"}`)

      if (stateStatus !== "ENABLED") {
        findings.push({
          checkId: "AWS-INSPECTOR-ENUM-001",
          provider: "aws",
          severity: "high",
          status: "FAIL",
          resource: `inspector2:account:${accountId}`,
          title: `Inspector scanning not fully enabled: ${accountId}`,
          details: `Inspector v2 status is ${stateStatus} for account ${accountId}`,
          remediation: "Enable all Inspector v2 scan types (EC2, ECR, Lambda)",
        })
      }
    }
  }

  const coverage = await aws(
    ["inspector2", "list-coverage", "--filter-criteria", "{}", "--max-results", "50"],
    profile,
    region,
    timeout,
  )
  if (coverage.exitCode === 0) {
    const resources = (tryJson(coverage.stdout)?.coveredResources || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Covered Resources (up to 50): ${resources.length}`)
    const byType: Record<string, number> = {}
    for (const r of resources) {
      const rType = r.resourceType as string
      byType[rType] = (byType[rType] || 0) + 1
    }
    for (const [type, count] of Object.entries(byType)) {
      output.push(`    ${type}: ${count}`)
    }
  }

  const aggregations = await aws(
    ["inspector2", "list-finding-aggregations", "--aggregation-type", "SEVERITY"],
    profile,
    region,
    timeout,
  )
  if (aggregations.exitCode === 0) {
    const responses = (tryJson(aggregations.stdout)?.responses || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Finding Aggregations by Severity:`)
    for (const r of responses) {
      const severity = r.severityCount as Record<string, unknown> | undefined
      if (severity) {
        output.push(`    Critical: ${severity.all || 0}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function backupEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS Backup Enumeration\n"]

  const plans = await aws(["backup", "list-backup-plans"], profile, region, timeout)
  if (plans.exitCode === 0) {
    const planList = (tryJson(plans.stdout)?.BackupPlansList || []) as Array<Record<string, unknown>>
    output.push(`[+] Backup Plans: ${planList.length}`)
    for (const p of planList) {
      const name = p.BackupPlanName as string
      const id = p.BackupPlanId as string
      output.push(`  [+] ${name} (${id})`)
    }
  }

  const vaults = await aws(["backup", "list-backup-vaults"], profile, region, timeout)
  if (vaults.exitCode !== 0) return { output: `[-] Cannot list backup vaults: ${vaults.stderr.trim()}`, findings }
  const vaultList = (tryJson(vaults.stdout)?.BackupVaultList || []) as Array<Record<string, unknown>>
  output.push(`\n[+] Backup Vaults: ${vaultList.length}`)

  for (const v of vaultList) {
    const name = v.BackupVaultName as string
    const arn = v.BackupVaultArn as string
    const encrypted = v.EncryptionKeyArn as string | undefined
    const recoveryPoints = v.NumberOfRecoveryPoints as number
    output.push(`\n  [+] ${name}`)
    output.push(`      ARN: ${arn}`)
    output.push(`      Encryption: ${encrypted || "Default"}`)
    output.push(`      Recovery Points: ${recoveryPoints}`)

    const rp = await aws(
      ["backup", "list-recovery-points-by-backup-vault", "--backup-vault-name", name, "--max-results", "20"],
      profile,
      region,
      timeout,
    )
    if (rp.exitCode === 0) {
      const rpList = (tryJson(rp.stdout)?.RecoveryPoints || []) as Array<Record<string, unknown>>
      output.push(`      Recent Recovery Points: ${rpList.length}`)
      for (const point of rpList.slice(0, 5)) {
        const arn = point.RecoveryPointArn as string
        const resType = point.ResourceType as string
        const created = point.CreationDate as string
        const status = point.Status as string
        output.push(`        ${resType}: ${status} (${created})`)
      }
    }

    const policy = await aws(
      ["backup", "get-backup-vault-access-policy", "--backup-vault-name", name],
      profile,
      region,
      timeout,
    )
    if (policy.exitCode === 0) {
      const vaultPolicy = tryJson(policy.stdout) as Record<string, unknown> | null
      if (vaultPolicy?.Policy) {
        const policyDoc = typeof vaultPolicy.Policy === "string" ? vaultPolicy.Policy : JSON.stringify(vaultPolicy.Policy)
        if (policyDoc.includes('"*"') || policyDoc.includes("\"*\"")) {
          output.push(`      [!] Vault access policy allows broad access (Principal: *)`)
          findings.push({
            checkId: "AWS-BACKUP-010",
            provider: "aws",
            severity: "high",
            status: "FAIL",
            resource: arn,
            title: `Backup vault open policy: ${name}`,
            details: `Backup vault ${name} has an access policy with Principal: * — any account can access backups`,
            remediation: "Restrict vault access policy to specific accounts and principals",
          })
        }
      }
    }

    if (recoveryPoints === 0) {
      findings.push({
        checkId: "AWS-BACKUP-011",
        provider: "aws",
        severity: "medium",
        status: "WARN",
        resource: arn,
        title: `Empty backup vault: ${name}`,
        details: `Backup vault ${name} has zero recovery points — either backups are not running or vault is unused`,
        remediation: "Verify backup plans are configured and running for critical resources",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function athenaEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Athena Enumeration\n"]

  const workgroups = await aws(["athena", "list-work-groups"], profile, region, timeout)
  if (workgroups.exitCode === 0) {
    const wgList = (tryJson(workgroups.stdout)?.WorkGroups || []) as Array<Record<string, unknown>>
    output.push(`[+] Athena Work Groups: ${wgList.length}`)

    for (const wg of wgList) {
      const name = wg.Name as string
      const state = wg.State as string
      output.push(`\n  [+] ${name} (${state})`)

      const detail = await aws(
        ["athena", "get-work-group", "--work-group", name],
        profile,
        region,
        timeout,
      )
      if (detail.exitCode !== 0) continue
      const workGroup = tryJson(detail.stdout)?.WorkGroup as Record<string, unknown> | undefined
      if (!workGroup) continue

      const config = workGroup.Configuration as Record<string, unknown> | undefined
      if (config) {
        const resultConfig = config.ResultConfiguration as Record<string, unknown> | undefined
        const encConfig = resultConfig?.EncryptionConfiguration as Record<string, unknown> | undefined
        const outputLocation = resultConfig?.OutputLocation as string

        output.push(`      Output: ${outputLocation || "Not configured"}`)

        if (!encConfig) {
          output.push(`      [!] Result encryption: NOT configured`)
          findings.push({
            checkId: "AWS-ATHENA-001",
            provider: "aws",
            severity: "medium",
            status: "FAIL",
            resource: `athena:workgroup:${name}`,
            title: `Athena workgroup without encryption: ${name}`,
            details: `Workgroup ${name} does not encrypt query results — data at rest may be exposed`,
            remediation: "Configure EncryptionConfiguration on the workgroup's ResultConfiguration",
          })
        } else {
          const encType = encConfig.EncryptionOption as string
          output.push(`      Encryption: ${encType}`)
        }

        const enforceConfig = config.EnforceWorkGroupConfiguration as boolean
        output.push(`      Enforce Config: ${enforceConfig}`)
      }
    }
  }

  const catalogs = await aws(["athena", "list-data-catalogs"], profile, region, timeout)
  if (catalogs.exitCode === 0) {
    const catList = (tryJson(catalogs.stdout)?.DataCatalogsSummary || []) as Array<Record<string, unknown>>
    output.push(`\n[+] Data Catalogs: ${catList.length}`)
    for (const cat of catList) {
      output.push(`  [+] ${cat.CatalogName} (${cat.Type})`)
    }
  }

  const queries = await aws(["athena", "list-named-queries"], profile, region, timeout)
  if (queries.exitCode === 0) {
    const qList = (tryJson(queries.stdout)?.NamedQueryIds || []) as string[]
    output.push(`\n[+] Named Queries: ${qList.length}`)

    findings.push({
      checkId: "AWS-ATHENA-002",
      provider: "aws",
      severity: "info",
      status: "INFO",
      resource: "athena",
      title: `Athena: ${qList.length} named queries found`,
      details: "Saved queries may contain information about data schema and access patterns",
      remediation: "Review named queries for sensitive data references",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function emrEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] EMR Enumeration\n"]

  const clusters = await aws(["emr", "list-clusters", "--active"], profile, region, timeout)
  if (clusters.exitCode !== 0) return { output: `[-] Cannot list EMR clusters: ${clusters.stderr.trim()}`, findings }
  const clusterList = (tryJson(clusters.stdout)?.Clusters || []) as Array<Record<string, unknown>>
  output.push(`[+] Active EMR Clusters: ${clusterList.length}\n`)

  for (const cl of clusterList) {
    const id = cl.Id as string
    const name = cl.Name as string
    const status = (cl.Status as Record<string, unknown>)?.State as string
    output.push(`  [+] ${name} (${id}, ${status})`)

    const desc = await aws(
      ["emr", "describe-cluster", "--cluster-id", id],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode !== 0) continue
    const cluster = tryJson(desc.stdout)?.Cluster as Record<string, unknown> | undefined
    if (!cluster) continue

    const visibleToAll = cluster.VisibleToAllUsers as boolean
    const secConfig = cluster.SecurityConfiguration as string | undefined
    const autoTerminate = cluster.AutoTerminate as boolean
    const apps = (cluster.Applications || []) as Array<Record<string, unknown>>

    output.push(`      Visible to All Users: ${visibleToAll}`)
    output.push(`      Security Config: ${secConfig || "None"}`)
    output.push(`      Auto Terminate: ${autoTerminate}`)
    output.push(`      Applications: ${apps.map((a) => a.Name).join(", ")}`)

    if (visibleToAll) {
      findings.push({
        checkId: "AWS-EMR-001",
        provider: "aws",
        severity: "medium",
        status: "WARN",
        resource: `emr:cluster:${id}`,
        title: `EMR cluster visible to all users: ${name}`,
        details: `Cluster ${name} (${id}) has VisibleToAllUsers=true — all IAM users in the account can view and access`,
        remediation: "Set VisibleToAllUsers to false and use IAM policies for access control",
      })
    }

    if (!secConfig) {
      findings.push({
        checkId: "AWS-EMR-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `emr:cluster:${id}`,
        title: `EMR cluster without security configuration: ${name}`,
        details: `Cluster ${name} (${id}) has no SecurityConfiguration — data in transit/at rest may not be encrypted`,
        remediation: "Create and attach an EMR SecurityConfiguration with encryption and authentication settings",
      })
    }

    const ec2 = cluster.Ec2InstanceAttributes as Record<string, unknown> | undefined
    if (ec2) {
      const subnet = ec2.Ec2SubnetId as string | undefined
      const keyName = ec2.Ec2KeyName as string | undefined
      output.push(`      Subnet: ${subnet || "No VPC"}`)
      output.push(`      Key Pair: ${keyName || "None"}`)
    }
  }

  const secConfigs = await aws(["emr", "list-security-configurations"], profile, region, timeout)
  if (secConfigs.exitCode === 0) {
    const scList = (tryJson(secConfigs.stdout)?.SecurityConfigurations || []) as Array<Record<string, unknown>>
    output.push(`\n[+] EMR Security Configurations: ${scList.length}`)
    for (const sc of scList) {
      output.push(`  [+] ${sc.Name} (created: ${sc.CreationDateTime})`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function mskEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] MSK (Managed Kafka) Enumeration\n"]

  const clusters = await aws(["kafka", "list-clusters-v2"], profile, region, timeout)
  if (clusters.exitCode !== 0) return { output: `[-] Cannot list MSK clusters: ${clusters.stderr.trim()}`, findings }
  const clusterList = (tryJson(clusters.stdout)?.ClusterInfoList || []) as Array<Record<string, unknown>>
  output.push(`[+] MSK Clusters: ${clusterList.length}\n`)

  for (const cl of clusterList) {
    const arn = cl.ClusterArn as string
    const name = cl.ClusterName as string
    const clType = cl.ClusterType as string
    const state = cl.State as string
    output.push(`  [+] ${name} (${clType}, ${state})`)

    const desc = await aws(
      ["kafka", "describe-cluster-v2", "--cluster-arn", arn],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode !== 0) continue
    const cluster = tryJson(desc.stdout)?.ClusterInfo as Record<string, unknown> | undefined
    if (!cluster) continue

    if (clType === "PROVISIONED") {
      const provisioned = cluster.Provisioned as Record<string, unknown> | undefined
      if (provisioned) {
        const clientAuth = provisioned.ClientAuthentication as Record<string, unknown> | undefined
        const encryption = provisioned.EncryptionInfo as Record<string, unknown> | undefined
        const monitoring = provisioned.OpenMonitoring as Record<string, unknown> | undefined
        const brokerCount = provisioned.NumberOfBrokerNodes as number

        output.push(`      Broker Nodes: ${brokerCount}`)

        if (clientAuth) {
          const sasl = clientAuth.Sasl as Record<string, unknown> | undefined
          const tls = clientAuth.Tls as Record<string, unknown> | undefined
          const unauthAccess = clientAuth.Unauthenticated as Record<string, unknown> | undefined
          output.push(`      Auth: SASL=${!!sasl}, TLS=${!!tls}, Unauthenticated=${!!(unauthAccess as Record<string, unknown>)?.Enabled}`)

          if ((unauthAccess as Record<string, unknown>)?.Enabled) {
            findings.push({
              checkId: "AWS-MSK-001",
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: arn,
              title: `MSK unauthenticated access enabled: ${name}`,
              details: `MSK cluster ${name} allows unauthenticated client connections`,
              remediation: "Disable unauthenticated access and enable SASL/TLS authentication",
            })
          }
        } else {
          output.push(`      [!] No client authentication configured`)
          findings.push({
            checkId: "AWS-MSK-001",
            provider: "aws",
            severity: "high",
            status: "FAIL",
            resource: arn,
            title: `MSK no authentication: ${name}`,
            details: `MSK cluster ${name} has no client authentication configured`,
            remediation: "Configure SASL/SCRAM or TLS client authentication",
          })
        }

        if (encryption) {
          const inTransit = encryption.EncryptionInTransit as Record<string, unknown> | undefined
          const atRest = encryption.EncryptionAtRest as Record<string, unknown> | undefined
          const clientBroker = inTransit?.ClientBroker as string
          output.push(`      Encryption in transit: ${clientBroker || "UNKNOWN"}`)
          output.push(`      Encryption at rest: ${atRest ? "KMS" : "Default"}`)

          if (clientBroker === "PLAINTEXT") {
            findings.push({
              checkId: "AWS-MSK-002",
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: arn,
              title: `MSK plaintext traffic: ${name}`,
              details: `MSK cluster ${name} allows plaintext client-broker communication`,
              remediation: "Set ClientBroker encryption to TLS or TLS_PLAINTEXT",
            })
          }
        }

        if (monitoring) {
          output.push(`      Open Monitoring: configured`)
        }
      }
    } else if (clType === "SERVERLESS") {
      output.push(`      Type: Serverless (managed security)`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function ecrEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] ECR Enumeration\n"]

  const repos = await aws(["ecr", "describe-repositories"], profile, region, timeout)
  if (repos.exitCode !== 0) return { output: `[-] Cannot list ECR repos: ${repos.stderr.trim()}`, findings }
  const repoList = (tryJson(repos.stdout)?.repositories || []) as Array<Record<string, unknown>>
  output.push(`[+] ECR Repositories: ${repoList.length}\n`)

  for (const repo of repoList) {
    const name = repo.repositoryName as string
    const arn = repo.repositoryArn as string
    const uri = repo.repositoryUri as string
    const scanOnPush = (repo.imageScanningConfiguration as Record<string, unknown>)?.scanOnPush as boolean
    const tagMutability = repo.imageTagMutability as string
    const encryption = (repo.encryptionConfiguration as Record<string, unknown>)?.encryptionType as string

    output.push(`  [+] ${name}`)
    output.push(`      URI: ${uri}`)
    output.push(`      Scan on Push: ${scanOnPush}`)
    output.push(`      Tag Mutability: ${tagMutability}`)
    output.push(`      Encryption: ${encryption || "AES256"}`)

    if (!scanOnPush) {
      findings.push({
        checkId: "AWS-ECR-ENUM-001",
        provider: "aws",
        severity: "medium",
        status: "FAIL",
        resource: arn,
        title: `ECR scan on push disabled: ${name}`,
        details: `Repository ${name} does not automatically scan images on push — vulnerabilities may go undetected`,
        remediation: "Enable image scan on push for the ECR repository",
      })
    }

    if (tagMutability === "MUTABLE") {
      output.push(`      [!] Tags are mutable — image tags can be overwritten`)
    }

    const policy = await aws(
      ["ecr", "get-repository-policy", "--repository-name", name],
      profile,
      region,
      timeout,
    )
    if (policy.exitCode === 0) {
      const policyText = tryJson(policy.stdout)?.policyText as string | undefined
      if (policyText) {
        const policyDoc = tryJson(policyText) as Record<string, unknown> | null
        if (policyDoc) {
          const statements = (policyDoc.Statement || []) as Array<Record<string, unknown>>
          for (const stmt of statements) {
            const principal = stmt.Principal as unknown
            const principalStr = typeof principal === "string" ? principal : JSON.stringify(principal)
            if (principalStr === "*" || principalStr === '"*"' || principalStr.includes('"*"')) {
              output.push(`      [!] Repository policy allows Principal: *`)
              findings.push({
                checkId: "AWS-ECR-ENUM-002",
                provider: "aws",
                severity: "high",
                status: "FAIL",
                resource: arn,
                title: `ECR open repository policy: ${name}`,
                details: `Repository ${name} has a policy with Principal: * — any account can pull images`,
                remediation: "Restrict repository policy to specific AWS accounts or IAM principals",
              })
              break
            }
          }
        }
      }
    }

    const scan = await aws(
      ["ecr", "describe-image-scan-findings", "--repository-name", name, "--image-id", "imageTag=latest"],
      profile,
      region,
      timeout,
    )
    if (scan.exitCode === 0) {
      const scanResult = tryJson(scan.stdout) as Record<string, unknown> | null
      if (scanResult?.imageScanFindings) {
        const scanFindings = scanResult.imageScanFindings as Record<string, unknown>
        const counts = scanFindings.findingSeverityCounts as Record<string, number> | undefined
        if (counts) {
          output.push(`      Scan Findings: CRITICAL=${counts.CRITICAL || 0}, HIGH=${counts.HIGH || 0}, MEDIUM=${counts.MEDIUM || 0}`)
        }
      }
    }

    const lifecycle = await aws(
      ["ecr", "get-lifecycle-policy", "--repository-name", name],
      profile,
      region,
      timeout,
    )
    if (lifecycle.exitCode === 0) {
      output.push(`      Lifecycle Policy: configured`)
    } else {
      output.push(`      Lifecycle Policy: NOT configured`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function appRunnerEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] App Runner Enumeration\n"]

  const services = await aws(["apprunner", "list-services"], profile, region, timeout)
  if (services.exitCode !== 0) return { output: `[-] Cannot list App Runner services: ${services.stderr.trim()}`, findings }
  const svcList = (tryJson(services.stdout)?.ServiceSummaryList || []) as Array<Record<string, unknown>>
  output.push(`[+] App Runner Services: ${svcList.length}\n`)

  for (const svc of svcList) {
    const name = svc.ServiceName as string
    const arn = svc.ServiceArn as string
    const status = svc.Status as string
    const url = svc.ServiceUrl as string
    output.push(`  [+] ${name} (${status})`)
    output.push(`      URL: ${url}`)
    output.push(`      ARN: ${arn}`)

    const desc = await aws(
      ["apprunner", "describe-service", "--service-arn", arn],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode !== 0) continue
    const service = tryJson(desc.stdout)?.Service as Record<string, unknown> | undefined
    if (!service) continue

    const networkConfig = service.NetworkConfiguration as Record<string, unknown> | undefined
    const sourceConfig = service.SourceConfiguration as Record<string, unknown> | undefined
    const healthCheck = service.HealthCheckConfiguration as Record<string, unknown> | undefined
    const autoScaling = service.AutoScalingConfigurationSummary as Record<string, unknown> | undefined

    if (networkConfig) {
      const egress = networkConfig.EgressConfiguration as Record<string, unknown> | undefined
      const ingress = networkConfig.IngressConfiguration as Record<string, unknown> | undefined
      const egressType = egress?.EgressType as string
      output.push(`      Egress: ${egressType || "DEFAULT"}`)
      if (ingress) {
        output.push(`      Public Ingress: ${(ingress as Record<string, unknown>).IsPubliclyAccessible}`)
      }

      const vpcConnector = egress?.VpcConnectorArn as string | undefined
      output.push(`      VPC Connector: ${vpcConnector || "None"}`)
    }

    if (healthCheck) {
      const protocol = healthCheck.Protocol as string
      const path = healthCheck.Path as string | undefined
      output.push(`      Health Check: ${protocol}${path ? " " + path : ""}`)
    }

    if (autoScaling) {
      output.push(`      Auto Scaling: ${autoScaling.AutoScalingConfigurationName}`)
    }

    findings.push({
      checkId: "AWS-APPRUNNER-001",
      provider: "aws",
      severity: "info",
      status: "INFO",
      resource: arn,
      title: `App Runner service: ${name}`,
      details: `Service ${name} at ${url} — review network configuration and access controls`,
      remediation: "Ensure VPC connector is used for private resource access; review auto-scaling limits",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function amplifyEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Amplify Enumeration\n"]

  const apps = await aws(["amplify", "list-apps"], profile, region, timeout)
  if (apps.exitCode !== 0) return { output: `[-] Cannot list Amplify apps: ${apps.stderr.trim()}`, findings }
  const appList = (tryJson(apps.stdout)?.apps || []) as Array<Record<string, unknown>>
  output.push(`[+] Amplify Apps: ${appList.length}\n`)

  for (const app of appList) {
    const appId = app.appId as string
    const name = app.name as string
    const defaultDomain = app.defaultDomain as string
    const platform = app.platform as string
    const repository = app.repository as string | undefined
    const basicAuthCreds = app.basicAuthCredentials as string | undefined
    const enableBasicAuth = app.enableBasicAuth as boolean

    output.push(`  [+] ${name} (${appId})`)
    output.push(`      Domain: ${defaultDomain}`)
    output.push(`      Platform: ${platform}`)
    if (repository) output.push(`      Repository: ${repository}`)
    output.push(`      Basic Auth: ${enableBasicAuth ? "ENABLED" : "DISABLED"}`)

    const branches = await aws(
      ["amplify", "list-branches", "--app-id", appId],
      profile,
      region,
      timeout,
    )
    if (branches.exitCode === 0) {
      const branchList = (tryJson(branches.stdout)?.branches || []) as Array<Record<string, unknown>>
      output.push(`      Branches: ${branchList.length}`)
      for (const branch of branchList) {
        const branchName = branch.branchName as string
        const stage = branch.stage as string
        const branchAuth = branch.enableBasicAuth as boolean
        const displayName = branch.displayName as string
        output.push(`        ${branchName} (${stage}${branchAuth ? ", auth: ON" : ""})`)

        if (stage === "PRODUCTION" && !branchAuth && !enableBasicAuth) {
          output.push(`          [*] Production branch without basic auth — expected if public`)
        }
      }
    }
  }

  findings.push({
    checkId: "AWS-AMPLIFY-001",
    provider: "aws",
    severity: "info",
    status: "INFO",
    resource: "amplify",
    title: `Amplify: ${appList.length} app(s) enumerated`,
    details: `Found ${appList.length} Amplify apps — review branch deployment settings and basic auth configuration`,
    remediation: "Ensure non-production branches have basic auth enabled to prevent data leakage",
  })

  return { output: output.join("\n"), findings }
}

export async function acmEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] ACM Certificate Enumeration\n"]

  const certs = await aws(
    ["acm", "list-certificates", "--certificate-statuses", "ISSUED", "PENDING_VALIDATION", "EXPIRED"],
    profile,
    region,
    timeout,
  )
  if (certs.exitCode !== 0) return { output: `[-] Cannot list certificates: ${certs.stderr.trim()}`, findings }
  const certList = (tryJson(certs.stdout)?.CertificateSummaryList || []) as Array<Record<string, unknown>>
  output.push(`[+] ACM Certificates: ${certList.length}\n`)

  const now = Date.now()
  const dayMs = 86400000
  const thirtyDays = 30 * dayMs

  for (const cert of certList) {
    const arn = cert.CertificateArn as string
    const domain = cert.DomainName as string
    const status = cert.Status as string
    output.push(`  [+] ${domain} (${status})`)
    output.push(`      ARN: ${arn}`)

    if (status === "EXPIRED") {
      findings.push({
        checkId: "AWS-ACM-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: arn,
        title: `Expired certificate: ${domain}`,
        details: `ACM certificate for ${domain} has expired`,
        remediation: "Renew or replace the expired certificate",
      })
    }

    const desc = await aws(
      ["acm", "describe-certificate", "--certificate-arn", arn],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode !== 0) continue
    const detail = tryJson(desc.stdout)?.Certificate as Record<string, unknown> | undefined
    if (!detail) continue

    const notAfter = detail.NotAfter as string | undefined
    const keyAlg = detail.KeyAlgorithm as string
    const type = detail.Type as string
    const issuer = detail.Issuer as string
    const sans = (detail.SubjectAlternativeNames || []) as string[]
    const inUseBy = (detail.InUseBy || []) as string[]

    output.push(`      Type: ${type}`)
    output.push(`      Issuer: ${issuer}`)
    output.push(`      Key Algorithm: ${keyAlg}`)
    output.push(`      SANs: ${sans.join(", ")}`)
    output.push(`      In Use By: ${inUseBy.length} resource(s)`)

    if (notAfter) {
      const expiryMs = new Date(notAfter).getTime()
      const daysUntilExpiry = Math.floor((expiryMs - now) / dayMs)
      output.push(`      Expires: ${notAfter} (${daysUntilExpiry} days)`)

      if (daysUntilExpiry > 0 && daysUntilExpiry <= 30) {
        findings.push({
          checkId: "AWS-ACM-001",
          provider: "aws",
          severity: "high",
          status: "WARN",
          resource: arn,
          title: `Certificate expiring soon: ${domain}`,
          details: `Certificate for ${domain} expires in ${daysUntilExpiry} days (${notAfter})`,
          remediation: "Renew the certificate before expiry; ensure DNS validation is active for auto-renewal",
        })
      }
    }

    if (keyAlg === "RSA_1024") {
      findings.push({
        checkId: "AWS-ACM-002",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: arn,
        title: `Weak key algorithm: ${domain}`,
        details: `Certificate for ${domain} uses ${keyAlg} which is considered insecure`,
        remediation: "Re-issue the certificate with RSA_2048 or ECDSA_P256 or stronger",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function transferFamilyEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Transfer Family Enumeration\n"]

  const servers = await aws(["transfer", "list-servers"], profile, region, timeout)
  if (servers.exitCode !== 0) return { output: `[-] Cannot list Transfer servers: ${servers.stderr.trim()}`, findings }
  const serverList = (tryJson(servers.stdout)?.Servers || []) as Array<Record<string, unknown>>
  output.push(`[+] Transfer Family Servers: ${serverList.length}\n`)

  for (const srv of serverList) {
    const serverId = srv.ServerId as string
    const arn = srv.Arn as string
    const state = srv.State as string
    const endpointType = srv.EndpointType as string
    const idProvider = srv.IdentityProviderType as string
    const domain = srv.Domain as string
    const protocols = (srv.Protocols || []) as string[]

    output.push(`  [+] ${serverId} (${state})`)
    output.push(`      ARN: ${arn}`)
    output.push(`      Endpoint Type: ${endpointType}`)
    output.push(`      Identity Provider: ${idProvider}`)
    output.push(`      Domain: ${domain}`)
    output.push(`      Protocols: ${protocols.join(", ")}`)

    const desc = await aws(
      ["transfer", "describe-server", "--server-id", serverId],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode === 0) {
      const detail = tryJson(desc.stdout)?.Server as Record<string, unknown> | undefined
      if (detail) {
        const loggingRole = detail.LoggingRole as string | undefined
        const securityPolicy = detail.SecurityPolicyName as string | undefined
        output.push(`      Security Policy: ${securityPolicy || "TransferSecurityPolicy-2018-11"}`)
        output.push(`      Logging Role: ${loggingRole || "None"}`)

        if (!loggingRole) {
          output.push(`      [!] No logging role configured`)
        }
      }
    }

    if (endpointType === "PUBLIC") {
      findings.push({
        checkId: "AWS-TRANSFER-001",
        provider: "aws",
        severity: "medium",
        status: "WARN",
        resource: arn,
        title: `Public Transfer Family endpoint: ${serverId}`,
        details: `Transfer server ${serverId} uses a PUBLIC endpoint — accessible from the internet`,
        remediation: "Use VPC endpoint type for private access, or restrict with security groups",
      })
    }

    if (protocols.includes("FTP")) {
      findings.push({
        checkId: "AWS-TRANSFER-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: arn,
        title: `Transfer server uses FTP: ${serverId}`,
        details: `Transfer server ${serverId} supports FTP (unencrypted) protocol`,
        remediation: "Use SFTP or FTPS instead of plain FTP for encrypted file transfer",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function publicExposureScan(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Public Exposure Scan — Attack Surface Summary\n"]
  let totalPublic = 0

  const eips = await aws(
    ["ec2", "describe-addresses", "--query", "Addresses[]"],
    profile,
    region,
    timeout,
  )
  if (eips.exitCode === 0) {
    const addresses = (tryJson(eips.stdout) || []) as Array<Record<string, unknown>>
    output.push(`[+] Elastic IPs: ${addresses.length}`)
    for (const addr of addresses) {
      const publicIp = addr.PublicIp as string
      const instanceId = addr.InstanceId as string | undefined
      const assocId = addr.AssociationId as string | undefined
      output.push(`  ${publicIp} → ${instanceId || assocId || "unattached"}`)
      if (!instanceId && !assocId) {
        output.push(`    [!] Unattached EIP — wasting cost and may be claimed if released`)
      }
    }
    totalPublic += addresses.length
  }

  const elbs = await aws(
    [
      "elbv2",
      "describe-load-balancers",
      "--query",
      "LoadBalancers[?Scheme=='internet-facing'].[LoadBalancerArn,DNSName,Type]",
    ],
    profile,
    region,
    timeout,
  )
  if (elbs.exitCode === 0) {
    const elbList = (tryJson(elbs.stdout) || []) as Array<unknown[]>
    output.push(`\n[+] Internet-Facing Load Balancers: ${elbList.length}`)
    for (const lb of elbList) {
      output.push(`  ${lb[1]} (${lb[2]})`)
    }
    totalPublic += elbList.length
  }

  const rds = await aws(
    [
      "rds",
      "describe-db-instances",
      "--query",
      "DBInstances[?PubliclyAccessible==`true`].[DBInstanceIdentifier,Endpoint.Address,Engine]",
    ],
    profile,
    region,
    timeout,
  )
  if (rds.exitCode === 0) {
    const rdsList = (tryJson(rds.stdout) || []) as Array<unknown[]>
    output.push(`\n[+] Public RDS Instances: ${rdsList.length}`)
    for (const db of rdsList) {
      output.push(`  ${db[0]} (${db[2]}) — ${db[1]}`)
    }
    if (rdsList.length > 0) {
      findings.push({
        checkId: "AWS-EXPOSURE-001",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: "rds",
        title: `${rdsList.length} public RDS instance(s)`,
        details: `Found ${rdsList.length} publicly accessible RDS instances: ${rdsList.map((d) => d[0]).join(", ")}`,
        remediation: "Disable public accessibility on RDS instances; use VPC peering or bastion hosts",
      })
    }
    totalPublic += rdsList.length
  }

  const s3websites = await aws(
    ["s3api", "list-buckets", "--query", "Buckets[].Name"],
    profile,
    region,
    timeout,
  )
  if (s3websites.exitCode === 0) {
    const bucketNames = (tryJson(s3websites.stdout) || []) as string[]
    let websiteCount = 0
    for (const bucket of bucketNames.slice(0, 20)) {
      const ws = await aws(
        ["s3api", "get-bucket-website", "--bucket", bucket],
        profile,
        region,
        timeout,
      )
      if (ws.exitCode === 0) {
        websiteCount++
        output.push(`  S3 Website: ${bucket}`)
      }
    }
    output.push(`\n[+] S3 Buckets with Website Hosting: ${websiteCount}`)
    totalPublic += websiteCount
  }

  const cf = await aws(
    ["cloudfront", "list-distributions", "--query", "DistributionList.Items[].[Id,DomainName,Status]"],
    profile,
    undefined,
    timeout,
  )
  if (cf.exitCode === 0) {
    const cfList = (tryJson(cf.stdout) || []) as Array<unknown[]>
    output.push(`\n[+] CloudFront Distributions: ${cfList.length}`)
    for (const d of cfList) {
      output.push(`  ${d[0]} — ${d[1]} (${d[2]})`)
    }
    totalPublic += cfList.length
  }

  const apigw = await aws(["apigateway", "get-rest-apis"], profile, region, timeout)
  if (apigw.exitCode === 0) {
    const apis = (tryJson(apigw.stdout)?.items || []) as Array<Record<string, unknown>>
    const publicApis = apis.filter((a) => {
      const endpointConfig = a.endpointConfiguration as Record<string, unknown> | undefined
      const types = (endpointConfig?.types || []) as string[]
      return types.includes("EDGE") || types.includes("REGIONAL")
    })
    output.push(`\n[+] Public API Gateway REST APIs: ${publicApis.length}`)
    for (const api of publicApis) {
      output.push(`  ${api.name} (${api.id})`)
    }
    if (publicApis.length > 0) {
      findings.push({
        checkId: "AWS-EXPOSURE-002",
        provider: "aws",
        severity: "medium",
        status: "INFO",
        resource: "apigateway",
        title: `${publicApis.length} public API Gateway(s)`,
        details: `Found ${publicApis.length} EDGE/REGIONAL API Gateways accessible from the internet`,
        remediation: "Review API Gateway authorization settings; use PRIVATE endpoint type for internal APIs",
      })
    }
    totalPublic += publicApis.length
  }

  output.push(`\n[*] Total Public-Facing Resources: ${totalPublic}`)
  findings.push({
    checkId: "AWS-EXPOSURE-003",
    provider: "aws",
    severity: totalPublic > 10 ? "high" : "medium",
    status: totalPublic > 10 ? "WARN" : "INFO",
    resource: "public-exposure",
    title: `Attack surface: ${totalPublic} public-facing resources`,
    details: `Enumerated ${totalPublic} internet-facing resources across EIPs, ELBs, RDS, S3, CloudFront, and API Gateway`,
    remediation: "Review each public resource for necessity; minimize attack surface",
  })

  return { output: output.join("\n"), findings }
}

export async function stalePermissionAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Stale Permission Audit — IAM Credential Report\n"]

  const gen = await aws(["iam", "generate-credential-report"], profile, region, timeout)
  if (gen.exitCode !== 0) {
    return { output: `[-] Cannot generate credential report: ${gen.stderr.trim()}`, findings }
  }

  await new Promise((resolve) => setTimeout(resolve, 3000))

  const report = await aws(["iam", "get-credential-report"], profile, region, timeout)
  if (report.exitCode !== 0) {
    return { output: `[-] Cannot get credential report: ${report.stderr.trim()}`, findings }
  }

  const reportData = tryJson(report.stdout) as Record<string, unknown> | null
  if (!reportData?.Content) {
    return { output: `[-] Credential report empty`, findings }
  }

  const csv = Buffer.from(reportData.Content as string, "base64").toString("utf-8")
  const lines = csv.split("\n").filter((l) => l.trim())
  const headers = lines[0].split(",")
  const userIdx = headers.indexOf("user")
  const pwLastUsedIdx = headers.indexOf("password_last_used")
  const pwEnabledIdx = headers.indexOf("password_enabled")
  const ak1ActiveIdx = headers.indexOf("access_key_1_active")
  const ak1LastUsedIdx = headers.indexOf("access_key_1_last_used_date")
  const ak1LastRotatedIdx = headers.indexOf("access_key_1_last_rotated")
  const ak2ActiveIdx = headers.indexOf("access_key_2_active")
  const ak2LastUsedIdx = headers.indexOf("access_key_2_last_used_date")
  const ak2LastRotatedIdx = headers.indexOf("access_key_2_last_rotated")
  const mfaIdx = headers.indexOf("mfa_active")

  const now = Date.now()
  const dayMs = 86400000
  let staleKeys = 0
  let stalePasswords = 0
  let noMfa = 0

  output.push(`[+] Users in credential report: ${lines.length - 1}\n`)

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",")
    const user = cols[userIdx]
    if (user === "<root_account>") {
      const rootMfa = cols[mfaIdx]
      if (rootMfa === "false") {
        output.push(`  [!] ROOT ACCOUNT: MFA NOT ENABLED`)
        findings.push({
          checkId: "AWS-STALE-001",
          provider: "aws",
          severity: "critical",
          status: "FAIL",
          resource: "iam:root",
          title: "Root account MFA not enabled",
          details: "The AWS root account does not have MFA enabled — highest privilege account",
          remediation: "Enable MFA on the root account immediately",
        })
      }
      continue
    }

    const issues: string[] = []

    const pwEnabled = cols[pwEnabledIdx]
    const pwLastUsed = cols[pwLastUsedIdx]
    if (pwEnabled === "true" && pwLastUsed && pwLastUsed !== "N/A" && pwLastUsed !== "no_information") {
      const age = Math.floor((now - new Date(pwLastUsed).getTime()) / dayMs)
      if (age > 90) {
        issues.push(`password unused ${age}d`)
        stalePasswords++
      }
    }

    for (const [activeIdx, lastUsedIdx, lastRotatedIdx, keyNum] of [
      [ak1ActiveIdx, ak1LastUsedIdx, ak1LastRotatedIdx, "1"],
      [ak2ActiveIdx, ak2LastUsedIdx, ak2LastRotatedIdx, "2"],
    ] as Array<[number, number, number, string]>) {
      if (cols[activeIdx] === "true") {
        if (cols[lastRotatedIdx] && cols[lastRotatedIdx] !== "N/A") {
          const rotAge = Math.floor((now - new Date(cols[lastRotatedIdx]).getTime()) / dayMs)
          if (rotAge > 90) {
            issues.push(`key${keyNum} age ${rotAge}d`)
            staleKeys++
          }
        }
        if (cols[lastUsedIdx] && cols[lastUsedIdx] !== "N/A" && cols[lastUsedIdx] !== "no_information") {
          const useAge = Math.floor((now - new Date(cols[lastUsedIdx]).getTime()) / dayMs)
          if (useAge > 90) {
            issues.push(`key${keyNum} unused ${useAge}d`)
          }
        }
      }
    }

    const mfa = cols[mfaIdx]
    if (mfa === "false" && pwEnabled === "true") {
      issues.push("no MFA")
      noMfa++
    }

    if (issues.length > 0) {
      output.push(`  [!] ${user}: ${issues.join(", ")}`)
    }
  }

  output.push(`\n[*] Summary:`)
  output.push(`    Stale access keys (>90d): ${staleKeys}`)
  output.push(`    Stale passwords (>90d): ${stalePasswords}`)
  output.push(`    Users without MFA: ${noMfa}`)

  if (staleKeys > 0) {
    findings.push({
      checkId: "AWS-STALE-001",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: "iam",
      title: `${staleKeys} stale access key(s) older than 90 days`,
      details: `Found ${staleKeys} active access keys that haven't been rotated in 90+ days`,
      remediation: "Rotate or deactivate access keys that are older than 90 days",
    })
  }

  if (stalePasswords > 0) {
    findings.push({
      checkId: "AWS-STALE-002",
      provider: "aws",
      severity: "medium",
      status: "WARN",
      resource: "iam",
      title: `${stalePasswords} stale password(s) unused for 90+ days`,
      details: `Found ${stalePasswords} users with console passwords not used in 90+ days`,
      remediation: "Disable console access for users who no longer need it",
    })
  }

  if (noMfa > 0) {
    findings.push({
      checkId: "AWS-STALE-003",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: "iam",
      title: `${noMfa} console user(s) without MFA`,
      details: `Found ${noMfa} IAM users with console access but no MFA enabled`,
      remediation: "Enable MFA for all IAM users with console access",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function tagComplianceAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Tag Compliance Audit\n"]

  const requiredTags = ["Environment", "Owner", "CostCenter"]
  output.push(`[*] Required tags: ${requiredTags.join(", ")}\n`)

  const resourceTypes = [
    "ec2:instance",
    "ec2:volume",
    "rds:db",
    "s3",
    "lambda:function",
    "elasticloadbalancing:loadbalancer",
    "dynamodb:table",
  ]

  const summary: Record<string, { total: number; missing: Record<string, number> }> = {}

  for (const resType of resourceTypes) {
    const resources = await aws(
      [
        "resourcegroupstaggingapi",
        "get-resources",
        "--resource-type-filters",
        resType,
      ],
      profile,
      region,
      timeout,
    )
    if (resources.exitCode !== 0) continue

    const resList = (tryJson(resources.stdout)?.ResourceTagMappingList || []) as Array<Record<string, unknown>>
    const missing: Record<string, number> = {}
    for (const tag of requiredTags) missing[tag] = 0

    for (const res of resList) {
      const tags = (res.Tags || []) as Array<Record<string, unknown>>
      const tagKeys = tags.map((t) => t.Key as string)

      for (const required of requiredTags) {
        if (!tagKeys.includes(required)) {
          missing[required]++
        }
      }
    }

    summary[resType] = { total: resList.length, missing }

    if (resList.length > 0) {
      output.push(`[+] ${resType}: ${resList.length} resources`)
      for (const tag of requiredTags) {
        if (missing[tag] > 0) {
          output.push(`    Missing "${tag}": ${missing[tag]}/${resList.length}`)
        }
      }
    }
  }

  let totalMissing = 0
  let totalResources = 0
  for (const [resType, data] of Object.entries(summary)) {
    totalResources += data.total
    for (const count of Object.values(data.missing)) {
      totalMissing += count
    }
  }

  output.push(`\n[*] Summary: ${totalResources} resources, ${totalMissing} missing tag instances`)

  if (totalMissing > 0) {
    findings.push({
      checkId: "AWS-TAG-001",
      provider: "aws",
      severity: "low",
      status: "WARN",
      resource: "tagging",
      title: `${totalMissing} missing required tags across ${totalResources} resources`,
      details: `Required tags (${requiredTags.join(", ")}) are missing on ${totalMissing} resource-tag combinations across ${Object.keys(summary).length} resource types`,
      remediation: "Implement AWS Config rules or SCPs to enforce required tags; use Tag Editor for bulk tagging",
    })
  } else if (totalResources > 0) {
    findings.push({
      checkId: "AWS-TAG-001",
      provider: "aws",
      severity: "info",
      status: "INFO",
      resource: "tagging",
      title: `All ${totalResources} resources have required tags`,
      details: `All checked resources have the required tags: ${requiredTags.join(", ")}`,
      remediation: "Continue enforcing tag compliance",
    })
  }

  return { output: output.join("\n"), findings }
}
