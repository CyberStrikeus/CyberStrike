import { mkdir, rm, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";

import { ApktoolCommandCleanup } from "../../../src/apktool/ApktoolCommandCleanup.js";
import { inspectApktoolClient } from "../../../src/apktool/ApktoolConfiguration.js";
import { createApktoolProcessFixture } from "../../fixtures/apktoolProcessTree.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { observePosixProcess } from "../../support/process/observePosixProcess.js";

it
  .skipIf(process.platform === "win32")
  .each(["malformed", "unreadable"] as const)(
  "retains fixture cleanup ownership when its published marker becomes %s",
  async (failure) => {
    const root = await createTestTempDirectory("rea-apktool-marker-failure-");
    const fixture = await createApktoolProcessFixture(root, "probe");
    await expect(fixture.readMarker()).resolves.toBeUndefined();
    const commands = new ApktoolCommandCleanup();
    const controller = new AbortController();
    const probe = inspectApktoolClient(
      { command: fixture.command, commandSource: "environment" },
      commands,
      { signal: controller.signal, environment: process.env },
    ).catch((cause: unknown) => cause);
    try {
      await expect
        .poll(async () => (await fixture.readMarker())?.ready, {
          timeout: 10_000,
          interval: 25,
        })
        .toBe(true);
      const marker = await fixture.readMarker();
      if (marker === undefined) throw new Error("Fixture marker disappeared");
      const pids = [marker.rootPid, marker.childPid];
      expect(await Promise.all(pids.map(observePosixProcess))).toEqual([
        expect.objectContaining({ kind: "running" }),
        expect.objectContaining({ kind: "running" }),
      ]);
      if (failure === "malformed") {
        await writeFile(fixture.markerPath, "not-json");
      } else {
        await rm(fixture.markerPath);
        await mkdir(fixture.markerPath);
      }
      await expect(fixture.readMarker()).rejects.toThrow();
      // No cancellation has run: fallback teardown must use the last valid
      // token owner even when the current marker cannot be read or parsed.
      await expect(fixture.cleanup()).rejects.toThrow();
      await expect
        .poll(
          async () =>
            (await Promise.all(pids.map(observePosixProcess))).every(
              ({ kind }) => kind !== "running",
            ),
          { timeout: 5_000, interval: 25 },
        )
        .toBe(true);
    } finally {
      controller.abort();
      await fixture.cleanup([probe, commands.close()]);
    }
  },
  30_000,
);
