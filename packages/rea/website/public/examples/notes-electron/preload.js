const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notes", {
  exportCsv: () => ipcRenderer.invoke("notes:export"),
});
