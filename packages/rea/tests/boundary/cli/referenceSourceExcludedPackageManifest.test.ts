import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "keeps package selection unknown when its manifest is excluded",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-reference-excluded-package-main-",
    );
    const config = await createTestTempDirectory(
      "rea-reference-excluded-package-main-config-",
    );
    await mkdir(join(root, "pkg"), { recursive: true });
    await Promise.all([
      writeFile(join(root, ".gitignore"), "pkg/package.json\n"),
      writeFile(join(root, "main.cjs"), 'require("./pkg");\n'),
      writeFile(join(root, "pkg", "package.json"), '{"main":"actual.cjs"}\n'),
      writeFile(join(root, "pkg", "actual.cjs"), "module.exports = 1;\n"),
      writeFile(join(root, "pkg", "index.js"), "module.exports = 2;\n"),
    ]);

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
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.exclusions).toContainEqual({
      path: "pkg/package.json",
      entry_kind: "file",
      reason: "project-ignored",
      pattern: "pkg/package.json",
    });
    expect(graph.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["pkg/actual.cjs", "pkg/index.js"]),
    );
    expect(graph.relationships).toContainEqual({
      from_path: "main.cjs",
      to: "pkg",
      kind: "requires",
      resolution: "unresolved",
      parse_state: "parsed",
    });
    expect(graph.relationships).not.toContainEqual(
      expect.objectContaining({
        from_path: "main.cjs",
        to: "pkg/index.js",
        resolution: "internal",
      }),
    );
  },
);

cliTest(
  "does not fall back to an index when the declared main is excluded",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-excluded-main-");
    const config = await createTestTempDirectory(
      "rea-reference-excluded-main-config-",
    );
    await Promise.all([
      mkdir(join(root, "excluded", "dist"), { recursive: true }),
      mkdir(join(root, "visible", "lib"), { recursive: true }),
      mkdir(join(root, "missing"), { recursive: true }),
      mkdir(join(root, "ignored", "lib"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, ".gitignore"), "ignored/lib/entry.js\n"),
      writeFile(
        join(root, "main.cjs"),
        'require("./excluded"); require("./visible"); require("./missing"); require("./ignored");\n',
      ),
      writeFile(
        join(root, "excluded", "package.json"),
        '{"main":"dist/index.js"}',
      ),
      writeFile(
        join(root, "excluded", "dist", "index.js"),
        "module.exports = 1;",
      ),
      writeFile(join(root, "excluded", "index.js"), "module.exports = 2;"),
      writeFile(
        join(root, "visible", "package.json"),
        '{"main":"lib/index.js"}',
      ),
      writeFile(
        join(root, "visible", "lib", "index.js"),
        "module.exports = 3;",
      ),
      writeFile(join(root, "visible", "index.js"), "module.exports = 4;"),
      writeFile(join(root, "missing", "package.json"), '{"main":"gone.js"}'),
      writeFile(join(root, "missing", "index.js"), "module.exports = 5;"),
      writeFile(
        join(root, "ignored", "package.json"),
        '{"main":"lib/entry.js"}',
      ),
      writeFile(
        join(root, "ignored", "lib", "entry.js"),
        "module.exports = 6;",
      ),
      writeFile(join(root, "ignored", "index.js"), "module.exports = 7;"),
    ]);
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
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.exclusions).toContainEqual({
      path: "excluded/dist",
      entry_kind: "directory",
      reason: "default-ignored",
      pattern: "dist/",
    });
    expect(graph.exclusions).toContainEqual({
      path: "ignored/lib/entry.js",
      entry_kind: "file",
      reason: "project-ignored",
      pattern: "ignored/lib/entry.js",
    });
    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from_path: "main.cjs",
          to: "excluded",
          resolution: "unresolved",
        }),
        expect.objectContaining({
          from_path: "main.cjs",
          to: "visible/lib/index.js",
          resolution: "internal",
        }),
        expect.objectContaining({
          from_path: "main.cjs",
          to: "missing/index.js",
          resolution: "internal",
        }),
        expect.objectContaining({
          from_path: "main.cjs",
          to: "ignored",
          resolution: "unresolved",
        }),
      ]),
    );
    expect(graph.relationships).not.toContainEqual(
      expect.objectContaining({
        from_path: "main.cjs",
        to: "excluded/index.js",
        resolution: "internal",
      }),
    );
    expect(graph.relationships).not.toContainEqual(
      expect.objectContaining({
        from_path: "main.cjs",
        to: "ignored/index.js",
        resolution: "internal",
      }),
    );
  },
);
