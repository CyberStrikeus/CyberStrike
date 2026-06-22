import z from "zod"
import { Tool } from "./tool"
import path from "path"

const KUBEHOOK_DIR = path.resolve(import.meta.dir, "../../data/kubehook")

const AVAILABLE_PROGRAMS: Record<string, { description: string; args: string }> = {
  k8s_enum: {
    description:
      "Enumerate Kubernetes cluster: namespaces, pods, services, secrets (metadata), RBAC roles/bindings, ingress, and service accounts",
    args: "[--namespace NS] [--kubeconfig PATH] [--json-output]",
  },
  k8s_secrets: {
    description:
      "Extract and base64-decode Kubernetes Secrets from all accessible namespaces. Filters by type (Opaque, TLS, docker-registry)",
    args: "[--namespace NS] [--type TYPE] [--kubeconfig PATH] [--json-output]",
  },
  k8s_escape: {
    description:
      "Detect and exploit container escape vectors: privileged mode, hostPID/hostNetwork, writable hostPath, mounted docker socket, SYS_ADMIN capability",
    args: "[--exploit] [--json-output]",
  },
  k8s_privesc: {
    description:
      "Kubernetes RBAC privilege escalation: steal ServiceAccount tokens, create ClusterRoleBinding for cluster-admin, abuse token request API",
    args: "--method <sa_token|bind_admin|token_request> [--namespace NS] [--sa-name NAME] [--kubeconfig PATH] [--json-output]",
  },
  etcd_dump: {
    description:
      "Connect directly to etcd and extract all Kubernetes secrets from /registry/secrets/ prefix. Requires etcd credentials or certs",
    args: "--endpoint ENDPOINT [--cert CERT] [--key KEY] [--ca CA] [--json-output]",
  },
  k8s_backdoor: {
    description:
      "Deploy persistent backdoor via DaemonSet (runs on every node) or CronJob (periodic callback) with configurable image and callback URL",
    args: "--type <daemonset|cronjob> --image IMAGE [--callback-url URL] [--namespace NS] [--kubeconfig PATH] [--json-output]",
  },
  cleanup_k8s: {
    description:
      "Remove all CyberStrike-created Kubernetes resources (by label app=cyberstrike): DaemonSets, CronJobs, ClusterRoleBindings, Pods. ALWAYS run before leaving",
    args: "[--kubeconfig PATH] [--json-output]",
  },
}

export const KubehookTool = Tool.define("kubehook", {
  description: `Execute a Kubernetes post-exploitation program after compromising a pod or obtaining kubeconfig. Available programs: ${Object.keys(AVAILABLE_PROGRAMS).join(", ")}. ALWAYS run cleanup_k8s before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(AVAILABLE_PROGRAMS) as [string, ...string[]]).describe(
      "Kubernetes program to execute. Options: " +
        Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const scriptPath = path.join(KUBEHOOK_DIR, `${params.program}.py`)
    const file = Bun.file(scriptPath)
    if (!(await file.exists())) {
      return {
        title: `kubehook: ${params.program}`,
        output: `Kubernetes program not found: ${params.program}.py\n\nAvailable programs:\n${Object.entries(
          AVAILABLE_PROGRAMS,
        )
          .map(([k, v]) => `  ${k}: ${v.description}\n    Usage: ${v.args}`)
          .join("\n")}`,
        metadata: { program: params.program, exitCode: -1, hasStderr: false },
      }
    }

    const proc = Bun.spawn(["python3", scriptPath, ...params.args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })

    const timeout = setTimeout(() => {
      proc.kill()
    }, params.timeout_seconds * 1000)

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])

    clearTimeout(timeout)
    const exitCode = await proc.exited

    const output = [stdout]
    if (stderr.trim()) output.push(`\n--- stderr ---\n${stderr}`)
    if (exitCode !== 0) {
      output.push(`\nExit code: ${exitCode}`)
      if (stderr.includes("ModuleNotFoundError") && stderr.includes("kubernetes")) {
        output.push("\n⚠ kubernetes client required. Install with: pip3 install kubernetes")
      }
      if (stderr.includes("ConfigException") || stderr.includes("KUBECONFIG")) {
        output.push("\n⚠ Kubernetes credentials not found. Set KUBECONFIG environment variable or use --kubeconfig")
      }
    }

    return {
      title: `kubehook: ${params.program}`,
      output: output.join(""),
      metadata: {
        program: params.program,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
