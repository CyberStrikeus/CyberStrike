import { projectCliAnalysisResult } from "../../../../src/cli/projectCliAnalysisResult.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  createNonApplicationZipInventory,
  inventoryApplicationPackage,
  requireDeterministicProjection,
  requireSuccessfulProjection,
  writeApplicationZip,
} from "../../../support/applicationSessionFixture.js";

import { projectHarmonyApplicationEvidence } from "../../../../src/application/harmony/HarmonyApplicationService.js";
import { createDirectAnalysis } from "../../../../src/composition/directAnalysis.js";
import { harmonyApplicationProjectionResultSchema } from "../../../../src/domain/harmony/harmonyApplication.js";
import { artifactInventoryResultSchema } from "../../../../src/domain/artifactGraph.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import {
  ZIP_PACKAGE_FORMATS,
  ZIP_NON_ENTRY_LIMITATION,
} from "../../../../src/domain/zipPackageFormat.js";

const { runProviderAnalysis } = createDirectAnalysis({});
const elf = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);

const stageHapEntries = [
  { path: "module.json", content: '{"module":{"name":"entry"}}' },
  { path: "ets/modules.abc", content: "panda bytecode" },
  { path: "libs/arm64-v8a/libentry.so", content: elf },
  { path: "resources.index", content: "resource index" },
  { path: "resources/base/profile/main_pages.json", content: "{}" },
  { path: "assets/web/index.js", content: "bridge();" },
  { path: "META-INF/FIXTURE.p7b", content: "opaque signing" },
] as const;

it("retains inventoried certificate-block suffixes without claiming verified signatures", async () => {
  const names = ["CERT.RSA", "CERT.DSA", "CERT.EC", "FIXTURE.p7b"];
  const path = await writeApplicationZip(
    "rea-harmony-certificate-paths-",
    "Fixture.hap",
    [
      ...names.map((name) => ({
        path: `META-INF/${name}`,
        content: "opaque bytes",
      })),
      { path: "META-INF/MANIFEST.MF", content: "manifest" },
      { path: "META-INF/CERT.SF", content: "signature file" },
    ],
  );
  const graph = requireDeterministicProjection(
    projectHarmonyApplicationEvidence,
    await inventoryApplicationPackage(path),
    harmonyApplicationProjectionResultSchema,
  );
  expect(graph.components.signing.map(({ path }) => path).sort()).toEqual(
    names.map((name) => `META-INF/${name}`).sort(),
  );
});

describe("HarmonyOS application projection", () => {
  it.each(["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts"])(
    "retains the JavaScript runtime hint for an authenticated .%s component",
    async (extension) => {
      const member = `assets/js/index.${extension}`;
      const path = await writeApplicationZip(
        "rea-harmony-javascript-",
        "Fixture.hap",
        [{ path: member, content: "export const value = 1;" }],
      );
      const inventory = await inventoryApplicationPackage(path);
      const projection = requireDeterministicProjection(
        projectHarmonyApplicationEvidence,
        inventory,
        harmonyApplicationProjectionResultSchema,
      );
      expect(projection.components.javascript).toEqual([
        expect.objectContaining({ path: member, format: "javascript-bundle" }),
      ]);
      expect(projection.runtime_families).toEqual(["javascript"]);
      expect(projection.coverage.status).toBe("complete-within-inventory");
    },
  );

  it("does not infer JavaScript from unrelated inventory content", async () => {
    const path = await writeApplicationZip(
      "rea-harmony-no-javascript-",
      "Fixture.hap",
      [
        { path: "module.json", content: "{}" },
        { path: "assets/js/notes.txt", content: "ordinary text" },
      ],
    );
    const inventory = await inventoryApplicationPackage(path);
    const projection = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      inventory,
      harmonyApplicationProjectionResultSchema,
    );
    expect(projection.components.javascript).toEqual([]);
    expect(projection.runtime_families).toEqual([]);
  });

  it("projects deterministic Stage HAP components and explicit bridge hypotheses", async () => {
    const path = await writeApplicationZip(
      "rea-harmony-",
      "Fixture.hap",
      stageHapEntries,
    );
    const inventory = await inventoryApplicationPackage(path);
    expect(inventory.subject?.format).toBe("hap");
    const left = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      inventory,
      harmonyApplicationProjectionResultSchema,
    );
    expect(left).toMatchObject({
      root_format: "hap",
      packaging_model: "stage",
      coverage: {
        status: "complete-within-inventory",
        inventory_complete: true,
      },
    });
    expect(left.components.manifests.map(({ path }) => path)).toEqual([
      "module.json",
    ]);
    expect(left.components.bytecode.map(({ path }) => path)).toEqual([
      "ets/modules.abc",
    ]);
    expect(left.components.resources.map(({ path }) => path).sort()).toEqual([
      "resources.index",
      "resources/base/profile/main_pages.json",
    ]);
    expect(left.components.native_libraries).toHaveLength(1);
    expect(left.components.javascript).toHaveLength(1);
    expect(left.components.signing).toHaveLength(1);
    expect(left.runtime_families).toEqual(["ark", "javascript", "native"]);
    expect(left.bridge_candidates).toEqual([
      expect.objectContaining({
        managed_path: "ets/modules.abc",
        native_path: "libs/arm64-v8a/libentry.so",
        basis: "napi-library-convention",
      }),
    ]);
    expect(left.app_pack_children).toEqual([]);
    expect(JSON.stringify(left)).not.toContain("opaque signing");
    expect(left.limitations).toContain(
      "Manifest, module, resource, and signing semantics require a dedicated HarmonyOS provider; this projection reports exact inventory paths and hashes only.",
    );
  });

  it("projects App Pack children by path without recursive inventory", async () => {
    const entryHap = await writeApplicationZip(
      "rea-harmony-entry-",
      "entry.hap",
      [
        { path: "module.json", content: '{"module":{}}' },
        { path: "ets/modules.abc", content: "panda" },
      ],
    );
    const featureHsp = await writeApplicationZip(
      "rea-harmony-feature-",
      "feature.hsp",
      [{ path: "module.json", content: '{"module":{}}' }],
    );
    const path = await writeApplicationZip("rea-harmony-app-", "Bundle.app", [
      { path: "pack.info", content: '{"packages":[]}' },
      { path: "entry.hap", content: new Uint8Array(await readFile(entryHap)) },
      {
        path: "feature.hsp",
        content: new Uint8Array(await readFile(featureHsp)),
      },
    ]);
    const inventory = await inventoryApplicationPackage(path);
    expect(inventory.subject?.format).toBe("app-pack");
    const projection = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      inventory,
      harmonyApplicationProjectionResultSchema,
    );
    expect(projection.root_format).toBe("app-pack");
    expect(projection.components.manifests.map(({ path }) => path)).toEqual([
      "pack.info",
    ]);
    expect(projection.app_pack_children.map(({ path }) => path).sort()).toEqual(
      ["entry.hap", "feature.hsp"],
    );
    expect(projection.packaging_model).toBe("unknown");
    expect(projection.limitations).toContain(
      "App Pack child packages are listed by inventory path only; their contents are not recursively inventoried by this projection.",
    );
  });
});

describe("HarmonyOS packaging boundaries", () => {
  it("keeps a nested .app ZIP member inside an IPA out of the App Pack classification", async () => {
    const nested = await writeApplicationZip(
      "rea-harmony-nested-",
      "Nested.app",
      [{ path: "inner.txt", content: "not an app pack" }],
    );
    const path = await writeApplicationZip("rea-harmony-ipa-", "Fixture.ipa", [
      { path: "Payload/App.app/Info.plist", content: "plist" },
      {
        path: "Payload/Nested.app",
        content: new Uint8Array(await readFile(nested)),
      },
    ]);
    const inventory = await inventoryApplicationPackage(path);
    expect(inventory.subject?.format).toBe("ipa");
    const occurrences = (
      inventory.normalized_result as {
        occurrences: Array<{
          logical_path: string;
          artifact_format: string;
        }>;
      }
    ).occurrences;
    const nestedOccurrence = occurrences.find(
      ({ logical_path }) => logical_path === "Payload/Nested.app",
    );
    expect(nestedOccurrence?.artifact_format).toBe("zip");
  });

  it("claims the FA model only from config.json", async () => {
    const path = await writeApplicationZip("rea-harmony-fa-", "Legacy.hap", [
      { path: "config.json", content: '{"app":{}}' },
      { path: "assets/js/default.js", content: "legacy();" },
      { path: "assets/entry/resources.index", content: "resource index" },
      {
        path: "assets/entry/resources/base/element/strings.json",
        content: "{}",
      },
      { path: "assets/feature/resources/rawfile/icon.png", content: "image" },
    ]);
    const inventory = await inventoryApplicationPackage(path);
    const result = projectHarmonyApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const projection = harmonyApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(result).normalized_result,
    );
    expect(projection.packaging_model).toBe("fa");
    expect(projection.runtime_families).toEqual(["javascript"]);
    expect(projection.components.resources.map(({ path }) => path)).toEqual([
      "assets/entry/resources.index",
      "assets/entry/resources/base/element/strings.json",
      "assets/feature/resources/rawfile/icon.png",
    ]);
  });

  it("does not classify a rawfile named module.json as a manifest", async () => {
    const path = await writeApplicationZip(
      "rea-harmony-rawfile-module-manifest-",
      "Legacy.hap",
      [
        { path: "config.json", content: '{"app":{}}' },
        {
          path: "assets/entry/resources/rawfile/module.json",
          content: '{"note":"ordinary raw resource"}',
        },
      ],
    );
    const inventory = await inventoryApplicationPackage(path);
    const result = projectHarmonyApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const projection = harmonyApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(result).normalized_result,
    );
    expect(projection.packaging_model).toBe("fa");
    expect(projection.components.manifests.map(({ path }) => path)).toEqual([
      "config.json",
    ]);
    expect(projection.components.resources.map(({ path }) => path)).toEqual([
      "assets/entry/resources/rawfile/module.json",
    ]);
  });

  it("rejects non-HarmonyOS inventory Evidence", async () => {
    const inventory = await createNonApplicationZipInventory(
      "rea-harmony-invalid-",
    );
    expect(
      projectHarmonyApplicationEvidence({ inventory_evidence: [inventory] }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  });

  it("keeps HTTP Archive .har files out of the HarmonyOS classification", async () => {
    const root = await createTestTempDirectory("rea-harmony-http-har-");
    const path = join(root, "capture.har");
    await writeFile(
      path,
      JSON.stringify({ log: { version: "1.2", creator: {}, entries: [] } }),
    );
    const result = await runProviderAnalysis(
      path,
      "inventory_artifact",
      {},
    ).then(projectCliAnalysisResult);
    expect(result).toMatchObject({
      error: "Analysis failed",
      code: "target_unavailable",
    });
  });
});

describe("HarmonyOS inventory coverage", () => {
  it("retains complete traversal and case-collision limits in the application projection", async () => {
    const path = await writeApplicationZip(
      "rea-harmony-case-collision-",
      "Fixture.hap",
      [
        { path: "module.json", content: '{"module":{}}' },
        { path: "MODULE.JSON", content: '{"module":{}}' },
      ],
    );
    const inventory = await inventoryApplicationPackage(path);
    expect(inventory.normalized_result).toMatchObject({
      coverage: { scope: "container-entries", status: "complete" },
    });

    const projection = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      inventory,
      harmonyApplicationProjectionResultSchema,
    );
    expect(projection.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
    expect(projection.limitations.join(" ")).toContain(
      "case-insensitive destination",
    );
  });

  it.each(ZIP_PACKAGE_FORMATS)(
    "retains archive identity and ZIP coverage for %s",
    async (format) => {
      const suffix = format === "app-pack" ? "app" : format;
      const path = await writeApplicationZip(
        "rea-package-family-",
        `Fixture.${suffix}`,
        [{ path: "module.json", content: "{}" }],
      );
      const target = await parseBinaryTarget(path);
      if (!target.ok) throw target.error;
      expect(target.value).toMatchObject({ kind: "archive", format });
      const evidence = await inventoryApplicationPackage(path);
      const inventory = artifactInventoryResultSchema.parse(
        evidence.normalized_result,
      );
      expect(
        inventory.occurrences.find(({ logical_path }) => logical_path === "."),
      ).toMatchObject({
        artifact_kind: "container",
        artifact_format: format,
      });
      expect(inventory.limitations).toContain(ZIP_NON_ENTRY_LIMITATION);
    },
  );

  it("preserves unavailable encrypted component paths and qualifies absence", async () => {
    const root = await createTestTempDirectory("rea-harmony-encrypted-");
    const path = join(root, "Locked.hap");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("module.json", new TextReader("{}"));
    await writer.add("ets/modules.abc", new TextReader("opaque bytecode"), {
      password: "fixture-only",
    });
    await writeFile(path, await writer.close());
    const evidence = await inventoryApplicationPackage(path);
    const projection = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      evidence,
      harmonyApplicationProjectionResultSchema,
    );
    expect(projection.components.bytecode).toEqual([]);
    expect(projection.unavailable_components).toEqual([
      expect.objectContaining({
        path: "ets/modules.abc",
        artifact_id: null,
        sha256: null,
        encrypted: true,
      }),
    ]);
    expect(projection.coverage).toEqual({
      status: "partial",
      inventory_complete: true,
    });
    expect(projection.limitations).toContainEqual(
      expect.stringContaining("component and runtime absence is unknown"),
    );
  });
});

describe("HarmonyOS manifest path rules", () => {
  it("claims stage and FA models only from the exact manifest filenames", async () => {
    // HAP/HSP/App Pack members are ZIP names. OpenHarmony's stage, FA, and
    // app-pack manifests are module.json, config.json, and pack.info.
    const path = await writeApplicationZip(
      "rea-harmony-manifest-case-",
      "Fixture.hap",
      [
        { path: "MODULE.JSON", content: "{}" },
        { path: "CONFIG.JSON", content: "{}" },
        { path: "PACK.INFO", content: "{}" },
      ],
    );
    const projection = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      await inventoryApplicationPackage(path),
      harmonyApplicationProjectionResultSchema,
    );
    expect(projection.packaging_model).toBe("unknown");
    expect(projection.components.manifests).toEqual([]);
  });

  it.each([
    { paths: ["a/module.json", "z/config.json"] },
    { paths: ["a/config.json", "z/module.json"] },
  ])("keeps Stage precedence for $paths", async ({ paths }) => {
    const path = await writeApplicationZip(
      "rea-harmony-mixed-model-",
      "Both.hap",
      paths.map((path) => ({ path, content: "{}" })),
    );
    const projection = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      await inventoryApplicationPackage(path),
      harmonyApplicationProjectionResultSchema,
    );
    expect(projection.packaging_model).toBe("stage");
    expect(
      projection.components.manifests.map(({ path }) => path).sort(),
    ).toEqual(paths.toSorted());
  });

  it.each([
    { name: "module.json", model: "stage" },
    { name: "config.json", model: "fa" },
    { name: "MODULE.JSON", model: "unknown" },
  ])("retains the path hint for unavailable $name", async ({ name, model }) => {
    const root = await createTestTempDirectory("rea-harmony-locked-manifest-");
    const path = join(root, "Locked.hap");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(name, new TextReader("{}"), { password: "fixture-only" });
    await writeFile(path, await writer.close());
    const projection = requireDeterministicProjection(
      projectHarmonyApplicationEvidence,
      await inventoryApplicationPackage(path),
      harmonyApplicationProjectionResultSchema,
    );
    expect(projection.packaging_model).toBe(model);
    expect(projection.components.manifests).toEqual([]);
    expect(projection.unavailable_components).toEqual([
      expect.objectContaining({
        path: name,
        artifact_id: null,
        sha256: null,
        encrypted: true,
      }),
    ]);
    expect(projection.coverage).toEqual({
      status: "partial",
      inventory_complete: true,
    });
  });
});
