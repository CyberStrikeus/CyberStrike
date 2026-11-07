import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { prepareHopperExecutableImage } from "./HopperImageCopy.js";

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

it("whole executable copying rejects pre-copy replacement and retains captured bytes after source replacement", async () => {
  const root = await createTestTempDirectory("rea-hopper-executable-");
  const source = join(root, "input.exe");
  const destination = join(root, "private-image");
  const selected = Buffer.from("MZ selected executable bytes");
  const replacement = Buffer.from("MZ replacement executable bytes");
  const resources = new ArtifactResourceScope();
  try {
    await writeFile(source, replacement);
    const changed = await resources.run(() =>
      prepareHopperExecutableImage(source, digest(selected), destination, {
        resourceScope: resources,
      }),
    );
    expect(changed).toMatchObject({
      ok: false,
      error: { userMessage: expect.stringContaining("changed before launch") },
    });
    // A failed copy remains in the owned session directory; use a new destination.
    const capturedPath = join(root, "captured-image");
    await writeFile(source, selected);
    const captured = await resources.run(() =>
      prepareHopperExecutableImage(source, digest(selected), capturedPath, {
        resourceScope: resources,
      }),
    );
    expect(captured).toEqual({ ok: true, value: capturedPath });
    await writeFile(source, replacement);
    expect(Buffer.compare(await readFile(capturedPath), selected)).toBe(0);
    expect(Buffer.compare(await readFile(source), replacement)).toBe(0);
  } finally {
    await resources.close();
  }
});
