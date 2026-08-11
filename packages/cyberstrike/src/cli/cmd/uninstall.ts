import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { Global } from "../../global"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Database as BunDatabase } from "bun:sqlite"

interface UninstallArgs {
  keepConfig: boolean
  keepData: boolean
  dryRun: boolean
  force: boolean
}

interface RemovalTarget {
  path: string
  label: string
  description: string
  keep: boolean
}

interface RemovalTargets {
  directories: RemovalTarget[]
  shellConfig: string | null
  binary: string | null
}

export const UninstallCommand = {
  command: "uninstall",
  describe: "uninstall cyberstrike and remove all related files",
  builder: (yargs: Argv) =>
    yargs
      .option("keep-config", {
        alias: "c",
        type: "boolean",
        describe: "keep configuration files",
        default: false,
      })
      .option("keep-data", {
        alias: "d",
        type: "boolean",
        describe: "keep session data and snapshots",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show what would be removed without removing",
        default: false,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "skip confirmation prompts",
        default: false,
      }),

  handler: async (args: UninstallArgs) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Uninstall CyberStrike")

    // Check for other running cyberstrike instances
    const running = await getRunningInstances()
    if (running > 0) {
      prompts.log.warn(`${running} other cyberstrike process${running > 1 ? "es" : ""} running`)
      if (!args.force) {
        const proceed = await prompts.confirm({
          message: "Uninstalling while other instances are running may cause errors. Continue?",
          initialValue: false,
        })
        if (!proceed || prompts.isCancel(proceed)) {
          prompts.outro("Stop other cyberstrike processes first, then retry")
          return
        }
      }
    }

    const method = await Installation.method()
    prompts.log.info(`Installation method: ${method}`)

    const targets = await collectRemovalTargets(args, method)

    // Interactive mode: let user pick what to remove
    if (!args.force && !args.dryRun && process.stdout.isTTY) {
      const existing = await getExistingTargets(targets)
      if (existing.length > 0) {
        const sizes = await Promise.all(existing.map((t) => getDirectorySize(t.path)))
        const options = existing.map((t, i) => ({
          value: t.path,
          label: `${t.label} ${UI.Style.TEXT_DIM}(${formatSize(sizes[i])})`,
          hint: t.description,
        }))

        const selected = await prompts.multiselect({
          message: "What would you like to remove?",
          options,
          initialValues: existing.filter((t) => !t.keep).map((t) => t.path),
          required: false,
        })

        if (prompts.isCancel(selected)) {
          prompts.outro("Cancelled")
          return
        }

        const selectedSet = new Set(selected)
        for (const dir of targets.directories) {
          dir.keep = !selectedSet.has(dir.path)
        }
      }
    }

    await showRemovalSummary(targets, method)

    if (!args.force && !args.dryRun) {
      const confirm = await prompts.confirm({
        message: "Proceed with uninstall?",
        initialValue: false,
      })
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.outro("Cancelled")
        return
      }
    }

    if (args.dryRun) {
      prompts.log.warn("Dry run - no changes made")
      prompts.outro("Done")
      return
    }

    await executeUninstall(method, targets)

    prompts.outro("Done")
  },
}

async function getRunningInstances(): Promise<number> {
  const pid = process.pid
  try {
    if (process.platform === "win32") {
      const result = await $`tasklist /FI "IMAGENAME eq cyberstrike.exe" /FO CSV /NH`.quiet().nothrow()
      const lines = result.stdout
        .toString("utf8")
        .split("\n")
        .filter((l) => l.includes("cyberstrike"))
      return Math.max(0, lines.length - 1)
    }
    const result = await $`pgrep -f cyberstrike`.quiet().nothrow()
    const pids = result.stdout
      .toString("utf8")
      .trim()
      .split("\n")
      .filter((p) => p && Number(p) !== pid)
    return pids.length
  } catch {
    return 0
  }
}

async function getExistingTargets(targets: RemovalTargets): Promise<RemovalTarget[]> {
  const result: RemovalTarget[] = []
  for (const dir of targets.directories) {
    const exists = await fs
      .access(dir.path)
      .then(() => true)
      .catch(() => false)
    if (exists) result.push(dir)
  }
  return result
}

async function collectRemovalTargets(args: UninstallArgs, method: Installation.Method): Promise<RemovalTargets> {
  const directories: RemovalTargets["directories"] = [
    {
      path: Global.Path.data,
      label: "Data",
      description: "sessions, database, skills, snapshots",
      keep: args.keepData,
    },
    {
      path: Global.Path.cache,
      label: "Cache",
      description: "models cache, downloaded assets",
      keep: false,
    },
    {
      path: Global.Path.config,
      label: "Config",
      description: "cyberstrike.json, provider settings",
      keep: args.keepConfig,
    },
    {
      path: Global.Path.state,
      label: "State",
      description: "runtime state",
      keep: false,
    },
  ]

  const shellConfig = method === "curl" ? await getShellConfigFile() : null
  const binary = method === "curl" ? process.execPath : null

  return { directories, shellConfig, binary }
}

async function showRemovalSummary(targets: RemovalTargets, method: Installation.Method) {
  prompts.log.message("Removal plan:")

  for (const dir of targets.directories) {
    const exists = await fs
      .access(dir.path)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    const size = await getDirectorySize(dir.path)
    const sizeStr = formatSize(size)
    const status = dir.keep ? UI.Style.TEXT_DIM + " (keeping)" : ""
    const prefix = dir.keep ? "○" : "✓"

    prompts.log.info(`  ${prefix} ${dir.label}: ${shortenPath(dir.path)} ${UI.Style.TEXT_DIM}(${sizeStr})${status}`)
  }

  if (targets.binary) {
    prompts.log.info(`  ✓ Binary: ${shortenPath(targets.binary)}`)
  }

  if (targets.shellConfig) {
    prompts.log.info(`  ✓ Shell PATH in ${shortenPath(targets.shellConfig)}`)
  }

  if (method !== "curl" && method !== "unknown") {
    const cmds: Record<string, string> = {
      npm: "npm uninstall -g @cyberstrike-io/cyberstrike",
      pnpm: "pnpm uninstall -g @cyberstrike-io/cyberstrike",
      bun: "bun remove -g @cyberstrike-io/cyberstrike",
      yarn: "yarn global remove @cyberstrike-io/cyberstrike",
      brew: "brew uninstall cyberstrike",
      choco: "choco uninstall cyberstrike",
      scoop: "scoop uninstall cyberstrike",
    }
    prompts.log.info(`  ✓ Package: ${cmds[method] || method}`)
  }
}

async function executeUninstall(method: Installation.Method, targets: RemovalTargets) {
  const spinner = prompts.spinner()
  const errors: string[] = []

  // Checkpoint SQLite WAL before removing data directory
  const dataTarget = targets.directories.find((d) => d.label === "Data")
  if (dataTarget && !dataTarget.keep) {
    const dbPath = path.join(dataTarget.path, "cyberstrike.db")
    const dbExists = await fs
      .access(dbPath)
      .then(() => true)
      .catch(() => false)
    if (dbExists) {
      spinner.start("Checkpointing database...")
      try {
        const sqlite = new BunDatabase(dbPath)
        sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)")
        sqlite.close()
        spinner.stop("Database checkpointed")
      } catch {
        spinner.stop("Database checkpoint skipped")
      }
    }
  }

  for (const dir of targets.directories) {
    if (dir.keep) {
      prompts.log.step(`Keeping ${dir.label}`)
      continue
    }

    const exists = await fs
      .access(dir.path)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    spinner.start(`Removing ${dir.label}...`)
    const err = await fs.rm(dir.path, { recursive: true, force: true }).catch((e) => e)
    if (err) {
      spinner.stop(`Failed to remove ${dir.label}`, 1)
      errors.push(`${dir.label}: ${err.message}`)
      continue
    }
    spinner.stop(`Removed ${dir.label}`)
  }

  if (targets.shellConfig) {
    spinner.start("Cleaning shell config...")
    const err = await cleanShellConfig(targets.shellConfig).catch((e) => e)
    if (err) {
      spinner.stop("Failed to clean shell config", 1)
      errors.push(`Shell config: ${err.message}`)
    } else {
      spinner.stop("Cleaned shell config")
    }
  }

  // Remove binary for curl installs
  if (method === "curl" && targets.binary) {
    spinner.start("Removing binary...")
    const err = await fs.unlink(targets.binary).catch((e) => e)
    if (err) {
      spinner.stop("Could not remove binary", 1)
      prompts.log.warn(`  Remove manually: rm "${targets.binary}"`)
    } else {
      spinner.stop(`Removed ${shortenPath(targets.binary)}`)
      const binDir = path.dirname(targets.binary)
      if (binDir.includes(".cyberstrike")) {
        await fs.rmdir(binDir).catch(() => {})
      }
    }
  }

  if (method !== "curl" && method !== "unknown") {
    const cmds: Record<string, string[]> = {
      npm: ["npm", "uninstall", "-g", "@cyberstrike-io/cyberstrike"],
      pnpm: ["pnpm", "uninstall", "-g", "@cyberstrike-io/cyberstrike"],
      bun: ["bun", "remove", "-g", "@cyberstrike-io/cyberstrike"],
      yarn: ["yarn", "global", "remove", "@cyberstrike-io/cyberstrike"],
      brew: ["brew", "uninstall", "cyberstrike"],
      choco: ["choco", "uninstall", "cyberstrike"],
      scoop: ["scoop", "uninstall", "cyberstrike"],
    }

    const cmd = cmds[method]
    if (cmd) {
      spinner.start(`Running ${cmd.join(" ")}...`)
      const result =
        method === "choco"
          ? await $`echo Y | choco uninstall cyberstrike -y -r`.quiet().nothrow()
          : await $`${cmd}`.quiet().nothrow()
      if (result.exitCode !== 0) {
        spinner.stop(`Package manager uninstall failed: exit code ${result.exitCode}`, 1)
        if (
          method === "choco" &&
          result.stdout.toString("utf8").includes("not running from an elevated command shell")
        ) {
          prompts.log.warn(`You may need to run '${cmd.join(" ")}' from an elevated command shell`)
        } else {
          prompts.log.warn(`You may need to run manually: ${cmd.join(" ")}`)
        }
      } else {
        spinner.stop("Package removed")
      }
    }
  }

  if (errors.length > 0) {
    UI.empty()
    prompts.log.warn("Some operations failed:")
    for (const err of errors) {
      prompts.log.error(`  ${err}`)
    }
  }

  // Inform about per-project directories
  UI.empty()
  prompts.log.info(
    `Per-project ${UI.Style.TEXT_NORMAL_BOLD}.cyberstrike/${UI.Style.TEXT_NORMAL} directories (skill cache, project config) are not removed.`,
  )
  prompts.log.info(`  To find them: ${UI.Style.TEXT_DIM}find ~ -name ".cyberstrike" -type d -maxdepth 5`)

  UI.empty()
  prompts.log.success("Thank you for using CyberStrike!")
}

async function getShellConfigFile(): Promise<string | null> {
  const shell = path.basename(process.env.SHELL || "bash")
  const home = os.homedir()
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")

  const configFiles: Record<string, string[]> = {
    fish: [path.join(xdgConfig, "fish", "config.fish")],
    zsh: [
      path.join(home, ".zshrc"),
      path.join(home, ".zshenv"),
      path.join(xdgConfig, "zsh", ".zshrc"),
      path.join(xdgConfig, "zsh", ".zshenv"),
    ],
    bash: [
      path.join(home, ".bashrc"),
      path.join(home, ".bash_profile"),
      path.join(home, ".profile"),
      path.join(xdgConfig, "bash", ".bashrc"),
      path.join(xdgConfig, "bash", ".bash_profile"),
    ],
    ash: [path.join(home, ".ashrc"), path.join(home, ".profile")],
    sh: [path.join(home, ".profile")],
  }

  const candidates = configFiles[shell] || configFiles.bash

  for (const file of candidates) {
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    const content = await Bun.file(file)
      .text()
      .catch(() => "")
    if (content.includes("# cyberstrike") || content.includes(".cyberstrike/bin")) {
      return file
    }
  }

  return null
}

async function cleanShellConfig(file: string) {
  const content = await Bun.file(file).text()
  const lines = content.split("\n")

  const filtered: string[] = []
  let skip = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === "# cyberstrike") {
      skip = true
      continue
    }

    if (skip) {
      skip = false
      if (trimmed.includes(".cyberstrike/bin") || trimmed.includes("fish_add_path")) {
        continue
      }
    }

    if (
      (trimmed.startsWith("export PATH=") && trimmed.includes(".cyberstrike/bin")) ||
      (trimmed.startsWith("fish_add_path") && trimmed.includes(".cyberstrike"))
    ) {
      continue
    }

    filtered.push(line)
  }

  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop()
  }

  const output = filtered.join("\n") + "\n"
  await Bun.write(file, output)
}

async function getDirectorySize(dir: string): Promise<number> {
  let total = 0

  const walk = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) total += stat.size
      }
    }
  }

  await walk(dir)
  return total
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function shortenPath(p: string): string {
  const home = os.homedir()
  if (p.startsWith(home)) {
    return p.replace(home, "~")
  }
  return p
}
