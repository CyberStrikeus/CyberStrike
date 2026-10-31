import { expect, it } from "vitest";

import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";
import { V8InspectorAdmission } from "./V8InspectorProvider.js";

const gate = (): { promise: Promise<void>; release: () => void } => {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

it("does not make one inspector admission wait on another", async () => {
  const first = new V8InspectorAdmission();
  const second = new V8InspectorAdmission();
  const held = gate();
  const running = first.run("observe_javascript_runtime", () => held.promise);
  const closing = first.close();
  try {
    let secondRan = false;
    await second.run("list_javascript_runtime_targets", async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);
    let firstFinished = false;
    void closing.finally(() => {
      firstFinished = true;
    });
    await Promise.resolve();
    expect(firstFinished).toBe(false);
  } finally {
    held.release();
    await Promise.allSettled([running, closing]);
  }
});

it("holds a later operation until the same admission finishes closing", async () => {
  const admission = new V8InspectorAdmission();
  const held = gate();
  const running = admission.run(
    "observe_javascript_runtime",
    () => held.promise,
  );
  const closing = admission.close();
  let proceeded = false;
  const queued = admission.run("list_javascript_runtime_targets", async () => {
    proceeded = true;
  });
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(proceeded).toBe(false);
  } finally {
    held.release();
    await Promise.allSettled([running, closing, queued]);
  }
  expect(proceeded).toBe(true);
});

it("closes one inspector file scope without waiting for another", async () => {
  const first = new V8InspectorAdmission();
  const second = new V8InspectorAdmission();
  const held = gate();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const scope = first.files;
  const original = scope.retryCleanup;
  scope.retryCleanup = function (this: typeof scope) {
    entered();
    return held.promise.then(() => original.call(this));
  };
  const closingFirst = first.close();
  const closingSecond = second.close();
  try {
    await awaitAcknowledgement(started, closingFirst, "first file cleanup");
    await awaitAcknowledgement(
      closingSecond.then(() => undefined),
      closingFirst,
      "second file cleanup",
    );
  } finally {
    held.release();
    await Promise.allSettled([closingFirst, closingSecond]);
    scope.retryCleanup = original;
  }
});
