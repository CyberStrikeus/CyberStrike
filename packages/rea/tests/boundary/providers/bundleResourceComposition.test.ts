import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "plist";
import { afterEach, expect, it } from "vitest";

import { parseConfig } from "../../../src/config/parseConfig.js";
import type { DirectAnalysisDependencies } from "../../../src/application/DirectAnalysisDependencies.js";
import { runProviderAnalysis } from "../../../src/application/DirectAnalysis.js";
import {
  createArtifactBinarySession,
  createBinarySession,
  createManagedBinarySession,
  createNativeBinarySession,
  createNativeDispatchBinarySession,
} from "../../../src/composition/binary.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("routes a CLI app resource path through the resource session and preserves null target identity", async () => {
  const bundlePath = await mkdtemp(join(tmpdir(), "rea-cli-resource-root-"));
  temporaryDirectories.push(bundlePath);
  await mkdir(join(bundlePath, "Resources"));
  await writeFile(
    join(bundlePath, "Info.plist"),
    '<?xml version="1.0"?><plist><dict/></plist>',
  );
  await writeFile(
    join(bundlePath, "Resources", "Archive.plist"),
    build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", "sample"],
      $top: { root: { UID: 1 } },
    }),
  );
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig({}),
    createBinarySession: (config, logger) =>
      createBinarySession(config, logger, {}),
    createNativeDispatchBinarySession: (config, logger) =>
      createNativeDispatchBinarySession(config, logger, {}),
    createArtifactBinarySession: () =>
      createArtifactBinarySession({}, process.platform),
    createNativeBinarySession: () =>
      createNativeBinarySession({}, process.platform),
    createManagedBinarySession,
  };
  const result = await runProviderAnalysis(
    dependencies,
    bundlePath,
    "inspect_keyed_archive",
    { path: "Resources/Archive.plist" },
  ).then(projectCliAnalysisResult);
  expect(result).toMatchObject({
    operation: "inspect_keyed_archive",
    subject: null,
    normalized_result: {
      target_sha256: null,
      resource_root: { canonical_path: bundlePath, executable_sha256: null },
    },
  });
});

it("reports resource capabilities from their providers on supported and unsupported hosts", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "rea-resource-capabilities-"));
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");

  for (const [platform, expected] of [
    ["darwin", { plist: true, assets: true }],
    ["linux", { plist: false, assets: false }],
  ] as const) {
    const session = await createArtifactBinarySession({}, platform);
    const opened = await session.openBundleResources(rootPath);
    expect(opened.ok, platform).toBe(true);
    const status = await session.status();
    const capabilitySets = (
      status as {
        capabilities: Array<{
          groups: Array<{ operations: string[]; available: boolean }>;
        }>;
      }
    ).capabilities;
    const operationAvailability = new Map(
      capabilitySets.flatMap(({ groups }) =>
        groups.flatMap(({ operations, available }) =>
          operations.map((operation) => [operation, available] as const),
        ),
      ),
    );
    expect(operationAvailability.get("inspect_plist"), platform).toBe(
      expected.plist,
    );
    expect(operationAvailability.get("inspect_asset_catalog"), platform).toBe(
      expected.assets,
    );
    expect(
      operationAvailability.get("decode_interface_builder"),
      platform,
    ).toBe(true);
    expect(operationAvailability.get("inspect_keyed_archive"), platform).toBe(
      true,
    );
    await session.close();
  }
});
