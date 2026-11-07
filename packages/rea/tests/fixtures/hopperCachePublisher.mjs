import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { acquireHopperReleaseCacheLease } from "../../dist/process/HopperLease.js";

// The parent prepares authenticated fixture evidence. Coordinate a real second
// process publishing it while another publisher is waiting for this lease.
const [cacheDirectory, launcherSha256, staged] = process.argv.slice(2);
const commands = createInterface({ input: process.stdin });
const command = once(commands, "line");
const acquired = await acquireHopperReleaseCacheLease({
  cacheDirectory,
  launcherSha256,
  runId: randomUUID(),
});
if (!acquired.acquired) throw new Error("Fixture cache lease was already held");
try {
  console.log(JSON.stringify({ held: true }));
  const [action] = await command;
  if (action === "publish") {
    const target = join(cacheDirectory, launcherSha256);
    await rename(target, `${target}.backup-${randomUUID()}`);
    await rename(staged, target);
  } else if (action !== "release") throw new Error("Unknown fixture action");
} finally {
  await acquired.lease.release();
  commands.close();
}
