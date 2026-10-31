import { lstat, open } from "node:fs/promises";

import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import type { VerifierCommands } from "./verifier-command-owner.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

export type VerifierFileSnapshotEntry =
  | {
      readonly path: string;
      readonly exists: true;
      readonly content: Buffer;
    }
  | {
      readonly path: string;
      readonly exists: false;
      readonly content: null;
    };

/** Capture source values while the command owner retains every in-flight file. */
export async function captureVerifierFileSnapshot(
  commands: Pick<VerifierCommands, "adopt">,
  paths: readonly string[],
): Promise<readonly VerifierFileSnapshotEntry[]> {
  const resources = new ArtifactResourceScope();
  commands.adopt(resources, "verifier file snapshots");
  return withVerifierCleanup(
    () =>
      Promise.all(
        paths.map((path) =>
          resources.run(async (): Promise<VerifierFileSnapshotEntry> => {
            try {
              await lstat(path);
            } catch (cause: unknown) {
              if (
                cause instanceof Error &&
                "code" in cause &&
                cause.code === "ENOENT"
              )
                return { path, exists: false, content: null };
              throw cause;
            }
            const handle = await open(path, "r");
            const owner = new OwnedFileHandle(handle);
            resources.retain({
              kind: "file-handle",
              resource: path,
              handle: owner,
            });
            return {
              path,
              exists: true,
              content: await handle.readFile(),
            };
          }),
        ),
      ),
    [() => resources.close()],
  );
}

/** Compare the same selected paths against their completed baseline facts. */
export async function assertVerifierFilesUnchanged(
  commands: Pick<VerifierCommands, "adopt">,
  snapshot: readonly VerifierFileSnapshotEntry[],
  label: string,
): Promise<void> {
  const current = await captureVerifierFileSnapshot(
    commands,
    snapshot.map(({ path }) => path),
  );
  for (const [index, entry] of snapshot.entries()) {
    const observed = current[index]!;
    if (
      entry.exists
        ? !observed.exists || !entry.content.equals(observed.content)
        : observed.exists
    )
      throw new Error(`${label} changed ${entry.path}`);
  }
}
