import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { OwnedStagedOutput } from "../../filesystem/OwnedStagedOutput.js";
import { ExportResources } from "./exportResources.js";

it.each([false, true])(
  "retains publication outcome and staging cleanup authority (conflict: %s)",
  async (conflict) => {
    const root = await createTestTempDirectory("rea-export-resources-");
    const destination = join(root, "published");
    if (conflict) await writeFile(destination, "existing");
    const lease = { release: vi.fn(async () => undefined) };
    const resources = new ExportResources(
      root,
      await lstat(root, { bigint: true }),
      lease,
      undefined,
    );
    const cleanupFailure = new Error("staging removal denied");
    const close = vi.spyOn(OwnedStagedOutput.prototype, "close");
    close.mockRejectedValueOnce(cleanupFailure);
    try {
      const cause: unknown = await resources
        .publish("new", destination, "link")
        .catch((failure: unknown) => failure);
      expect(cause).toBeInstanceOf(ArtifactReaderFailure);
      const failure = cause as ArtifactReaderFailure;
      expect(failure.cleanup?.reason).toContain("staging removal denied");
      expect(failure.cleanupLeases).toHaveLength(1);
      if (conflict) {
        expect(failure.message).toContain("EEXIST");
        expect(failure.cause).toBeInstanceOf(ArtifactReaderFailure);
      } else expect(failure.message).toBe("staging removal denied");
      expect(await readFile(destination, "utf8")).toBe(
        conflict ? "existing" : "new",
      );
      expect(
        (await readdir(root)).some((name) =>
          name.startsWith(".decompile-stage-"),
        ),
      ).toBe(true);
      expect(lease.release).not.toHaveBeenCalled();
      await expect(resources.close()).resolves.toEqual({
        ok: true,
        value: undefined,
      });
      expect(await readdir(root)).toEqual(["published"]);
      expect(failure.cleanupLeases?.[0]?.released).toBe(true);
      expect(lease.release).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
      await resources.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
