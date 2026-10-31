import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cleanupOwnedProcessGroup,
  readProcessRunId,
} from "../../../dist/process/ProcessOwnership.js";

/** Exercise a real CLI signal while the owned Java engine is still running. */
export const verifyAndroidCliCancellation = async ({
  entrypoint,
  environment,
  path,
  repository,
  execute,
}) => {
  // Native identity inspection must be ready before observing the short-lived
  // engine; compiling its helper after acquisition can miss the whole request.
  await readProcessRunId(process.pid);
  const child = spawn(
    process.execPath,
    [entrypoint, "inspect-android-package", path, "--format", "json"],
    { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let group;
  let ownership;
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const table = (
        await execute("ps", ["-eo", "pid=,ppid=,pgid=,args="], {
          timeout: 5_000,
          maxBuffer: 2 * 1024 * 1024,
        })
      ).stdout;
      for (const row of table.split("\n")) {
        const entry = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(row);
        if (
          entry !== null &&
          Number(entry[2]) === child.pid &&
          entry[4].includes("engine.jar") &&
          entry[4].includes("ReaJadxBridge.java")
        ) {
          group = Number(entry[3]);
          const runId = await readProcessRunId(Number(entry[1]));
          assert.ok(
            runId !== undefined,
            "Owned Java process did not carry an identity token",
          );
          ownership = {
            runId,
            leaderPid: Number(entry[1]),
            processGroupId: group,
          };
        }
      }
      if (group !== undefined) break;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          `CLI exited before acquiring JADX: ${stdout}\n${stderr}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      group !== undefined,
      "CLI did not acquire the expected owned Java group",
    );
    child.kill("SIGTERM");
    let timer;
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("CLI cancellation did not finish cleanup")),
          10_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(result.code, 143, `${stdout}\n${stderr}`);
    assert.equal(result.signal, null);
    assert.equal(JSON.parse(stdout).code, "cancelled", `${stdout}\n${stderr}`);
    assert.throws(() => process.kill(-group, 0), { code: "ESRCH" });
    console.log(
      "PASS real CLI SIGTERM cancellation and owned Java group cleanup",
    );
  } finally {
    await cleanupCancellation(child, exited, ownership);
  }
};

const cleanupCancellation = async (child, exited, ownership) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    let timer;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2_000);
      }),
    ]).finally(() => clearTimeout(timer));
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
  if (ownership !== undefined)
    assert.equal(
      (await cleanupOwnedProcessGroup(ownership)).cleaned,
      true,
      "Verifier could not confirm its owned Java group cleanup",
    );
};
