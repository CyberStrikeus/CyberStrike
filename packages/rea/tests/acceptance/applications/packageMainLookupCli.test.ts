import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  { name: "null-main", metadata: { main: null } },
  { name: "false-main", metadata: { main: false } },
  { name: "zero-main", metadata: { main: 0 } },
  { name: "true-main", metadata: { main: true } },
  { name: "object-main", metadata: { main: {} } },
  { name: "empty-main", metadata: { main: "" } },
  { name: "missing-main", metadata: {} },
  { name: "string-main", metadata: { main: "./index.js" } },
] as const;

cliTest.for(["CLI", "stdio MCP"] as const)(
  "matches Node package main interpretation through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-package-main-");
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ type: "commonjs" }),
      "entry.cjs": cases
        .map(({ name }) => `require(${JSON.stringify(name)});`)
        .join("\n"),
      "entry.mjs": cases
        .map(({ name }) => `import ${JSON.stringify(name)};`)
        .join("\n"),
      "control.cjs": [
        `const specifiers = ${JSON.stringify(cases.map(({ name }) => name))};`,
        "console.log(JSON.stringify(specifiers.map((specifier) => require(specifier))));",
      ].join("\n"),
      "control.mjs": [
        `const specifiers = ${JSON.stringify(cases.map(({ name }) => name))};`,
        "console.log(JSON.stringify(await Promise.all(specifiers.map(async (specifier) => (await import(specifier)).default))));",
      ].join("\n"),
    };
    for (const { name, metadata } of cases) {
      files[`node_modules/${name}/package.json`] = JSON.stringify(metadata);
      files[`node_modules/${name}/index.js`] =
        `module.exports = ${JSON.stringify(`node_modules/${name}/index.js`)};`;
    }
    await writeFixtureFiles(root, files);

    for (const filename of ["control.cjs", "control.mjs"]) {
      expect(await runNodeJsonControl(root, filename)).toEqual(
        cases.map(({ name }) => `node_modules/${name}/index.js`),
      );
    }

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const kind of ["require", "import"])
      for (const { name } of cases)
        expect(
          graph.edges
            .filter(({ relation }) => relation === "imports")
            .map(({ properties }) => properties),
        ).toContainEqual(
          expect.objectContaining({
            module_link_kind: kind,
            specifier: name,
            resolved_path: `node_modules/${name}/index.js`,
            resolution_status: "resolved",
          }),
        );
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves loader-specific package main probes and finalization through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-package-main-path-");
    const packages = [
      {
        name: "dot-slash-main",
        main: "./lib/",
        files: ["lib.js", "lib/index.js", "index.js"],
        require: "lib.js",
        import: null,
      },
      {
        name: "slash-main",
        main: "lib/",
        files: ["lib.js", "lib/index.js", "index.js"],
        require: "lib.js",
        import: null,
      },
      {
        name: "plain-main",
        main: "./lib",
        files: ["lib.js", "lib/index.js"],
        require: "lib.js",
        import: "lib.js",
      },
      {
        name: "directory-main",
        main: "./lib/",
        files: ["lib/index.js", "index.js"],
        require: "lib/index.js",
        import: "lib/index.js",
      },
      {
        name: "fallback-main",
        main: "./missing/",
        files: ["index.js"],
        require: "index.js",
        import: "index.js",
      },
      {
        name: "exact-main",
        main: "./lib.js/",
        files: ["lib.js", "index.js"],
        require: "lib.js",
        import: "lib.js",
      },
      {
        name: "finalized-directory-main",
        main: "./lib/",
        files: ["lib.js", "lib/.js/child.js"],
        require: "lib.js",
        import: null,
        importError: "ERR_UNSUPPORTED_DIR_IMPORT",
      },
      {
        name: "finalized-main",
        main: "./lib/",
        files: ["lib.js", "lib/.js", "lib/index.js"],
        require: "lib.js",
        import: "lib/.js",
      },
    ] as const;
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ type: "commonjs" }),
      "entry.cjs": [
        ...packages.map(({ name }) => `require(${JSON.stringify(name)});`),
        'require("./local/");',
      ].join("\n"),
      "entry.mjs": packages
        .map(({ name }) => `import ${JSON.stringify(name)};`)
        .join("\n"),
      "local.js": 'module.exports = "local.js";',
      "local/index.js": 'module.exports = "local/index.js";',
    };
    for (const item of packages) {
      files[`node_modules/${item.name}/package.json`] = JSON.stringify({
        main: item.main,
      });
      for (const path of item.files) {
        const target = `node_modules/${item.name}/${path}`;
        files[target] = `module.exports = ${JSON.stringify(target)};`;
      }
    }
    for (const kind of ["require", "import"] as const) {
      const filename = `control.${kind === "require" ? "cjs" : "mjs"}`;
      files[filename] = [
        `const specifiers = ${JSON.stringify(packages.map(({ name }) => name))};`,
        "const results = [];",
        "for (const specifier of specifiers) {",
        `  try { results.push({ path: ${kind === "require" ? "require(specifier)" : "(await import(specifier)).default"} }); }`,
        "  catch (error) { results.push({ code: error.code }); }",
        "}",
        "console.log(JSON.stringify(results));",
      ].join("\n");
    }
    files["local-control.cjs"] =
      'console.log(JSON.stringify(require("./local/")));';
    await writeFixtureFiles(root, files);
    for (const kind of ["require", "import"] as const) {
      const control = await runNodeJsonControl(
        root,
        `control.${kind === "require" ? "cjs" : "mjs"}`,
      );
      expect(control).toEqual(
        packages.map((item) =>
          item[kind] === null
            ? {
                code:
                  "importError" in item
                    ? item.importError
                    : "ERR_MODULE_NOT_FOUND",
              }
            : { path: `node_modules/${item.name}/${item[kind]}` },
        ),
      );
    }
    expect(await runNodeJsonControl(root, "local-control.cjs")).toBe(
      "local/index.js",
    );
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const relationships = graph.edges
      .filter(({ relation }) => relation === "imports")
      .map(({ properties }) => properties);
    for (const kind of ["require", "import"] as const)
      for (const item of packages)
        expect(relationships).toContainEqual(
          expect.objectContaining({
            module_link_kind: kind,
            specifier: item.name,
            resolved_path:
              item[kind] === null
                ? null
                : `node_modules/${item.name}/${item[kind]}`,
            resolution_status:
              item[kind] === null
                ? "importError" in item
                  ? "rejected"
                  : "not-found"
                : "resolved",
          }),
        );
    expect(relationships).toContainEqual(
      expect.objectContaining({
        module_link_kind: "require",
        specifier: "./local/",
        resolved_path: "local/index.js",
        resolution_status: "resolved",
      }),
    );
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "resolves package mains that name the artifact root through %s",
  async (surface, { cli }) => {
    const mains = ["../..", "../../", "../../."];
    const names = mains.map((_, index) => `root-main-${index}`);
    const requires = names.map((name) => `require("${name}")`);
    for (const rootIndex of ["index.js", "index.json", null]) {
      const root = await createTestTempDirectory("rea-package-main-root-");
      const importOptions =
        rootIndex === "index.json" ? ', { with: { type: "json" } }' : "";
      const imports = names.map(
        (name) =>
          `import("${name}"${importOptions}).then(module => module.default)`,
      );
      const files: Record<string, string> = {
        "package.json": '{"type":"commonjs"}',
        "entry.cjs": requires.join(";\n"),
        "entry.mjs": names.map((name) => `import "${name}";`).join("\n"),
        ".js": 'module.exports = ".js decoy";',
        ".json": '".json decoy"',
        "control.cjs": `console.log(JSON.stringify([${requires.join(",")}]));`,
        "control.mjs": `console.log(JSON.stringify(await Promise.all([${imports.join(",")}])));`,
      };
      if (rootIndex !== null)
        files[rootIndex] =
          rootIndex === "index.js"
            ? 'module.exports = "index.js";'
            : '"index.json"';
      for (const [index, main] of mains.entries()) {
        const directory = `node_modules/${names[index]}`;
        files[`${directory}/package.json`] = JSON.stringify({ main });
        files[`${directory}/index.js`] =
          `module.exports = "${directory}/index.js";`;
      }
      await writeFixtureFiles(root, files);
      const expected = names.map(
        (name) => rootIndex ?? `node_modules/${name}/index.js`,
      );
      for (const filename of ["control.cjs", "control.mjs"])
        expect(await runNodeJsonControl(root, filename)).toEqual(expected);

      const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
      const relationships = graph.edges
        .filter(({ relation }) => relation === "imports")
        .map(({ properties }) => properties);
      for (const kind of ["require", "import"])
        for (const [index, name] of names.entries())
          expect(relationships).toContainEqual(
            expect.objectContaining({
              module_link_kind: kind,
              specifier: name,
              resolved_path: expected[index],
              resolution_status: "resolved",
            }),
          );
    }
  },
);
