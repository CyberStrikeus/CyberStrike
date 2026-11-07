import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves empty ESM import names on local re-export origins through %s",
  async (surface, { cli, processes }) => {
    const root = await createTestTempDirectory("rea-empty-import-name-");
    const modulePath = join(root, "module.mjs");
    const appPath = join(root, "app.mjs");
    await writeFile(
      modulePath,
      'const value = 1; export { value as "", value as "a", value as "0" };',
    );
    await writeFile(
      appPath,
      [
        'import { "" as empty, "a" as letter, "0" as zero } from "./module.mjs";',
        "export { empty, letter, zero };",
        'export { "" as direct } from "./module.mjs";',
      ].join("\n"),
    );
    for (const path of [modulePath, appPath]) {
      const checked = await processes.run(process.execPath, ["--check", path]);
      expect(checked.exitCode, checked.stderr).toBe(0);
    }
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const imports = result.graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" && properties.specifier === "./module.mjs",
    );
    for (const [name, local] of [
      ["", "empty"],
      ["a", "letter"],
      ["0", "zero"],
    ]) {
      for (const kind of ["import", "export"]) {
        expect(imports).toContainEqual(
          expect.objectContaining({
            properties: expect.objectContaining({
              module_link_kind: kind,
              ...(kind === "export"
                ? { exported_name: local }
                : { local_name: local }),
              imported_name: name,
              imported_path: [name],
              resolved_path: "module.mjs",
              resolution_status: "resolved",
            }),
          }),
        );
      }
    }
    expect(imports).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          exported_name: "direct",
          imported_name: "",
          imported_path: [""],
          resolution_status: "resolved",
        }),
      }),
    );
  },
);
