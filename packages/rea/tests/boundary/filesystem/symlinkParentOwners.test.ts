import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import { absoluteCallerPath } from "../../../src/filesystem/callerPath.js";
import { FirmwareFileAccess } from "../../../src/firmware/FirmwareFiles.js";
import { associateWasmGlue } from "../../../src/wasm/WasmGlueAdapter.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// POSIX follows `link` before `..`, so `link/../x` names target/x, not ./x.
const layout = async (prefix: string) => {
  const root = await realpath(await createTestTempDirectory(prefix));
  await mkdir(join(root, "target/child"), { recursive: true });
  await symlink("target/child", join(root, "link"));
  return root;
};

describe.skipIf(process.platform === "win32")(
  "file owners preserve POSIX path traversal",
  () => {
    it("snapshots the firmware image the filesystem selects", async () => {
      const root = await layout("rea-symlink-parent-firmware-");
      const selected = Buffer.from("selected firmware");
      await writeFile(join(root, "target/image.bin"), selected);
      await writeFile(join(root, "image.bin"), "sibling firmware");
      const work = await createTestTempDirectory("rea-firmware-snapshot-");
      // Concatenate: path.join would collapse `link/..` itself.
      const path = `${root}/link/../image.bin`;
      const snapshot = await new FirmwareFileAccess().snapshot(
        { operation: "inspect_firmware_regions", input: { path } },
        work,
        new AbortController().signal,
      );
      expect(snapshot.subject).toMatchObject({
        path,
        sha256: createHash("sha256").update(selected).digest("hex"),
      });
    });

    it("rejects a trailing separator after a regular file", async () => {
      const root = await layout("rea-trailing-separator-");
      // A real executable, so only the trailing separator can reject it.
      await copyFile(process.execPath, join(root, "sample"));
      expect((await parseBinaryTarget(`${root}/sample`)).ok).toBe(true);
      for (const path of [`${root}/sample/`, `${root}/sample/.`]) {
        const target = await parseBinaryTarget(path);
        expect(target.ok, path).toBe(false);
      }
    });

    it("matches WASM glue to a module selected through link/..", () => {
      const root = "/app";
      const selected = absoluteCallerPath("link/../module.wasm", {
        cwd: root,
      });
      expect(
        associateWasmGlue(
          'fetch("./module.wasm");',
          absoluteCallerPath("link/../glue.js", { cwd: root }),
          [selected, "/app/module.wasm"],
        ).references,
      ).toMatchObject([
        { association: "local-path-candidate", candidate_paths: [selected] },
      ]);
    });

    it("creates the output directory the filesystem selects", async () => {
      const root = await layout("rea-symlink-parent-output-");
      const tree = await SafeOutputTree.create(`${root}/link/../out`);
      try {
        expect(tree.outputRoot).toBe(join(root, "target/out"));
        expect((await stat(join(root, "target/out"))).isDirectory()).toBe(true);
        await expect(stat(join(root, "out"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await tree.rollback();
      }
    });

    it.each(["file/out", "file/../out"])(
      "refuses an output parent traversing a regular file: %s",
      async (relative) => {
        const root = await layout("rea-nondirectory-parent-output-");
        await writeFile(join(root, "file"), "original");
        // Darwin realpath can collapse file/.. even though stat rejects it.
        const output = `${root}/${relative}`;
        for (const admit of [
          () => SafeOutputTree.checkDestination(output),
          () => SafeOutputTree.create(output),
        ]) {
          await expect(admit()).rejects.toMatchObject({
            name: "SafeOutputTreeDestinationRefusal",
            reason: "path",
          });
          await expect(stat(join(root, "out"))).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      },
    );
  },
);
