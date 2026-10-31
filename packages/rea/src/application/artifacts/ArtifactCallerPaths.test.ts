import {
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { withArtifactResourceScope } from "../../../tests/fixtures/artifactInventory.js";
import { extractArtifact } from "../../artifacts/extraction/ArtifactExtraction.js";
import { createArtifactExtractionDestination } from "./ArtifactExtractionDestination.js";

it.skipIf(process.platform === "win32")(
  "allocates extraction in the physical TMPDIR parent selected through a symlink and ..",
  async () => {
    const root = await createTestTempDirectory("rea-extraction-parent-");
    const selected = join(root, "physical");
    await mkdir(join(selected, "child"), { recursive: true });
    await mkdir(join(root, "lexical"));
    await symlink(join(selected, "child"), join(root, "lexical", "alias"));
    vi.stubEnv("TMPDIR", `${root}/lexical/alias/..`);
    try {
      const destination = createArtifactExtractionDestination();
      expect(await realpath(dirname(destination))).toBe(
        await realpath(selected),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it("refuses directory extraction output inside the source before copying and keeps outside extraction exact", async () => {
  const root = await createTestTempDirectory("rea-extraction-overlap-");
  const source = join(root, "source");
  await mkdir(join(source, "nested"), { recursive: true });
  await writeFile(join(source, "nested", "payload.txt"), "original bytes");
  const input = {
    inputPath: source,
    inputFormat: "mach-o" as const,
    environment: {},
    integrityPolicy: "fail" as const,
  };
  await withArtifactResourceScope(async (resourceScope) => {
    await expect(
      extractArtifact({
        ...input,
        resourceScope,
        outputRoot: join(source, "nested", "output"),
      }),
    ).rejects.toMatchObject({
      name: "SafeOutputTreeDestinationRefusal",
      reason: "path",
      message: expect.stringContaining("outside the source"),
    });
    expect(await readdir(join(source, "nested"))).toEqual(["payload.txt"]);
    const result = await extractArtifact({
      ...input,
      resourceScope,
      outputRoot: join(root, "outside"),
    });
    expect(result.artifacts.map(({ relative_path }) => relative_path)).toEqual([
      "nested/payload.txt",
    ]);
    expect(
      await readFile(join(result.output_root, "nested", "payload.txt"), "utf8"),
    ).toBe("original bytes");
    expect(await readFile(join(source, "nested", "payload.txt"), "utf8")).toBe(
      "original bytes",
    );
  });
});

it.skipIf(process.platform === "win32")(
  "inventories and extracts literal letter-colon POSIX names",
  async () => {
    const root = await createTestTempDirectory("rea-extraction-colon-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "a:b"), "literal colon bytes");
    await withArtifactResourceScope(async (resourceScope) => {
      const result = await extractArtifact({
        inputPath: source,
        inputFormat: "mach-o",
        outputRoot: join(root, "output"),
        environment: {},
        integrityPolicy: "fail",
        resourceScope,
      });
      expect(
        result.artifacts.map(({ relative_path }) => relative_path),
      ).toEqual(["a:b"]);
      expect(await readFile(join(result.output_root, "a:b"), "utf8")).toBe(
        "literal colon bytes",
      );
    });
  },
);
