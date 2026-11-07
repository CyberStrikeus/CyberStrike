import { afterEach, expect, it } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import {
  closeCliJavaScriptResources,
  runCliJavaScriptApplicationAnalysis,
} from "../../../src/cli/javascriptApplicationAnalysis.js";

const originalClose = ArtifactResourceScope.prototype.close;

afterEach(async () => {
  ArtifactResourceScope.prototype.close = originalClose;
  await closeCliJavaScriptResources();
});

/** Create the process-owned scope without starting a worker. */
const openCliScope = (): Promise<unknown> =>
  runCliJavaScriptApplicationAnalysis({}, {});

it("retries JavaScript worker shutdown when the first close fails", async () => {
  let calls = 0;
  ArtifactResourceScope.prototype.close = function (
    this: ArtifactResourceScope,
  ) {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error("worker still owned"));
    return originalClose.call(this);
  };

  await openCliScope();
  await expect(closeCliJavaScriptResources()).rejects.toThrow(
    "worker still owned",
  );
  expect(calls).toBe(1);
  await closeCliJavaScriptResources();
  expect(calls).toBe(2);
  await closeCliJavaScriptResources();
  expect(calls).toBe(2);
});

it("shares one in-flight JavaScript worker shutdown between callers", async () => {
  let calls = 0;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  ArtifactResourceScope.prototype.close = function (
    this: ArtifactResourceScope,
  ) {
    calls += 1;
    return gate.then(() => originalClose.call(this));
  };

  try {
    await openCliScope();
    const first = closeCliJavaScriptResources();
    const second = closeCliJavaScriptResources();
    expect(second).toBe(first);
    expect(calls).toBe(1);
    release();
    await first;
    expect(calls).toBe(1);
  } finally {
    release();
  }
});
