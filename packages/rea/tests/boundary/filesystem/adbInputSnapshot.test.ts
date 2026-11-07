import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import {
  openRegularFile,
  RegularFileAdmissionFailure,
} from "../../../src/filesystem/RegularFile.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import {
  AdbInputSnapshotFailure,
  snapshotAdbInput,
} from "../../../src/adb/AdbInputSnapshot.js";

it("retains and retries a source handle that fails close during admission", async () => {
  const parent = await mkdtemp(join(tmpdir(), "rea-adb-snapshot-test-"));
  const root = await PrivateRuntimeRoot.create({ parent });
  const resources = new ArtifactResourceScope();
  const sourcePath = join(parent, "selected.apk");
  await writeFile(sourcePath, "selected bytes");
  let closeAttempts = 0;
  try {
    await expect(
      snapshotAdbInput(
        sourcePath,
        root,
        resources,
        "install_adb_package",
        undefined,
        {
          openSource: async (path, options) => {
            const { handle } = await openRegularFile(path, options);
            const close = handle.close.bind(handle);
            const owner = new OwnedFileHandle(handle);
            handle.close = async () => {
              closeAttempts += 1;
              if (closeAttempts === 1)
                throw new Error("controlled close failure");
              await close();
            };
            throw new RegularFileAdmissionFailure(
              path,
              new Error("controlled admission failure"),
              new Error("first close was not confirmed"),
              owner,
            );
          },
        },
      ),
    ).rejects.toMatchObject<Partial<AdbInputSnapshotFailure>>({
      primaryCause: expect.objectContaining({
        message: "controlled admission failure",
      }),
      cleanupResources: [expect.stringContaining("source handle")],
    });

    expect(resources.hasPending).toBe(true);
    expect(closeAttempts).toBe(1);
    await resources.retryCleanup();
    expect(resources.hasPending).toBe(false);
    expect(closeAttempts).toBe(2);
  } finally {
    await resources.close();
    await root.close();
    await rm(parent, { recursive: true, force: true });
  }
});
