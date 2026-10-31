import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const withDeadline = async (promise, milliseconds, description) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`${description} exceeded ${milliseconds} ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export async function verifyVolumeRootAppendLease({
  fixturePath,
  volumeRoot,
  verifyAdmission,
}) {
  const lease = spawn(
    resolve(fixturePath),
    ["volume-root-append-lease", volumeRoot],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const lines = createInterface({ input: lease.stdout });
  let leaseStderr = "";
  lease.stderr.setEncoding("utf8");
  lease.stderr.on("data", (chunk) => {
    if (leaseStderr.length < 8192) leaseStderr += chunk;
  });

  const closed = once(lease, "close").then(([code, signal]) => ({
    code,
    signal,
  }));
  const leaseLine = once(lines, "line").then(([line]) => ({ line }));
  const leaseError = once(lease, "error").then(([error]) => {
    throw error;
  });
  let verificationFailure;
  try {
    const ready = await withDeadline(
      Promise.race([leaseLine, closed, leaseError]),
      10_000,
      "Volume-root append lease readiness",
    );
    assert.equal(
      "line" in ready,
      true,
      `Volume-root append lease exited before readiness (code ${ready.code}, signal ${ready.signal}): ${leaseStderr}`,
    );
    const observation = JSON.parse(ready.line);
    assert.equal(
      observation.writeAccessGranted,
      true,
      `Windows test token cannot hold FILE_ADD_SUBDIRECTORY on ${volumeRoot} (Win32 ${observation.win32Code}).`,
    );
    await verifyAdmission();
  } catch (error) {
    verificationFailure = error;
  }

  lines.close();
  if (
    lease.exitCode === null &&
    lease.signalCode === null &&
    !lease.stdin.destroyed
  )
    lease.stdin.end("x");

  let releaseFailure;
  try {
    const result = await withDeadline(
      closed,
      10_000,
      "Volume-root append lease release",
    ).catch(async (error) => {
      lease.kill();
      try {
        return await withDeadline(
          closed,
          5_000,
          "Volume-root append lease termination",
        );
      } catch (terminationError) {
        throw new AggregateError(
          [error, terminationError],
          `Volume-root append lease could not be released: ${leaseStderr}`,
        );
      }
    });
    assert.equal(
      result.code,
      0,
      `Volume-root append lease exited with code ${result.code}, signal ${result.signal}: ${leaseStderr}`,
    );
  } catch (error) {
    releaseFailure = error;
  }

  if (verificationFailure !== undefined && releaseFailure !== undefined)
    throw new AggregateError(
      [verificationFailure, releaseFailure],
      "Volume-root append lease verification and cleanup both failed.",
    );
  if (verificationFailure !== undefined) throw verificationFailure;
  if (releaseFailure !== undefined) throw releaseFailure;
}
