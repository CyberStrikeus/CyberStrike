import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const MIB = 1024 * 1024;
const LIMIT = 128 * MIB;
// Observed peaks exceed the limit by a few MiB of kernel-charged commit
// (e.g. 512 MiB -> 520 MiB, 256 MiB -> 262 MiB under Bun), never by an
// allocation the limit refused.
const PEAK_OVERSHOOT = 32 * MIB;
// External Buffer memory is committed outside the V8 heap, so V8 heap flags
// cannot bound it; only the Job Object commit limit can stop this child.
const UNBOUNDED = `const kept = [];
for (let index = 0; index < 64; index++) kept.push(Buffer.alloc(${String(16 * MIB)}, 1));
console.log("unbounded allocation completed");`;
const BOUNDED = `const kept = Buffer.alloc(${String(MIB)}, 1);
console.log("bounded allocation completed", kept.length);`;

/** Exercise owned Job Object commit limits through the native boundary and its production wrapper. */
export async function verifyWindowsJobMemoryLimit(packageRoot, workspace) {
  const { WindowsOwnedProcess } = await import(
    pathToFileURL(join(packageRoot, "dist/windows/WindowsOwnedProcess.js"))
  );
  const { requireWindowsNativeAuthority } = await import(
    pathToFileURL(join(packageRoot, "dist/windows/WindowsNativeLoader.js"))
  );
  const native = requireWindowsNativeAuthority();
  assert.equal(native.inspection.jobMemoryLimit, true);
  const launch = nativeLauncher(native, workspace);

  for (const invalid of [
    0,
    -MIB,
    1.5,
    LIMIT + 0.5,
    2 ** 53,
    NaN,
    Infinity,
    4097,
    "134217728",
    null,
  ])
    assert.throws(() => launch(BOUNDED, false, invalid), {
      code: "ERR_REA_WINDOWS_NATIVE",
      win32Code: 87,
    });

  const unlimited = await settle(native, launch(BOUNDED));
  assert.equal(unlimited.exitCode, 0);
  assert.equal("memoryLimitReached" in unlimited, false);
  assert.equal("peakJobMemoryBytes" in unlimited, false);

  const reachedLaunch = launch(UNBOUNDED, false, LIMIT);
  assert.equal(reachedLaunch.jobMemoryLimitBytes, LIMIT);
  const reached = await settle(native, reachedLaunch);
  assert.notEqual(reached.exitCode, 0);
  assert.doesNotMatch(reached.output, /unbounded allocation completed/u);
  assert.equal(reached.activeProcesses, 0);
  assert.equal(reached.memoryLimitReached, true);
  assert.equal(reached.memoryLimitReachedAtExit, true);
  assert.ok(reached.peakJobMemoryBytes <= LIMIT + PEAK_OVERSHOOT);
  assert.ok(reached.peakJobMemoryBytes > LIMIT - 64 * MIB);

  const control = await settle(native, launch(BOUNDED, false, LIMIT));
  assert.equal(control.exitCode, 0);
  assert.match(control.output, /bounded allocation completed/u);
  assert.equal(control.activeProcesses, 0);
  assert.equal(control.memoryLimitReached, false);
  assert.equal(control.memoryLimitReachedAtExit, false);
  assert.ok(control.peakJobMemoryBytes < LIMIT);

  await verifyWrappedLimit(WindowsOwnedProcess, native, workspace);

  return {
    limit_bytes: LIMIT,
    invalid_limits_rejected: true,
    unlimited_poll_shape_unchanged: true,
    reached: {
      exit_code: reached.exitCode,
      peak_job_memory_bytes: reached.peakJobMemoryBytes,
    },
    control: {
      exit_code: control.exitCode,
      peak_job_memory_bytes: control.peakJobMemoryBytes,
    },
    wrapper_reports_limit_reached: true,
    first_exit_reports_limit_reached: true,
    missing_capability_refused: true,
  };
}

function nativeLauncher(native, workspace) {
  const environment = Object.entries(process.env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  const quote = (value) =>
    `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
  return (script, ...controls) =>
    native.call("process_spawn", [
      process.execPath,
      [process.execPath, "-e", script].map(quote).join(" "),
      workspace,
      environment,
      ...controls,
    ]);
}

async function verifyWrappedLimit(WindowsOwnedProcess, native, workspace) {
  const wrapped = new WindowsOwnedProcess(
    process.execPath,
    ["-e", UNBOUNDED],
    workspace,
    process.env,
    false,
    { memoryLimitBytes: LIMIT },
  );
  const closed = new Promise((resolve, reject) => {
    wrapped.once("error", reject);
    wrapped.once("close", (code) => resolve(code));
  });
  let memoryLimitReachedAtExit;
  wrapped.once("exit", () => {
    memoryLimitReachedAtExit = wrapped.memoryLimitReached;
  });
  wrapped.stdout.resume();
  wrapped.stderr.resume();
  assert.notEqual(await closed, 0);
  assert.equal(memoryLimitReachedAtExit, true);
  assert.equal(wrapped.memoryLimitReached, true);
  assert.ok(wrapped.peakJobMemoryBytes <= LIMIT + PEAK_OVERSHOOT);

  assert.throws(
    () =>
      new WindowsOwnedProcess(
        process.execPath,
        ["-e", BOUNDED],
        workspace,
        process.env,
        false,
        {
          memoryLimitBytes: LIMIT,
          authority: {
            call: native.call,
            inspection: { ...native.inspection, jobMemoryLimit: undefined },
          },
        },
      ),
    /does not support Job Object memory limits/u,
  );
}

async function settle(native, child) {
  let output = "";
  let firstExitState;
  try {
    for (let attempt = 0; attempt < 800; attempt++) {
      const state = native.call("process_poll", [child.handle]);
      output += state.stdout.toString();
      if (state.exitCode !== null) firstExitState ??= state;
      if (
        state.exitCode !== null &&
        state.activeProcesses === 0 &&
        state.stdoutEnded &&
        state.stderrEnded
      )
        return {
          ...state,
          output,
          memoryLimitReachedAtExit: firstExitState.memoryLimitReached,
        };
      await delay(25);
    }
    throw new Error(
      "Memory-limited job did not settle within the fixture deadline.",
    );
  } finally {
    native.call("process_close", [child.handle]);
  }
}
