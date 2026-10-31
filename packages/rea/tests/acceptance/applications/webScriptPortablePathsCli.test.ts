import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { webScriptExportManifestSchema } from "../../../src/domain/webScriptExport.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { scriptScenarioFixture } from "../../fixtures/webScriptCapture.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest(
  "keeps portable URL characters in exported module relationships",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-web-script-portable-");
    const capturePath = join(root, "capture.json");
    const output = join(root, "output");
    const filenames = ["chunk+abc.js", "cash$flow.js", "a&b.js"];
    const scripts = [
      {
        url: "https://fixture.test/app/main.js",
        bytes: Buffer.from(
          filenames.map((name) => `import './${name}';`).join("\n"),
        ),
      },
      ...filenames.map((name) => ({
        url: `https://fixture.test/app/${name}`,
        bytes: Buffer.from("export const marker = 1;\n"),
      })),
    ];
    await writeFile(
      capturePath,
      JSON.stringify(scriptScenarioFixture(scripts)),
    );
    const published = await cli.run({
      arguments: ["export-web-scripts", capturePath, output, "--json"],
    });
    expect(published.exitCode, published.stderr).toBe(0);
    const manifest = webScriptExportManifestSchema.parse(
      JSON.parse(await readFile(join(output, "manifest.json"), "utf8")),
    );
    expect(manifest.scripts.map(({ url }) => url)).toEqual(
      scripts.map(({ url }) => url),
    );
    for (const [index, record] of manifest.scripts.entries()) {
      expect(record.content.state).toBe("exported");
      if (record.content.state !== "exported")
        throw new Error("missing export");
      expect(record.content.layout).toBe("url-path");
      const expected = scripts[index]?.bytes;
      if (expected === undefined) throw new Error("missing source script");
      expect(
        (
          await readFile(join(output, "files", record.content.relative_path))
        ).equals(expected),
      ).toBe(true);
    }
    const result = await analyzeJavaScriptDirectory(
      "CLI",
      cli,
      join(output, "files"),
    );
    for (const name of filenames)
      expect(result.graph.edges).toContainEqual(
        expect.objectContaining({
          relation: "imports",
          properties: expect.objectContaining({
            specifier: `./${name}`,
            resolution_status: "resolved",
          }),
        }),
      );
  },
);
