#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";
import { WindowsPrivateRuntime } from "../dist/windows/WindowsPrivateRuntime.js";

if (process.platform !== "win32" || process.argv.length !== 3)
  throw new Error(
    "Android workspace guardian requires Windows and one parent directory",
  );

// This process owns the native directory handle. Detached process creation
// keeps it alive when the REA owner is terminated without running JS cleanup.
const runtime = WindowsPrivateRuntime.create(process.argv[2], "rea-android-");
const ready = await new Promise((resolve) => {
  process.stdout.once("error", () => resolve(false));
  process.stdout.write(
    JSON.stringify({
      path: runtime.observation.path,
      volumeSerial: runtime.observation.volumeSerial,
      fileId: runtime.observation.fileId,
      privateDacl: runtime.observation.privateDacl,
    }) + "\n",
    (error) => resolve(error == null),
  );
});

// The owner holds the write end until close/death. A failed readiness pipe
// also grants cleanup authority, including owner death during startup.
if (ready) {
  for await (const _ of process.stdin) {
    // No commands are accepted; only EOF grants cleanup authority.
  }
} else {
  process.stdin.destroy();
}

// A failed native walk retains the directory identity lease for a later retry.
// Keep this process alive so a transient sharing violation cannot orphan it.
for (;;) {
  try {
    await runtime.close();
    process.exit(0);
  } catch {
    await delay(1000);
  }
}
