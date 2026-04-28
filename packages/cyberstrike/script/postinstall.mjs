#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import { execSync } from "child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  // Map platform names
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  // Map architecture names
  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `@cyberstrike-io/cyberstrike-${platform}-${arch}`
  const binaryName = platform === "windows" ? "cyberstrike.exe" : "cyberstrike"

  try {
    // Use require.resolve to find the package
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return { binaryPath, binaryName }
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin")
  const targetPath = path.join(binDir, binaryName)

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  // Remove existing binary/symlink if it exists
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }

  return { binDir, targetPath }
}

function symlinkBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)

  fs.symlinkSync(sourcePath, targetPath)
  console.log(`cyberstrike binary symlinked: ${targetPath} -> ${sourcePath}`)

  // Verify the file exists after operation
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`)
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function xdgDataDir() {
  // Match xdg-basedir: XDG_DATA_HOME or ~/.local/share
  const xdg = process.env.XDG_DATA_HOME
  if (xdg) return xdg
  return path.join(os.homedir(), ".local", "share")
}

function installWebUI() {
  const webSrc = path.join(__dirname, "web")
  if (!fs.existsSync(path.join(webSrc, "index.html"))) return

  const dataDir = path.join(xdgDataDir(), "cyberstrike")
  const webDest = path.join(dataDir, "web")

  // Remove old web UI before copying
  if (fs.existsSync(webDest)) {
    fs.rmSync(webDest, { recursive: true, force: true })
  }

  copyDirSync(webSrc, webDest)
  console.log(`Web UI installed to ${webDest}`)
}

function installSkills() {
  const skillSrc = path.join(__dirname, "skill")
  if (!fs.existsSync(skillSrc)) return

  const dataDir = path.join(xdgDataDir(), "cyberstrike")
  const skillDest = path.join(dataDir, "skill")

  // Remove old skills before copying
  if (fs.existsSync(skillDest)) {
    fs.rmSync(skillDest, { recursive: true, force: true })
  }

  copyDirSync(skillSrc, skillDest)
  console.log(`Skills installed to ${skillDest}`)
}

/**
 * Install hackbrowser worker JS to Global.Path.bin equivalent
 * (~/.local/share/cyberstrike/bin/hackbrowser-worker.js).
 *
 * The worker is the subprocess that runs playwright/hackbrowser so that
 * the main cyberstrike binary has zero playwright references at startup
 * (subprocess.md). The main binary locates the worker at this path.
 *
 * Playwright JS package is also installed to
 * ~/.local/share/cyberstrike/node_modules/ so the worker can resolve it
 * at runtime without relying on the npm global node_modules layout.
 * The actual chromium binary requires a separate one-time step:
 *   npx playwright install chromium
 */
function installHackbrowserWorker() {
  const workerSrc = path.join(__dirname, "hackbrowser-worker.js")
  if (!fs.existsSync(workerSrc)) {
    console.warn("Warning: hackbrowser-worker.js not found in package — hackbrowser subcommand will not work")
    return
  }

  const dataDir = path.join(xdgDataDir(), "cyberstrike")
  const binDir = path.join(dataDir, "bin")
  const workerDest = path.join(binDir, "hackbrowser-worker.js")

  fs.mkdirSync(binDir, { recursive: true })
  fs.copyFileSync(workerSrc, workerDest)
  console.log(`hackbrowser worker installed to ${workerDest}`)

  // Install playwright JS package next to the worker so Node/Bun upward
  // traversal from binDir finds it at dataDir/node_modules/playwright/.
  // The playwright package itself is small (~5 MB); chromium is separate.
  const nodeModulesDir = path.join(dataDir, "node_modules")
  const playwrightDir = path.join(nodeModulesDir, "playwright")
  if (!fs.existsSync(playwrightDir)) {
    console.log("Installing playwright npm package for hackbrowser worker...")
    try {
      execSync(`npm install --prefix "${dataDir}" playwright@1.58.2 --no-fund --no-audit --loglevel=error`, {
        stdio: "inherit",
        timeout: 120000,
      })
      console.log("playwright installed to", nodeModulesDir)
    } catch (err) {
      console.warn(
        "Warning: Failed to install playwright automatically:",
        err.message,
        "\nTo install manually: npm install --prefix ~/.local/share/cyberstrike playwright@1.58.2",
      )
    }
  } else {
    console.log("playwright already installed at", playwrightDir)
  }

  console.log(
    "\nTo use hackbrowser, install the Chromium browser (one-time setup):",
    "\n  npx playwright install chromium",
  )
}

async function main() {
  try {
    if (os.platform() === "win32") {
      // On Windows, the .exe is already included in the package and bin field points to it
      // No postinstall setup needed
      console.log("Windows detected: binary setup not needed (using packaged .exe)")
      installWebUI()
      installSkills()
      installHackbrowserWorker()
      return
    }

    // On non-Windows platforms, just verify the binary package exists
    // Don't replace the wrapper script - it handles binary execution
    const { binaryPath } = findBinary()
    console.log(`Platform binary verified at: ${binaryPath}`)
    console.log("Wrapper script will handle binary execution")

    installWebUI()
    installSkills()
    installHackbrowserWorker()
  } catch (error) {
    console.error("Failed to setup cyberstrike binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
