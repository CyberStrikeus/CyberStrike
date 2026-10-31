import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { expect } from "vitest";

import { appleApplicationProjectionResultSchema } from "../../../src/domain/apple/appleApplication.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { androidApplicationProjectionResultSchema } from "../../../src/domain/android/androidApplication.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { harmonyApplicationProjectionResultSchema } from "../../../src/domain/harmony/harmonyApplication.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const harmony = {
  family: "HarmonyOS",
  extension: "hap",
  command: "project-harmony-application-graph",
  operation: "project_harmony_application_graph",
  paths: [
    "module.json",
    "ets/modules.abc",
    "libs/arm64-v8a/libflutter.so",
    "assets/main.js",
    "resources.index",
    "resources/base",
    "META-INF/TEST.p7b",
  ],
  nestedCode: "ets/modules.abc/actual.abc",
  runtimeFamilies: ["ark", "flutter", "javascript", "native"],
  nestedRuntime: "ark",
  nestedCategory: "bytecode",
  fileComponents: {
    manifests: ["module.json"],
    bytecode: ["ets/modules.abc"],
    resources: ["resources.index", "resources/base"],
    native_libraries: ["libs/arm64-v8a/libflutter.so"],
    javascript: ["assets/main.js"],
    signing: ["META-INF/TEST.p7b"],
  },
  fileBridges: [
    {
      managed_path: "ets/modules.abc",
      native_path: "libs/arm64-v8a/libflutter.so",
      basis: "napi-library-convention",
    },
  ],
};

const fixtures = [
  {
    family: "Android",
    extension: "apk",
    command: "project-android-application-graph",
    operation: "project_android_application_graph",
    paths: [
      "AndroidManifest.xml",
      "resources.arsc",
      "classes.dex",
      "Main.class",
      "lib/arm64-v8a/libflutter.so",
      "META-INF/TEST.RSA",
    ],
    nestedCode: "classes.dex/actual.dex",
    runtimeFamilies: ["dalvik-art", "flutter", "java-kotlin", "native"],
    nestedRuntime: "dalvik-art",
    nestedCategory: "dex",
    fileComponents: {
      manifests: ["AndroidManifest.xml"],
      resources: ["resources.arsc"],
      dex: ["classes.dex"],
      jvm_classes: ["Main.class"],
      native_libraries: ["lib/arm64-v8a/libflutter.so"],
      javascript: [],
      signing: ["META-INF/TEST.RSA"],
    },
    fileBridges: [
      {
        managed_path: "classes.dex",
        native_path: "lib/arm64-v8a/libflutter.so",
        basis: "flutter-convention",
      },
      {
        managed_path: "Main.class",
        native_path: "lib/arm64-v8a/libflutter.so",
        basis: "flutter-convention",
      },
    ],
  },
  {
    family: "Apple",
    extension: "ipa",
    command: "project-apple-application-graph",
    operation: "project_apple_application_graph",
    paths: [
      "Payload/Fixture.app/Info.plist",
      "Payload/Fixture.app/main.js",
      "Payload/Fixture.app/libentry.dylib",
    ],
    nestedCode: "Payload/Fixture.app/main.js/actual.js",
    runtimeFamilies: ["javascript", "native"],
    nestedRuntime: "javascript",
    nestedCategory: "javascript",
    fileComponents: {
      bundle_metadata: ["Payload/Fixture.app/Info.plist"],
      executables: ["Payload/Fixture.app/libentry.dylib"],
      frameworks: [],
      native_libraries: ["Payload/Fixture.app/libentry.dylib"],
      javascript: ["Payload/Fixture.app/main.js"],
      signing: [],
      privileged_helpers: [],
      launchd_plists: [],
      helpers: [],
    },
    fileBridges: [
      {
        source_path: "Payload/Fixture.app/main.js",
        native_path: "Payload/Fixture.app/libentry.dylib",
        basis: "javascript-and-native-content",
      },
    ],
  },
  harmony,
  {
    ...harmony,
    family: "HarmonyOS App Pack",
    extension: "app",
    paths: [...harmony.paths, "entry.hap", "feature.hsp"],
  },
];

cliTest.for(fixtures)(
  "preserves entry kinds in $family projections through CLI and stdio MCP",
  { timeout: 60_000 },
  async (fixture, { cli }) => {
    const root = await createTestTempDirectory("rea-mobile-directory-");
    const environment = { HOME: root, USERPROFILE: root };
    const { call } = await connectLocalToolsMcp(environment);
    for (const mode of ["directories", "files", "nested"] as const) {
      const writer = new ZipWriter(new Uint8ArrayWriter());
      for (const path of fixture.paths) {
        if (mode !== "files")
          await writer.add(`${path}/`, undefined, { directory: true });
        else
          await writer.add(
            path,
            path.endsWith(".dylib")
              ? new Uint8ArrayReader(thinMach(0xfeedfacf, 0x0100000c))
              : path.endsWith(".so")
                ? new Uint8ArrayReader(
                    Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
                  )
                : new TextReader("opaque fixture content"),
          );
      }
      if (mode === "nested")
        await writer.add(fixture.nestedCode, new TextReader("opaque bytecode"));
      const bytes = await writer.close();
      const path = join(root, `${mode}.${fixture.extension}`);
      await writeFile(path, bytes);

      const inspected = await cli.run({
        arguments: ["inspect-artifact", path, "--json"],
        environment,
      });
      expect(inspected.exitCode, inspected.stderr).toBe(0);
      const inventoryEvidence = parseEvidence(inspected.json);
      const inspection = artifactInspectionResultSchema.parse(
        inventoryEvidence.normalized_result,
      );
      const occurrences = inspection.substeps.flatMap(
        ({ evidence }) =>
          artifactInventoryResultSchema.parse(
            parseEvidence(evidence).normalized_result,
          ).occurrences,
      );
      for (const member of fixture.paths)
        expect(occurrences, `${mode}: ${member}`).toContainEqual(
          expect.objectContaining({
            logical_path: member,
            entry_kind: mode === "files" ? "file" : "directory",
            ...(mode === "files" ? {} : { artifact_format: "directory" }),
          }),
        );

      const input = { inventory_evidence: [inventoryEvidence] };
      const originalInput = JSON.stringify(input);
      const projected = await cli.run({
        arguments: [fixture.command, originalInput, "--json"],
        environment,
      });
      expect(projected.exitCode, projected.stderr).toBe(0);
      const evidence = parseEvidence(projected.json);
      const mcp = await call(fixture.operation, input);
      expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
      expect(parseEvidence(mcp.structuredContent)).toEqual(evidence);
      expect(JSON.stringify(input)).toBe(originalInput);

      const projection =
        fixture.extension === "apk"
          ? androidApplicationProjectionResultSchema.parse(
              evidence.normalized_result,
            )
          : fixture.extension === "ipa"
            ? appleApplicationProjectionResultSchema.parse(
                evidence.normalized_result,
              )
            : harmonyApplicationProjectionResultSchema.parse(
                evidence.normalized_result,
              );
      const childPackages = fixture.paths.filter((member) =>
        /\.(?:hap|hsp)$/u.test(member),
      );
      expect(
        Object.fromEntries(
          Object.entries(projection.components).map(
            ([category, components]) => [
              category,
              components.map(({ path }) => path),
            ],
          ),
        ),
        mode,
      ).toEqual(
        mode === "files"
          ? fixture.fileComponents
          : Object.fromEntries(
              Object.keys(fixture.fileComponents).map((category) => [
                category,
                mode === "nested" && category === fixture.nestedCategory
                  ? [fixture.nestedCode]
                  : [],
              ]),
            ),
      );
      expect(projection.runtime_families, mode).toEqual(
        mode === "files"
          ? fixture.runtimeFamilies
          : mode === "nested"
            ? [fixture.nestedRuntime]
            : [],
      );
      expect(projection.bridge_candidates, mode).toEqual(
        mode === "files" ? fixture.fileBridges : [],
      );
      expect(projection.source_evidence_ids).toEqual([
        inventoryEvidence.evidence_id,
      ]);
      expect(projection.coverage).toEqual({
        status: "complete-within-inventory",
        inventory_complete: true,
      });
      if ("packaging_model" in projection) {
        expect(projection.packaging_model, mode).toBe(
          mode === "files" ? "stage" : "unknown",
        );
        expect(projection.app_pack_children.map((child) => child.path)).toEqual(
          mode === "files" ? childPackages : [],
        );
      }
      expect(Buffer.compare(await readFile(path), Buffer.from(bytes))).toBe(0);
    }
  },
);

cliTest.for([
  {
    family: "Apple IPA",
    extension: "ipa",
    paths: ["Payload/Fixture.app/Info.plist"],
    command: "project-apple-application-graph",
    operation: "project_apple_application_graph",
  },
  {
    family: "Apple macOS bundle",
    extension: "zip",
    paths: [
      "Fixture.app/Contents/Info.plist",
      "Fixture.app/Contents/_CodeSignature/CodeResources",
      "Fixture.app/Contents/Frameworks/Core.framework/Versions/A/Resources/Info.plist",
    ],
    command: "project-apple-application-graph",
    operation: "project_apple_application_graph",
  },
  {
    family: "Harmony Stage",
    extension: "hap",
    paths: ["module.json"],
    command: "project-harmony-application-graph",
    operation: "project_harmony_application_graph",
  },
  {
    family: "Harmony FA",
    extension: "hsp",
    paths: ["config.json"],
    command: "project-harmony-application-graph",
    operation: "project_harmony_application_graph",
  },
  {
    family: "Harmony App Pack",
    extension: "app",
    paths: ["entry.hap", "feature.hsp"],
    command: "project-harmony-application-graph",
    operation: "project_harmony_application_graph",
  },
])(
  "preserves encrypted $family path facts through CLI and stdio MCP",
  { timeout: 60_000 },
  async (fixture, { cli }) => {
    const root = await createTestTempDirectory("rea-mobile-encrypted-paths-");
    const environment = { HOME: root, USERPROFILE: root };
    const { call } = await connectLocalToolsMcp(environment);
    for (const encrypted of [false, true]) {
      const writer = new ZipWriter(new Uint8ArrayWriter());
      for (const member of fixture.paths)
        await writer.add(
          member,
          new TextReader("opaque fixture content"),
          encrypted ? { password: "fixture-only" } : {},
        );
      const bytes = await writer.close();
      const path = join(root, `${encrypted}.${fixture.extension}`);
      await writeFile(path, bytes);
      const inspected = await cli.run({
        arguments: ["inspect-artifact", path, "--json"],
        environment,
      });
      expect(inspected.exitCode, inspected.stderr).toBe(0);
      const inventory = parseEvidence(inspected.json);
      const input = { inventory_evidence: [inventory] };
      const projected = await cli.run({
        arguments: [fixture.command, JSON.stringify(input), "--json"],
        environment,
      });
      expect(projected.exitCode, projected.stderr).toBe(0);
      const evidence = parseEvidence(projected.json);
      const mcp = await call(fixture.operation, input);
      expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
      expect(parseEvidence(mcp.structuredContent)).toEqual(evidence);
      const graph =
        fixture.operation === "project_apple_application_graph"
          ? appleApplicationProjectionResultSchema.parse(
              evidence.normalized_result,
            )
          : harmonyApplicationProjectionResultSchema.parse(
              evidence.normalized_result,
            );
      expect(graph.source_evidence_ids).toEqual([inventory.evidence_id]);
      expect(graph.coverage).toEqual({
        status: encrypted ? "partial" : "complete-within-inventory",
        inventory_complete: true,
      });
      expect(
        graph.unavailable_components.map(({ path }) => path).sort(),
      ).toEqual(encrypted ? [...fixture.paths].sort() : []);
      for (const component of graph.unavailable_components)
        expect(component).toMatchObject({
          artifact_id: null,
          sha256: null,
          encrypted: true,
        });
      expect(graph.runtime_families).toEqual([]);
      expect(graph.bridge_candidates).toEqual([]);
      if ("bundles" in graph) {
        expect(graph.platforms).toEqual([
          fixture.extension === "ipa" ? "ios" : "macos",
        ]);
        expect(
          graph.bundles.map(({ info_plist_path }) => info_plist_path).sort(),
        ).toEqual(
          fixture.paths
            .filter((member) => member.endsWith("Info.plist"))
            .sort(),
        );
        expect(
          graph.bundles.flatMap(({ signing_paths }) => signing_paths),
        ).toEqual(
          fixture.paths.filter((member) => member.endsWith("CodeResources")),
        );
        expect(
          graph.bundles.flatMap(
            ({ executable_candidates }) => executable_candidates,
          ),
        ).toEqual([]);
      } else {
        expect(graph.packaging_model).toBe(
          fixture.extension === "hap"
            ? "stage"
            : fixture.extension === "hsp"
              ? "fa"
              : "unknown",
        );
        expect(graph.app_pack_children.map(({ path }) => path)).toEqual(
          fixture.extension === "app" ? fixture.paths : [],
        );
        for (const child of graph.app_pack_children)
          if (encrypted)
            expect(child).toMatchObject({ artifact_id: null, sha256: null });
          else {
            expect(child.artifact_id).toMatch(/^art_/u);
            expect(child.sha256).toBe(
              createHash("sha256")
                .update("opaque fixture content")
                .digest("hex"),
            );
          }
      }
      if (encrypted) expect(Object.values(graph.components).flat()).toEqual([]);
      expect(Buffer.compare(await readFile(path), Buffer.from(bytes))).toBe(0);
    }
  },
);
