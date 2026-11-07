import { createHash } from "node:crypto";
import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import * as processOutput from "../../process/ExecFileOutput.js";
import { encodeNibArchiveFixture } from "./NibArchive.fixture.js";
import type { analyzeInterfaceBuilderBundle } from "./InterfaceBuilderAnalysis.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  analyzeAppleAssetCatalogs,
  collectInterfaceBuilderResourceKeys,
} from "./AppleAssetCatalogAnalysis.js";

describe("Apple asset catalog traversal coverage", () => {
  it.for([false, true])(
    "retains catalog traversal coverage with invalid-byte entries: %s",
    async (invalidName, context) => {
      if (invalidName && process.platform !== "linux") context.skip();
      const bundle = await createTestTempDirectory("rea-asset-traversal-");
      if (invalidName)
        await writeFile(
          Buffer.concat([Buffer.from(`${bundle}/`), Buffer.from([0xff])]),
          "unrepresented",
        );
      const result = await analyzeAppleAssetCatalogs({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
        environment: {},
        runAssetUtil: async () => {
          throw new Error("no catalog was admitted");
        },
      });
      expect(result.inventory_coverage).toEqual({
        scope: "container-entries",
        status: invalidName ? "unknown" : "complete",
      });
      if (invalidName)
        expect(result.limitations).toContainEqual(
          expect.stringContaining("not valid UTF-8"),
        );
    },
  );

  it("keeps represented symlinks distinct from catalog-target inspection", async () => {
    const bundle = await createTestTempDirectory("rea-asset-subtree-");
    await symlink("unexamined", join(bundle, "Resources"));
    const result = await analyzeAppleAssetCatalogs({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      environment: {},
      runAssetUtil: async () => "[]",
    });
    expect(result.inventory_coverage.status).toBe("complete");
    expect(result.catalog_coverage).toMatchObject({ status: "unknown" });
    expect(result.resource_key_coverage).toMatchObject({ status: "unknown" });
    expect(result.limitations).toContainEqual(
      expect.stringContaining("catalogs beneath them may remain uninspected"),
    );
  });
});

describe("Apple asset catalog application workflow", () => {
  it("joins only explicit resource-key fields with archive provenance", () => {
    expect(
      collectInterfaceBuilderResourceKeys([
        {
          id: "ib:Main.nib:object:2",
          kind: "resource",
          name: "Decorative image",
          attributes: {
            imageName: "Toolbar",
            title: "not-an-asset-key",
            image: 42,
            nibValues: {
              title: "not-an-asset-key",
              imageName: { value: "not-a-scalar" },
              image: 42,
              assetName: "",
              nested: { NSImageName: "not-a-direct-field" },
            },
          },
          evidence: [
            {
              artifact_path: "Contents/Resources/Main.nib",
              artifact_sha256: "d".repeat(64),
            },
          ],
        },
        {
          id: "ib:Main.nib:object:3",
          kind: "control",
          name: "Toolbar",
          attributes: { NSImageName: "Toolbar", imageName: "Toolbar" },
          evidence: [
            {
              artifact_path: "Contents/Resources/Main.nib",
              artifact_sha256: "d".repeat(64),
            },
          ],
        },
      ]),
    ).toEqual([
      {
        sourceNodeId: "ib:Main.nib:object:2",
        sourcePath: "Contents/Resources/Main.nib",
        sourceArchiveSha256: "d".repeat(64),
        field: "imageName",
        key: "Toolbar",
      },
    ]);
  });

  it.each([0, 1, 5])(
    "reports an app without compiled catalogs as empty at offset %i",
    async (offset) => {
      const bundle = await createTestTempDirectory("rea-asset-catalog-absent-");
      await mkdir(join(bundle, "Contents", "Resources"), { recursive: true });
      await writeFile(join(bundle, "Contents", "Resources", "icon.icns"), "");
      // Names that merely end in Assets.car are ordinary resources.
      await mkdir(join(bundle, "Contents", "Resources", "NotAssets.car"));
      await writeFile(
        join(bundle, "Contents", "Resources", "OldAssets.car"),
        "",
      );
      const result = await analyzeAppleAssetCatalogs({
        environment: {},
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
        page: { offset },
        runAssetUtil: () => {
          throw new Error("assetutil must not run without a catalog");
        },
      });
      expect(result).toMatchObject({
        catalogs: [],
        total_records: 0,
        offset,
        limit: 1_000,
        records: [],
        resource_key_matches: [],
        next_offset: null,
        truncated: false,
      });
      expect(result.limitations).toContain(
        "No compiled Assets.car catalog was found among the app bundle's regular files (symlinks are not followed); any resource keys are reported as unmatched.",
      );
    },
  );

  it("does not report absence when the only catalog entry is a symlink", async () => {
    const bundle = await createTestTempDirectory("rea-asset-catalog-link-");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(join(bundle, "outside.car"), "catalog");
    await symlink("../../outside.car", join(resources, "Assets.car"));
    const rejected = await analyzeAppleAssetCatalogs({
      environment: {},
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      runAssetUtil: () => Promise.resolve("[]"),
    }).catch((cause: unknown) => cause);
    expect(rejected).toBeInstanceOf(ArtifactReaderFailure);
    expect(rejected).toMatchObject({
      reason: "path",
      message: expect.stringContaining(
        "Contents/Resources/Assets.car (symlink)",
      ),
    });
  });

  it("discloses skipped catalog entries beside inspected catalogs", async () => {
    const bundle = await createTestTempDirectory("rea-asset-catalog-mixed-");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(join(resources, "Nested"), { recursive: true });
    await writeFile(join(resources, "Assets.car"), "catalog");
    await symlink("../Assets.car", join(resources, "Nested", "Assets.car"));
    const result = await analyzeAppleAssetCatalogs({
      environment: {},
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      runAssetUtil: () => Promise.resolve("[]"),
    });
    expect(result.catalogs.map(({ path }) => path)).toEqual([
      "Contents/Resources/Assets.car",
    ]);
    expect(result.catalog_coverage).toEqual({
      status: "partial",
      reason: "catalog_entries_uninspected",
    });
    expect(result.resource_key_coverage.status).toBe("partial");
    expect(result.limitations).toContainEqual(
      expect.stringContaining("Contents/Resources/Nested/Assets.car (symlink)"),
    );
    expect(result.limitations).not.toContainEqual(
      expect.stringContaining("No compiled Assets.car catalog"),
    );
  });
});

it.skipIf(process.platform === "win32")(
  "qualifies UI resource joins when a symlinked nib was not decoded",
  async () => {
    const bundle = await createTestTempDirectory("rea-asset-ui-symlink-");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(resources, "Panel.data"),
      encodeNibArchiveFixture({
        classes: ["NSView"],
        objects: [{ classIndex: 0, values: { title: "Panel" } }],
      }),
    );
    await symlink("Panel.data", join(resources, "Panel.nib"));
    const result = await analyzeAppleAssetCatalogs({
      bundlePath: bundle,
      environment: {},
      targetSha256: "a".repeat(64),
      runAssetUtil: () => {
        throw new Error("No catalog is present");
      },
    });
    expect(result.limitations).toContain(
      "Interface Builder resource-key joins may be incomplete because the decoded object inventory is incomplete.",
    );
  },
);

it.each([0, 1, 5])(
  "keeps an empty assetutil inventory complete at offset %i",
  async (offset) => {
    const bundle = await createTestTempDirectory("rea-asset-catalog-empty-");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "Assets.car"), "inert catalog fixture");
    const result = await analyzeAppleAssetCatalogs({
      environment: {},
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      page: { offset, limit: 2 },
      runAssetUtil: () => Promise.resolve("[]"),
    });
    expect(result).toMatchObject({
      total_records: 0,
      offset,
      limit: 2,
      records: [],
      next_offset: null,
      truncated: false,
    });
  },
);

it.each([1, 2])(
  "joins NIBArchive keys against %i supplied assetutil renditions",
  async (count) => {
    const bundle = await createTestTempDirectory("rea-asset-nib-join-");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    const archive = encodeNibArchiveFixture({
      classes: ["NSIBObjectData", "NSImageView", "NSImage", "NSString"],
      objects: [
        { classIndex: 0, values: { NSRoot: { ref: 1 } } },
        { classIndex: 1, values: { image: { ref: 2 } } },
        { classIndex: 2, values: { NSImageName: { ref: 3 } } },
        { classIndex: 3, values: { "NS.bytes": "Toolbar" } },
      ],
    });
    await writeFile(join(resources, "Panel.nib"), archive);
    await writeFile(join(resources, "Assets.car"), "inert catalog fixture");
    // Supplied metadata tests the post-engine join; it does not establish native catalog validity.
    const result = await analyzeAppleAssetCatalogs({
      environment: {},
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      runAssetUtil: () =>
        Promise.resolve(
          JSON.stringify(
            Array.from({ length: count }, (_, index) => ({
              Name: "Toolbar",
              RenditionName: `toolbar-${String(index)}.png`,
            })),
          ),
        ),
    });
    expect(result.resource_key_matches).toHaveLength(1);
    expect(result.resource_key_matches[0]).toMatchObject({
      field: "NSImageName",
      key: "Toolbar",
      status: count === 1 ? "matched" : "ambiguous",
      source_path: "Contents/Resources/Panel.nib",
      source_archive_sha256: createHash("sha256").update(archive).digest("hex"),
      renditions: Array.from({ length: count }, (_, index) =>
        expect.objectContaining({
          record_index: index,
          rendition_name: `toolbar-${String(index)}.png`,
        }),
      ),
    });
  },
);

it("keeps recognized image fields on NIBArchive controls out of resource joins", async () => {
  const bundle = await createTestTempDirectory("rea-asset-nib-control-");
  const resources = join(bundle, "Contents", "Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(
    join(resources, "Panel.nib"),
    encodeNibArchiveFixture({
      classes: ["NSIBObjectData", "NSButton", "NSString"],
      objects: [
        { classIndex: 0, values: { NSRoot: { ref: 1 } } },
        { classIndex: 1, values: { NSImageName: { ref: 2 } } },
        { classIndex: 2, values: { "NS.bytes": "Toolbar" } },
      ],
    }),
  );
  await writeFile(join(resources, "Assets.car"), "inert catalog fixture");
  const result = await analyzeAppleAssetCatalogs({
    environment: {},
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
    runAssetUtil: () => Promise.resolve(JSON.stringify([{ Name: "Toolbar" }])),
  });
  expect(result.resource_key_matches).toEqual([]);
});

describe("Apple asset catalog and Interface Builder concurrency", () => {
  const catalogBundle = async () => {
    const bundle = await createTestTempDirectory("rea-asset-catalog-ib-");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "Assets.car"), "catalog");
    return bundle;
  };
  const emptyGraph = {
    graph: { nodes: [], truncated: false, coverage: [] },
  } as unknown as Awaited<ReturnType<typeof analyzeInterfaceBuilderBundle>>;

  it("keeps the Interface Builder analysis running while catalogs are inspected", async () => {
    // The Interface Builder analysis can finish only after catalog inspection
    // starts, so a sequential implementation would never complete.
    let catalogStarted!: () => void;
    const catalogStart = new Promise<void>((resolve) => {
      catalogStarted = resolve;
    });
    const result = await analyzeAppleAssetCatalogs({
      environment: {},
      bundlePath: await catalogBundle(),
      targetSha256: "a".repeat(64),
      analyzeInterfaceBuilder: async () => {
        await catalogStart;
        return emptyGraph;
      },
      runAssetUtil: async () => {
        catalogStarted();
        return "[]";
      },
    });
    expect(result.catalogs).toHaveLength(1);
  }, 5_000);

  it("cancels the Interface Builder analysis and reports a catalog failure", async () => {
    let cancelled = false;
    let settled = false;
    const rejected = await analyzeAppleAssetCatalogs({
      environment: {},
      bundlePath: await catalogBundle(),
      targetSha256: "a".repeat(64),
      analyzeInterfaceBuilder: ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            cancelled = true;
            setImmediate(() => {
              settled = true;
              reject(new Error("interface builder cancelled"));
            });
          });
        }),
      runAssetUtil: () => Promise.reject(new Error("assetutil failed")),
    }).catch((cause: unknown) => cause);
    expect(rejected).toMatchObject({ message: "assetutil failed" });
    expect(cancelled).toBe(true);
    expect(settled).toBe(true);
  });

  it("reports an early Interface Builder failure only after catalogs are inspected", async () => {
    let finishCatalog!: (output: string) => void;
    let catalogStarted = false;
    let settled = false;
    const analysis = analyzeAppleAssetCatalogs({
      environment: {},
      bundlePath: await catalogBundle(),
      targetSha256: "a".repeat(64),
      analyzeInterfaceBuilder: () =>
        Promise.reject(new Error("interface builder failed")),
      runAssetUtil: () => {
        catalogStarted = true;
        return new Promise((resolve) => {
          finishCatalog = resolve;
        });
      },
    }).finally(() => {
      settled = true;
    });
    analysis.catch(() => undefined);
    await vi.waitFor(() => expect(catalogStarted).toBe(true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    finishCatalog("[]");
    await expect(analysis).rejects.toThrow("interface builder failed");
  });

  it.skipIf(process.platform === "win32")(
    "settles a cancelled assetutil run only after its process exits",
    async () => {
      const bundle = await catalogBundle();
      const work = await createTestTempDirectory("rea-assetutil-stop-");
      const ready = join(work, "ready");
      const exited = join(work, "exited");
      const script = `const fs=require("node:fs");process.on("SIGTERM",()=>{setTimeout(()=>{fs.writeFileSync(process.argv[2],"exited");process.exit(0)},500)});fs.writeFileSync(process.argv[1],"ready");setInterval(()=>{},1000);`;
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      const realExecFileOutput = processOutput.execFileOutput;
      Object.defineProperty(process, "platform", {
        ...platform,
        value: "darwin",
      });
      const spy = vi
        .spyOn(processOutput, "execFileOutput")
        .mockImplementation((_command, _args, options) =>
          realExecFileOutput(
            process.execPath,
            ["-e", script, ready, exited],
            options,
          ),
        );
      const controller = new AbortController();
      let settled: Promise<unknown> | undefined;
      try {
        settled = analyzeAppleAssetCatalogs({
          environment: {},
          bundlePath: bundle,
          targetSha256: "a".repeat(64),
          signal: controller.signal,
          analyzeInterfaceBuilder: async () => emptyGraph,
        }).catch((cause: unknown) => cause);
        await vi.waitFor(() => expect(access(ready)).resolves.toBeUndefined());
        controller.abort("stop asset inspection");
        expect(await settled).toMatchObject({ reason: "cancelled" });
        await expect(access(exited)).resolves.toBeUndefined();
      } finally {
        controller.abort("stop asset inspection");
        await settled;
        spy.mockRestore();
        Object.defineProperty(process, "platform", platform);
      }
    },
  );
});

it.each(["not json", "{}", "[null]"])(
  "preserves successful assetutil output failures for %s",
  async (output) => {
    const bundle = await createTestTempDirectory("rea-asset-output-");
    await writeFile(join(bundle, "Assets.car"), "inert catalog");
    await expect(
      analyzeAppleAssetCatalogs({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
        environment: {},
        runAssetUtil: async () => output,
      }),
    ).rejects.toMatchObject({
      _tag: "AnalysisOutputError",
      reason: expect.stringContaining("Assets.car"),
      diagnostics: { catalog_path: "Assets.car" },
      capturedOutput: { stdout: output, exit_code: 0 },
    });
  },
);
it.each([
  ["ETIMEDOUT", "AnalysisTimeoutError"],
  ["ENOENT", "AnalysisCapabilityUnavailableError"],
  ["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "AnalysisResourceConstraintError"],
  [1, "AnalysisOutputError"],
] as const)(
  "preserves assetutil command failure %s and diagnostics",
  async (code, tag) => {
    const bundle = await createTestTempDirectory("rea-asset-command-");
    await writeFile(join(bundle, "Assets.car"), "inert catalog");
    const cause = Object.assign(new Error("native refusal"), {
      code,
      stdout: "",
      stderr: "specific catalog diagnostic",
      signal: code === "ETIMEDOUT" ? "SIGTERM" : null,
    });
    await expect(
      analyzeAppleAssetCatalogs({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
        environment: {},
        runAssetUtil: async () => {
          throw cause;
        },
      }),
    ).rejects.toMatchObject({
      _tag: tag,
      cause,
      diagnostics: { catalog_path: "Assets.car" },
      capturedOutput: { stderr: "specific catalog diagnostic" },
      ...(code === "ETIMEDOUT" ? { timeoutMs: 60000 } : {}),
    });
  },
);

it.each(["reported carutil", "tab-indented carutil", "observed assetutil"])(
  "attributes %s rejection of a readable nested catalog as invalid bytes",
  async (variant) => {
    const bundle = await createTestTempDirectory("rea-asset-rejected-");
    const relativePath =
      "Contents/Resources/Widget bundle/Contents/Resources/Assets.car";
    const path = join(bundle, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      join(bundle, "Contents/Resources/Assets.car"),
      "valid control",
    );
    await writeFile(path, "truncated catalog");
    // The carutil variant is reported in #5698. The assetutil variant was
    // observed with 400 zero bytes and a 400-byte truncation of Calculator's
    // catalog. This test injects those diagnoses, without running Apple tools.
    const stderr =
      "BOMStreamWithFileAndSys: read: Operation not permitted\n" +
      (variant !== "observed assetutil"
        ? `assetutil Error: Unable to read file at '${path}'\n` +
          `carutil: error:\n${variant === "tab-indented carutil" ? "\t" : "    "}${path} is not a valid AssetCatalog\n`
        : `assetutil: file error error exiting: 'can't read from: '${path}' Undefined error: 0' invalid file\n`);
    const cause = Object.assign(new Error("assetutil exited 1"), {
      code: 1,
      stdout: "partial metadata",
      stderr,
      signal: null,
    });
    const error = await analyzeAppleAssetCatalogs({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      environment: {},
      runAssetUtil: async (selectedPath) => {
        if (selectedPath === path) throw cause;
        return "[]";
      },
    }).catch((failure: unknown) => failure);
    if (!(error instanceof AnalysisError)) throw error;
    expect(error.cause).toBe(cause);
    expect(projectAnalysisError(error)).toMatchObject({
      code: "artifact_operation_failed",
      message:
        "Artifact is invalid or has changed. Get a fresh copy and try again.",
      details: {
        operation: "inspect_asset_catalog",
        reason: "format",
        detail: expect.stringContaining(relativePath),
        diagnostics: { catalog_path: relativePath },
        captured_output: {
          stdout: "partial metadata",
          stderr,
          exit_code: 1,
          signal: null,
          truncated: false,
        },
      },
    });
  },
);

it.each([
  "unrecognized text",
  "another catalog",
  "tab-indented another catalog",
  "signal",
  "truncated capture",
  "failed capture",
  "different file-error code",
  "different file-error text",
])("keeps the catalog rejection unknown for %s", async (scenario) => {
  const bundle = await createTestTempDirectory("rea-asset-unknown-rejection-");
  const path = join(bundle, "Assets.car");
  await writeFile(path, "readable catalog");
  const rejectedPath = scenario.includes("another catalog")
    ? `${path}.other`
    : path;
  const stderr =
    scenario === "unrecognized text"
      ? "Operation not permitted; catalog may be invalid"
      : scenario.startsWith("different file-error")
        ? `assetutil: file error error exiting: 'can't read from: '${path}' Undefined error: ${scenario === "different file-error code" ? "13" : "0"}' ${scenario === "different file-error text" ? "access denied" : "invalid file"}\n`
        : `carutil: error:\n${scenario.startsWith("tab-indented") ? "\t" : "    "}${rejectedPath} is not a valid AssetCatalog\n`;
  const cause = Object.assign(new Error("assetutil failed"), {
    code: 1,
    stdout: "",
    stderr,
    signal: scenario === "signal" ? "SIGTERM" : null,
    outputTruncated: scenario === "truncated capture",
    collectionFailure: scenario === "failed capture",
  });
  await expect(
    analyzeAppleAssetCatalogs({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      environment: {},
      runAssetUtil: async () => {
        throw cause;
      },
    }),
  ).rejects.toMatchObject({
    _tag: "AnalysisOutputError",
    reason: expect.stringContaining("Assets.car"),
    cause,
    diagnostics: { catalog_path: "Assets.car" },
    capturedOutput: { stderr },
  });
});

it.each(["Toolbar", "MissingToolbar"])(
  "retains AppKit NSCustomResource image key %s with its archive identity",
  async (name) => {
    const bundle = await createTestTempDirectory("rea-asset-custom-resource-");
    await writeFile(
      join(bundle, "Panel.nib"),
      encodeNibArchiveFixture({
        classes: ["NSIBObjectData", "NSCustomResource", "NSString"],
        objects: [
          { classIndex: 0, values: { NSRoot: { ref: 1 } } },
          {
            classIndex: 1,
            values: { NSClassName: { ref: 2 }, NSResourceName: { ref: 3 } },
          },
          { classIndex: 2, values: { "NS.bytes": "NSImage" } },
          { classIndex: 2, values: { "NS.bytes": name } },
        ],
      }),
    );
    await writeFile(join(bundle, "Assets.car"), "inert catalog");
    const result = await analyzeAppleAssetCatalogs({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      environment: {},
      runAssetUtil: async () => JSON.stringify([{ Name: "Toolbar" }]),
    });
    expect(result.resource_key_matches).toMatchObject([
      {
        field: "NSResourceName",
        key: name,
        source_path: "Panel.nib",
        status: name === "Toolbar" ? "matched" : "unmatched",
      },
    ]);
    expect(result.resource_key_coverage.status).toBe("complete");
  },
);

it("preserves every own JSON metadata field through catalog inspection and page projection", async () => {
  const bundle = await createTestTempDirectory("rea-asset-metadata-members-");
  const catalog = Buffer.from("inert catalog for the output-decoding boundary");
  await writeFile(join(bundle, "Assets.car"), catalog);
  // Authored producer text exercises the accepted metadata contract; it is not
  // evidence that native assetutil emits these additional field names.
  const output =
    '[{"Name":"Toolbar","RenditionName":"Toolbar@2x","__proto__":{"Name":"metadata, not an inherited asset name"},"constructor":"retained constructor metadata","toString":false,"Unknown":{"__proto__":{"value":0}},"Empty":"","Zero":0,"Absent":null}]';
  const result = await analyzeAppleAssetCatalogs({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
    environment: {},
    runAssetUtil: async (path) => {
      expect(path).toBe(join(bundle, "Assets.car"));
      return output;
    },
  });
  const expected: unknown = JSON.parse(output);
  expect(result.records.map(({ metadata }) => metadata)).toEqual(expected);
  expect(result.records[0]).toMatchObject({
    asset_name: "Toolbar",
    rendition_name: "Toolbar@2x",
    catalog_path: "Assets.car",
    catalog_sha256: createHash("sha256").update(catalog).digest("hex"),
  });
  const metadata = result.records[0]?.metadata;
  if (metadata === undefined) throw new Error("missing catalog metadata");
  expect(Object.hasOwn(metadata, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(metadata)).toBe(Object.prototype);
});

it.skipIf(process.platform === "win32")(
  "retains an exited assetutil failure when cancellation arrives while inherited pipes drain",
  async () => {
    const bundle = await createTestTempDirectory("rea-asset-exit-pipes-");
    await writeFile(join(bundle, "Assets.car"), "inert catalog");
    const exited = join(bundle, "root-exited");
    const release = join(bundle, "release");
    const descendant = [
      'const fs = require("node:fs");',
      "const parent = Number(process.argv[1]);",
      "const timer = setInterval(() => {",
      "  try { process.kill(parent, 0); } catch {",
      `    fs.writeFileSync(${JSON.stringify(exited)}, "");`,
      "  }",
      `  if (fs.existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.exit(0); }`,
      "}, 10);",
      "setTimeout(() => process.exit(0), 5000).unref();",
    ].join("\n");
    const program = [
      'const { spawn } = require("node:child_process");',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}, String(process.pid)], { stdio: "inherit" });`,
      "child.unref();",
      'process.stderr.write("specific catalog failure\\n");',
      "process.exit(7);",
    ].join("\n");
    const controller = new AbortController();
    let settled = false;
    const analysis = analyzeAppleAssetCatalogs({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      environment: {},
      signal: controller.signal,
      runAssetUtil: async (_path, signal) =>
        (
          await processOutput.execFileOutput(
            process.execPath,
            ["-e", program],
            {
              signal,
              stopSignal: "SIGTERM",
            },
          )
        ).stdout,
    })
      .catch((cause: unknown) => cause)
      .finally(() => {
        settled = true;
      });
    try {
      await vi.waitFor(() => expect(access(exited)).resolves.toBeUndefined());
      expect(settled).toBe(false);
      controller.abort("late cancellation");
      expect(settled).toBe(false);
      await writeFile(release, "");
      expect(await analysis).toMatchObject({
        _tag: "AnalysisOutputError",
        diagnostics: { catalog_path: "Assets.car" },
        capturedOutput: { stderr: "specific catalog failure\n", exit_code: 7 },
      });
    } finally {
      await writeFile(release, "");
      controller.abort();
      await analysis;
    }
  },
);
