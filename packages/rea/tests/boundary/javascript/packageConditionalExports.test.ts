import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ArtifactPathResolution } from "../../../src/application/javascript/JavaScriptArtifactPathResolution.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { resolveStandaloneArtifactPath } from "../../support/javascriptArtifactPathResolution.js";
const execute = promisify(execFile);
const TARGETS = [
  "default.cjs",
  "specific.cjs",
  "node.cjs",
  "require.cjs",
  "array.cjs",
  "nested.cjs",
];
const nodeExportOutcomeSchema = z.strictObject({
  target: z.string().nullable(),
  error_code: z.string().nullable(),
});

/** Resolve through the real Node resolver, retaining its refusal reason. */
const nodeTarget = async (
  cwd: string,
  moduleKind: "import" | "require",
  specifier: string,
) => {
  const expression =
    moduleKind === "import"
      ? `(await import(${JSON.stringify(specifier)})).default`
      : `createRequire(import.meta.url)(${JSON.stringify(specifier)})`;
  const { stdout } = await execute(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import { createRequire } from "node:module";
      try {
        console.log(JSON.stringify({target: ${expression}, error_code: null}));
      } catch (error) {
        console.log(JSON.stringify({target: null, error_code: error.code}));
      }
    `,
    ],
    { cwd },
  );
  return nodeExportOutcomeSchema.parse(JSON.parse(stdout));
};
/**
 * Install one real package on disk and mirror it into an artifact inventory,
 * so Node and REA observe the same container, then resolve through both.
 */
const compareWithNode = async (
  exportsMap: unknown,
  moduleKind: "import" | "require",
  present: readonly string[] = TARGETS,
  options: {
    readonly siblingFile?: boolean;
    readonly packageName?: string;
    readonly specifier?: string;
    readonly main?: string;
    readonly metadataText?: string;
    readonly metadataAbsent?: boolean;
    readonly sourceWithinPackage?: string;
    readonly packageFiles?: Readonly<Record<string, string>>;
  } = {},
): Promise<{
  readonly node: string | null;
  readonly node_error: string | null;
  readonly outcome: ArtifactPathResolution;
  readonly files: ReadonlyMap<string, JavaScriptArtifactFile>;
}> => {
  const root = await createTestTempDirectory("rea-exports-");
  const packageName = options.packageName ?? "example";
  const specifier = options.specifier ?? packageName;
  const sourcePath =
    options.sourceWithinPackage === undefined
      ? "main.js"
      : `node_modules/${packageName}/${options.sourceWithinPackage}`;
  const packageDirectory = join(root, "node_modules", packageName);
  await mkdir(packageDirectory, { recursive: true });
  const metadata =
    options.metadataText ??
    JSON.stringify({
      name: packageName,
      exports: exportsMap,
      main: options.main,
    });
  const contents = new Map<string, string>([[sourcePath, ""]]);
  if (!options.metadataAbsent) {
    await writeFile(join(packageDirectory, "package.json"), metadata);
    contents.set(`node_modules/${packageName}/package.json`, metadata);
  }
  if (options.siblingFile === true) {
    const filename = `${packageName}.js`;
    const source = `module.exports = ${JSON.stringify(filename)};`;
    await writeFile(join(root, "node_modules", filename), source);
    contents.set(`node_modules/${filename}`, source);
  }
  for (const target of present) {
    const source = `module.exports = ${JSON.stringify(target)};`;
    await writeFile(join(packageDirectory, target), source);
    contents.set(`node_modules/${packageName}/${target}`, source);
  }
  for (const [path, source] of Object.entries(options.packageFiles ?? {})) {
    const absolute = join(packageDirectory, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, source);
    contents.set(`node_modules/${packageName}/${path}`, source);
  }
  const files = new Map<string, JavaScriptArtifactFile>(
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
  const node = await nodeTarget(
    dirname(join(root, sourcePath)),
    moduleKind,
    specifier,
  );
  return {
    node: node.target,
    node_error: node.error_code,
    files,
    outcome: resolveStandaloneArtifactPath({
      declaredPath: specifier,
      sourcePath,
      context: "module-specifier",
      moduleKind,
      files,
    }),
  };
};
const resolvedLeaf = (outcome: ArtifactPathResolution): string | null =>
  outcome.resolved_path?.split("/").pop() ?? null;
/** Pin the real Node result, then require REA to select the same target. */
const expectNodeAgreement = async (
  exportsMap: unknown,
  expected: string | null,
  moduleKind: "import" | "require" = "import",
  present: readonly string[] = TARGETS,
): Promise<ArtifactPathResolution> => {
  const { node, outcome } = await compareWithNode(
    exportsMap,
    moduleKind,
    present,
  );
  expect(node).toBe(expected);
  expect(resolvedLeaf(outcome)).toBe(expected);
  return outcome;
};
describe("ordered package exports conditions", () => {
  it.each([
    { ".": "./default.cjs", import: "./specific.cjs" },
    { default: "./default.cjs", "./feature": "./specific.cjs" },
    { "0": "./specific.cjs", default: "./default.cjs" },
    { ".": { "1.5": "./specific.cjs", default: "./default.cjs" } },
    { node: [{ "4294967294": null }, "./array.cjs"], default: "./default.cjs" },
  ])(
    "rejects invalid exports configuration %j without fallback",
    async (exportsMap) => {
      for (const moduleKind of ["import", "require"] as const) {
        const { node, node_error, outcome } = await compareWithNode(
          exportsMap,
          moduleKind,
        );
        expect(node).toBeNull();
        expect(node_error).toBe("ERR_INVALID_PACKAGE_CONFIG");
        expect(outcome).toMatchObject({
          resolved_path: null,
          resolution_status: "rejected",
        });
        expect(outcome.limitations[0]).toContain("exports configuration");
      }
    },
  );

  it.each([
    { "01": "./specific.cjs", default: "./default.cjs" },
    { "4294967295": "./specific.cjs", default: "./default.cjs" },
    { browser: { "0": null }, default: "./default.cjs" },
    ["./default.cjs", { "0": null }],
    { ".": "./default.cjs", "./feature": "./specific.cjs" },
  ])("preserves valid or unvisited conditions in %j", async (exportsMap) => {
    for (const moduleKind of ["import", "require"] as const)
      await expectNodeAgreement(exportsMap, "default.cjs", moduleKind);
  });

  it.each(["import", "require"] as const)(
    "matches Node when default precedes %s",
    async (moduleKind) => {
      await expectNodeAgreement(
        { default: "./default.cjs", [moduleKind]: "./specific.cjs" },
        "default.cjs",
        moduleKind,
      );
    },
  );
  it.each(["import", "require"] as const)(
    "matches Node when %s precedes default",
    async (moduleKind) => {
      await expectNodeAgreement(
        { [moduleKind]: "./specific.cjs", default: "./default.cjs" },
        "specific.cjs",
        moduleKind,
      );
    },
  );
  it.each(["import", "require"] as const)(
    "matches Node when the node condition precedes %s",
    async (moduleKind) => {
      await expectNodeAgreement(
        { node: "./node.cjs", [moduleKind]: "./specific.cjs" },
        "node.cjs",
        moduleKind,
      );
    },
  );
  it.each(["import", "require"] as const)(
    "matches Node when %s precedes the node condition",
    async (moduleKind) => {
      await expectNodeAgreement(
        { [moduleKind]: "./specific.cjs", node: "./node.cjs" },
        "specific.cjs",
        moduleKind,
      );
    },
  );
  it.each(["import", "require"] as const)(
    "matches Node when node-addons precedes %s",
    async (moduleKind) => {
      await expectNodeAgreement(
        { "node-addons": "./node.cjs", [moduleKind]: "./specific.cjs" },
        "node.cjs",
        moduleKind,
      );
    },
  );
});

describe("package exports before sibling files", () => {
  it.each(["import", "require"] as const)(
    "selects the active %s export before a same-named sibling file",
    async (moduleKind) => {
      const { node, node_error, outcome } = await compareWithNode(
        { import: "./specific.cjs", require: "./require.cjs" },
        moduleKind,
        TARGETS,
        { siblingFile: true },
      );
      const target = moduleKind === "import" ? "specific.cjs" : "require.cjs";
      expect(node).toBe(target);
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: `node_modules/example/${target}`,
        resolution_status: "resolved",
      });
    },
  );

  it.each([
    [{ ".": null }, "ERR_PACKAGE_PATH_NOT_EXPORTED", "external"],
    ["./missing.cjs", "MODULE_NOT_FOUND", "not-found"],
    ["../outside.cjs", "ERR_INVALID_PACKAGE_TARGET", "rejected"],
  ] as const)(
    "preserves the refusal for %j despite a same-named sibling file",
    async (exportsMap, error, status) => {
      for (const moduleKind of ["import", "require"] as const) {
        const { node, node_error, outcome } = await compareWithNode(
          exportsMap,
          moduleKind,
          TARGETS,
          { siblingFile: true },
        );
        expect(node).toBeNull();
        expect(node_error).toBe(
          error === "MODULE_NOT_FOUND" && moduleKind === "import"
            ? "ERR_MODULE_NOT_FOUND"
            : error,
        );
        expect(outcome).toMatchObject({
          resolved_path: null,
          resolution_status: status,
        });
        expect(outcome.limitations).not.toHaveLength(0);
      }
    },
  );

  it.each([undefined, null])(
    "preserves CommonJS sibling-file priority when exports is %s",
    async (exportsMap) => {
      const { node, node_error, outcome } = await compareWithNode(
        exportsMap,
        "require",
        [...TARGETS, "index.js"],
        { siblingFile: true },
      );
      expect(node).toBe("example.js");
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: "node_modules/example.js",
        resolution_status: "resolved",
      });
    },
  );

  it("keeps an unmapped package container unknown despite a local sibling file", async () => {
    const {
      node,
      node_error,
      outcome: mapped,
      files,
    } = await compareWithNode("./default.cjs", "require", TARGETS, {
      siblingFile: true,
    });
    expect(node).toBe("default.cjs");
    expect(node_error).toBeNull();
    expect(mapped).toMatchObject({
      resolved_path: "node_modules/example/default.cjs",
      resolution_status: "resolved",
    });
    // The Node control has one runtime directory. A different inventoried
    // container without its loader mapping cannot prove the metadata absent.
    const outcome = resolveStandaloneArtifactPath({
      declaredPath: "example",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files: new Map(
        [...files].map(([path, file]) => [
          path,
          path.startsWith("node_modules/example/")
            ? { ...file, container_sha256: "c".repeat(64) }
            : file,
        ]),
      ),
    });
    expect(outcome).toMatchObject({
      resolved_path: null,
      resolution_status: "unavailable",
      limitations: [
        expect.stringContaining(
          "without an established runtime loader mapping",
        ),
      ],
    });
  });

  it.each([undefined, "main.js"])(
    "uses the real sibling when metadata is absent with package-local source %s",
    async (sourceWithinPackage) => {
      const { node, node_error, outcome } = await compareWithNode(
        "./default.cjs",
        "require",
        TARGETS,
        {
          siblingFile: true,
          metadataAbsent: true,
          ...(sourceWithinPackage === undefined ? {} : { sourceWithinPackage }),
        },
      );
      expect(node).toBe("example.js");
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: "node_modules/example.js",
        resolution_status: "resolved",
      });
    },
  );
});
describe("scalar package exports metadata", () => {
  it.each([false, true, 0, 42])(
    "preserves CommonJS sibling-file priority for root exports %s",
    async (exportsMap) => {
      const { node, node_error, outcome } = await compareWithNode(
        exportsMap,
        "require",
        TARGETS,
        { siblingFile: true, main: "./default.cjs" },
      );
      expect(node).toBe("example.js");
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: "node_modules/example.js",
        resolution_status: "resolved",
      });
    },
  );

  it.each(["import", "require"] as const)(
    "uses the legacy main for %s with numeric root exports and no sibling",
    async (moduleKind) => {
      const { node, node_error, outcome } = await compareWithNode(
        42,
        moduleKind,
        TARGETS,
        { main: "./default.cjs" },
      );
      expect(node).toBe("default.cjs");
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: "node_modules/example/default.cjs",
        resolution_status: "resolved",
      });
    },
  );

  it.each([false, 42])(
    "still rejects nested scalar target %s without a sibling fallback",
    async (target) => {
      const { node, node_error, outcome } = await compareWithNode(
        { ".": target },
        "require",
        TARGETS,
        { siblingFile: true },
      );
      expect(node).toBeNull();
      expect(node_error).toBe("ERR_INVALID_PACKAGE_TARGET");
      expect(outcome).toMatchObject({
        resolved_path: null,
        resolution_status: "rejected",
      });
    },
  );
});

describe("package self-reference", () => {
  it.each(["fi%xture", "@scope/fi%xture"])(
    "applies self exports before the CommonJS sibling for %s",
    async (packageName) => {
      const { node, node_error, outcome } = await compareWithNode(
        "./specific.cjs",
        "require",
        TARGETS,
        { packageName, sourceWithinPackage: "main.js", siblingFile: true },
      );
      expect(node).toBe("specific.cjs");
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: `node_modules/${packageName}/specific.cjs`,
        resolution_status: "resolved",
      });
    },
  );

  it("resolves an exported self subpath for a percent-named package", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      { "./part": "./specific.cjs" },
      "require",
      TARGETS,
      {
        packageName: "fi%xture",
        specifier: "fi%xture/part",
        sourceWithinPackage: "main.js",
      },
    );
    expect(node).toBe("specific.cjs");
    expect(node_error).toBeNull();
    expect(outcome).toMatchObject({
      resolved_path: "node_modules/fi%xture/specific.cjs",
      resolution_status: "resolved",
    });
  });

  it("does not fall back to main or a sibling when self exports block the root", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      { ".": null },
      "require",
      TARGETS,
      {
        packageName: "fi%xture",
        sourceWithinPackage: "main.js",
        siblingFile: true,
        main: "./default.cjs",
      },
    );
    expect(node).toBeNull();
    expect(node_error).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
    expect(outcome).toMatchObject({
      resolved_path: null,
      resolution_status: "external",
    });
  });

  it("falls through to dependency lookup when the self package has no exports", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      undefined,
      "require",
      TARGETS,
      { sourceWithinPackage: "main.js", siblingFile: true },
    );
    expect(node).toBe("example.js");
    expect(node_error).toBeNull();
    expect(outcome).toMatchObject({
      resolved_path: "node_modules/example.js",
      resolution_status: "resolved",
    });
  });

  it("selects self exports before a same-named nested dependency", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      "./specific.cjs",
      "require",
      TARGETS,
      {
        sourceWithinPackage: "main.js",
        packageFiles: {
          "node_modules/example/index.js": 'module.exports = "dependency.js";',
        },
      },
    );
    expect(node).toBe("specific.cjs");
    expect(node_error).toBeNull();
    expect(outcome).toMatchObject({
      resolved_path: "node_modules/example/specific.cjs",
      resolution_status: "resolved",
    });
  });
});

describe("package self-reference scope boundaries", () => {
  it.each([{ name: "other", exports: "./missing.cjs" }, { name: "example" }])(
    "stops self lookup at the nearest package metadata %j",
    async (metadata) => {
      const { node, node_error, outcome } = await compareWithNode(
        "./specific.cjs",
        "require",
        TARGETS,
        {
          sourceWithinPackage: "child/main.js",
          packageFiles: {
            "child/package.json": JSON.stringify(metadata),
            "child/node_modules/example/index.js":
              'module.exports = "dependency.js";',
          },
        },
      );
      expect(node).toBe("dependency.js");
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path:
          "node_modules/example/child/node_modules/example/index.js",
        resolution_status: "resolved",
      });
    },
  );

  it("stops self lookup at node_modules when the nearer package has no metadata", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      "./specific.cjs",
      "require",
      TARGETS,
      {
        sourceWithinPackage: "node_modules/dependency/main.js",
        packageFiles: {
          "node_modules/dependency/node_modules/example/index.js":
            'module.exports = "dependency.js";',
        },
      },
    );
    expect(node).toBe("dependency.js");
    expect(node_error).toBeNull();
    expect(outcome).toMatchObject({
      resolved_path:
        "node_modules/example/node_modules/dependency/node_modules/example/index.js",
      resolution_status: "resolved",
    });
  });

  it("reports malformed nearest metadata without resolving an ancestor self export", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      "./specific.cjs",
      "require",
      TARGETS,
      {
        sourceWithinPackage: "child/main.js",
        packageFiles: { "child/package.json": "{" },
      },
    );
    expect(node).toBeNull();
    expect(node_error).toBe("ERR_INVALID_PACKAGE_CONFIG");
    expect(outcome).toMatchObject({
      resolved_path: null,
      resolution_status: "unavailable",
    });
  });

  it("keeps unmapped self metadata unknown rather than selecting a sibling", async () => {
    const {
      node,
      node_error,
      outcome: mapped,
      files,
    } = await compareWithNode("./specific.cjs", "require", TARGETS, {
      sourceWithinPackage: "main.js",
      siblingFile: true,
    });
    expect(node).toBe("specific.cjs");
    expect(node_error).toBeNull();
    expect(mapped).toMatchObject({
      resolved_path: "node_modules/example/specific.cjs",
      resolution_status: "resolved",
    });
    const outcome = resolveStandaloneArtifactPath({
      declaredPath: "example",
      sourcePath: "node_modules/example/main.js",
      context: "module-specifier",
      moduleKind: "require",
      files: new Map(
        [...files].map(([path, file]) => [
          path,
          path === "node_modules/example/package.json"
            ? { ...file, container_sha256: "c".repeat(64) }
            : file,
        ]),
      ),
    });
    expect(outcome).toMatchObject({
      resolved_path: null,
      resolution_status: "unavailable",
      limitations: [
        expect.stringContaining(
          "without an established runtime loader mapping",
        ),
      ],
    });
  });
});

describe("package exports name eligibility", () => {
  it.each([
    ["fi%xture", "./specific.cjs"],
    ["@scope/fi%xture", { ".": null }],
    ["@sc%ope/fixture", "./specific.cjs"],
  ] as const)(
    "uses the literal sibling file for %s without applying exports",
    async (packageName, exportsMap) => {
      const { node, node_error, outcome } = await compareWithNode(
        exportsMap,
        "require",
        TARGETS,
        { packageName, siblingFile: true },
      );
      expect(node).toBe(`${packageName}.js`);
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: `node_modules/${packageName}.js`,
        resolution_status: "resolved",
      });
    },
  );

  it.each([
    { packageName: "fi%xture" },
    { packageName: "@scope/fi%xture" },
    { packageName: "@sc%ope/fixture", metadataText: "{" },
  ])(
    "rejects the ESM package name $packageName before metadata or sibling lookup",
    async (options) => {
      const { node, node_error, outcome } = await compareWithNode(
        "./specific.cjs",
        "import",
        TARGETS,
        { ...options, siblingFile: true },
      );
      expect(node).toBeNull();
      expect(node_error).toBe("ERR_INVALID_MODULE_SPECIFIER");
      expect(outcome).toMatchObject({
        resolved_path: null,
        resolution_status: "rejected",
      });
    },
  );

  it("uses the legacy main of a percent-named package without a sibling file", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      "./specific.cjs",
      "require",
      TARGETS,
      { packageName: "fi%xture", main: "./default.cjs" },
    );
    expect(node).toBe("default.cjs");
    expect(node_error).toBeNull();
    expect(outcome).toMatchObject({
      resolved_path: "node_modules/fi%xture/default.cjs",
      resolution_status: "resolved",
    });
  });

  it.each([
    ["require", "example"],
    ["import", "example"],
    ["import", "@scope/example"],
  ] as const)(
    "still applies exports to %s percent subpaths of %s",
    async (moduleKind, packageName) => {
      const { node, node_error, outcome } = await compareWithNode(
        { "./fi%xture": "./specific.cjs" },
        moduleKind,
        TARGETS,
        { packageName, specifier: `${packageName}/fi%xture` },
      );
      expect(node).toBe("specific.cjs");
      expect(node_error).toBeNull();
      expect(outcome).toMatchObject({
        resolved_path: `node_modules/${packageName}/specific.cjs`,
        resolution_status: "resolved",
      });
    },
  );

  it("resolves a percent-package subpath despite malformed parent metadata", async () => {
    const { node, node_error, outcome } = await compareWithNode(
      undefined,
      "require",
      TARGETS,
      {
        packageName: "fi%xture",
        specifier: "fi%xture/specific.cjs",
        metadataText: "{",
      },
    );
    expect(node).toBe("specific.cjs");
    expect(node_error).toBeNull();
    expect(outcome).toMatchObject({
      resolved_path: "node_modules/fi%xture/specific.cjs",
      resolution_status: "resolved",
    });
  });
});

describe("nested and array package export targets", () => {
  it.each([
    [
      { import: { node: "./nested.cjs", default: "./default.cjs" } },
      "nested.cjs",
    ],
    [{ import: { default: "./default.cjs" } }, "default.cjs"],
    [
      { import: { browser: "./specific.cjs" }, default: "./default.cjs" },
      "default.cjs",
    ],
    [{ import: [42, "./array.cjs"] }, "array.cjs"],
    [{ import: ["./specific.cjs", 42] }, "specific.cjs"],
    [{ import: ["../outside.cjs", "./array.cjs"] }, "array.cjs"],
    [{ import: { node: { default: "./default.cjs" } } }, "default.cjs"],
    [{ import: [{ node: "./nested.cjs" }, "./array.cjs"] }, "nested.cjs"],
    [{ import: [{ browser: "./x.cjs" }, "./array.cjs"] }, "array.cjs"],
    [{ import: [null, "./array.cjs"] }, "array.cjs"],
    [{ import: ["./specific.cjs", "./array.cjs"] }, "specific.cjs"],
  ] as const)(
    "selects the same target as Node for %j",
    async (exportsMap, expected) => {
      await expectNodeAgreement(exportsMap, expected);
    },
  );
  it.each([
    [{ import: { browser: "./x.cjs" } }, "external"],
    [{ import: { node: null, default: "./default.cjs" } }, "external"],
    [{ import: [] }, "external"],
  ] as const)(
    "refuses %j with %s exactly as Node refuses it",
    async (exportsMap, status) => {
      const outcome = await expectNodeAgreement(exportsMap, null);
      expect(outcome.resolution_status).toBe(status);
    },
  );
  it.each([
    [{ import: ["./absent.cjs", "./array.cjs"] }],
    [{ import: [["./absent.cjs"], "./array.cjs"] }],
  ] as const)(
    "reports %j as absent rather than falling through to a later entry",
    async (exportsMap) => {
      const outcome = await expectNodeAgreement(exportsMap, null);
      expect(outcome.resolution_status).toBe("not-found");
    },
  );
});
describe("package export target URL normalization compared with Node", () => {
  it.each([
    [["./.\t./outside.cjs", "./array.cjs"]],
    [["./.%\n2e/outside.cjs", "./array.cjs"]],
    [["./.\r./outside.cjs", "./array.cjs"]],
    ["./arr\tay.cjs"],
    ["./array.cjs \t"],
    ["./array.cjs?selected=one#fragment"],
    ["./.\t./example/array.cjs"],
  ] as const)(
    "resolves normalized target %j through both loaders",
    async (target) => {
      for (const moduleKind of ["import", "require"] as const) {
        const { node, outcome } = await compareWithNode(target, moduleKind);
        expect(node).toBe("array.cjs");
        expect(outcome).toMatchObject({
          resolution_status: "resolved",
          resolved_path: "node_modules/example/array.cjs",
        });
      }
    },
  );

  it.each([
    [["./arr%2fay.cjs", "./array.cjs"], "rejected"],
    [["./miss\ting.cjs", "./array.cjs"], "not-found"],
  ] as const)(
    "retains the first selected target failure in %j",
    async (target, status) => {
      for (const moduleKind of ["import", "require"] as const) {
        const { node, node_error, outcome } = await compareWithNode(
          target,
          moduleKind,
        );
        expect(node).toBeNull();
        expect(node_error).not.toBeNull();
        expect(outcome).toMatchObject({
          resolution_status: status,
          resolved_path: null,
        });
      }
    },
  );
});

describe("unmatched package export conditions", () => {
  it.each([
    [[{ browser: "./default.cjs" }], "browser"],
    [
      [[{ browser: "./default.cjs" }, { "rea-inactive": "./node.cjs" }]],
      "browser, rea-inactive",
    ],
    [{ node: [{ browser: "./default.cjs" }] }, "node, browser"],
  ] as const)(
    "preserves condition names in unmatched target %j",
    async (target, declared) => {
      for (const moduleKind of ["import", "require"] as const) {
        const { node_error, outcome } = await compareWithNode(
          target,
          moduleKind,
        );
        expect(node_error).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
        expect(outcome).toMatchObject({
          resolution_status: "external",
          resolved_path: null,
        });
        expect(outcome.limitations[0]).toContain(`It declares ${declared}.`);
      }
    },
  );
  it.each(["import", "require"] as const)(
    "names the declared conditions for %s",
    async (moduleKind) => {
      const { node, outcome } = await compareWithNode(
        { browser: "./default.cjs" },
        moduleKind,
      );
      expect(node).toBeNull();
      expect(outcome).toMatchObject({
        resolution_status: "external",
        resolved_path: null,
      });
      expect(outcome.limitations[0]).toContain("declares browser");
    },
  );
  it("does not report valid metadata as malformed", async () => {
    const { node_error, outcome } = await compareWithNode(
      { default: 7 },
      "import",
    );
    expect(node_error).toBe("ERR_INVALID_PACKAGE_TARGET");
    expect(outcome.resolution_status).toBe("rejected");
    expect(outcome.limitations[0]).toContain("exports target 7");
    expect(outcome.limitations[0]).not.toContain("not valid package JSON");
  });
});

describe("blocked package export provenance", () => {
  it.each([
    [[], "an empty exports target array"],
    [{ node: [] }, "an empty exports target array"],
    [[null, []], "an empty exports target array"],
    [[[], null], "an explicit null exports target"],
  ] as const)(
    "preserves the blocking source value in %j",
    async (target, limitation) => {
      for (const moduleKind of ["import", "require"] as const) {
        const { node_error, outcome } = await compareWithNode(
          target,
          moduleKind,
        );
        expect(node_error).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
        expect(outcome).toMatchObject({
          resolution_status: "external",
          resolved_path: null,
        });
        expect(outcome.limitations[0]).toContain(limitation);
      }
    },
  );
});

describe("package exports fallback refusal reasons", () => {
  it.each([
    [{ import: [42, 7] }, "ERR_INVALID_PACKAGE_TARGET", "rejected"],
    [{ import: [null, null] }, "ERR_PACKAGE_PATH_NOT_EXPORTED", "external"],
    [{ import: [42, null] }, "ERR_PACKAGE_PATH_NOT_EXPORTED", "external"],
    [{ import: [null, 42] }, "ERR_INVALID_PACKAGE_TARGET", "rejected"],
    [
      { import: { node: null }, default: "./default.cjs" },
      "ERR_PACKAGE_PATH_NOT_EXPORTED",
      "external",
    ],
  ] as const)(
    "matches Node refusal for %j",
    async (exportsMap, code, status) => {
      const { node, node_error, outcome } = await compareWithNode(
        exportsMap,
        "import",
      );
      expect(node).toBeNull();
      expect(node_error).toBe(code);
      expect(outcome.resolved_path).toBeNull();
      expect(outcome.resolution_status).toBe(status);
      if (code === "ERR_INVALID_PACKAGE_TARGET") {
        expect(outcome.limitations[0]).toContain("exports target");
        expect(outcome.limitations[0]).not.toContain("not valid package JSON");
      }
    },
  );
});
