import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

/** Exercise owned Windows stdin through its production Writable and native boundary. */
export async function verifyWindowsProtocolInput(packageRoot, workspace) {
  const { WindowsOwnedProcess } = await import(
    pathToFileURL(join(packageRoot, "dist/windows/WindowsOwnedProcess.js"))
  );
  const { requireWindowsNativeAuthority } = await import(
    pathToFileURL(join(packageRoot, "dist/windows/WindowsNativeLoader.js"))
  );
  const native = requireWindowsNativeAuthority();
  assert.equal(native.inspection.protocolStdin, true);
  const launch = (script) => acquire(WindowsOwnedProcess, workspace, script);
  const echo = await verifyEcho(launch);
  const cancellation = await verifyBlockedCancellation(launch);
  await verifyNativePendingWrite(native, workspace);
  const { JadxMcpTransport } = await import(
    pathToFileURL(join(packageRoot, "dist/android/JadxMcpTransport.js"))
  );
  await verifyTransportPendingWrite(JadxMcpTransport, workspace);
  return {
    echo,
    cancellation,
    native_pending_write_closed: true,
    forged_input_handle_rejected: true,
    malformed_input_rejected: true,
    provider_transport_pending_write_cancelled: true,
  };
}

function acquire(Process, workspace, script) {
  const child = new Process(
    process.execPath,
    ["-e", script],
    workspace,
    process.env,
    false,
    { protocolStdin: true },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (bytes) => {
    stdout += bytes.toString();
  });
  child.stderr.on("data", (bytes) => {
    stderr += bytes.toString();
  });
  const inputErrors = [];
  child.stdin.on("error", (cause) => inputErrors.push(cause.message));
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  return { child, closed, inputErrors, stdout: () => stdout };
}

async function verifyEcho(launch) {
  const acquired = launch(`
    const {createHash} = require('node:crypto');
    const hash = createHash('sha256'); let count = 0;
    process.stdin.on('data', bytes => { hash.update(bytes); count += bytes.length; });
    process.stdin.pause(); setTimeout(() => process.stdin.resume(), 250);
    process.stdin.on('end', () => console.log(JSON.stringify({count,sha256:hash.digest('hex')})));
  `);
  const bytes = Buffer.from(
    "caller-selected UTF8: 路径 Ω; binary:\0\n".repeat(60000),
  );
  const expected = {
    count: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  try {
    let writable;
    await new Promise((resolve, reject) => {
      writable = acquired.child.stdin.write(bytes, (cause) =>
        cause ? reject(cause) : resolve(),
      );
      // The native worker owns its copy before returning to the caller.
      bytes.fill(0x5a);
    });
    assert.equal(
      writable,
      false,
      "Large protocol input did not expose backpressure",
    );
    assert.ok(ticks > 0, "Input write blocked the JS event loop");
    acquired.child.stdin.end();
    const result = await deadline(acquired.closed);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    assert.deepEqual(acquired.inputErrors, []);
    assert.equal((await acquired.child.cleanup()).cleaned, true);
    return {
      bytes: expected.count,
      sha256: expected.sha256,
      backpressure: true,
      event_loop_responsive: true,
      eof_observed: true,
    };
  } finally {
    clearInterval(timer);
    await acquired.child.cleanup();
  }
}

async function verifyBlockedCancellation(launch) {
  const acquired = launch(`
    const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'inherit'});
    console.log('owned descendant ' + child.pid);
    setInterval(() => {}, 1000);
  `);
  try {
    for (
      let attempt = 0;
      attempt < 100 && !acquired.stdout().includes("owned descendant");
      attempt++
    )
      await delay(25);
    assert.match(acquired.stdout(), /owned descendant \d+/u);
    const write = new Promise((resolve) =>
      acquired.child.stdin.write(Buffer.alloc(2 * 1024 * 1024), (cause) =>
        resolve(cause),
      ),
    );
    await delay(100);
    const cleanup = await acquired.child.cleanup();
    assert.equal(cleanup.cleaned, true, cleanup.reason);
    assert.ok(
      await deadline(write),
      "Closing the owned job reported a successful blocked write",
    );
    await deadline(acquired.closed);
    return { blocked_write_cancelled: true, descendant_job_settled: true };
  } finally {
    await acquired.child.cleanup();
  }
}

async function verifyNativePendingWrite(native, workspace) {
  const quote = (value) =>
    `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
  const child = native.call("process_spawn", [
    process.execPath,
    [process.execPath, "-e", "setInterval(() => {}, 1000)"]
      .map(quote)
      .join(" "),
    workspace,
    Object.entries(process.env)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`),
    true,
  ]);
  let rejected;
  try {
    assert.throws(
      () => native.call("process_stdin_write", [child.handle, "not a Buffer"]),
      /must be a Buffer/u,
    );
    const pending = native.call("process_stdin_write", [
      child.handle,
      Buffer.alloc(2 * 1024 * 1024),
    ]);
    rejected = pending.then(
      () => false,
      (cause) => cause,
    );
    assert.throws(
      () =>
        native.call("process_stdin_write", [
          child.handle,
          Buffer.from("second"),
        ]),
      /pending write/u,
    );
    assert.throws(
      () => native.call("process_stdin_write", [{}, Buffer.from("forged")]),
      /does not belong to REA/u,
    );
  } finally {
    // The worker retains its handle/buffer after the JS resource closes.
    native.call("process_close", [child.handle]);
  }
  const failure = await deadline(rejected);
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /Write owned process input failed/u);
}

async function verifyTransportPendingWrite(Transport, workspace) {
  const transport = new Transport({
    command: process.execPath,
    arguments: ["-e", "setInterval(() => {}, 1000)"],
    cwd: workspace,
  });
  transport.onerror = () => {};
  try {
    await transport.start();
    const pending = transport
      .send({
        jsonrpc: "2.0",
        id: "blocked",
        method: "probe",
        params: { payload: "x".repeat(2 * 1024 * 1024) },
      })
      .then(
        () => false,
        (cause) => cause,
      );
    await delay(100);
    await transport.close();
    assert.ok(
      await deadline(pending),
      "Transport cancellation accepted a blocked write",
    );
  } finally {
    await transport.close();
  }
}

async function deadline(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Owned input fixture exceeded its deadline")),
        10000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
