#!/usr/bin/env node

import path from "path"
import fs from "fs"
import os from "os"

function xdgDataDir() {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
}
function xdgCacheDir() {
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
}
function xdgConfigDir() {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}
function xdgStateDir() {
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
}

const dirs = [
  { path: path.join(xdgDataDir(), "cyberstrike"), label: "Data (sessions, database, skills)" },
  { path: path.join(xdgCacheDir(), "cyberstrike"), label: "Cache (models, assets)" },
  { path: path.join(xdgConfigDir(), "cyberstrike"), label: "Config (settings, providers)" },
  { path: path.join(xdgStateDir(), "cyberstrike"), label: "State" },
]

const existing = dirs.filter((d) => fs.existsSync(d.path))

if (existing.length > 0) {
  console.log("")
  console.log("  CyberStrike data directories are preserved after package removal.")
  console.log("  To remove them, run:")
  console.log("")
  console.log("    rm -rf " + existing.map((d) => d.path).join(" \\\n           "))
  console.log("")
  console.log("  Or reinstall and run: cyberstrike uninstall")
  console.log("")
}
