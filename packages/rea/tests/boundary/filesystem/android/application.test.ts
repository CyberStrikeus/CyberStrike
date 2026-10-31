import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  createNonApplicationZipInventory,
  inventoryApplicationPackage,
  requireSuccessfulProjection,
} from "../../../support/applicationSessionFixture.js";

import { projectAndroidApplicationEvidence } from "../../../../src/application/android/AndroidApplicationService.js";
import { androidApplicationProjectionResultSchema } from "../../../../src/domain/android/androidApplication.js";
import { artifactInventoryResultSchema } from "../../../../src/domain/artifactGraph.js";

describe("Android application projection", () => {
  it("projects deterministic APK components and explicit bridge hypotheses", async () => {
    const root = await createTestTempDirectory("rea-android-");
    const path = join(root, "Fixture.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(
      "AndroidManifest.xml",
      new Uint8ArrayReader(Uint8Array.from([3, 0, 8, 0])),
    );
    await writer.add(
      "classes.dex",
      new Uint8ArrayReader(
        Uint8Array.from([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0]),
      ),
    );
    const elf = () =>
      new Uint8ArrayReader(
        Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
      );
    await writer.add("lib/arm64-v8a/libreactnativejni.so", elf());
    await writer.add("lib/arm64-v8a/libflutter.so", elf());
    await writer.add("lib/arm64-v8a/libunity.so", elf());
    await writer.add("lib/arm64-v8a/libcommunity.so", elf());
    await writer.add("assets/index.js", new TextReader("bridge();"));
    await writer.add("META-INF/FIXTURE.RSA", new TextReader("opaque signing"));
    await writeFile(path, await writer.close());

    const inventory = await inventoryApplicationPackage(path);
    const first = projectAndroidApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const second = projectAndroidApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const left = androidApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(first).normalized_result,
    );
    const right = androidApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(second).normalized_result,
    );
    expect(left).toEqual(right);
    expect(left).toMatchObject({
      root_format: "apk",
      coverage: {
        status: "complete-within-inventory",
        inventory_complete: true,
      },
    });
    expect(left.components.manifests).toHaveLength(1);
    expect(left.components.dex).toHaveLength(1);
    expect(left.components.native_libraries).toHaveLength(4);
    expect(left.components.javascript).toHaveLength(1);
    expect(left.components.signing).toHaveLength(1);
    expect(left.runtime_families).toEqual(
      expect.arrayContaining([
        "dalvik-art",
        "flutter",
        "javascript",
        "native",
        "react-native",
        "unity",
      ]),
    );
    expect(left.runtime_families).not.toContain("community");
    expect(left.bridge_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ basis: "react-native-convention" }),
        expect.objectContaining({ basis: "flutter-convention" }),
        expect.objectContaining({ basis: "unity-convention" }),
      ]),
    );
    const community = left.bridge_candidates.filter(({ native_path }) =>
      native_path.endsWith("libcommunity.so"),
    );
    expect(community.length).toBeGreaterThan(0);
    expect(
      community.every(({ basis }) => basis === "jni-library-convention"),
    ).toBe(true);
    expect(left.limitations).toEqual(
      expect.arrayContaining([
        "A bridge basis is inferred from the native path and is repeated for every managed component.",
        "ZIP inventory cannot see the APK Signing Block, so an empty signing array does not mean the APK is unsigned.",
      ]),
    );
    expect(JSON.stringify(left)).not.toContain("opaque signing");
  });

  it("rejects non-APK inventory Evidence", async () => {
    const inventory = await createNonApplicationZipInventory(
      "rea-android-invalid-",
    );
    expect(
      projectAndroidApplicationEvidence({ inventory_evidence: [inventory] }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        issues: [
          expect.objectContaining({
            message: expect.stringContaining("root format is zip"),
          }),
        ],
      },
    });
  });

  it("keeps uppercase path-derived bytecode families distinct from byte validity", async () => {
    const root = await createTestTempDirectory("rea-android-suffixes-");
    const path = join(root, "Suffixes.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const entry of [
      "classes.DEX",
      "extra.dex",
      "Main.CLASS",
      "Other.class",
    ])
      await writer.add(entry, new TextReader("unrecognized bytes"));
    await writeFile(path, await writer.close());

    const inventory = await inventoryApplicationPackage(path);
    const result = projectAndroidApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const projection = androidApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(result).normalized_result,
    );

    expect(projection.components.dex.map(({ path }) => path).sort()).toEqual([
      "classes.DEX",
      "extra.dex",
    ]);
    expect(
      projection.components.jvm_classes.map(({ path }) => path).sort(),
    ).toEqual(["Main.CLASS", "Other.class"]);
    expect(
      projection.components.dex.every(({ format }) => format === "file"),
    ).toBe(true);
    expect(
      projection.components.jvm_classes.every(
        ({ format }) => format === "file",
      ),
    ).toBe(true);
    expect(projection.runtime_families).toEqual(["dalvik-art", "java-kotlin"]);
    expect(projection.limitations).toContain(
      "Runtime families are inferred from inventory formats and paths; filename suffixes do not establish valid DEX or JVM class bytes.",
    );
  });
});

it("projects APK v1 metadata candidates at any META-INF depth", async () => {
  const root = await createTestTempDirectory("rea-android-v1-metadata-");
  const path = join(root, "NestedSigning.apk");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const names = [
    "META-INF/CERT.SF",
    "META-INF/CERT.EC",
    "META-INF/keys/CERT.SF",
    "META-INF/keys/CERT.EC",
    "META-INF/keys/readme.txt",
    "META-INF/keys/MANIFEST.MF",
    "assets/not-signing.SF",
    "meta-inf/lower.SF",
  ];
  for (const entry of names)
    await writer.add(entry, new TextReader(`content:${entry}`));
  await writeFile(path, await writer.close());

  const inventory = await inventoryApplicationPackage(path);
  const projection = androidApplicationProjectionResultSchema.parse(
    requireSuccessfulProjection(
      projectAndroidApplicationEvidence({ inventory_evidence: [inventory] }),
    ).normalized_result,
  );

  expect(projection.components.signing.map(({ path }) => path).sort()).toEqual([
    "META-INF/CERT.EC",
    "META-INF/CERT.SF",
    "META-INF/keys/CERT.EC",
    "META-INF/keys/CERT.SF",
  ]);
  for (const name of [
    "META-INF/CERT.SF",
    "META-INF/CERT.EC",
    "META-INF/keys/CERT.SF",
    "META-INF/keys/CERT.EC",
  ]) {
    const component = projection.components.signing.find(
      ({ path }) => path === name,
    );
    expect(component).toMatchObject({
      path: name,
      artifact_id: expect.stringMatching(/^art_/u),
      sha256: createHash("sha256").update(`content:${name}`).digest("hex"),
    });
  }
  expect(projection.limitations).toContain(
    "Manifest, resource, signing, and bytecode semantics require a dedicated Android provider; this projection reports exact inventory paths and hashes only.",
  );
});

describe("APK family without a root manifest", () => {
  const missingManifest =
    "No root AndroidManifest.xml occurrence was observed. The APK family comes from the .apk suffix of a ZIP archive, so these bytes may not be an APK.";
  const projectApk = async (entries: Record<string, string>) => {
    const root = await createTestTempDirectory("rea-android-manifest-");
    const path = join(root, "Plain.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const [entry, text] of Object.entries(entries))
      await writer.add(entry, new TextReader(text));
    await writeFile(path, await writer.close());
    const inventory = await inventoryApplicationPackage(path);
    return androidApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(
        projectAndroidApplicationEvidence({ inventory_evidence: [inventory] }),
      ).normalized_result,
    );
  };

  it("says when the APK family rests only on the ZIP filename suffix", async () => {
    expect((await projectApk({ "readme.txt": "hello" })).limitations).toContain(
      missingManifest,
    );
    expect(
      (await projectApk({ "AndroidManifest.xml": "manifest" })).limitations,
    ).not.toContain(missingManifest);
  });
});

it("retains encrypted native library paths as unknown component evidence", async () => {
  const root = await createTestTempDirectory("rea-android-encrypted-");
  const path = join(root, "Encrypted.apk");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "lib/arm64-v8a/libentry.so",
    new TextReader("encrypted native library"),
    { password: "fixture-only" },
  );
  await writeFile(path, await writer.close());
  const inventory = await inventoryApplicationPackage(path);
  const projection = androidApplicationProjectionResultSchema.parse(
    requireSuccessfulProjection(
      projectAndroidApplicationEvidence({ inventory_evidence: [inventory] }),
    ).normalized_result,
  );

  expect(projection.unavailable_components).toContainEqual(
    expect.objectContaining({
      path: "lib/arm64-v8a/libentry.so",
      artifact_id: null,
      sha256: null,
      encrypted: true,
    }),
  );
  expect(projection.coverage).toMatchObject({
    status: "partial",
    inventory_complete: true,
  });
  expect(projection.limitations).toContainEqual(
    expect.stringContaining("component absence is unknown"),
  );
});

describe("case-distinct APK resource names", () => {
  it("inventories and projects an APK whose resource names differ only in case", async () => {
    const root = await createTestTempDirectory("rea-android-case-");
    const path = join(root, "Shrunk.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(
      "AndroidManifest.xml",
      new Uint8ArrayReader(Uint8Array.from([3, 0, 8, 0])),
    );
    await writer.add(
      "classes.dex",
      new Uint8ArrayReader(
        Uint8Array.from([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0]),
      ),
    );
    await writer.add("res/2F.xml", new TextReader("upper"));
    await writer.add("res/2f.xml", new TextReader("lower"));
    await writeFile(path, await writer.close());

    const inventory = await inventoryApplicationPackage(path);
    expect(inventory.normalized_result).toMatchObject({
      coverage: { scope: "container-entries", status: "complete" },
    });
    const result = projectAndroidApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const projection = androidApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(result).normalized_result,
    );
    expect(projection.root_format).toBe("apk");
    expect(projection.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
    expect(projection.limitations.join(" ")).toContain(
      "case-insensitive destination",
    );
    expect(projection.components.manifests).toHaveLength(1);
    expect(projection.components.dex).toHaveLength(1);
    const graph = artifactInventoryResultSchema.parse(
      inventory.normalized_result,
    );
    for (const logicalPath of ["res/2F.xml", "res/2f.xml"]) {
      expect(graph.occurrences).toContainEqual(
        expect.objectContaining({
          logical_path: logicalPath,
          limitations: expect.arrayContaining([
            expect.stringContaining("English (en-US) Unicode case folding"),
          ]),
        }),
      );
    }
  });
});

describe("Android bridge candidate coverage", () => {
  it("returns every component and bridge candidate from the inventory", async () => {
    const root = await createTestTempDirectory("rea-android-complete-");
    const path = join(root, "Fixture.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    const dex = Uint8Array.from([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0]);
    for (let index = 0; index < 1_001; index += 1)
      await writer.add(
        `classes${String(index).padStart(4, "0")}.dex`,
        new Uint8ArrayReader(dex),
      );
    await writer.add("lib/arm64-v8a/libnative.so", new TextReader("native"));
    await writeFile(path, await writer.close());

    const inventory = await inventoryApplicationPackage(path);
    const result = projectAndroidApplicationEvidence({
      inventory_evidence: [inventory],
    });

    if (!result.ok) throw result.error;
    const projection = androidApplicationProjectionResultSchema.parse(
      result.value.evidence.normalized_result,
    );
    expect(projection.components.dex).toHaveLength(1_001);
    expect(projection.bridge_candidates).toHaveLength(1_001);
    expect(projection.coverage.status).toBe("complete-within-inventory");
  });

  it("marks a multidex by native projection partial when escaped UTF-8 candidate paths exceed its byte budget", async () => {
    const root = await createTestTempDirectory("rea-android-bridge-budget-");
    const path = join(root, "Large.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    const dex = Uint8Array.from([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0]);
    const escapedDirectory = `${"é".repeat(100)}${'"'.repeat(120)}`;
    for (let index = 0; index < 129; index += 1)
      await writer.add(
        `${escapedDirectory}/classes${String(index + 1).padStart(3, "0")}.dex`,
        new Uint8ArrayReader(dex),
      );
    for (let index = 0; index < 128; index += 1)
      await writer.add(
        `lib/arm64-v8a/libnative${String(index).padStart(3, "0")}.so`,
        new TextReader("native"),
      );
    await writeFile(path, await writer.close());

    const inventory = await inventoryApplicationPackage(path);
    const result = projectAndroidApplicationEvidence({
      inventory_evidence: [inventory],
    });
    if (!result.ok) throw result.error;
    const projection = androidApplicationProjectionResultSchema.parse(
      result.value.evidence.normalized_result,
    );

    expect(projection.components.dex).toHaveLength(129);
    expect(projection.components.native_libraries).toHaveLength(128);
    expect(projection.bridge_candidate_coverage).toMatchObject({
      status: "partial",
      total_candidates: 129 * 128,
      emitted_candidates: projection.bridge_candidates.length,
      omitted_candidates: 129 * 128 - projection.bridge_candidates.length,
    });
    expect(projection.bridge_candidates.length).toBeGreaterThan(0);
    expect(projection.bridge_candidates.length).toBeLessThan(129 * 128);
    expect(
      Buffer.byteLength(JSON.stringify(projection.bridge_candidates)),
    ).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(projection.coverage).toMatchObject({
      status: "partial",
      inventory_complete: true,
    });
    expect(projection.limitations).toContain(
      "Bridge candidates are path-based hypotheses, not decoded JNI declarations or observed runtime calls.",
    );
    expect(projection.limitations).toContain(
      `Bridge candidate pairs exceeded the projection safety budget; ${projection.bridge_candidate_coverage.omitted_candidates} hypotheses are omitted. Component arrays still include every component from the supplied inventory pages.`,
    );
  });
});

it("does not infer a runtime from library-named directories or their text descendants", async () => {
  const root = await createTestTempDirectory("rea-android-runtime-directory-");
  const path = join(root, "Fixture.apk");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("AndroidManifest.xml", new TextReader("fixture"));
  for (const name of ["libflutter.so", "libunity.so", "libreactnative.so"]) {
    await writer.add(`assets/${name}/`, undefined, { directory: true });
    await writer.add(`assets/${name}/NOTICE.txt`, new TextReader("inert text"));
  }
  await writeFile(path, await writer.close());
  const inventory = await inventoryApplicationPackage(path);
  const graph = androidApplicationProjectionResultSchema.parse(
    requireSuccessfulProjection(
      projectAndroidApplicationEvidence({ inventory_evidence: [inventory] }),
    ).normalized_result,
  );
  expect(graph.components.native_libraries).toEqual([]);
  expect(graph.runtime_families).toEqual([]);
  expect(graph.coverage.status).toBe("complete-within-inventory");
});

it("retains an encrypted root manifest occurrence without claiming absence", async () => {
  const root = await createTestTempDirectory("rea-android-locked-manifest-");
  const path = join(root, "Locked.apk");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("AndroidManifest.xml", new TextReader("manifest"), {
    password: "fixture-only",
  });
  await writeFile(path, await writer.close());
  const inventory = await inventoryApplicationPackage(path);
  const graph = androidApplicationProjectionResultSchema.parse(
    requireSuccessfulProjection(
      projectAndroidApplicationEvidence({ inventory_evidence: [inventory] }),
    ).normalized_result,
  );
  expect(graph.components.manifests).toEqual([]);
  expect(graph.unavailable_components).toContainEqual(
    expect.objectContaining({
      path: "AndroidManifest.xml",
      encrypted: true,
      artifact_id: null,
      sha256: null,
    }),
  );
  expect(graph.coverage.status).toBe("partial");
  expect(
    graph.limitations.some((text) =>
      text.startsWith("No root AndroidManifest.xml"),
    ),
  ).toBe(false);
  expect(graph.limitations).toContainEqual(
    expect.stringContaining("component absence is unknown"),
  );
});
