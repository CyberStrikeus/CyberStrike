import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";

// Drives one real staged Evidence publication at an exact lifecycle point.
// "cleanup" queues the signal after the committed output's staging directory
// is removed; "staging" delivers it once the staging directory exists, before
// any byte can be committed. cleanup_failures rejects that many removals of
// the staging directory first, without removing it.
const input = JSON.parse(process.env.REA_TEST_EVIDENCE_PUBLICATION ?? "null");
assert.ok(
  input && typeof input.prefix === "string" && typeof input.marker === "string",
);
const phase = input.phase ?? "cleanup";
assert.ok(["staging", "cleanup"].includes(phase));
if (input.signal !== undefined) {
  assert.ok(["SIGINT", "SIGTERM"].includes(input.signal));
  assert.ok(["event", "os"].includes(input.delivery));
}
let cleanupFailures = input.cleanup_failures ?? 0;
assert.ok(Number.isSafeInteger(cleanupFailures) && cleanupFailures >= 0);

const require = createRequire(import.meta.url);
const fs = require("node:fs/promises");
const owned = (path) => String(path).startsWith(input.prefix);
let signalled = input.signal === undefined;
const recordDelivery = () => {
  writeFileSync(
    input.marker,
    JSON.stringify({
      phase,
      signal: input.signal,
      delivery: input.delivery,
      listeners: process.listenerCount(input.signal),
    }),
  );
};
const emitSignal = () => {
  if (input.delivery === "os") process.kill(process.pid, input.signal);
  else process.emit(input.signal);
};
const deliver = () => {
  recordDelivery();
  emitSignal();
};
const deliverAndObserve = async () => {
  recordDelivery();
  // Registered after the marker so it never stands in for the CLI handler.
  // Signal watchers do not keep the event loop alive; the timer does, and
  // reports a signal that was never observed. It never selects the phase.
  const observed = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${input.signal} was not observed`)),
      5_000,
    );
    process.once(input.signal, () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  emitSignal();
  await observed;
};

const remove = fs.rmdir;
fs.rmdir = async (...arguments_) => {
  if (cleanupFailures > 0 && owned(arguments_[0])) {
    cleanupFailures -= 1;
    throw Object.assign(new Error("injected staging cleanup failure"), {
      code: "EBUSY",
    });
  }
  const result = await remove(...arguments_);
  if (phase === "cleanup" && !signalled && owned(arguments_[0])) {
    signalled = true;
    setImmediate(deliver);
  }
  return result;
};

const stage = fs.mkdtemp;
fs.mkdtemp = async (...arguments_) => {
  const directory = await stage(...arguments_);
  if (phase === "staging" && !signalled && owned(directory)) {
    signalled = true;
    await deliverAndObserve();
  }
  return directory;
};
syncBuiltinESMExports();
