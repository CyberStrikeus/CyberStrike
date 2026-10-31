#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

report="$HOME/rea-ci"
exec > "$report/run.log" 2>&1
# Publish the result only after all commands have settled. The host reads it as
# root; no shared-storage permission or helper Android application is needed.
trap 'result=$?; printf "%s\n" "$result" > "$report/status"' EXIT
set -x
[[ "$(id -u)" != 0 ]]
export DEBIAN_FRONTEND=noninteractive
export HUSKY=0
pkg update -y
pkg upgrade -y
pkg install -y nodejs-lts npm git x11-repo termux-exec
pkg install -y chromium
mkdir -p "$report/source"
tar -xf "$report/source.tar" -C "$report/source"
cd "$report/source"
node -e 'if (process.platform !== "android") throw new Error("Expected Android Node.js")'
node -e 'const expected = require("node:fs").readFileSync(".nvmrc", "utf8").trim().replace(/^v/, ""); if (process.versions.node !== expected) throw new Error(`Termux Node ${process.versions.node} differs from .nvmrc ${expected}`)'
# Android uses Termux's Bionic-linked Node distribution; the desktop .nvmrc
# binary cannot run here. Keep npm at the repository's exact pinned version.
npm install --prefix "$report/toolchain" --no-package-lock --ignore-scripts \
  "$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).packageManager')"
export PATH="$report/toolchain/node_modules/.bin:$PATH"
node --version
npm --version
dpkg-query -W nodejs-lts chromium termux-exec
npm ci
npm run build:termux
unset PLAYWRIGHT_BROWSERS_PATH npm_config_playwright_browsers_path npm_package_config_playwright_browsers_path
node scripts/verify/termux/browser.mjs
