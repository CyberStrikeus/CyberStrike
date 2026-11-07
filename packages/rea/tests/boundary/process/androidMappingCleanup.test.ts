import { access, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { JadxSession } from "../../../src/android/JadxSession.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import {
  createJadxProtocolFixture,
  verifyJadxFixtureCleanup,
} from "../../fixtures/android/jadx.js";

/** Warm the real protocol fixture, then fail only the selected mapping owner. */
const mappingCloseFailure = async (cleanupFailure?: () => boolean) => {
  const fixture = await createJadxProtocolFixture("normal", cleanupFailure);
  const mapping = join(dirname(fixture.apk), "mapping.txt");
  await writeFile(mapping, "example.Original -> fixture.Target:\n");
  const target = await parseBinaryTarget(fixture.apk);
  if (!target.ok) throw target.error;
  const warm = await fixture.provider.execute(target.value, {
    operation: "inspect_android_package",
    input: { path: fixture.apk },
  });
  if (!warm.ok) throw warm.error;
  expect(fixture.launches).toHaveLength(1);
  const identity = await stat(mapping);
  const cause = new Error(
    "controlled selected mapping descriptor close failure",
  );
  const original = OwnedFileHandle.prototype.close;
  const attempts: OwnedFileHandle[] = [];
  let allowClose = false;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      if (this.handle.fd >= 0) {
        const observed = await this.handle.stat();
        if (observed.dev === identity.dev && observed.ino === identity.ino) {
          attempts.push(this);
          if (!allowClose) throw cause;
        }
      }
      await original.call(this);
    });
  return {
    ...fixture,
    target: target.value,
    mapping,
    attempts,
    close,
    allowClose: () => {
      allowClose = true;
    },
  };
};

it("retries a retained mapping descriptor before a request without mapping can reuse the warm engine", async () => {
  const fixture = await mappingCloseFailure();
  const { apk, provider, target, mapping, launches } = fixture;
  // Observe the actual session boundary without replacing its implementation.
  const execute = vi.spyOn(JadxSession.prototype, "execute");
  try {
    const first = await provider.execute(target, {
      operation: "inspect_android_class",
      input: { path: apk, class_name: "fixture.Target", mapping_path: mapping },
    });
    if (first.ok)
      throw new Error("Expected the mapping descriptor close failure");
    expect(first.error).toBeInstanceOf(ProviderAdapterError);
    expect(first.error.cleanupIncomplete).toBe(true);
    const owner = fixture.attempts[0];
    if (owner === undefined) throw new Error("Missing retained mapping owner");
    expect(owner.handle.fd).toBeGreaterThanOrEqual(0);
    const originalCause = first.error.cause;
    const attempts = fixture.attempts.length;
    const blocked = await provider.execute(target, {
      operation: "inspect_android_package",
      input: { path: apk },
    });
    if (blocked.ok) throw new Error("Pending mapping cleanup must block reuse");
    expect(blocked.error).toBeInstanceOf(ProviderAdapterError);
    expect(blocked.error).toMatchObject({
      providerId: "jadx",
      operation: "inspect_android_package",
      cleanupIncomplete: true,
    });
    expect(fixture.attempts.length).toBeGreaterThan(attempts);
    expect(fixture.attempts.every((attempt) => attempt === owner)).toBe(true);
    expect(owner.handle.fd).toBeGreaterThanOrEqual(0);
    expect(first.error.cleanupIncomplete).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(launches).toHaveLength(1);
    fixture.allowClose();
    const recovered = await provider.execute(target, {
      operation: "inspect_android_package",
      input: { path: apk },
    });
    if (!recovered.ok) throw recovered.error;
    expect(owner.handle.fd).toBe(-1);
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(first.error.cause).toBe(originalCause);
    expect(blocked.error.cleanupIncomplete).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(launches).toHaveLength(1);
  } finally {
    fixture.allowClose();
    try {
      await provider.close();
      await verifyJadxFixtureCleanup(launches);
    } finally {
      fixture.close.mockRestore();
      execute.mockRestore();
    }
  }
});

it.each([false, true])(
  "idle cleanup drains the mapping owner even when engine cleanup fails=%s",
  async (mixed) => {
    let engineCleanupFails = mixed;
    let engineCleanupAttempts = 0;
    let fixture: Awaited<ReturnType<typeof mappingCloseFailure>> | undefined;
    // Only control the provider's idle clock; restore real timers before polling
    // the actual subprocess, filesystem and retained cleanup lease completion.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fixture = await mappingCloseFailure(() => {
        engineCleanupAttempts++;
        return engineCleanupFails;
      });
      const { apk, provider, target, mapping, launches } = fixture;
      const failed = await provider.execute(target, {
        operation: "inspect_android_class",
        input: {
          path: apk,
          class_name: "fixture.Target",
          mapping_path: mapping,
        },
      });
      if (failed.ok) throw new Error("Expected retained mapping cleanup");
      expect(failed.error.cleanupIncomplete).toBe(true);
      const originalCause = failed.error.cause;
      const owner = fixture.attempts[0];
      if (owner === undefined)
        throw new Error("Missing retained mapping owner");
      expect(owner.handle.fd).toBeGreaterThanOrEqual(0);
      fixture.allowClose();
      vi.advanceTimersByTime(60_000);
      vi.useRealTimers();
      await expect
        .poll(
          () => ({
            fd: owner.handle.fd,
            cleanupIncomplete: failed.error.cleanupIncomplete,
          }),
          { timeout: 5_000 },
        )
        .toEqual({ fd: -1, cleanupIncomplete: false });
      expect(failed.error.cause).toBe(originalCause);
      expect(fixture.attempts.every((attempt) => attempt === owner)).toBe(true);
      expect(engineCleanupAttempts).toBeGreaterThan(0);
      expect(launches).toHaveLength(1);
      if (mixed) {
        const workspace = launches[0]?.cwd;
        if (workspace === undefined)
          throw new Error("Missing retained workspace");
        await expect(access(workspace)).resolves.toBeUndefined();
      } else {
        await verifyJadxFixtureCleanup(launches);
      }
    } finally {
      vi.useRealTimers();
      engineCleanupFails = false;
      if (fixture !== undefined) {
        fixture.allowClose();
        try {
          await fixture.provider.close();
          await verifyJadxFixtureCleanup(fixture.launches);
        } finally {
          fixture.close.mockRestore();
        }
      }
    }
  },
);
