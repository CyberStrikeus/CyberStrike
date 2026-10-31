import { createHash } from "node:crypto";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { loadRealHopperFixtureTargets } from "../../../../scripts/lib/real-hopper-fixture.mjs";

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("real Hopper fixture binding", () => {
  it("binds exact source-owned artifacts and their semantic oracle", async () => {
    const manifest = await fixtureManifest();
    await expect(loadRealHopperFixtureTargets(manifest)).resolves.toMatchObject(
      {
        primary: { path: join(root ?? "", "c") },
        secondary: { path: join(root ?? "", "version-v2") },
        large: { path: join(root ?? "", "large") },
        largeOracle: {
          symbolPrefix: "_rea_inventory_",
          symbolCount: 1_205,
          stringPrefix: "REA_INVENTORY_",
          stringCount: 1_205,
        },
        oracle: {
          mainProcedure: "main",
          entryProcedure: "rea_entry",
          branchProcedure: "rea_branch",
          leafProcedure: "rea_leaf",
          entryString: "REA_C_ENTRY",
          leafString: "REA_C_LEAF",
          globalName: "rea_c_global",
        },
      },
    );
  });

  it("rejects digest drift and artifacts escaping the manifest root", async () => {
    const manifest = await fixtureManifest();
    await writeFile(join(root ?? "", "c"), "changed");
    await expect(loadRealHopperFixtureTargets(manifest)).rejects.toThrow(
      /digest/u,
    );

    const outside = await createTestTempDirectory("rea-hopper-outside-");
    try {
      await writeFile(join(outside, "c"), "primary");
      await rm(join(root ?? "", "c"));
      await symlink(join(outside, "c"), join(root ?? "", "c"));
      await expect(loadRealHopperFixtureTargets(manifest)).rejects.toThrow(
        /escapes/u,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects manifest entries that alias the same artifact", async () => {
    const manifest = await fixtureManifest();
    const parsed = JSON.parse(await readFile(manifest, "utf8")) as {
      fixtures: { name: string; artifact: string; artifactSha256: string }[];
    };
    const primary = parsed.fixtures.find(({ name }) => name === "c");
    const secondary = parsed.fixtures.find(({ name }) => name === "version-v2");
    if (primary === undefined || secondary === undefined)
      throw new Error("Fixture manifest setup failed");
    secondary.artifact = primary.artifact;
    secondary.artifactSha256 = primary.artifactSha256;
    await writeFile(manifest, JSON.stringify(parsed));

    await expect(loadRealHopperFixtureTargets(manifest)).rejects.toThrow(
      /distinct artifacts/u,
    );
  });
});

const fixtureManifest = async (): Promise<string> => {
  root = await createTestTempDirectory("rea-hopper-fixture-");
  const primary = Buffer.from("primary");
  const secondary = Buffer.from("secondary");
  await Promise.all([
    writeFile(join(root, "c"), primary),
    writeFile(join(root, "version-v2"), secondary),
    writeFile(join(root, "large"), Buffer.from("large")),
  ]);
  const manifest = join(root, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      fixtures: [
        {
          name: "c",
          artifact: "c",
          artifactSha256: digest(primary),
          expectations: {
            hopperOracle: {
              mainProcedure: "main",
              entryProcedure: "rea_entry",
              branchProcedure: "rea_branch",
              leafProcedure: "rea_leaf",
              entryString: "REA_C_ENTRY",
              leafString: "REA_C_LEAF",
              globalName: "rea_c_global",
            },
          },
        },
        {
          name: "version-v2",
          artifact: "version-v2",
          artifactSha256: digest(secondary),
        },
        {
          name: "large",
          artifact: "large",
          artifactSha256: digest(Buffer.from("large")),
          expectations: {
            symbolPrefix: "_rea_inventory_",
            symbolCount: 1_205,
            stringPrefix: "REA_INVENTORY_",
            stringCount: 1_205,
          },
        },
      ],
    }),
  );
  return manifest;
};

const digest = (value: Buffer): string =>
  createHash("sha256").update(value).digest("hex");
