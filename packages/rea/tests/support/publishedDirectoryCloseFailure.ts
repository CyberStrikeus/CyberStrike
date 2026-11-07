import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { vi } from "vitest";

import { SafeOutputTree } from "../../src/artifacts/SafeOutputTree.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";

/** Fail closing the parent directory after publication until retry is allowed. */
export const injectPublishedDirectoryCloseFailure = async (
  output: string,
  persistent = false,
) => {
  const parent = await stat(dirname(output));
  const owners: OwnedFileHandle[] = [];
  let committing = false;
  let injected = false;
  let denied = true;
  const originalClose = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      if (committing && this.handle.fd >= 0) {
        const identity = await this.handle.stat();
        if (identity.dev === parent.dev && identity.ino === parent.ino) {
          owners.push(this);
          if (owners.length === 1) {
            const handle = this.handle;
            const closeHandle = handle.close.bind(handle);
            handle.close = async () => {
              if (denied) {
                injected = true;
                if (!persistent) denied = false;
                throw new Error("injected published directory close failure");
              }
              handle.close = closeHandle;
              await closeHandle();
            };
          }
        }
      }
      await originalClose.call(this);
    });
  const originalCommit = SafeOutputTree.prototype.commit;
  const commit = vi
    .spyOn(SafeOutputTree.prototype, "commit")
    .mockImplementation(function (this: SafeOutputTree, signal) {
      committing = true;
      return originalCommit.call(this, signal);
    });
  return {
    owners,
    wasInjected: () => injected,
    allowCleanup: () => {
      denied = false;
    },
    restore: () => {
      commit.mockRestore();
      close.mockRestore();
    },
  };
};
