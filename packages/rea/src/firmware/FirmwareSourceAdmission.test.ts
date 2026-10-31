import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { firmwareRequestSchema } from "../domain/firmware/firmwareAnalysis.js";
import { FirmwareFileAccess } from "./FirmwareFiles.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const workspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-firmware-source-"));
  roots.push(root);
  const staging = join(root, "stage");
  await mkdir(staging);
  return { root, staging };
};

it("honors cancellation before source admission without creating a snapshot", async () => {
  const { root, staging } = await workspace();
  const path = join(root, "firmware");
  await writeFile(path, "firmware");
  const request = firmwareRequestSchema.parse({
    operation: "inspect_firmware_regions",
    input: { path },
  });
  const cancellation = new AbortController();
  cancellation.abort(new Error("cancel source admission"));
  const files = new FirmwareFileAccess();
  try {
    await expect(
      files.snapshot(request, staging, cancellation.signal),
    ).rejects.toMatchObject({ reason: "cancelled" });
    await expect(readFile(join(staging, "firmware.bin"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  } finally {
    await files.close();
  }
});

it.skipIf(process.platform === "win32")(
  "rejects file/.. traversal before creating a firmware snapshot",
  async () => {
    const { root, staging } = await workspace();
    await writeFile(join(root, "blocker"), "regular file");
    await writeFile(join(root, "firmware"), "decoy firmware");
    const path = `${root}/blocker/../firmware`;
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOTDIR" });
    const request = firmwareRequestSchema.parse({
      operation: "inspect_firmware_regions",
      input: { path },
    });
    const files = new FirmwareFileAccess();
    try {
      await expect(
        files.snapshot(request, staging, new AbortController().signal),
      ).rejects.toMatchObject({ _tag: "AnalysisInputError" });
      await expect(
        readFile(join(staging, "firmware.bin")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await files.close();
    }
  },
);

// POSIX parent traversal and symlink creation require host filesystem support;
// Windows does not guarantee either traversal semantics or symlink privileges.
it.skipIf(process.platform === "win32").each(["parent", "final"] as const)(
  "snapshots the filesystem-selected %s symlink target and preserves its selected path",
  async (kind) => {
    const { root, staging } = await workspace();
    await mkdir(join(root, "physical", "child"), { recursive: true });
    const bytes = Buffer.from("selected firmware bytes");
    await writeFile(join(root, "physical", "firmware"), bytes);
    await writeFile(join(root, "firmware"), "lexical decoy");
    await symlink(join(root, "physical", "child"), join(root, "link"), "dir");
    await symlink(
      join(root, "physical", "firmware"),
      join(root, "alias"),
      "file",
    );
    const path =
      kind === "parent" ? `${root}/link/../firmware` : join(root, "alias");
    const request = firmwareRequestSchema.parse({
      operation: "inspect_firmware_regions",
      input: { path },
    });
    const files = new FirmwareFileAccess();
    try {
      const snapshot = await files.snapshot(
        request,
        staging,
        new AbortController().signal,
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(snapshot.subject).toEqual({ path, sha256, format: "file" });
      expect(snapshot.selection).toEqual({
        offset: 0,
        length: bytes.length,
        sha256,
      });
      expect((await readFile(snapshot.inputPath)).equals(bytes)).toBe(true);
    } finally {
      await files.close();
    }
  },
);
