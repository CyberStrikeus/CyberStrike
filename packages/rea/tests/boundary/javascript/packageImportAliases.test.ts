import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ArtifactPathResolution } from "../../../src/application/javascript/JavaScriptArtifactPathResolution.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/workspace/writeFixtureFiles.js";
import { resolveStandaloneArtifactPath } from "../../support/javascriptArtifactPathResolution.js";

const execute = promisify(execFile);
const nodeOutcomeSchema = z.strictObject({
  target: z.string().nullable(),
  error_code: z.string().nullable(),
});

const posixRelative = (root: string, absolute: string): string =>
  relative(root, absolute).replaceAll("\\", "/");

const inventory = (
  contents: ReadonlyMap<string, string>,
): Map<string, JavaScriptArtifactFile> =>
  new Map(
    [...contents].map(([path, value]) => [
      path,
      {
        path,
        container_sha256: "a".repeat(64),
        sha256: "b".repeat(64),
        bytes: Buffer.byteLength(value),
        inventory_artifact_id: path,
        kind: path.endsWith("package.json") ? "package-json" : "javascript",
        unpacked: false,
        text: { included: true, value },
      },
    ]),
  );

const writeTree = async (
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<Map<string, string>> => {
  await writeFixtureFiles(root, files);
  return new Map(Object.entries(files));
};

const nodeRequireTarget = async (
  importer: string,
  specifier: string,
): Promise<z.infer<typeof nodeOutcomeSchema>> => {
  try {
    return {
      target: createRequire(importer).resolve(specifier),
      error_code: null,
    };
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? z.string().parse(Reflect.get(error, "code"))
        : null;
    return { target: null, error_code: code };
  }
};

const nodeImportTarget = async (
  cwd: string,
  specifier: string,
): Promise<z.infer<typeof nodeOutcomeSchema>> => {
  const { stdout } = await execute(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      try {
        const url = await import.meta.resolve(${JSON.stringify(specifier)});
        console.log(JSON.stringify({ target: url, error_code: null }));
      } catch (error) {
        console.log(JSON.stringify({
          target: null,
          error_code: error.code ?? null,
        }));
      }
    `,
    ],
    { cwd },
  );
  return nodeOutcomeSchema.parse(JSON.parse(stdout));
};

const resolveAlias = (
  files: Map<string, JavaScriptArtifactFile>,
  declaredPath: string,
  sourcePath: string,
  moduleKind: "import" | "require",
): ArtifactPathResolution =>
  resolveStandaloneArtifactPath({
    declaredPath,
    sourcePath,
    context: "module-specifier",
    moduleKind,
    files,
  });

describe("literal package import keys compared with Node", () => {
  it("matches literal imports keys containing path-like bytes in both Node loaders", async () => {
    const root = await createTestTempDirectory("rea-import-alias-literal-");
    const specifiers = ["#/x", "#x%2Fy", "#x%2Ey", "#x\\y", "#x\0y"];
    const contents = await writeTree(root, {
      "package.json": JSON.stringify({
        imports: Object.fromEntries(
          specifiers.map((specifier) => [specifier, "./target.cjs"]),
        ),
      }),
      "main.cjs": "module.exports = 1;",
      "target.cjs": "module.exports = 1;",
    });
    const inventoried = inventory(contents);
    for (const specifier of specifiers) {
      const required = await nodeRequireTarget(
        join(root, "main.cjs"),
        specifier,
      );
      expect(required.error_code).toBeNull();
      expect(posixRelative(root, required.target ?? "")).toBe("target.cjs");
      const imported = await nodeImportTarget(root, specifier);
      expect(imported.error_code).toBeNull();
      expect(posixRelative(root, fileURLToPath(imported.target ?? ""))).toBe(
        "target.cjs",
      );
      for (const moduleKind of ["require", "import"] as const)
        expect(
          resolveAlias(inventoried, specifier, "main.cjs", moduleKind),
          JSON.stringify({ specifier, moduleKind }),
        ).toMatchObject({
          declared_path: specifier,
          resolution_status: "resolved",
          resolved_path: "target.cjs",
        });
    }
  });

  it("still rejects unsafe selected targets for literal imports keys", async () => {
    const root = await createTestTempDirectory("rea-import-alias-target-");
    const contents = await writeTree(root, {
      "package.json": JSON.stringify({
        imports: { "#x%2Fy": "./nested%2Ftarget.cjs" },
      }),
      "main.cjs": "module.exports = 1;",
      "nested/target.cjs": "module.exports = 1;",
    });
    const inventoried = inventory(contents);
    const required = await nodeRequireTarget(join(root, "main.cjs"), "#x%2Fy");
    expect(required.error_code).toBe("ERR_INVALID_MODULE_SPECIFIER");
    const imported = await nodeImportTarget(root, "#x%2Fy");
    expect(imported.error_code).toBe("ERR_INVALID_MODULE_SPECIFIER");
    for (const moduleKind of ["require", "import"] as const)
      expect(
        resolveAlias(inventoried, "#x%2Fy", "main.cjs", moduleKind),
      ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
  });
});

describe("inactive package target arrays compared with Node", () => {
  it("continues past inactive arrays in enclosing imports and exports conditions", async () => {
    const root = await createTestTempDirectory("rea-inactive-package-array-");
    const conditional = {
      node: [{ browser: "./browser.cjs" }],
      default: "./fallback.cjs",
    };
    const nested = {
      node: [
        [{ browser: "./browser.cjs" }],
        { "rea-inactive": "./inactive.cjs" },
      ],
      default: "./fallback.cjs",
    };
    const contents = await writeTree(root, {
      "package.json": JSON.stringify({
        imports: { "#conditional": conditional, "#nested": nested },
      }),
      "main.cjs": "module.exports = 1;",
      "fallback.cjs": "module.exports = 1;",
      "node_modules/fixture/package.json": JSON.stringify({
        name: "fixture",
        exports: { ".": conditional, "./nested": nested },
      }),
      "node_modules/fixture/fallback.cjs": "module.exports = 2;",
    });
    const inventoried = inventory(contents);
    for (const [specifier, expected] of [
      ["#conditional", "fallback.cjs"],
      ["#nested", "fallback.cjs"],
      ["fixture", "node_modules/fixture/fallback.cjs"],
      ["fixture/nested", "node_modules/fixture/fallback.cjs"],
    ] as const) {
      const required = await nodeRequireTarget(
        join(root, "main.cjs"),
        specifier,
      );
      expect(required.error_code, specifier).toBeNull();
      expect(posixRelative(root, required.target ?? "")).toBe(expected);
      const imported = await nodeImportTarget(root, specifier);
      expect(imported.error_code).toBeNull();
      expect(posixRelative(root, fileURLToPath(imported.target ?? ""))).toBe(
        expected,
      );
      for (const moduleKind of ["require", "import"] as const)
        expect(
          resolveAlias(inventoried, specifier, "main.cjs", moduleKind),
        ).toMatchObject({
          declared_path: specifier,
          resolution_status: "resolved",
          resolved_path: expected,
        });
    }
  });
});

describe("package target refusal evidence compared with Node", () => {
  it("keeps empty, null, invalid, and unmatched array outcomes distinct", async () => {
    const root = await createTestTempDirectory("rea-inactive-package-refusal-");
    const inactive = { browser: "./browser.cjs" };
    const contents = await writeTree(root, {
      "package.json": JSON.stringify({
        imports: {
          "#empty-direct": [],
          "#empty": { node: [], default: "./fallback.cjs" },
          "#null": { node: [null, inactive], default: "./fallback.cjs" },
          "#null-last": [[], null],
          "#empty-last": [null, []],
          "#invalid": {
            node: ["../outside.cjs", inactive],
            default: "./fallback.cjs",
          },
          "#unmatched": [inactive],
          "#unmatched-nested": [
            [inactive, { "rea-inactive": "./inactive.cjs" }],
          ],
          "#unmatched-active": { node: [inactive] },
        },
      }),
      "main.cjs": "module.exports = 1;",
      "fallback.cjs": "module.exports = 1;",
    });
    const inventoried = inventory(contents);
    for (const [specifier, errorCode, status, limitation] of [
      [
        "#empty-direct",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "an empty imports target array",
      ],
      [
        "#empty",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "an empty imports target array",
      ],
      [
        "#null",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "an explicit null imports target",
      ],
      [
        "#null-last",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "an explicit null imports target",
      ],
      [
        "#empty-last",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "an empty imports target array",
      ],
      ["#invalid", "ERR_INVALID_PACKAGE_TARGET", "rejected", "../outside.cjs"],
      [
        "#unmatched",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "it declares browser.",
      ],
      [
        "#unmatched-nested",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "it declares browser, rea-inactive.",
      ],
      [
        "#unmatched-active",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "it declares node, browser.",
      ],
    ] as const) {
      expect(
        (await nodeRequireTarget(join(root, "main.cjs"), specifier)).error_code,
      ).toBe(errorCode);
      expect((await nodeImportTarget(root, specifier)).error_code).toBe(
        errorCode,
      );
      for (const moduleKind of ["require", "import"] as const) {
        const result = resolveAlias(
          inventoried,
          specifier,
          "main.cjs",
          moduleKind,
        );
        expect(result).toMatchObject({
          resolution_status: status,
          resolved_path: null,
        });
        expect(result.limitations.join(" "), specifier).toContain(limitation);
      }
    }
  });
});

describe("package import target arrays compared with Node", () => {
  it("skips invalid parent, absolute, and URL targets before an exact fallback", async () => {
    const root = await createTestTempDirectory("rea-import-alias-fallback-");
    const imports = {
      "#parent": ["../outside.cjs", "./fallback.cjs"],
      "#absolute": { node: [["/outside.cjs"], "./fallback.cjs"] },
      "#url": {
        import: ["https://example.invalid/outside.cjs", "./fallback.cjs"],
        require: ["file:///outside.cjs", "./fallback.cjs"],
      },
    };
    const contents = await writeTree(root, {
      "package.json": JSON.stringify({ imports }),
      "main.cjs": "module.exports = 1;",
      "fallback.cjs": "module.exports = 1;",
    });
    const inventoried = inventory(contents);
    for (const specifier of Object.keys(imports)) {
      const required = await nodeRequireTarget(
        join(root, "main.cjs"),
        specifier,
      );
      expect(required.error_code).toBeNull();
      expect(posixRelative(root, required.target ?? "")).toBe("fallback.cjs");
      const imported = await nodeImportTarget(root, specifier);
      expect(imported.error_code).toBeNull();
      expect(posixRelative(root, fileURLToPath(imported.target ?? ""))).toBe(
        "fallback.cjs",
      );
      for (const moduleKind of ["require", "import"] as const)
        expect(
          resolveAlias(inventoried, specifier, "main.cjs", moduleKind),
        ).toMatchObject({
          declared_path: specifier,
          resolution_status: "resolved",
          resolved_path: "fallback.cjs",
        });
    }
  });

  it("preserves invalid, null, and unsupported-package outcomes in arrays", async () => {
    const root = await createTestTempDirectory(
      "rea-import-alias-fallback-refuse-",
    );
    const contents = await writeTree(root, {
      "package.json": JSON.stringify({
        imports: {
          "#invalid": [null, "../outside.cjs"],
          "#blocked": ["../outside.cjs", null],
          "#package": ["fixture", "./fallback.cjs"],
        },
      }),
      "main.cjs": "module.exports = 1;",
      "fallback.cjs": "module.exports = 1;",
      "node_modules/fixture/package.json": JSON.stringify({
        name: "fixture",
        main: "index.cjs",
      }),
      "node_modules/fixture/index.cjs": "module.exports = 2;",
    });
    const inventoried = inventory(contents);
    for (const [specifier, errorCode, resolutionStatus, reason] of [
      ["#invalid", "ERR_INVALID_PACKAGE_TARGET", "rejected", "../outside.cjs"],
      [
        "#blocked",
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        "external",
        "explicit null",
      ],
    ] as const) {
      const required = await nodeRequireTarget(
        join(root, "main.cjs"),
        specifier,
      );
      expect(required.error_code).toBe(errorCode);
      expect((await nodeImportTarget(root, specifier)).error_code).toBe(
        errorCode,
      );
      for (const moduleKind of ["require", "import"] as const) {
        const result = resolveAlias(
          inventoried,
          specifier,
          "main.cjs",
          moduleKind,
        );
        expect(result).toMatchObject({
          resolution_status: resolutionStatus,
          resolved_path: null,
        });
        expect(result.limitations.join(" ")).toContain(reason);
      }
    }
    const required = await nodeRequireTarget(
      join(root, "main.cjs"),
      "#package",
    );
    expect(posixRelative(root, required.target ?? "")).toBe(
      "node_modules/fixture/index.cjs",
    );
    const imported = await nodeImportTarget(root, "#package");
    expect(imported.error_code).toBeNull();
    expect(posixRelative(root, fileURLToPath(imported.target ?? ""))).toBe(
      "node_modules/fixture/index.cjs",
    );
    for (const moduleKind of ["require", "import"] as const) {
      const result = resolveAlias(
        inventoried,
        "#package",
        "main.cjs",
        moduleKind,
      );
      expect(result).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
      });
      expect(result.limitations.join(" ")).toContain(
        "External-package import targets remain unresolved",
      );
    }
  });
});

describe("package import target URL normalization compared with Node", () => {
  it("normalizes targets before package-root validation and array selection", async () => {
    const root = await createTestTempDirectory("rea-package-target-url-");
    // Windows forbids '?' in filenames; the suffix target below covers URL queries.
    const directory =
      process.platform === "win32" ? "app space#%λ" : "app space#?%λ";
    const imports = {
      "#tab-escape": ["./.\t./outside.cjs", "./fallback.cjs"],
      "#newline-escape": ["./.%\n2e/outside.cjs", "./fallback.cjs"],
      "#cr-escape": ["./.\r./outside.cjs", "./fallback.cjs"],
      "#normalized": "./fall\tback.cjs",
      "#trimmed": "./fallback.cjs \t",
      "#suffix": "./fallback.cjs?selected=one#fragment",
      "#return": `./.\t./${encodeURIComponent(directory)}/fallback.cjs`,
    };
    const contents = await writeTree(root, {
      [`${directory}/package.json`]: JSON.stringify({ imports }),
      [`${directory}/main.cjs`]: "module.exports = 1;",
      [`${directory}/fallback.cjs`]: "module.exports = 1;",
    });
    const inventoried = inventory(contents);
    for (const specifier of Object.keys(imports)) {
      const required = await nodeRequireTarget(
        join(root, directory, "main.cjs"),
        specifier,
      );
      expect(required.error_code, specifier).toBeNull();
      expect(posixRelative(root, required.target ?? "")).toBe(
        `${directory}/fallback.cjs`,
      );
      const imported = await nodeImportTarget(join(root, directory), specifier);
      expect(imported.error_code, specifier).toBeNull();
      expect(posixRelative(root, fileURLToPath(imported.target ?? ""))).toBe(
        `${directory}/fallback.cjs`,
      );
      for (const moduleKind of ["require", "import"] as const)
        expect(
          resolveAlias(
            inventoried,
            specifier,
            `${directory}/main.cjs`,
            moduleKind,
          ),
          specifier,
        ).toMatchObject({
          declared_path: specifier,
          resolution_status: "resolved",
          resolved_path: `${directory}/fallback.cjs`,
        });
    }
  });

  it("keeps URL decoding and missing-file failures after array selection", async () => {
    const root = await createTestTempDirectory(
      "rea-package-target-url-refusal-",
    );
    const contents = await writeTree(root, {
      "package.json": JSON.stringify({
        imports: {
          "#escape": "./.\t./outside.cjs",
          "#separator": ["./fall%2fback.cjs", "./fallback.cjs"],
          "#missing": ["./miss\ting.cjs", "./fallback.cjs"],
          "#query-separator": ["./first.cjs?selected=%2f", "./fallback.cjs"],
        },
      }),
      "main.cjs": "module.exports = 1;",
      "fallback.cjs": "module.exports = 1;",
      "first.cjs": "module.exports = 2;",
    });
    const inventoried = inventory(contents);
    for (const [specifier, code] of [
      ["#escape", "ERR_INVALID_PACKAGE_TARGET"],
      ["#separator", "ERR_INVALID_MODULE_SPECIFIER"],
    ] as const) {
      expect(
        (await nodeRequireTarget(join(root, "main.cjs"), specifier)).error_code,
      ).toBe(code);
      expect((await nodeImportTarget(root, specifier)).error_code).toBe(code);
      for (const moduleKind of ["require", "import"] as const)
        expect(
          resolveAlias(inventoried, specifier, "main.cjs", moduleKind),
        ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
    }
    expect(
      (await nodeRequireTarget(join(root, "main.cjs"), "#missing")).error_code,
    ).toBe("MODULE_NOT_FOUND");
    const imported = await nodeImportTarget(root, "#missing");
    expect(posixRelative(root, fileURLToPath(imported.target ?? ""))).toBe(
      "missing.cjs",
    );
    for (const moduleKind of ["require", "import"] as const)
      expect(
        resolveAlias(inventoried, "#missing", "main.cjs", moduleKind),
      ).toMatchObject({
        resolution_status: "not-found",
        resolved_path: null,
        limitations: [expect.stringContaining("missing.cjs")],
      });
    expect(
      resolveAlias(
        inventoried,
        "#escape",
        "main.cjs",
        "require",
      ).limitations.join(" "),
    ).toContain(JSON.stringify("./.\t./outside.cjs"));
    expect(
      (await nodeRequireTarget(join(root, "main.cjs"), "#query-separator"))
        .error_code,
    ).toBe("ERR_INVALID_MODULE_SPECIFIER");
    expect(
      resolveAlias(inventoried, "#query-separator", "main.cjs", "require"),
    ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
    const withQuery = await nodeImportTarget(root, "#query-separator");
    expect(posixRelative(root, fileURLToPath(withQuery.target ?? ""))).toBe(
      "first.cjs",
    );
    expect(
      resolveAlias(inventoried, "#query-separator", "main.cjs", "import"),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "first.cjs",
    });
    expect(
      resolveAlias(
        inventoried,
        "#missing",
        "main.cjs",
        "require",
      ).limitations.join(" "),
    ).toContain(JSON.stringify("./miss\ting.cjs"));
  });
});

describe("package import aliases compared with Node", () => {
  it("matches Node require and import for an exact root alias", async () => {
    const root = await createTestTempDirectory("rea-import-alias-root-");
    const files = {
      "package.json": JSON.stringify({
        name: "app",
        imports: { "#config": "./config.cjs" },
      }),
      "main.cjs": 'module.exports = require("#config");',
      "config.cjs": "module.exports = 'config.cjs';",
    };
    const contents = await writeTree(root, files);
    const inventoried = inventory(contents);
    const required = await nodeRequireTarget(join(root, "main.cjs"), "#config");
    expect(posixRelative(root, required.target ?? "")).toBe("config.cjs");
    expect(
      resolveAlias(inventoried, "#config", "main.cjs", "require"),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "config.cjs",
    });
    const imported = await nodeImportTarget(root, "#config");
    expect(imported.error_code).toBeNull();
    expect(
      resolveAlias(inventoried, "#config", "main.cjs", "import"),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "config.cjs",
    });
  });

  it("matches Node when a nested package has its own imports map", async () => {
    const root = await createTestTempDirectory("rea-import-alias-nested-");
    const files = {
      "package.json": JSON.stringify({
        name: "app",
        imports: { "#config": "./root.cjs" },
      }),
      "root.cjs": "module.exports = 'root';",
      "node_modules/fixture/package.json": JSON.stringify({
        name: "fixture",
        imports: { "#config": "./local.cjs" },
      }),
      "node_modules/fixture/index.cjs": 'module.exports = require("#config");',
      "node_modules/fixture/local.cjs": "module.exports = 'local';",
    };
    const contents = await writeTree(root, files);
    const inventoried = inventory(contents);
    const nested = await nodeRequireTarget(
      join(root, "node_modules/fixture/index.cjs"),
      "#config",
    );
    expect(posixRelative(root, nested.target ?? "")).toBe(
      "node_modules/fixture/local.cjs",
    );
    expect(
      resolveAlias(
        inventoried,
        "#config",
        "node_modules/fixture/index.cjs",
        "require",
      ),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "node_modules/fixture/local.cjs",
    });
    const fromRoot = await nodeRequireTarget(join(root, "root.cjs"), "#config");
    expect(posixRelative(root, fromRoot.target ?? "")).toBe("root.cjs");
    expect(
      resolveAlias(inventoried, "#config", "root.cjs", "require"),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "root.cjs",
    });
  });

  it("matches Node when a nested package does not define the alias", async () => {
    const root = await createTestTempDirectory("rea-import-alias-scope-");
    const files = {
      "package.json": JSON.stringify({
        name: "app",
        imports: { "#config": "./root.cjs" },
      }),
      "root.cjs": "module.exports = 'root';",
      "node_modules/fixture/package.json": JSON.stringify({
        name: "fixture",
      }),
      "node_modules/fixture/index.cjs": 'module.exports = require("#config");',
    };
    await writeTree(root, files);
    const nested = await nodeRequireTarget(
      join(root, "node_modules/fixture/index.cjs"),
      "#config",
    );
    expect(nested.target).toBeNull();
    // CJS reports MODULE_NOT_FOUND when the nested package.json has no
    // `imports` field at all; it still does not inherit the ancestor map.
    expect(nested.error_code).toBe("MODULE_NOT_FOUND");
    const outcome = resolveAlias(
      inventory(new Map(Object.entries(files))),
      "#config",
      "node_modules/fixture/index.cjs",
      "require",
    );
    expect(outcome).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
    expect(outcome.limitations.join(" ")).toContain(
      "node_modules/fixture/package.json",
    );
  });
});

describe("package import alias refusals compared with Node", () => {
  it("matches Node refusal for a missing key, explicit null, and reserved specifier", async () => {
    const root = await createTestTempDirectory("rea-import-alias-refuse-");
    const files = {
      "package.json": JSON.stringify({
        name: "app",
        imports: {
          "#config": "./config.cjs",
          "#blocked": null,
        },
      }),
      "main.cjs": "module.exports = 1;",
      "config.cjs": "module.exports = 1;",
    };
    await writeTree(root, files);
    const inventoried = inventory(new Map(Object.entries(files)));
    const missing = await nodeRequireTarget(join(root, "main.cjs"), "#missing");
    expect(missing.error_code).toBe("ERR_PACKAGE_IMPORT_NOT_DEFINED");
    expect(
      resolveAlias(inventoried, "#missing", "main.cjs", "require"),
    ).toMatchObject({ resolution_status: "external", resolved_path: null });
    const blocked = await nodeRequireTarget(join(root, "main.cjs"), "#blocked");
    expect(blocked.error_code).toBe("ERR_PACKAGE_IMPORT_NOT_DEFINED");
    expect(
      resolveAlias(inventoried, "#blocked", "main.cjs", "require"),
    ).toMatchObject({ resolution_status: "external", resolved_path: null });
    for (const specifier of ["#", "#/", "#config/"]) {
      const reserved = await nodeRequireTarget(
        join(root, "main.cjs"),
        specifier,
      );
      expect(reserved.error_code).toBe("ERR_INVALID_MODULE_SPECIFIER");
      expect((await nodeImportTarget(root, specifier)).error_code).toBe(
        "ERR_INVALID_MODULE_SPECIFIER",
      );
      for (const moduleKind of ["require", "import"] as const)
        expect(
          resolveAlias(inventoried, specifier, "main.cjs", moduleKind),
        ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
    }
  });

  it("matches Node when an import condition selects a different exact file", async () => {
    const root = await createTestTempDirectory("rea-import-alias-cond-");
    const files = {
      "package.json": JSON.stringify({
        name: "app",
        type: "module",
        imports: {
          "#config": {
            import: "./config.mjs",
            require: "./config.cjs",
          },
        },
      }),
      "main.cjs": 'module.exports = require("#config");',
      "config.cjs": "export default 'cjs'; module.exports = 'cjs';",
      "config.mjs": "export default 'mjs';",
    };
    await writeTree(root, files);
    const inventoried = inventory(new Map(Object.entries(files)));
    const required = await nodeRequireTarget(join(root, "main.cjs"), "#config");
    expect(posixRelative(root, required.target ?? "")).toBe("config.cjs");
    expect(
      resolveAlias(inventoried, "#config", "main.cjs", "require"),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "config.cjs",
    });
    const imported = await nodeImportTarget(root, "#config");
    expect(imported.error_code).toBeNull();
    expect(imported.target ?? "").toContain("config.mjs");
    expect(
      resolveAlias(inventoried, "#config", "main.cjs", "import"),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "config.mjs",
    });
  });
});
