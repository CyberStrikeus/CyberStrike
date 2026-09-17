// @refresh reload

import {
  AppBaseProviders,
  AppInterface,
  type Platform,
  PlatformProvider,
  useCommand,
  handleNotificationClick,
} from "@cyberstrike-io/app"
import type { DesktopMenuAction } from "@cyberstrike-io/app/desktop-menu"
import * as Sentry from "@sentry/solid"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { resetZoom, setPinchZoomEnabled, webviewZoom, zoomIn, zoomOut } from "./webview-zoom"
import { windowFullscreen } from "./window-fullscreen"
import "./styles.css"
import { useTheme } from "@cyberstrike-io/ui/theme/context"

// The desktop server is a local sidecar the main process starts on 4096. Loopback requests
// skip auth, so the renderer connects with no credentials (see main/server.ts). Pinned to 4096
// for the HackBrowser capture extension's ingest endpoint.
const SIDECAR_URL = "http://127.0.0.1:4096"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element #root not found")
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" &&
          !(
            import.meta.env.CYBERSTRIKE_CHANNEL === "prod" &&
            (i.name === "GlobalHandlers" || i.name === "BrowserApiErrors")
          ),
      )
    },
  })
}

const deepLinkEvent = "cyberstrike:deep-link"

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__CYBERSTRIKE__ ??= {}
  const pending = window.__CYBERSTRIKE__.deepLinks ?? []
  window.__CYBERSTRIKE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  void window.api.consumeInitialDeepLinks().then((urls) => emitDeepLinks(urls))
  return window.api.onDeepLink((urls) => emitDeepLinks(urls))
}

const detectOs = (): "macos" | "windows" | "linux" | undefined => {
  const ua = navigator.userAgent
  if (ua.includes("Mac")) return "macos"
  if (ua.includes("Windows")) return "windows"
  if (ua.includes("Linux")) return "linux"
  return undefined
}

const createStorageFactory = () => {
  const cache = new Map<string, AsyncStorage>()
  const build = (name: string): AsyncStorage => {
    const store: AsyncStorage = {
      getItem: (key: string) => window.api.storeGet(name, key),
      setItem: (key: string, value: string) => window.api.storeSet(name, key, value),
      removeItem: (key: string) => window.api.storeDelete(name, key),
      clear: () => window.api.storeClear(name),
      key: async (index: number) => (await window.api.storeKeys(name))[index],
      getLength: () => window.api.storeLength(name),
      get length() {
        return store.getLength()
      },
    }
    return store
  }
  return (name = "default.dat") => {
    const cached = cache.get(name)
    if (cached) return cached
    const store = build(name)
    cache.set(name, store)
    return store
  }
}

const createPlatform = (windowID: string | undefined): Platform => {
  const os = detectOs()

  const runDesktopMenuAction: Platform["runDesktopMenuAction"] = (action) => {
    if (action === "view.resetZoom") return resetZoom()
    if (action === "view.zoomIn") return zoomIn()
    if (action === "view.zoomOut") return zoomOut()
    return window.api.runDesktopMenuAction(action as DesktopMenuAction)
  }

  return {
    platform: "desktop",
    os,
    version: pkg.version,
    windowID,

    openLink: (url) => window.api.openExternal(url),

    openPath: async (path, appName) => {
      if (os === "windows") {
        const resolved = appName ? await window.api.resolveAppPath(appName).catch(() => null) : null
        return window.api.openPath(path, resolved ?? undefined)
      }
      return window.api.openPath(path, appName)
    },

    restart: async () => {
      await window.api.killSidecar().catch(() => undefined)
      window.api.relaunch()
    },

    back: () => window.history.back(),
    forward: () => window.history.forward(),

    notify: async (title, description, href) => {
      const focused = await window.api.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return
      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://cyberstrike.io/favicon-96x96-v3.png",
      })
      notification.onclick = () => {
        void window.api.showWindow()
        void window.api.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    openDirectoryPickerDialog: (opts) =>
      window.api.openDirectoryPicker({ multiple: opts?.multiple ?? false, title: opts?.title }),

    storage: createStorageFactory(),

    getDefaultServerUrl: () => window.api.getDefaultServerUrl().catch(() => null),
    setDefaultServerUrl: (url) => window.api.setDefaultServerUrl(url),

    getDisplayBackend: () => window.api.getDisplayBackend().catch(() => null),
    setDisplayBackend: (backend) => window.api.setDisplayBackend(backend),

    webviewZoom,
    windowFullscreen,

    checkAppExists: (appName) => window.api.checkAppExists(appName),

    readClipboardImage: async () => {
      const image = await window.api.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, { type: "image/png" })
    },

    runDesktopMenuAction,

    setForceFocus: (enabled) => window.api.setForceFocus(enabled),
  }
}

let menuTrigger = null as null | ((id: string) => void)
window.api.onMenuCommand((id) => menuTrigger?.(id))
listenForDeepLinks()
void setPinchZoomEnabled

// Bridges native menu commands into the command palette and syncs the native window background
// to the active theme. Renders inside AppInterface so useCommand()/useTheme() resolve.
function DesktopBridge() {
  const cmd = useCommand()
  menuTrigger = (id) => cmd.trigger(id)
  const theme = useTheme()
  createEffect(() => {
    theme.themeId()
    theme.mode()
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
    if (bg) void window.api.setBackgroundColor(bg)
  })
  return null
}

render(() => {
  const platform = createPlatform(undefined)
  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <AppInterface defaultUrl={SIDECAR_URL} isSidecar>
          <DesktopBridge />
        </AppInterface>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
