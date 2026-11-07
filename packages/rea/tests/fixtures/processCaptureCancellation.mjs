import { spawn } from "node:child_process";
import { once } from "node:events";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";

const [mode, root] = process.argv.slice(2);

const publishReadyMarker = async (marker) => {
  const destination = join(root, "ready.json");
  const temporary = join(root, "ready.json.tmp");
  await writeFile(temporary, JSON.stringify(marker));
  await rename(temporary, destination);
};

if (mode === "settlement") {
  const child = spawn(process.execPath, [process.argv[1], "workload", root], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let handedOff = false;
  await withVerifierCleanup(async () => {
    const [message] = await once(child, "message");
    if (message !== "ready" || child.pid === undefined)
      throw new Error("Owned capture workload did not report ready");
    await publishReadyMarker({
      rootPid: process.pid,
      childPid: child.pid,
      runId: process.env.REA_PROCESS_RUN_ID,
    });
    child.disconnect();
    child.unref();
    handedOff = true;
  }, [
    async () => {
      if (
        !handedOff &&
        child.pid !== undefined &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await stopped;
      }
    },
  ]);
  process.stdout.write("root exiting; owned workload remains\n");
  process.exit(0);
} else {
  // A closed PTY must not masquerade as capture cancellation in this fixture.
  process.on("SIGHUP", () => undefined);
  const lateWrite = delay(6_000);
  const lifetime = delay(12_000);
  if (mode === "workload") process.send?.("ready");
  else {
    await publishReadyMarker({
      rootPid: process.pid,
      runId: process.env.REA_PROCESS_RUN_ID,
    });
    process.stdout.write("owned workload ready\n");
  }
  await lateWrite;
  await writeFile(join(root, "late-write"), "still running");
  await lifetime;
  process.exit(0);
}
