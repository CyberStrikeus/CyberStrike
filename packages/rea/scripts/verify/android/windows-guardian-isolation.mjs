import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createJadxWorkspaceRoot } from "../../../dist/android/JadxWorkspaceRoot.js";

const source = fileURLToPath(import.meta.url);
const marker = "REA synthetic guardian isolation test\n";
const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

if (process.argv[1] === source && process.argv[2] === "owner") {
  const root = await createJadxWorkspaceRoot();
  await writeFile(join(root.path, "synthetic.txt"), marker);
  process.stdout.write(JSON.stringify({ path: root.path }) + "\n");
  await new Promise(() => {});
}

const bounded = async (promise, milliseconds, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const launch = async () => {
  const child = spawn(process.execPath, [source, "owner"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  const exit = new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    const ready = await bounded(
      lines[Symbol.asyncIterator]().next(),
      20000,
      `Android guardian owner readiness timed out: ${stderr}`,
    );
    assert.equal(ready.done, false, stderr);
    const { path } = JSON.parse(ready.value);
    assert.equal(typeof path, "string");
    assert.equal(await exists(join(path, "synthetic.txt")), true);
    return { child, exit, path };
  } catch (cause) {
    child.kill();
    await bounded(exit, 15000, "Android guardian owner did not exit");
    throw cause;
  }
};

const stop = async ({ child, exit, path }) => {
  assert.equal(child.kill(), true);
  await bounded(exit, 15000, "Android guardian owner did not exit");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await exists(path))) return;
    await delay(100);
  }
  throw new Error(`Android guardian retained ${path} after owner death`);
};

/** Two independent owners must never delete one another's private workspace. */
export async function verifyWindowsGuardianIsolation() {
  assert.equal(process.platform, "win32");
  const first = await launch();
  let second;
  try {
    second = await launch();
    assert.notEqual(first.path, second.path);
    await stop(first);
    assert.equal(
      await exists(join(second.path, "synthetic.txt")),
      true,
      "First owner deleted the second owner's workspace",
    );
    await stop(second);
    console.log("PASS Windows Android guardian two-owner cleanup isolation");
  } finally {
    for (const owner of [first, second]) {
      if (owner === undefined) continue;
      if (owner.child.exitCode === null && owner.child.signalCode === null)
        owner.child.kill();
      await bounded(owner.exit, 15000, "Android guardian owner did not exit");
    }
  }
}
