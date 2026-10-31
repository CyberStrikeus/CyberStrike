import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { expect } from "vitest";
import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const android = {
  extension: "apk",
  operation: "project_android_application_graph",
  command: "project-android-application-graph",
  scripts: ["classes.dex", "extra.dex"],
  nativeBytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
  libraries: {
    "lib/arm64-v8a/libcommunity.so": "jni-library-convention",
    "lib/arm64-v8a/libpreact.so": "jni-library-convention",
    "lib/arm64-v8a/libreactivity.so": "jni-library-convention",
    "lib/arm64-v8a/libhermesfake.so": "jni-library-convention",
    "lib/arm64-v8a/libflutter.so.backup.so": "jni-library-convention",
  },
  positives: {
    "lib/arm64-v8a/libreactnativejni.so": "react-native-convention",
    "lib/arm64-v8a/libhermes.so": "react-native-convention",
    "lib/arm64-v8a/libflutter.so": "flutter-convention",
    "lib/arm64-v8a/libunity.so": "unity-convention",
  },
};
const apple = {
  extension: "ipa",
  operation: "project_apple_application_graph",
  command: "project-apple-application-graph",
  scripts: ["Payload/Fixture.app/main.js", "Payload/Fixture.app/extra.js"],
  nativeBytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
  libraries: {
    "Payload/Fixture.app/Frameworks/App.framework/App":
      "javascript-and-native-content",
    "Payload/Fixture.app/Frameworks/MyApp.framework/MyApp":
      "javascript-and-native-content",
    "Payload/Fixture.app/Frameworks/Community.framework/Community":
      "javascript-and-native-content",
    "Payload/Fixture.app/Frameworks/Preact.framework/Preact":
      "javascript-and-native-content",
    "Payload/Fixture.app/Frameworks/Reactivity.framework/Reactivity":
      "javascript-and-native-content",
    "Payload/Fixture.app/Frameworks/HermesExtra.framework/HermesExtra":
      "javascript-and-native-content",
    "Payload/Fixture.app/Frameworks/Flutter.framework.backup/Flutter":
      "javascript-and-native-content",
    "Payload/Fixture.app/Frameworks/plain.dylib":
      "javascript-and-native-content",
  },
  positives: {
    "Payload/Fixture.app/Frameworks/React.framework/React":
      "react-native-convention",
    "Payload/Fixture.app/Frameworks/hermes.framework/hermes":
      "react-native-convention",
    "Payload/Fixture.app/Frameworks/Flutter.framework/Flutter":
      "flutter-convention",
    "Payload/Fixture.app/Frameworks/UnityFramework.framework/UnityFramework":
      "unity-convention",
  },
};

cliTest(
  "bounds mobile conventions and preserves inference provenance through compiled CLI and real MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-mobile-conventions-");
    const { call } = await connectLocalToolsMcp();
    const { runProviderAnalysis } = createDirectAnalysis({});
    for (const fixture of [android, apple]) {
      for (const positive of [false, true]) {
        const libraries = positive ? fixture.positives : fixture.libraries;
        const path = join(
          root,
          `${positive ? "positive" : "negative"}.${fixture.extension}`,
        );
        const writer = new ZipWriter(new Uint8ArrayWriter());
        for (const script of fixture.scripts)
          await writer.add(script, new TextReader("export const value = 1;"));
        for (const name of Object.keys(libraries))
          await writer.add(name, new Uint8ArrayReader(fixture.nativeBytes));
        await writeFile(path, await writer.close());
        const inventory = parseEvidence(
          await runProviderAnalysis(path, "inventory_artifact", {}).then(
            projectCliAnalysisResult,
          ),
        );
        const input = { inventory_evidence: [inventory] };
        const result = await cli.run({
          arguments: [fixture.command, JSON.stringify(input), "--json"],
        });
        expect(result.exitCode, result.stderr).toBe(0);
        const evidence = parseEvidence(result.json);
        const response = await call(fixture.operation, input);
        expect(response.isError).not.toBe(true);
        const mcp = parseEvidence(response.structuredContent);
        expect(mcp).toEqual(evidence);
        expect(evidence.normalized_result).toMatchObject({
          runtime_families: positive
            ? fixture.extension === "apk"
              ? ["dalvik-art", "flutter", "native", "react-native", "unity"]
              : ["flutter", "javascript", "native", "react-native", "unity"]
            : fixture.extension === "apk"
              ? ["dalvik-art", "native"]
              : ["javascript", "native"],
          coverage: {
            status: "complete-within-inventory",
            inventory_complete: true,
          },
          limitations: expect.arrayContaining([
            "A bridge basis is inferred from the native path and is repeated for every managed component.",
          ]),
          bridge_candidates: expect.arrayContaining(
            Object.entries(libraries).flatMap(([native_path, basis]) =>
              fixture.scripts.map((script) =>
                expect.objectContaining({
                  native_path,
                  basis,
                  ...(fixture.extension === "apk"
                    ? { managed_path: script }
                    : { source_path: script }),
                }),
              ),
            ),
          ),
        });
      }
    }
  },
  30_000,
);
