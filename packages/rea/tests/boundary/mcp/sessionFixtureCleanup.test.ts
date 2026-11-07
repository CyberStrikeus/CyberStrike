import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, vi, type OnTestFinishedHandler } from "vitest";

import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { openArtifactTarget } from "../../support/mcp/artifactSession.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { openProductionTarget } from "../../support/mcp/productionSession.js";

mcpTest.for([
  { name: "production", open: openProductionTarget },
  { name: "artifact", open: openArtifactTarget },
])(
  "$name session fixture reports failed teardown and retries its exact descriptor owner",
  async ({ open }, { mcp, task }) => {
    const directory = await createTestTempDirectory(
      "rea-session-fixture-cleanup-",
    );
    // Descriptor ownership needs real target bytes, without selecting an
    // installed deep-analysis engine whose availability varies by host.
    const path = join(directory, "target.plist");
    await writeFile(path, '<?xml version="1.0"?><plist><dict/></plist>');
    const identity = await stat(path);
    let cleanup: OnTestFinishedHandler | undefined;
    let retained: OwnedFileHandle | undefined;
    let denied = true;
    let deniedAttempts = 0;
    let restoreClose = () => {};
    try {
      const client = await open(
        mcp,
        (handler) => {
          cleanup = handler;
        },
        path,
      );
      if (cleanup === undefined)
        throw new Error("Session fixture did not register teardown");
      const nativeClose = OwnedFileHandle.prototype.close;
      const closeFailure = new Error("controlled fixture target close denial");
      const close = vi
        .spyOn(OwnedFileHandle.prototype, "close")
        .mockImplementation(async function (this: OwnedFileHandle) {
          if (retained === undefined && this.handle.fd >= 0) {
            const observed = await this.handle.stat();
            if (observed.dev === identity.dev && observed.ino === identity.ino)
              retained = this;
          }
          if (this === retained && denied) {
            deniedAttempts += 1;
            throw closeFailure;
          }
          await nativeClose.call(this);
        });
      restoreClose = () => close.mockRestore();

      // A successful admission has already closed its read descriptor. Reopen
      // the same target to leave a real failed close owned by this session.
      const failedOpen = parseMcpToolError(
        await client.callTool({ name: "open_binary", arguments: { path } }),
      );
      expect(failedOpen.error).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          resources: [path],
          cleanup_reason: expect.stringContaining(closeFailure.message),
        },
      });
      if (retained === undefined)
        throw new Error(
          "Target close denial did not retain a descriptor owner",
        );
      const owner = retained;
      const descriptor = owner.handle.fd;
      expect(descriptor).toBeGreaterThanOrEqual(0);
      expect(await owner.handle.stat()).toMatchObject({
        dev: identity.dev,
        ino: identity.ino,
      });

      const beforeFirstCleanup = deniedAttempts;
      await expect(cleanup(task.context)).rejects.toBeInstanceOf(AnalysisError);
      expect(deniedAttempts).toBeGreaterThan(beforeFirstCleanup);
      expect(retained).toBe(owner);
      expect(owner.handle.fd).toBe(descriptor);

      const beforeRetry = deniedAttempts;
      await expect(cleanup(task.context)).rejects.toMatchObject({
        cleanupIncomplete: true,
        cleanupResources: [path],
        diagnostics: { reason: expect.stringContaining(closeFailure.message) },
      });
      expect(deniedAttempts).toBeGreaterThan(beforeRetry);
      expect(retained).toBe(owner);
      expect(owner.handle.fd).toBe(descriptor);

      denied = false;
      restoreClose();
      await cleanup(task.context);
      expect(owner.handle.fd).toBe(-1);
      await expect(owner.handle.stat()).rejects.toMatchObject({
        code: "EBADF",
      });
    } finally {
      denied = false;
      restoreClose();
      await closeVerifierResources([
        async () => {
          await cleanup?.(task.context);
        },
        () => mcp.close(),
      ]);
    }
  },
);
