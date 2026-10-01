import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to io.cyberstrike.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.CYBERSTRIKE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "io.cyberstrike.desktop.dev",
  beta: "io.cyberstrike.desktop.beta",
  prod: "io.cyberstrike.desktop",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "cyberstrike-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "io.cyberstrike.desktop" becomes
  // "io.cyberstrike.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    {
      from: "resources/cyberstrike/",
      to: "cyberstrike/",
      filter: ["**/*"],
    },
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: process.env.GITHUB_ACTIONS === "true",
    identity: process.env.GITHUB_ACTIONS === "true" ? undefined : null,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: process.env.GITHUB_ACTIONS === "true",
  },
  protocols: {
    name: "CyberStrike",
    schemes: ["cyberstrike"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "CyberStrike Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "cyberstrike-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "CyberStrike Beta",
        protocols: { name: "CyberStrike Beta", schemes: ["cyberstrike"] },
        publish: { provider: "github", owner: "CyberStrikeus", repo: "CyberStrike-Enterprise", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "cyberstrike-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "CyberStrike",
        protocols: { name: "CyberStrike", schemes: ["cyberstrike"] },
        publish: { provider: "github", owner: "CyberStrikeus", repo: "CyberStrike-Enterprise", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
        rpm: { packageName: "cyberstrike", fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
