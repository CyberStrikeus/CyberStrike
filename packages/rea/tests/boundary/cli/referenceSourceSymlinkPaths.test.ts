import {
  mkdir,
  readFile,
  readlink,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "resolves source symlink targets through native traversal across retargeting and missing files",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-native-links-");
    const config = await createTestTempDirectory("rea-reference-link-config-");
    const outside = await createTestTempDirectory(
      "rea-reference-link-outside-",
    );
    for (const directory of [
      join(root, "first"),
      join(root, "second"),
      outside,
    ]) {
      await mkdir(join(directory, "deep"), { recursive: true });
      await writeFile(
        join(directory, "source.js"),
        "export const selected = true;\n",
      );
    }
    await writeFile(join(root, "source.js"), "export const decoy = true;\n");
    const alias = join(root, "alias");
    await symlink(join(root, "first/deep"), alias);
    await symlink("alias/../source.js", join(root, "selected.js"));
    await symlink("alias/../../source.js", join(root, "parent.js"));
    await symlink("absent/../source.js", join(root, "missing-parent.js"));
    await symlink("source.js/", join(root, "directory-required.js"));
    await symlink("source.js/..", join(root, "file-parent.js"));
    await symlink("source.js/../source.js", join(root, "file-parent-child.js"));
    const run = async () => {
      const result = await cli.run({
        arguments: ["import-reference-source", root, "--json"],
        environment: {
          HOME: config,
          XDG_CONFIG_HOME: config,
          XDG_CACHE_HOME: config,
        },
      });
      expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
        0,
      );
      return historicalSourceGraphSchema.parse(result.json);
    };
    const first = await run();
    expect(first.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "selected.js",
          target: "first/source.js",
          target_state: "internal",
        }),
        expect.objectContaining({
          path: "parent.js",
          target: "source.js",
          target_state: "internal",
        }),
        expect.objectContaining({
          path: "missing-parent.js",
          target: `${root}/absent/../source.js`,
          target_state: "missing",
        }),
        expect.objectContaining({
          path: "directory-required.js",
          target: `${root}/source.js/`,
          target_state: "missing",
        }),
        expect.objectContaining({
          path: "file-parent.js",
          target: `${root}/source.js/..`,
          target_state: "missing",
        }),
        expect.objectContaining({
          path: "file-parent-child.js",
          target: `${root}/source.js/../source.js`,
          target_state: "missing",
        }),
      ]),
    );
    await unlink(alias);
    await symlink(join(root, "second/deep"), alias);
    const second = await run();
    expect(second.entries).toContainEqual(
      expect.objectContaining({
        path: "selected.js",
        target: "second/source.js",
        target_state: "internal",
      }),
    );
    await unlink(join(root, "second/source.js"));
    const missing = await run();
    expect(missing.entries).toContainEqual(
      expect.objectContaining({
        path: "selected.js",
        target: "second/source.js",
        target_state: "missing",
      }),
    );
    await unlink(alias);
    await symlink(join(outside, "deep"), alias);
    const external = await run();
    expect(external.entries).toContainEqual(
      expect.objectContaining({
        path: "selected.js",
        target: join(outside, "source.js"),
        target_state: "external",
      }),
    );
    expect(
      external.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.path),
    ).toEqual(["first/source.js", "source.js"]);
    expect(await readlink(join(root, "selected.js"))).toBe(
      "alias/../source.js",
    );
    expect(await readFile(join(root, "source.js"), "utf8")).toBe(
      "export const decoy = true;\n",
    );
  },
);
