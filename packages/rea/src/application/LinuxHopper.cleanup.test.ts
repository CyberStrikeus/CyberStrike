import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import {
  inspectLinuxHopperLauncher,
  systemLinuxHopperInstallHost,
} from "./LinuxHopper.js";
import {
  LinuxHopperPublisher,
  retryLinuxHopperPublisherCleanup,
} from "./LinuxHopperPublisher.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import * as nativeCommands from "../process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

for (const boundary of ["inspection", "installation-host"] as const)
  it(`retries every retained publisher after the ${boundary} publisher close fails`, async () => {
    const directory = await createTestTempDirectory(
      "rea-publisher-mixed-cleanup-",
    );
    const earlierPath = join(directory, "earlier");
    const currentPath = join(directory, "current");
    await writeFile(earlierPath, "inert earlier fixture");
    await writeFile(currentPath, "inert current fixture");
    const earlier = new LinuxHopperPublisher({}, async () => undefined);
    const host = systemLinuxHopperInstallHost({}, async () => undefined);
    const command = vi
      .spyOn(nativeCommands, "execFileOutput")
      .mockResolvedValue({
        stdout: "libc.so.6 => /lib/libc.so.6",
        stderr: "",
        stdoutBytes: 30,
        stderrBytes: 0,
      });
    const originalClose = OwnedFileHandle.prototype.close;
    const attempts = new Map<OwnedFileHandle, number>();
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        const count = (attempts.get(this) ?? 0) + 1;
        attempts.set(this, count);
        const isEarlier = this === attempts.keys().next().value;
        if (count <= (isEarlier ? 3 : 4))
          throw new Error("Fixture descriptor close remains unavailable");
        return originalClose.call(this);
      });
    try {
      await expect(earlier.hashLauncher(earlierPath)).rejects.toMatchObject({
        reason: "cleanup_failed",
      });
      const earlierOwner = [...attempts.keys()][0]!;
      expect(attempts.get(earlierOwner)).toBe(3);
      if (boundary === "inspection") {
        const result = await inspectLinuxHopperLauncher(currentPath, {});
        // Preserve the original inspection failure even after physical release.
        expect(result).toMatchObject({
          ok: false,
          error: { reason: "cleanup_failed" },
        });
      } else {
        expect(await host.launcherStatus(currentPath, "0".repeat(64))).toBe(
          "cleanup_failed",
        );
        await host.close?.();
      }
      expect(attempts.size).toBe(2);
      expect([...attempts.values()]).toEqual([4, 5]);
      expect(
        [...attempts.keys()].every((owner) => owner.handle.fd === -1),
      ).toBe(true);
    } finally {
      close.mockRestore();
      command.mockRestore();
      await earlier.close();
      await host.close?.();
      await retryLinuxHopperPublisherCleanup();
    }
  });
