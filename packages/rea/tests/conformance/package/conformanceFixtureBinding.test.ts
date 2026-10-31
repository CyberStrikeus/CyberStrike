import { createHash } from "node:crypto";
import { realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  bindConformanceFixtureArtifact,
  resolveConformanceFixturePath,
} from "../../../scripts/lib/conformance-fixtures.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("binds canonical manifest-relative artifacts without changing declared names", async () => {
  const root = await createTestTempDirectory("rea-conformance-binding-");
  const name = "caller α source artifact";
  const bytes = Buffer.from("inert fixture content");
  await writeFile(join(root, name), bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = await realpath(join(root, name));
  const declaration = {
    name: "fixture",
    artifact: name,
    artifactSha256: sha256,
  };
  expect(await bindConformanceFixtureArtifact(path, declaration)).toEqual({
    path,
    sha256,
  });
  expect(declaration.artifact).toBe(name);
  expect(await resolveConformanceFixturePath(root, name)).toBe(path);
  await expect(
    bindConformanceFixtureArtifact(path, {
      ...declaration,
      artifactSha256: "0".repeat(64),
    }),
  ).rejects.toThrow("digest did not match");
});

it.each([
  null,
  { name: "fixture", artifact: "artifact", artifactSha256: null },
  { name: "fixture", artifact: "artifact", artifactSha256: "A".repeat(64) },
])(
  "rejects malformed artifact declarations before reading files: %j",
  async (declaration) => {
    const root = await createTestTempDirectory("rea-conformance-declaration-");
    await expect(
      bindConformanceFixtureArtifact(join(root, "artifact"), declaration),
    ).rejects.toThrow("Invalid conformance artifact declaration");
  },
);

it("rejects paths outside the canonical manifest root", async () => {
  const root = await createTestTempDirectory("rea-conformance-root-");
  const outside = await createTestTempDirectory("rea-conformance-outside-");
  const path = join(outside, "artifact");
  await writeFile(path, "outside");
  await expect(resolveConformanceFixturePath(root, path)).rejects.toThrow(
    "escapes its root",
  );
  await expect(resolveConformanceFixturePath(root, null)).rejects.toThrow(
    "manifest path is invalid",
  );
});

it.skipIf(process.platform === "win32")(
  "rejects artifact symlinks escaping their manifest root",
  async () => {
    const root = await createTestTempDirectory("rea-conformance-symlink-");
    const outside = await createTestTempDirectory(
      "rea-conformance-symlink-outside-",
    );
    const bytes = Buffer.from("outside");
    await writeFile(join(outside, "artifact"), bytes);
    await symlink(join(outside, "artifact"), join(root, "artifact"));
    await expect(
      resolveConformanceFixturePath(root, "artifact"),
    ).rejects.toThrow("escapes its root");
  },
);
