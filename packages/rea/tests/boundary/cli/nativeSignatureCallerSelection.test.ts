import { execFile } from "node:child_process";
import { copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { inspectPlistSchema } from "../../../src/domain/native/nativeInspection.js";
import { appleAssetCatalogResultSchema } from "../../../src/domain/apple/appleAssetCatalog.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const run = promisify(execFile);
const environment = {
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "auto",
} as const;

const signedApp = async () => {
  const root = await createTestTempDirectory("rea-selected-app-");
  const app = join(root, "Probe.app");
  const executable = join(app, "Contents/MacOS/Probe");
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  await copyFile("/usr/bin/true", executable);
  await writeFile(
    join(app, "Contents/Info.plist"),
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Probe</string><key>CFBundleIdentifier</key><string>org.example.rea.probe</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
  );
  await run("/usr/bin/codesign", ["-s", "-", "-f", app]);
  await symlink("Probe.app", join(root, "Selected.app"));
  return { root, app, executable };
};

describe.skipIf(process.platform !== "darwin")(
  "native app CLI caller selection",
  () => {
    cliTest(
      "retains the selected app alias across signature, plist, and absent asset inspections",
      async ({ cli }) => {
        const { root, app, executable } = await signedApp();
        for (const command of [
          "inspect-signature",
          "inspect-plist",
          "inspect-asset-catalog",
        ]) {
          const selectedRun = await cli.run({
            arguments: [command, "Selected.app", "--json"],
            cwd: root,
            environment,
          });
          const directRun = await cli.run({
            arguments: [command, "Probe.app", "--json"],
            cwd: root,
            environment,
          });
          expect(selectedRun.exitCode, selectedRun.stderr).toBe(0);
          expect(directRun.exitCode, directRun.stderr).toBe(0);
          const selected = parseEvidence(selectedRun.json);
          const direct = parseEvidence(directRun.json);
          expect(selected.parameters).toMatchObject({
            input_path: "Selected.app",
          });
          expect(direct.parameters).toMatchObject({ input_path: "Probe.app" });
          expect(selected.subject).toEqual(direct.subject);
          if (command === "inspect-signature") {
            expect(selected.subject?.local_path).toBe(executable);
            expect(selected.normalized_result).toEqual(
              direct.normalized_result,
            );
          } else if (command === "inspect-plist") {
            const aliasResult = inspectPlistSchema.parse(
              selected.normalized_result,
            );
            const directResult = inspectPlistSchema.parse(
              direct.normalized_result,
            );
            expect(aliasResult.resource_root).toMatchObject({
              caller_path: join(root, "Selected.app"),
              canonical_path: app,
            });
            expect(directResult.resource_root).toMatchObject({
              caller_path: app,
              canonical_path: app,
            });
            expect({
              ...aliasResult,
              resource_root: directResult.resource_root,
            }).toEqual(directResult);
          } else {
            const aliasResult = appleAssetCatalogResultSchema.parse(
              selected.normalized_result,
            );
            const directResult = appleAssetCatalogResultSchema.parse(
              direct.normalized_result,
            );
            expect(aliasResult.catalogs).toEqual([]);
            expect(aliasResult.resource_root).toMatchObject({
              caller_path: join(root, "Selected.app"),
              canonical_path: app,
            });
            expect(directResult.resource_root).toMatchObject({
              caller_path: app,
              canonical_path: app,
            });
            expect({
              ...aliasResult,
              resource_root: directResult.resource_root,
            }).toEqual(directResult);
          }
        }
      },
    );
  },
);
