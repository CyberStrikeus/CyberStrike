const { parentPort } = require("electron");

parentPort.on("message", (event) => {
  parentPort.postMessage({ echoed: event.data });
});
