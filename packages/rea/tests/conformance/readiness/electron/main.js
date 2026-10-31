const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  utilityProcess,
} = require("electron");
const { spawn } = require("node:child_process");

const windows = new Set();
const deliverDeepLink = (url) => {
  for (const window of windows) window.webContents.send("deep-link", url);
};
app.on("open-url", (_event, url) => deliverDeepLink(url));
app.on("second-instance", (_event, commandLine) => {
  const url = commandLine.at(-1);
  if (typeof url === "string") deliverDeepLink(url);
});
app.whenReady().then(() => {
  for (let index = 0; index < 2; index += 1) {
    const window = new BrowserWindow({
      webPreferences: { preload: require.resolve("./preload.js") },
    });
    windows.add(window);
    window.loadFile("renderer.html");
    window.webContents.on("render-process-gone", () => window.reload());
  }
  utilityProcess.fork(require.resolve("./utility.js"));
  const child = spawn(
    process.env.REA_ELECTRON_NODE_EXECUTABLE ?? "node",
    ["-e", "setTimeout(() => {}, 100)"],
    { stdio: "ignore" },
  );
  child.on("error", () => undefined);
  ipcMain.handle("readiness:echo", (_event, value) => ({ value }));
  shell.openExternal("https://blocked.invalid").catch(() => undefined);
});
