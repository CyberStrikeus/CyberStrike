import { expect, it, vi } from "vitest";

import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { RegularFileCleanupFailure } from "../../../src/filesystem/OwnedRegularFile.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import {
  createJadxProtocolFixture,
  verifyJadxFixtureCleanup,
} from "../../fixtures/android/jadx.js";

it("resolves descriptor uncertainty after an immediate owned hash close retry", async () => {
  const { apk, provider, launches } = await createJadxProtocolFixture();
  // Resolve admission before injecting the provider-owned hash close failure.
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  const cause = new Error("controlled hash close failure");
  const original = OwnedFileHandle.prototype.close;
  const owners: OwnedFileHandle[] = [];
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      owners.push(this);
      if (owners.length === 1) throw cause;
      await original.call(this);
    });
  try {
    const result = await provider.execute(target.value, {
      operation: "inspect_android_package",
      input: { path: apk },
    });
    if (result.ok) throw new Error("Expected the original close failure");
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    const primary = (result.error.cause as AggregateError).errors[0];
    expect(primary).toBeInstanceOf(AnalysisError);
    expect(primary.cause).toBeInstanceOf(RegularFileCleanupFailure);
    expect(primary.cause.cleanupCause).toBe(cause);
    expect(primary.cause.outcome.kind).toBe("completed");
    expect(owners).toHaveLength(2);
    expect(owners[0]).toBe(owners[1]);
    expect(owners[0]?.handle.fd).toBe(-1);
    expect(launches).toHaveLength(0);
  } finally {
    close.mockRestore();
    await provider.close();
    await verifyJadxFixtureCleanup(launches);
  }
});

it("keeps hash cleanup live until the exact retained descriptor closes", async () => {
  const { apk, provider, launches } = await createJadxProtocolFixture();
  // Resolve admission before injecting the provider-owned hash close failure.
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  const cause = new Error("controlled persistent hash close failure");
  const original = OwnedFileHandle.prototype.close;
  const owners: OwnedFileHandle[] = [];
  let allowClose = false;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      owners.push(this);
      if (!allowClose) throw cause;
      await original.call(this);
    });
  try {
    const result = await provider.execute(target.value, {
      operation: "inspect_android_package",
      input: { path: apk },
    });
    if (result.ok) throw new Error("Expected retained descriptor cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    const retirement = (result.error.cause as AggregateError).errors;
    const primary = retirement[0];
    if (!(primary instanceof AnalysisError))
      throw new Error("Missing original typed hash failure");
    const originalCause = primary.cause;
    expect(primary.cleanupIncomplete).toBe(true);
    expect(owners).toHaveLength(2);
    expect(owners[0]).toBe(owners[1]);
    expect(owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);
    allowClose = true;
    await provider.close();
    expect(primary.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(primary.cause).toBe(originalCause);
    expect(owners[0]?.handle.fd).toBe(-1);
    expect(launches).toHaveLength(0);
  } finally {
    allowClose = true;
    await provider.close();
    close.mockRestore();
    await verifyJadxFixtureCleanup(launches);
  }
});
