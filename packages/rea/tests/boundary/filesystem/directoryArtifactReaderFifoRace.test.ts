import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const run = promisify(execFile);

it.skipIf(process.platform === "win32")(
  "rejects a FIFO replacement without blocking the owner process",
  async () => {
    const root = await createTestTempDirectory("rea-directory-fifo-");
    await writeFile(join(root, "module.js"), "export {}\n");
    const probe = fileURLToPath(
      new URL("../../fixtures/directoryReaderFifoProbe.mjs", import.meta.url),
    );
    const readerModule = fileURLToPath(
      new URL(
        "../../../dist/artifacts/DirectoryArtifactReader.js",
        import.meta.url,
      ),
    );
    const launch = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [probe, readerModule, root],
      runId: `rea-fifo-probe-${randomUUID()}`,
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
      expect(supervisor.snapshot().stdout.text.trim()).toBe("integrity");
    } finally {
      const stopped = await supervisor.stop({
        terminationGraceMs: 100,
        killGraceMs: 500,
      });
      expect(stopped.status).not.toBe("incomplete");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "skips unsupported FIFO entries and continues through the directory",
  async () => {
    const root = await createTestTempDirectory("rea-directory-entry-fifo-");
    await writeFile(join(root, "module.js"), "export {}\n");
    await run("mkfifo", [join(root, "unsupported.fifo")]);
    const probe = fileURLToPath(
      new URL(
        "../../fixtures/directoryReaderUnsupportedEntryProbe.mjs",
        import.meta.url,
      ),
    );
    const readerModule = fileURLToPath(
      new URL(
        "../../../dist/artifacts/DirectoryArtifactReader.js",
        import.meta.url,
      ),
    );
    const launch = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [probe, readerModule, root],
      runId: `rea-directory-entry-fifo-${randomUUID()}`,
      cwd: tmpdir(),
      hostEnvironment: process.env,
    });
    const supervisor = new ProviderProcessSupervisor({
      ...launch,
      ownsProcessLifetime: true,
    });

    try {
      expect(await supervisor.waitForOutputClose(2_000)).toBe(true);
      expect(supervisor.snapshot().stdout.text.trim()).toBe('["module.js"]');
    } finally {
      const stopped = await supervisor.stop({
        terminationGraceMs: 100,
        killGraceMs: 500,
      });
      expect(stopped.status).not.toBe("incomplete");
    }
  },
);
