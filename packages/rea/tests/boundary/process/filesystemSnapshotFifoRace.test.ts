import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "does not block when an observed regular file is replaced by a FIFO",
  async () => {
    const directory = await createTestTempDirectory("rea-snapshot-fifo-");
    const probe = fileURLToPath(
      new URL(
        "../../fixtures/filesystemSnapshotFifoProbe.mjs",
        import.meta.url,
      ),
    );
    const snapshotModule = fileURLToPath(
      new URL(
        "../../../dist/process/capture/FilesystemSnapshot.js",
        import.meta.url,
      ),
    );
    const launch = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [probe, snapshotModule, directory],
      runId: `rea-snapshot-fifo-${randomUUID()}`,
      cwd: tmpdir(),
      hostEnvironment: process.env,
    });
    const supervisor = new ProviderProcessSupervisor({
      ...launch,
      ownsProcessLifetime: true,
    });

    try {
      const closed = await supervisor.waitForOutputClose(2_000);
      expect(closed).toBe(true);
      expect(supervisor.snapshot().stdout.text.trim()).toBe("rejected");
    } finally {
      const stopped = await supervisor.stop({
        terminationGraceMs: 100,
        killGraceMs: 500,
      });
      expect(stopped.status).not.toBe("incomplete");
    }
  },
);
