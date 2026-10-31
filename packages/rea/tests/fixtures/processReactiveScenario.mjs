import { spawn, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

import { WebSocket } from "ws";

process.stdout.write("Ready\n");
const worker = spawn(
  process.execPath,
  ["-e", 'process.title = "rea-reactive-worker"; setTimeout(() => {}, 750);'],
  { stdio: "ignore" },
);
// "Collecting" must reach the capture coordinator as an observation *after*
// the one carrying "Ready", because the ready transition consumes that
// observation and advances the terminal frontier. Writing both back to back
// let the PTY coalesce them into a single chunk, so whether the collecting
// trigger could match depended on host timing and the multi-source run
// intermittently resolved target_lost instead of passed. The synchronous probe
// below guarantees the reader has drained the first chunk before this one.
spawnSync(process.argv[2], ["probe"], { stdio: "ignore" });
process.stdout.write("Collecting\n");
await writeFile("reactive-result.txt", "created");
await fetch(`${process.env.REA_REPLAY_HTTP_URL}/reactive`);
await new Promise((resolve, reject) => {
  const socket = new WebSocket(process.env.REA_REPLAY_WEBSOCKET_URL);
  socket.once("open", () => socket.send("reactive-client"));
  socket.once("message", () => socket.close());
  socket.once("close", resolve);
  socket.once("error", reject);
});
await new Promise((resolve, reject) => {
  worker.once("exit", resolve);
  worker.once("error", reject);
});
// Let the parent capture coordinator ingest final protocol and filesystem events
// before the root process exits and submits its terminal loss signal.
await new Promise((resolve) => setTimeout(resolve, 25));
