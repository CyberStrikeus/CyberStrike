import {
  primitiveCandidateExpansionExpression,
  primitiveByteExpansionSource,
} from "../../fixtures/javascriptPrimitiveExpansion.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackage, createPackageWithOptions } from "@electron/asar";
import { expect, it } from "vitest";

import {
  analyzeJavaScriptApplication,
  readJavaScriptArtifactFiles,
} from "../../support/javascriptApplicationScope.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createJavaScriptArtifactReader } from "../../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import { scanCanonicalArtifactInventory } from "../../fixtures/artifactInventory.js";
import { createStrippedAsarAddon } from "../../fixtures/strippedAsarAddon.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("records an explicitly continued Electron addon mismatch as untrusted evidence", async () => {
  const { archive, addon, original, stripped } =
    await createStrippedAsarAddon();
  const rejected = await analyzeJavaScriptApplication({ input_path: archive });
  if (rejected.ok) throw new Error("Expected strict integrity failure");
  expect(projectAnalysisError(rejected.error)).toMatchObject({
    code: "artifact_integrity_mismatch",
    details: {
      logical_path: addon,
      declared_sha256: expect.any(String),
      calculated_sha256: expect.any(String),
      unpacked: true,
    },
    remediation: {
      action: expect.stringContaining("integrity_policy=record-and-continue"),
    },
  });

  const continued = await analyzeJavaScriptApplication({
    input_path: archive,
    integrity_policy: "record-and-continue",
  });
  if (!continued.ok) throw new Error("Expected explicit continuation");
  const result = javascriptApplicationAnalysisResultSchema.parse(
    continued.value.normalized_result,
  );
  const contradiction = result.integrity_contradictions.find(
    ({ logical_path }) => logical_path === addon,
  );
  expect(contradiction).toMatchObject({
    logical_path: addon,
    declared_sha256: createHash("sha256").update(original).digest("hex"),
    observed_sha256: createHash("sha256").update(stripped).digest("hex"),
    trust: "observed-untrusted",
  });
  expect(result.graph.coverage.status).toBe("partial");
  expect(result.graph.coverage.omitted_count).toBe(0);
  expect(result.graph.limitations).toContain(
    `Artifact integrity metadata contradicts observed bytes at ${addon}; the observed bytes are untrusted.`,
  );
  expect(continued.value.parameters).toMatchObject({
    format: "auto",
    integrity_policy: "record-and-continue",
  });
  expect(result.statistics.parsed_javascript_files).toBeGreaterThan(0);
  expect(JSON.stringify(result.graph)).toContain(
    createHash("sha256").update(stripped).digest("hex"),
  );
});

it("keeps a contradicted nested ASAR opaque during JavaScript reconstruction", async () => {
  const root = await createTestTempDirectory("rea-mismatched-nested-asar-");
  const nestedSource = join(root, "nested-source");
  const outerSource = join(root, "outer-source");
  const archive = join(root, "app.asar");
  const nestedArchive = join(outerSource, "nested.asar");
  const nestedSecret = "export const nestedOnly = 'not inventoried';\n";
  await mkdir(nestedSource);
  await mkdir(outerSource);
  await writeFile(join(nestedSource, "main.js"), nestedSecret);
  await writeFile(join(outerSource, "main.js"), "export const outer = true;\n");
  await createPackage(nestedSource, nestedArchive);
  await createPackageWithOptions(outerSource, archive, {
    unpack: "nested.asar",
  });
  const unpackedNested = join(`${archive}.unpacked`, "nested.asar");
  const nestedBytes = await readFile(unpackedNested);
  nestedBytes[0] = (nestedBytes[0] ?? 0) ^ 0xff;
  await writeFile(unpackedNested, nestedBytes);

  const analyzed = await analyzeJavaScriptApplication({
    input_path: archive,
    integrity_policy: "record-and-continue",
  });
  if (!analyzed.ok) throw new Error("Expected explicit continuation");
  const result = javascriptApplicationAnalysisResultSchema.parse(
    analyzed.value.normalized_result,
  );
  expect(result.integrity_contradictions).toMatchObject([
    { logical_path: "nested.asar", trust: "observed-untrusted" },
  ]);
  expect(result.statistics.nested_asar_containers).toBe(0);
  expect(JSON.stringify(result)).not.toContain(nestedSecret);
  expect(result.graph.coverage.status).toBe("partial");
  expect(result.graph.coverage.omitted_count).toBeNull();
});

it("keeps an ASAR-named file without an ASAR header opaque during JavaScript reconstruction", async () => {
  const root = await createTestTempDirectory("rea-opaque-asar-name-");
  await writeFile(join(root, "main.js"), "export const outer = true;\n");
  // Inventory records this file as ordinary bytes and does not expand it.
  await writeFile(join(root, "ordinary.asar"), "ordinary bytes");

  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const read = await readJavaScriptArtifactFiles(reader, snapshot);
    expect(read.files.map(({ path }) => path)).toEqual(["main.js"]);
    expect(read.containers).toEqual([]);
  } finally {
    await reader.close();
  }

  const analyzed = await analyzeJavaScriptApplication({
    input_path: root,
    format: "directory",
  });
  if (!analyzed.ok) throw analyzed.error;
  const result = javascriptApplicationAnalysisResultSchema.parse(
    analyzed.value.normalized_result,
  );
  expect(result.statistics.nested_asar_containers).toBe(0);
  expect(result.integrity_contradictions).toEqual([]);
});

it("retains semantic resource limits alongside recorded integrity contradictions", async () => {
  const { archive } = await createStrippedAsarAddon([
    {
      path: "app.js",
      contents: `const answer = { nested: ${primitiveCandidateExpansionExpression()} };`,
    },
    { path: "growth.js", contents: primitiveByteExpansionSource() },
  ]);
  const analyzed = await analyzeJavaScriptApplication({
    input_path: archive,
    integrity_policy: "record-and-continue",
  });
  if (!analyzed.ok) throw new Error("Expected explicit continuation");
  const result = javascriptApplicationAnalysisResultSchema.parse(
    analyzed.value.normalized_result,
  );
  expect(result.integrity_contradictions).toHaveLength(1);
  expect(result.graph.coverage).toMatchObject({
    status: "partial",
    omitted_count: null,
    limits: expect.arrayContaining([
      expect.objectContaining({
        name: "javascript_semantic_primitive_candidates",
        unit: "items",
      }),
      expect.objectContaining({
        name: "javascript_semantic_primitive_bytes",
        unit: "bytes",
      }),
    ]),
  });
});

it("rejects a nested ASAR introduced after inventory as artifact drift", async () => {
  const root = await createTestTempDirectory("rea-new-nested-asar-");
  const nestedSource = join(root, "nested-source");
  await mkdir(nestedSource);
  await writeFile(join(root, "main.js"), "export const outer = true;\n");
  await writeFile(
    join(nestedSource, "main.js"),
    "export const nested = true;\n",
  );
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  await createPackage(nestedSource, join(root, "new.asar"));
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    await expect(
      readJavaScriptArtifactFiles(reader, snapshot),
    ).rejects.toMatchObject({
      reason: "integrity",
      message: "Nested ASAR was not present in inventory: new.asar",
    });
  } finally {
    await reader.close();
  }
});
