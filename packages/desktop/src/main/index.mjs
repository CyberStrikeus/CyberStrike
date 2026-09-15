// CyberStrike desktop shell (MVP). On launch: start the local CyberStrike server, then open a native
// window on its web UI. Thin wrapper — no bundled renderer; it loads the server's served UI (loopback,
// so no auth prompt). Auto-update / native pty / packaging polish are later phases.
import { app, BrowserWindow, dialog, shell } from "electron"
import { startBackend, stopBackend } from "./backend.mjs"

let mainWindow = null
let backend = null

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "CyberStrike",
    backgroundColor: "#0b0b12",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // External links (target=_blank / window.open) open in the system browser, not a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u)) shell.openExternal(u)
    return { action: "deny" }
  })

  mainWindow.once("ready-to-show", () => mainWindow?.show())
  mainWindow.on("closed", () => {
    mainWindow = null
  })
  mainWindow.loadURL(url)
}

async function boot() {
  try {
    backend = await startBackend()
    createWindow(backend.url)
  } catch (err) {
    dialog.showErrorBox("CyberStrike failed to start", String(err instanceof Error ? err.message : err))
    app.quit()
  }
}

app.whenReady().then(boot)

app.on("activate", () => {
  // macOS: re-open a window when the dock icon is clicked and none are open.
  if (BrowserWindow.getAllWindows().length === 0 && backend) createWindow(backend.url)
})

app.on("window-all-closed", () => {
  // macOS convention keeps the app alive, but this MVP owns a server child, so quit everywhere.
  app.quit()
})

app.on("before-quit", () => stopBackend(backend?.child))
app.on("quit", () => stopBackend(backend?.child))
