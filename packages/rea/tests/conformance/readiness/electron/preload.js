const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readiness", {
  echo: (value) => ipcRenderer.invoke("readiness:echo", value),
  onDeepLink: (listener) => ipcRenderer.on("deep-link", listener),
});
