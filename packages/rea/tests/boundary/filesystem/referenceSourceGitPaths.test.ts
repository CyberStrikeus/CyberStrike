import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { locateReferenceSourceGitDirectory } from "../../../src/application/ReferenceSourceGitDirectory.js";
import { readReferenceSourceVcs } from "../../../src/application/ReferenceSourceVcsAdapter.js";
import { withArtifactResourceScope } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it.skipIf(process.platform === "win32").each(["gitdir", "commondir"] as const)(
  "rejects non-directory traversal in a %s pointer without publishing decoy Git facts",
  async (pointer) => {
    const root = await createTestTempDirectory("rea-reference-git-path-");
    const source = join(root, "source");
    const metadata = join(root, "metadata");
    await mkdir(source);
    await mkdir(metadata);
    await writeFile(join(root, "blocker"), "regular file\n");
    await writeFile(join(metadata, "HEAD"), `${"1".repeat(40)}\n`);
    await writeFile(join(metadata, "config"), "[core]\nignorecase = true\n");
    const selected = `${join(root, "blocker")}/../metadata`;
    if (pointer === "gitdir") {
      await writeFile(join(source, ".git"), `gitdir: ${selected}\n`);
    } else {
      await mkdir(join(source, ".git"));
      await writeFile(join(source, ".git", "HEAD"), `${"2".repeat(40)}\n`);
      await writeFile(join(source, ".git", "commondir"), `${selected}\n`);
    }
    await expect(stat(selected)).rejects.toMatchObject({ code: "ENOTDIR" });
    await expect(
      locateReferenceSourceGitDirectory(source, (path) =>
        readFile(path, "utf8"),
      ),
    ).rejects.toMatchObject({ code: "ENOTDIR", path: selected });
    await withArtifactResourceScope(async (resources) => {
      expect(await readReferenceSourceVcs(source, resources)).toMatchObject({
        ok: true,
        value: { kind: "unknown", head: null, dirty: null },
      });
    });
    const imported = await importReferenceSource({
      root: source,
      caller: "git-path-test",
      policy: { secretPatterns: [] },
    });
    expect(imported).toMatchObject({
      ok: false,
      error: {
        code: "io",
        cause: { code: "ENOTDIR", path: selected },
      },
    });
  },
);
