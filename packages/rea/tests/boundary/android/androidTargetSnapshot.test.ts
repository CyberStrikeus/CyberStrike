import { stat, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { snapshotAndroidTarget } from "../../../src/android/AndroidTargetSnapshot.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "cancels an in-flight APK snapshot and removes its partial output",
  async () => {
    const root = await createTestTempDirectory("rea-android-snapshot-cancel-");
    const source = join(root, "large.apk");
    const snapshot = join(root, "target.apk");
    await writeFile(source, "");
    // A sparse extent keeps fixture setup cheap while ensuring the copy cannot
    // finish before the test observes its first output bytes and aborts it.
    await truncate(source, 64 * 1024 * 1024 * 1024);

    const controller = new AbortController();
    const pending = snapshotAndroidTarget(
      source,
      "0".repeat(64),
      root,
      "inspect_android_package",
      controller.signal,
    );
    try {
      await expect
        .poll(
          () =>
            stat(snapshot).then(
              ({ size }) => size > 0,
              () => false,
            ),
          { timeout: 10_000, interval: 10 },
        )
        .toBe(true);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await expect(stat(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      controller.abort();
      await pending.catch(() => undefined);
    }
  },
);
