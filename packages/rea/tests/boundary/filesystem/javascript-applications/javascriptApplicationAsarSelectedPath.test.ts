import { createHash } from "node:crypto";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackageWithOptions, extractFile } from "@electron/asar";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { reconstructJavaScriptArtifact } from "../../../support/javascriptApplicationScope.js";

it.skipIf(process.platform === "win32").each([
  {
    archiveName: "canonical.asar",
    aliasName: "selected.asar",
    format: "asar" as const,
  },
  {
    archiveName: "canonical",
    aliasName: "selected.asar",
    format: "asar" as const,
  },
  {
    archiveName: "canonical",
    aliasName: "selected.asar",
    format: "auto" as const,
  },
  {
    archiveName: "canonical.asar",
    aliasName: "selected",
    format: "auto" as const,
  },
])(
  "analyzes unpacked JavaScript through an alias to $archiveName with format $format",
  async ({ archiveName, aliasName, format }) => {
    const root = await createTestTempDirectory("rea-js-asar-selected-");
    const source = join(root, "source");
    await mkdir(source);
    const main = 'module.exports = require("./dependency.js");';
    await Promise.all([
      writeFile(
        join(source, "package.json"),
        JSON.stringify({ main: "main.js" }),
      ),
      writeFile(join(source, "main.js"), main),
      writeFile(join(source, "dependency.js"), "module.exports = 42;"),
    ]);
    const archive = join(root, archiveName);
    const selected = join(root, aliasName);
    await createPackageWithOptions(source, archive, { unpack: "*.js" });
    await symlink(archive, selected);
    await rename(`${archive}.unpacked`, `${selected}.unpacked`);
    expect(extractFile(selected, "main.js").toString()).toBe(main);
    const result = await reconstructJavaScriptArtifact({
      input_path: selected,
      format,
    });
    expect(result.statistics.parsed_javascript_files).toBe(2);
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          specifier: "./dependency.js",
          resolved_path: "dependency.js",
        }),
      }),
    );
    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({
        identity: expect.objectContaining({ path: "main.js" }),
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              entry_sha256: createHash("sha256").update(main).digest("hex"),
            }),
          }),
        ]),
      }),
    );
  },
);
