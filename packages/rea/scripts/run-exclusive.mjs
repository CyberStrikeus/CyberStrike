#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
let shutdownSignal;
const supervisor = spawn(
  process.execPath,
  [
    // SQLite and Windows source transforms are internal supervisor APIs. This
    // process-only flag keeps their notices out of command stderr without
    // changing the command's arguments, environment, or warning behavior.
    "--disable-warning=ExperimentalWarning",
    fileURLToPath(new URL("./run-exclusive-command.mjs", import.meta.url)),
    ...process.argv.slice(2),
  ],
  {
    detached: process.platform !== "win32",
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  },
);

for (const signal of Object.keys(signalExitCodes))
  process.on(signal, () => {
    if (shutdownSignal !== undefined) return;
    shutdownSignal = signal;
    if (supervisor.connected)
      supervisor.send(signal, (cause) => {
        if (cause !== null)
          console.error(`Could not forward cancellation: ${cause.message}`);
      });
  });

supervisor.once("error", (cause) => {
  console.error(cause.message);
  process.exitCode = 1;
});
supervisor.once("close", (code) => {
  process.exitCode =
    shutdownSignal === undefined
      ? (code ?? 1)
      : signalExitCodes[shutdownSignal];
});
