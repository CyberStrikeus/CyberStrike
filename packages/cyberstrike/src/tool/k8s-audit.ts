import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  verify_readonly: {
    description:
      "Safety check: confirm current kubeconfig identity has no write/modify permissions by testing create/delete/patch verbs via kubectl auth can-i. ALWAYS run first",
    args: "[--kubeconfig PATH] [--context CTX]",
  },
  rbac_audit: {
    description:
      "Audit RBAC: cluster-admin bindings, wildcard verb/resource roles, default ServiceAccount permissions, overprivileged bindings",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  network_policy_audit: {
    description:
      "Check for missing or overly permissive NetworkPolicies. Identify namespaces with no ingress/egress restrictions",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  pod_security_audit: {
    description:
      "Check pods for dangerous configurations: privileged, hostPID, hostNetwork, hostPath, SYS_ADMIN, runAsRoot, no securityContext",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  secrets_audit: {
    description:
      "Audit Kubernetes Secrets: count by type, check for unencrypted etcd (EncryptionConfiguration), detect mounted secrets in pods",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  image_audit: {
    description:
      "Check container images: latest tag usage, non-pinned digests, images from untrusted registries, missing imagePullPolicy",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  api_server_audit: {
    description:
      "Check API server exposure: anonymous auth, insecure port, NodeRestriction admission, audit logging, OIDC config",
    args: "[--kubeconfig PATH] [--context CTX]",
  },
  resource_limits_audit: {
    description:
      "Check for missing CPU/memory requests/limits, LimitRange and ResourceQuota coverage per namespace",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  ingress_audit: {
    description:
      "Audit Ingress resources: TLS termination, missing annotations, exposed internal services, wildcard hosts",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
  serviceaccount_audit: {
    description:
      "Check ServiceAccounts: automountServiceAccountToken=true, bound to cluster-admin, unused SAs with secrets",
    args: "[--namespace NS] [--kubeconfig PATH] [--context CTX]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = { checkId: string; provider: string; severity: string; status: string; resource: string; title: string; details: string; remediation: string }
type AuditResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function exec(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  try { return JSON.parse(s) } catch { return null }
}

function kc(args: string[], kubeconfig: string | undefined, ctx: string | undefined, timeout: number) {
  const extra = [...(kubeconfig ? ["--kubeconfig", kubeconfig] : []), ...(ctx ? ["--context", ctx] : [])]
  return exec("kubectl", [...args, ...extra, "-o", "json"], timeout)
}

function kcText(args: string[], kubeconfig: string | undefined, ctx: string | undefined, timeout: number) {
  const extra = [...(kubeconfig ? ["--kubeconfig", kubeconfig] : []), ...(ctx ? ["--context", ctx] : [])]
  return exec("kubectl", [...args, ...extra], timeout)
}

function formatFindings(tool: string, findings: Finding[]): string {
  const crit = findings.filter(f => f.severity === "critical").length
  const high = findings.filter(f => f.severity === "high").length
  const med = findings.filter(f => f.severity === "medium").length
  const lines = [`\n${"=".repeat(60)}`, `${tool} — ${findings.length} finding(s) (critical: ${crit}, high: ${high}, medium: ${med})\n`]
  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.title}`)
    lines.push(`  Resource: ${f.resource}`)
    lines.push(`  ${f.details}`)
    lines.push(`  Fix: ${f.remediation}\n`)
  }
  return lines.join("\n")
}

async function getNamespaces(kubeconfig: string | undefined, ctx: string | undefined, timeout: number): Promise<string[]> {
  const r = await kc(["get", "namespaces"], kubeconfig, ctx, timeout)
  if (r.exitCode !== 0) return ["default"]
  const items = tryJson(r.stdout)?.items || []
  return items.map((n: Record<string, Record<string, string>>) => n.metadata.name)
}

// ── Programs ──

async function verifyReadonly(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const output: string[] = ["[*] Verifying READ-ONLY access to Kubernetes cluster...\n"]
  const findings: Finding[] = []

  const whoami = await kcText(["auth", "whoami"], kubeconfig, ctx, timeout)
  if (whoami.exitCode === 0) {
    output.push(`[+] Current identity:\n${whoami.stdout}`)
  }

  const writeVerbs = ["create", "delete", "patch", "update"]
  const resources = ["pods", "deployments", "secrets", "configmaps", "clusterroles", "clusterrolebindings"]
  let hasWrite = false
  for (const verb of writeVerbs) {
    for (const res of resources) {
      const check = await kcText(["auth", "can-i", verb, res, "--all-namespaces"], kubeconfig, ctx, timeout)
      if (check.stdout.trim() === "yes") {
        hasWrite = true
        output.push(`[!] WRITE permission detected: ${verb} ${res}`)
        findings.push({
          checkId: "K8S-READONLY-001",
          provider: "kubernetes",
          severity: "high",
          status: "FAIL",
          resource: `verb:${verb}/resource:${res}`,
          title: `Write permission detected: ${verb} ${res}`,
          details: `Current identity can ${verb} ${res} across all namespaces. This violates read-only assessment constraints.`,
          remediation: "Use a kubeconfig with read-only ClusterRole (view or custom) for security assessments",
        })
      }
    }
  }

  if (!hasWrite) output.push("[+] PASS — No write permissions detected. Safe to proceed with audit.")

  const readVerbs = ["get", "list"]
  for (const verb of readVerbs) {
    const check = await kcText(["auth", "can-i", verb, "pods", "--all-namespaces"], kubeconfig, ctx, timeout)
    output.push(check.stdout.trim() === "yes" ? `[+] Can ${verb} pods: YES` : `[-] Can ${verb} pods: NO (limited audit coverage)`)
  }

  output.push(formatFindings("verify_readonly", findings))
  return { output: output.join("\n"), findings }
}

async function rbacAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Kubernetes RBAC...\n"]

  const crb = await kc(["get", "clusterrolebindings"], kubeconfig, ctx, timeout)
  if (crb.exitCode === 0) {
    const bindings = tryJson(crb.stdout)?.items || []
    output.push(`[*] ClusterRoleBindings: ${bindings.length}`)
    for (const b of bindings) {
      const role = b.roleRef?.name
      if (role !== "cluster-admin") continue
      const subjects = b.subjects || []
      for (const s of subjects) {
        if (s.name === "system:masters") continue
        output.push(`  [!] cluster-admin binding: ${s.kind}/${s.name} via ${b.metadata.name}`)
        findings.push({
          checkId: "K8S-RBAC-001",
          provider: "kubernetes",
          severity: "critical",
          status: "FAIL",
          resource: `ClusterRoleBinding/${b.metadata.name}`,
          title: `cluster-admin bound to ${s.kind}/${s.name}`,
          details: `${s.kind} "${s.name}" has cluster-admin via ClusterRoleBinding "${b.metadata.name}". This grants unrestricted cluster access.`,
          remediation: "Replace cluster-admin with a scoped ClusterRole following least-privilege. Use namespaced RoleBindings where possible.",
        })
      }
    }
  }

  const cr = await kc(["get", "clusterroles"], kubeconfig, ctx, timeout)
  if (cr.exitCode === 0) {
    const roles = tryJson(cr.stdout)?.items || []
    for (const r of roles) {
      if (r.metadata.name.startsWith("system:")) continue
      const rules = r.rules || []
      for (const rule of rules) {
        const verbs = rule.verbs || []
        const resources = rule.resources || []
        const apiGroups = rule.apiGroups || []
        if (verbs.includes("*") && resources.includes("*") && apiGroups.includes("*")) continue
        if (verbs.includes("*") || resources.includes("*")) {
          output.push(`  [!] Wildcard role: ${r.metadata.name} — verbs:${verbs.join(",")} resources:${resources.join(",")}`)
          findings.push({
            checkId: "K8S-RBAC-002",
            provider: "kubernetes",
            severity: "high",
            status: "FAIL",
            resource: `ClusterRole/${r.metadata.name}`,
            title: `Wildcard permissions in ClusterRole ${r.metadata.name}`,
            details: `ClusterRole has wildcard verbs (${verbs.join(",")}) or resources (${resources.join(",")}).`,
            remediation: "Replace wildcards with explicit verb and resource lists.",
          })
        }
      }
    }
  }

  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)
  for (const n of namespaces) {
    const sa = await kc(["get", "rolebindings", "-n", n], kubeconfig, ctx, timeout)
    if (sa.exitCode !== 0) continue
    const bindings = tryJson(sa.stdout)?.items || []
    for (const b of bindings) {
      const subjects = b.subjects || []
      for (const s of subjects) {
        if (s.kind !== "ServiceAccount" || s.name !== "default") continue
        output.push(`  [!] Default SA has RoleBinding in ${n}: ${b.metadata.name} → ${b.roleRef.name}`)
        findings.push({
          checkId: "K8S-RBAC-003",
          provider: "kubernetes",
          severity: "medium",
          status: "FAIL",
          resource: `${n}/RoleBinding/${b.metadata.name}`,
          title: `Default ServiceAccount has RoleBinding in namespace ${n}`,
          details: `The default ServiceAccount is bound to role "${b.roleRef.name}" in namespace "${n}". Pods without explicit SA inherit these permissions.`,
          remediation: "Bind specific ServiceAccounts instead of default. Set automountServiceAccountToken: false on default SA.",
        })
      }
    }
  }

  output.push(formatFindings("rbac_audit", findings))
  return { output: output.join("\n"), findings }
}

async function serviceaccountAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Kubernetes ServiceAccounts...\n"]

  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)
  let total = 0

  const crb = await kc(["get", "clusterrolebindings"], kubeconfig, ctx, timeout)
  const clusterBindings = crb.exitCode === 0 ? (tryJson(crb.stdout)?.items || []) : []
  const saClusterRoles = new Map<string, string[]>()
  for (const b of clusterBindings) {
    for (const s of (b.subjects || [])) {
      if (s.kind !== "ServiceAccount") continue
      const key = `${s.namespace || "default"}/${s.name}`
      const roles = saClusterRoles.get(key) || []
      roles.push(b.roleRef.name)
      saClusterRoles.set(key, roles)
    }
  }

  for (const n of namespaces) {
    const sas = await kc(["get", "serviceaccounts", "-n", n], kubeconfig, ctx, timeout)
    if (sas.exitCode !== 0) continue
    const items = tryJson(sas.stdout)?.items || []
    total += items.length

    for (const sa of items) {
      const name = sa.metadata.name
      const automount = sa.automountServiceAccountToken
      const key = `${n}/${name}`

      if (automount !== false && name === "default") {
        output.push(`  [!] ${n}/default: automountServiceAccountToken not disabled`)
        findings.push({
          checkId: "K8S-SA-001",
          provider: "kubernetes",
          severity: "medium",
          status: "FAIL",
          resource: `${n}/ServiceAccount/default`,
          title: `Default SA auto-mounts token in ${n}`,
          details: `Default ServiceAccount in "${n}" has automountServiceAccountToken=true. All pods without explicit SA get a token.`,
          remediation: "Set automountServiceAccountToken: false on the default ServiceAccount.",
        })
      }

      const roles = saClusterRoles.get(key) || []
      if (roles.includes("cluster-admin")) {
        output.push(`  [!] ${key}: bound to cluster-admin!`)
        findings.push({
          checkId: "K8S-SA-002",
          provider: "kubernetes",
          severity: "critical",
          status: "FAIL",
          resource: `${n}/ServiceAccount/${name}`,
          title: `ServiceAccount ${name} has cluster-admin`,
          details: `ServiceAccount "${name}" in "${n}" is bound to cluster-admin via ClusterRoleBinding.`,
          remediation: "Remove cluster-admin binding. Use a scoped ClusterRole with minimum required permissions.",
        })
      }

      const secrets = sa.secrets || []
      if (secrets.length > 1) {
        output.push(`  [*] ${key}: ${secrets.length} secrets attached`)
      }
    }

    const rb = await kc(["get", "rolebindings", "-n", n], kubeconfig, ctx, timeout)
    if (rb.exitCode !== 0) continue
    const bindings = tryJson(rb.stdout)?.items || []
    const boundSAs = new Set<string>()
    for (const b of bindings) {
      for (const s of (b.subjects || [])) {
        if (s.kind === "ServiceAccount" && s.namespace === n) boundSAs.add(s.name)
      }
    }

    const saItems = tryJson((await kc(["get", "serviceaccounts", "-n", n], kubeconfig, ctx, timeout)).stdout)?.items || []
    for (const sa of saItems) {
      if (sa.metadata.name === "default") continue
      if (!boundSAs.has(sa.metadata.name) && !saClusterRoles.has(`${n}/${sa.metadata.name}`)) {
        const pods = await kcText(["get", "pods", "-n", n, "--field-selector", `spec.serviceAccountName=${sa.metadata.name}`, "--no-headers"], kubeconfig, ctx, timeout)
        if (pods.stdout.trim() === "") {
          output.push(`  [*] ${n}/${sa.metadata.name}: unused (no bindings, no pods)`)
          findings.push({
            checkId: "K8S-SA-003",
            provider: "kubernetes",
            severity: "low",
            status: "WARN",
            resource: `${n}/ServiceAccount/${sa.metadata.name}`,
            title: `Unused ServiceAccount: ${sa.metadata.name}`,
            details: `ServiceAccount "${sa.metadata.name}" in "${n}" has no role bindings and no running pods. Dormant SA with secrets is an attack surface.`,
            remediation: "Delete unused ServiceAccounts to reduce attack surface.",
          })
        }
      }
    }
  }

  output.push(`\n[*] Total ServiceAccounts: ${total}`)
  output.push(formatFindings("serviceaccount_audit", findings))
  return { output: output.join("\n"), findings }
}

async function ingressAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Ingress resources...\n"]

  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)
  let total = 0

  for (const n of namespaces) {
    const ingresses = await kc(["get", "ingresses", "-n", n], kubeconfig, ctx, timeout)
    if (ingresses.exitCode !== 0) continue
    const items = tryJson(ingresses.stdout)?.items || []
    total += items.length

    for (const ing of items) {
      const name = ing.metadata.name
      const tls = ing.spec?.tls || []
      const rules = ing.spec?.rules || []

      if (tls.length === 0) {
        output.push(`  [!] ${n}/${name}: no TLS configured`)
        findings.push({
          checkId: "K8S-ING-001",
          provider: "kubernetes",
          severity: "high",
          status: "FAIL",
          resource: `${n}/Ingress/${name}`,
          title: `No TLS on Ingress ${name}`,
          details: `Ingress "${name}" in namespace "${n}" has no TLS configuration. Traffic is unencrypted.`,
          remediation: "Add spec.tls with a valid TLS secret reference.",
        })
      }

      for (const rule of rules) {
        const host = rule.host || ""
        if (host === "*" || host === "") {
          output.push(`  [!] ${n}/${name}: wildcard or empty host`)
          findings.push({
            checkId: "K8S-ING-002",
            provider: "kubernetes",
            severity: "medium",
            status: "FAIL",
            resource: `${n}/Ingress/${name}`,
            title: `Wildcard host on Ingress ${name}`,
            details: `Ingress rule has wildcard or empty host — matches all incoming requests.`,
            remediation: "Set explicit hostnames on Ingress rules to prevent unintended routing.",
          })
        }

        const paths = rule.http?.paths || []
        for (const p of paths) {
          const svc = p.backend?.service?.name || p.backend?.serviceName || ""
          const port = p.backend?.service?.port?.number || p.backend?.servicePort || ""
          output.push(`  [*] ${n}/${name}: ${host}${p.path || "/"} → ${svc}:${port}`)
        }
      }

      const annotations = ing.metadata?.annotations || {}
      const sensitive = ["nginx.ingress.kubernetes.io/server-snippet", "nginx.ingress.kubernetes.io/configuration-snippet"]
      for (const ann of sensitive) {
        if (annotations[ann]) {
          output.push(`  [!] ${n}/${name}: has ${ann} annotation (code injection risk)`)
          findings.push({
            checkId: "K8S-ING-003",
            provider: "kubernetes",
            severity: "high",
            status: "FAIL",
            resource: `${n}/Ingress/${name}`,
            title: `Dangerous annotation on Ingress ${name}: ${ann}`,
            details: `Annotation "${ann}" allows arbitrary nginx config injection. Can leak secrets or proxy to internal services.`,
            remediation: "Remove snippet annotations. Use dedicated Ingress annotations for configuration.",
          })
        }
      }
    }
  }

  output.push(`\n[*] Total Ingress resources: ${total}`)
  output.push(formatFindings("ingress_audit", findings))
  return { output: output.join("\n"), findings }
}

async function resourceLimitsAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing resource limits and quotas...\n"]

  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)
  for (const n of namespaces) {
    if (n === "kube-system" || n === "kube-public" || n === "kube-node-lease") continue

    const lr = await kc(["get", "limitranges", "-n", n], kubeconfig, ctx, timeout)
    const limitRanges = lr.exitCode === 0 ? (tryJson(lr.stdout)?.items || []) : []
    if (limitRanges.length === 0) {
      findings.push({
        checkId: "K8S-RES-001",
        provider: "kubernetes",
        severity: "medium",
        status: "FAIL",
        resource: `Namespace/${n}`,
        title: `No LimitRange in namespace ${n}`,
        details: `Namespace "${n}" has no LimitRange. Containers can consume unlimited CPU/memory.`,
        remediation: "Create a LimitRange with default CPU/memory requests and limits.",
      })
    }

    const rq = await kc(["get", "resourcequotas", "-n", n], kubeconfig, ctx, timeout)
    const quotas = rq.exitCode === 0 ? (tryJson(rq.stdout)?.items || []) : []
    if (quotas.length === 0) {
      findings.push({
        checkId: "K8S-RES-002",
        provider: "kubernetes",
        severity: "low",
        status: "WARN",
        resource: `Namespace/${n}`,
        title: `No ResourceQuota in namespace ${n}`,
        details: `Namespace "${n}" has no ResourceQuota. No upper bound on total resource consumption.`,
        remediation: "Create a ResourceQuota to limit total CPU, memory, and object counts per namespace.",
      })
    }

    output.push(`  ${n}: LimitRanges=${limitRanges.length}, ResourceQuotas=${quotas.length}`)

    const pods = await kc(["get", "pods", "-n", n], kubeconfig, ctx, timeout)
    if (pods.exitCode !== 0) continue
    const items = tryJson(pods.stdout)?.items || []
    let noLimits = 0
    for (const pod of items) {
      const containers = pod.spec?.containers || []
      for (const c of containers) {
        const resources = c.resources || {}
        if (!resources.limits?.cpu || !resources.limits?.memory) {
          noLimits++
          if (noLimits <= 5) output.push(`    [!] ${pod.metadata.name}/${c.name}: missing CPU/memory limits`)
        }
        if (!resources.requests?.cpu || !resources.requests?.memory) {
          if (noLimits <= 5) output.push(`    [!] ${pod.metadata.name}/${c.name}: missing CPU/memory requests`)
        }
      }
    }
    if (noLimits > 0) {
      findings.push({
        checkId: "K8S-RES-003",
        provider: "kubernetes",
        severity: "medium",
        status: "FAIL",
        resource: `Namespace/${n}`,
        title: `${noLimits} container(s) without resource limits in ${n}`,
        details: `${noLimits} container(s) in namespace "${n}" lack CPU/memory limits. Risk of resource exhaustion (DoS).`,
        remediation: "Set resources.requests and resources.limits on all containers.",
      })
    }
  }

  output.push(formatFindings("resource_limits_audit", findings))
  return { output: output.join("\n"), findings }
}

async function apiServerAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Kubernetes API server configuration...\n"]

  const version = await kc(["version"], kubeconfig, ctx, timeout)
  if (version.exitCode === 0) {
    const v = tryJson(version.stdout)
    output.push(`[+] Server version: ${v?.serverVersion?.gitVersion || "unknown"}`)
    output.push(`    Platform: ${v?.serverVersion?.platform || "unknown"}`)
  }

  const anonCheck = await kcText(["auth", "can-i", "list", "namespaces", "--as=system:anonymous"], kubeconfig, ctx, timeout)
  if (anonCheck.stdout.trim() === "yes") {
    output.push("[!] Anonymous authentication: ENABLED — anonymous user can list namespaces")
    findings.push({
      checkId: "K8S-API-001",
      provider: "kubernetes",
      severity: "critical",
      status: "FAIL",
      resource: "kube-apiserver",
      title: "Anonymous authentication allows namespace listing",
      details: "system:anonymous can list namespaces. Anonymous auth may be enabled on the API server.",
      remediation: "Set --anonymous-auth=false on kube-apiserver. Remove anonymous ClusterRoleBindings.",
    })
  } else {
    output.push("[+] Anonymous auth: restricted (cannot list namespaces)")
  }

  const anonSecrets = await kcText(["auth", "can-i", "get", "secrets", "--as=system:anonymous", "--all-namespaces"], kubeconfig, ctx, timeout)
  if (anonSecrets.stdout.trim() === "yes") {
    output.push("[!] CRITICAL — Anonymous user can read secrets!")
    findings.push({
      checkId: "K8S-API-002",
      provider: "kubernetes",
      severity: "critical",
      status: "FAIL",
      resource: "kube-apiserver",
      title: "Anonymous user can read secrets",
      details: "system:anonymous has get access to secrets across all namespaces. Full credential compromise risk.",
      remediation: "Remove all anonymous ClusterRoleBindings. Set --anonymous-auth=false.",
    })
  }

  const apiPod = await kc(["get", "pods", "-n", "kube-system", "-l", "component=kube-apiserver"], kubeconfig, ctx, timeout)
  if (apiPod.exitCode === 0) {
    const items = tryJson(apiPod.stdout)?.items || []
    for (const pod of items) {
      const containers = pod.spec?.containers || []
      for (const c of containers) {
        const cmd = (c.command || []).join(" ")
        if (cmd.includes("--insecure-port") && !cmd.includes("--insecure-port=0")) {
          findings.push({ checkId: "K8S-API-003", provider: "kubernetes", severity: "critical", status: "FAIL", resource: `kube-system/Pod/${pod.metadata.name}`, title: "Insecure port enabled on API server", details: "kube-apiserver has --insecure-port set to non-zero. Unauthenticated access possible.", remediation: "Set --insecure-port=0 on kube-apiserver." })
          output.push("[!] Insecure port enabled!")
        }
        if (!cmd.includes("--enable-admission-plugins") || !cmd.includes("NodeRestriction")) {
          findings.push({ checkId: "K8S-API-004", provider: "kubernetes", severity: "high", status: "FAIL", resource: `kube-system/Pod/${pod.metadata.name}`, title: "NodeRestriction admission controller not enabled", details: "NodeRestriction admission plugin is not in --enable-admission-plugins. Compromised nodes can modify any object.", remediation: "Add NodeRestriction to --enable-admission-plugins on kube-apiserver." })
          output.push("[!] NodeRestriction admission controller not found")
        }
        if (!cmd.includes("--audit-log-path")) {
          findings.push({ checkId: "K8S-API-005", provider: "kubernetes", severity: "high", status: "FAIL", resource: `kube-system/Pod/${pod.metadata.name}`, title: "API server audit logging not configured", details: "No --audit-log-path set. API server requests are not being logged for forensics.", remediation: "Configure --audit-log-path and --audit-policy-file on kube-apiserver." })
          output.push("[!] Audit logging not configured")
        }
      }
    }
  } else {
    output.push("[*] Cannot inspect API server pod (managed cluster or insufficient permissions)")
  }

  output.push(formatFindings("api_server_audit", findings))
  return { output: output.join("\n"), findings }
}

async function imageAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing container images...\n"]

  const trustedRegistries = ["gcr.io", "docker.io/library", "registry.k8s.io", "quay.io", "ghcr.io", "mcr.microsoft.com", "public.ecr.aws"]
  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)

  for (const n of namespaces) {
    if (n === "kube-system" || n === "kube-public" || n === "kube-node-lease") continue
    const pods = await kc(["get", "pods", "-n", n], kubeconfig, ctx, timeout)
    if (pods.exitCode !== 0) continue
    const items = tryJson(pods.stdout)?.items || []
    for (const pod of items) {
      const containers = [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])]
      for (const c of containers) {
        const image = c.image || ""
        const pullPolicy = c.imagePullPolicy || ""

        if (image.endsWith(":latest") || !image.includes(":")) {
          output.push(`  [!] ${n}/${pod.metadata.name}/${c.name}: uses :latest tag — ${image}`)
          findings.push({
            checkId: "K8S-IMG-001",
            provider: "kubernetes",
            severity: "medium",
            status: "FAIL",
            resource: `${n}/Pod/${pod.metadata.name}/container/${c.name}`,
            title: `Container uses :latest tag: ${image}`,
            details: `Image "${image}" uses :latest or no tag. This is non-deterministic and can pull different versions silently.`,
            remediation: "Pin images to a specific version tag or SHA256 digest.",
          })
        }

        if (pullPolicy === "Never" || pullPolicy === "IfNotPresent") {
          if (image.endsWith(":latest") || !image.includes(":")) {
            output.push(`  [!] ${n}/${pod.metadata.name}/${c.name}: imagePullPolicy=${pullPolicy} with :latest`)
            findings.push({
              checkId: "K8S-IMG-002",
              provider: "kubernetes",
              severity: "medium",
              status: "FAIL",
              resource: `${n}/Pod/${pod.metadata.name}/container/${c.name}`,
              title: `imagePullPolicy ${pullPolicy} with mutable tag`,
              details: `Container uses "${pullPolicy}" pull policy with a mutable tag. Stale or tampered images may run.`,
              remediation: "Use imagePullPolicy: Always with mutable tags, or pin to immutable digests.",
            })
          }
        }

        const registry = image.split("/")[0]
        if (registry && !registry.includes(".") && registry !== "library") continue
        if (registry && !trustedRegistries.some(tr => image.startsWith(tr))) {
          output.push(`  [*] ${n}/${pod.metadata.name}/${c.name}: untrusted registry — ${registry}`)
          findings.push({
            checkId: "K8S-IMG-003",
            provider: "kubernetes",
            severity: "low",
            status: "WARN",
            resource: `${n}/Pod/${pod.metadata.name}/container/${c.name}`,
            title: `Image from non-standard registry: ${registry}`,
            details: `Image "${image}" is pulled from "${registry}" which is not in the trusted registry list.`,
            remediation: "Use images from trusted registries or add this registry to your allowlist after verification.",
          })
        }
      }
    }
  }

  output.push(formatFindings("image_audit", findings))
  return { output: output.join("\n"), findings }
}

async function secretsAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Kubernetes Secrets...\n"]

  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)
  let total = 0
  const byType: Record<string, number> = {}

  for (const n of namespaces) {
    const secrets = await kc(["get", "secrets", "-n", n], kubeconfig, ctx, timeout)
    if (secrets.exitCode !== 0) continue
    const items = tryJson(secrets.stdout)?.items || []
    for (const s of items) {
      total++
      const t = s.type || "Opaque"
      byType[t] = (byType[t] || 0) + 1

      if (t === "kubernetes.io/service-account-token") continue
      const data = s.data || {}
      const keys = Object.keys(data)
      const sensitiveKeys = keys.filter(k => /password|secret|token|key|credential|api.?key/i.test(k))
      if (sensitiveKeys.length > 0) {
        output.push(`  [*] ${n}/${s.metadata.name}: ${sensitiveKeys.length} sensitive key(s) — ${sensitiveKeys.join(", ")}`)
      }
    }

    const pods = await kc(["get", "pods", "-n", n], kubeconfig, ctx, timeout)
    if (pods.exitCode !== 0) continue
    const podItems = tryJson(pods.stdout)?.items || []
    for (const pod of podItems) {
      const containers = [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])]
      for (const c of containers) {
        const envFrom = c.envFrom || []
        for (const ef of envFrom) {
          if (ef.secretRef) {
            output.push(`  [!] ${n}/${pod.metadata.name}/${c.name}: entire secret "${ef.secretRef.name}" mounted as env`)
            findings.push({
              checkId: "K8S-SEC-001",
              provider: "kubernetes",
              severity: "medium",
              status: "FAIL",
              resource: `${n}/Pod/${pod.metadata.name}/container/${c.name}`,
              title: `Entire secret mounted as env vars: ${ef.secretRef.name}`,
              details: `Container "${c.name}" mounts all keys from Secret "${ef.secretRef.name}" as environment variables. Env vars are visible in /proc and crash dumps.`,
              remediation: "Mount individual keys via env[].valueFrom.secretKeyRef or use volume mounts with specific items.",
            })
          }
        }
        const env = c.env || []
        for (const e of env) {
          if (e.valueFrom?.secretKeyRef) {
            const secret = e.valueFrom.secretKeyRef.name
            const key = e.valueFrom.secretKeyRef.key
            output.push(`  [*] ${n}/${pod.metadata.name}/${c.name}: env ${e.name} ← secret/${secret}/${key}`)
          }
        }
      }
    }
  }

  output.push(`\n[*] Total secrets: ${total}`)
  for (const [t, count] of Object.entries(byType)) output.push(`    ${t}: ${count}`)

  const encConfig = await kcText(["get", "--raw", "/api/v1/namespaces/kube-system/configmaps/encryption-config"], kubeconfig, ctx, timeout)
  if (encConfig.exitCode !== 0) {
    output.push("\n[!] Cannot verify etcd encryption configuration (no access to kube-system or not configured)")
    findings.push({
      checkId: "K8S-SEC-002",
      provider: "kubernetes",
      severity: "high",
      status: "WARN",
      resource: "cluster/etcd-encryption",
      title: "Cannot verify etcd encryption at rest",
      details: "Unable to check EncryptionConfiguration. Secrets may be stored unencrypted in etcd.",
      remediation: "Enable EncryptionConfiguration for secrets. Use aescbc or secretbox provider.",
    })
  }

  output.push(formatFindings("secrets_audit", findings))
  return { output: output.join("\n"), findings }
}

async function podSecurityAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing pod security configurations...\n"]

  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)
  for (const n of namespaces) {
    if (n === "kube-system" || n === "kube-public" || n === "kube-node-lease") continue
    const pods = await kc(["get", "pods", "-n", n], kubeconfig, ctx, timeout)
    if (pods.exitCode !== 0) continue
    const items = tryJson(pods.stdout)?.items || []
    for (const pod of items) {
      const name = pod.metadata.name
      const spec = pod.spec || {}

      if (spec.hostPID) {
        findings.push({ checkId: "K8S-POD-001", provider: "kubernetes", severity: "critical", status: "FAIL", resource: `${n}/Pod/${name}`, title: `hostPID enabled on ${name}`, details: "Pod shares host PID namespace — can see all host processes and potentially inject code.", remediation: "Remove hostPID: true unless absolutely required." })
        output.push(`  [!] ${n}/${name}: hostPID=true`)
      }
      if (spec.hostNetwork) {
        findings.push({ checkId: "K8S-POD-002", provider: "kubernetes", severity: "critical", status: "FAIL", resource: `${n}/Pod/${name}`, title: `hostNetwork enabled on ${name}`, details: "Pod shares host network namespace — can sniff traffic and bind to host ports.", remediation: "Remove hostNetwork: true. Use Services/Ingress for external access." })
        output.push(`  [!] ${n}/${name}: hostNetwork=true`)
      }

      const containers = [...(spec.containers || []), ...(spec.initContainers || [])]
      for (const c of containers) {
        const sc = c.securityContext || {}
        if (sc.privileged) {
          findings.push({ checkId: "K8S-POD-003", provider: "kubernetes", severity: "critical", status: "FAIL", resource: `${n}/Pod/${name}/container/${c.name}`, title: `Privileged container: ${c.name} in ${name}`, details: "Container runs in privileged mode — full access to host devices and kernel.", remediation: "Remove privileged: true. Use specific capabilities instead." })
          output.push(`  [!] ${n}/${name}/${c.name}: privileged=true`)
        }
        if (sc.runAsUser === 0 || (sc.runAsNonRoot !== true && !sc.runAsUser)) {
          findings.push({ checkId: "K8S-POD-004", provider: "kubernetes", severity: "high", status: "FAIL", resource: `${n}/Pod/${name}/container/${c.name}`, title: `Container may run as root: ${c.name}`, details: "No runAsNonRoot: true or explicit non-root runAsUser set. Container may run as UID 0.", remediation: "Set securityContext.runAsNonRoot: true and runAsUser to a non-zero UID." })
        }
        const caps = sc.capabilities?.add || []
        const dangerous = ["SYS_ADMIN", "NET_ADMIN", "SYS_PTRACE", "NET_RAW", "ALL"]
        for (const cap of caps) {
          if (dangerous.includes(cap)) {
            findings.push({ checkId: "K8S-POD-005", provider: "kubernetes", severity: "high", status: "FAIL", resource: `${n}/Pod/${name}/container/${c.name}`, title: `Dangerous capability ${cap} on ${c.name}`, details: `Container has ${cap} capability added. This can be used for container escape or network attacks.`, remediation: `Remove ${cap} from capabilities.add. Use the minimum required capabilities.` })
            output.push(`  [!] ${n}/${name}/${c.name}: cap_add=${cap}`)
          }
        }
        if (!sc.readOnlyRootFilesystem) {
          findings.push({ checkId: "K8S-POD-006", provider: "kubernetes", severity: "low", status: "FAIL", resource: `${n}/Pod/${name}/container/${c.name}`, title: `Writable root filesystem: ${c.name}`, details: "Container root filesystem is writable. Attackers can modify binaries or drop tools.", remediation: "Set securityContext.readOnlyRootFilesystem: true. Use emptyDir for writable paths." })
        }
      }

      const volumes = spec.volumes || []
      for (const v of volumes) {
        if (v.hostPath) {
          const hp = v.hostPath.path
          const critical = ["/", "/etc", "/var", "/root", "/var/run/docker.sock"]
          if (critical.some(p => hp === p || hp.startsWith(p + "/"))) {
            findings.push({ checkId: "K8S-POD-007", provider: "kubernetes", severity: "critical", status: "FAIL", resource: `${n}/Pod/${name}`, title: `Sensitive hostPath mount: ${hp}`, details: `Pod mounts "${hp}" from host. This provides direct access to host filesystem or Docker socket.`, remediation: "Remove hostPath volume or restrict to a non-sensitive directory." })
            output.push(`  [!] ${n}/${name}: hostPath=${hp}`)
          }
        }
      }
    }
  }

  output.push(formatFindings("pod_security_audit", findings))
  return { output: output.join("\n"), findings }
}

async function networkPolicyAudit(args: string[], timeout: number): Promise<AuditResult> {
  const kubeconfig = argVal(args, "--kubeconfig")
  const ctx = argVal(args, "--context")
  const ns = argVal(args, "--namespace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Kubernetes NetworkPolicies...\n"]

  const namespaces = ns ? [ns] : await getNamespaces(kubeconfig, ctx, timeout)
  for (const n of namespaces) {
    if (n === "kube-system" || n === "kube-public" || n === "kube-node-lease") continue
    const np = await kc(["get", "networkpolicies", "-n", n], kubeconfig, ctx, timeout)
    const policies = np.exitCode === 0 ? (tryJson(np.stdout)?.items || []) : []
    if (policies.length === 0) {
      output.push(`  [!] No NetworkPolicies in namespace: ${n}`)
      findings.push({
        checkId: "K8S-NET-001",
        provider: "kubernetes",
        severity: "high",
        status: "FAIL",
        resource: `Namespace/${n}`,
        title: `No NetworkPolicies in namespace ${n}`,
        details: `Namespace "${n}" has zero NetworkPolicies. All pod-to-pod traffic is unrestricted.`,
        remediation: "Create default-deny ingress/egress NetworkPolicies and add allow rules for required traffic.",
      })
      continue
    }

    output.push(`  [+] ${n}: ${policies.length} NetworkPolicy(ies)`)
    let hasDefaultDenyIngress = false
    let hasDefaultDenyEgress = false
    for (const p of policies) {
      const spec = p.spec || {}
      const podSelector = spec.podSelector || {}
      const isEmpty = !podSelector.matchLabels && !podSelector.matchExpressions?.length
      const policyTypes = spec.policyTypes || []
      if (isEmpty && policyTypes.includes("Ingress") && (!spec.ingress || spec.ingress.length === 0)) hasDefaultDenyIngress = true
      if (isEmpty && policyTypes.includes("Egress") && (!spec.egress || spec.egress.length === 0)) hasDefaultDenyEgress = true

      const ingress = spec.ingress || []
      for (const rule of ingress) {
        const from = rule.from || []
        if (from.length === 0 && ingress.length > 0) {
          output.push(`    [!] ${p.metadata.name}: ingress rule allows all sources`)
          findings.push({
            checkId: "K8S-NET-002",
            provider: "kubernetes",
            severity: "medium",
            status: "FAIL",
            resource: `${n}/NetworkPolicy/${p.metadata.name}`,
            title: `Overly permissive ingress in ${p.metadata.name}`,
            details: `Ingress rule with no "from" selector — allows traffic from all pods/namespaces.`,
            remediation: "Add explicit podSelector/namespaceSelector to ingress rules.",
          })
        }
      }
    }

    if (!hasDefaultDenyIngress) {
      output.push(`    [!] ${n}: no default-deny ingress policy`)
      findings.push({
        checkId: "K8S-NET-003",
        provider: "kubernetes",
        severity: "medium",
        status: "FAIL",
        resource: `Namespace/${n}`,
        title: `No default-deny ingress NetworkPolicy in ${n}`,
        details: `Namespace "${n}" has policies but no default-deny ingress (empty podSelector + Ingress type + no ingress rules).`,
        remediation: "Add a default-deny ingress NetworkPolicy: podSelector: {}, policyTypes: [Ingress].",
      })
    }
    if (!hasDefaultDenyEgress) {
      output.push(`    [!] ${n}: no default-deny egress policy`)
      findings.push({
        checkId: "K8S-NET-004",
        provider: "kubernetes",
        severity: "medium",
        status: "FAIL",
        resource: `Namespace/${n}`,
        title: `No default-deny egress NetworkPolicy in ${n}`,
        details: `Namespace "${n}" has no default-deny egress policy. Pods can reach any external endpoint.`,
        remediation: "Add a default-deny egress NetworkPolicy and whitelist required destinations.",
      })
    }
  }

  output.push(formatFindings("network_policy_audit", findings))
  return { output: output.join("\n"), findings }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const K8sAuditTool = Tool.define("k8s_audit", {
  description: `Execute a READ-ONLY Kubernetes security assessment based on CIS Kubernetes Benchmark. No resources are created, modified, or deleted — all checks use kubectl get/describe/auth can-i. Run verify_readonly first. Programs: ${programKeys.join(", ")}`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "K8s audit program. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments for the program"),
    timeout_seconds: z.number().optional().default(300).describe("Max execution time (default: 300)"),
  }),
  async execute(params) {
    const check = await exec("which", ["kubectl"], 5)
    if (check.exitCode !== 0) {
      return {
        title: `k8s_audit: ${params.program}`,
        output: "kubectl not found. Install: https://kubernetes.io/docs/tasks/tools/",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const dispatch: Record<Program, () => Promise<AuditResult>> = {
      verify_readonly: () => verifyReadonly(params.args, params.timeout_seconds),
      rbac_audit: () => rbacAudit(params.args, params.timeout_seconds),
      network_policy_audit: () => networkPolicyAudit(params.args, params.timeout_seconds),
      pod_security_audit: () => podSecurityAudit(params.args, params.timeout_seconds),
      secrets_audit: () => secretsAudit(params.args, params.timeout_seconds),
      image_audit: () => imageAudit(params.args, params.timeout_seconds),
      api_server_audit: () => apiServerAudit(params.args, params.timeout_seconds),
      resource_limits_audit: () => resourceLimitsAudit(params.args, params.timeout_seconds),
      ingress_audit: () => ingressAudit(params.args, params.timeout_seconds),
      serviceaccount_audit: () => serviceaccountAudit(params.args, params.timeout_seconds),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `k8s_audit: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return { title: `k8s_audit: ${params.program}`, output: `Error: ${e instanceof Error ? e.message : String(e)}`, metadata: { program: params.program, findings: [] } }
    }
  },
})
