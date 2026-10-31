import { projectCliAnalysisResult } from "../../../../src/cli/projectCliAnalysisResult.js";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { createDirectAnalysis } from "../../../../src/composition/directAnalysis.js";
import { artifactInspectionResultSchema } from "../../../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";

const { runProviderAnalysis } = createDirectAnalysis({});

// mach_header_64 for an arm64 MH_EXECUTE image with no load commands.
const MACH_O_64 = Buffer.alloc(32);
MACH_O_64.writeUInt32LE(0xfeedfacf, 0);
MACH_O_64.writeUInt32LE(0x0100000c, 4);
MACH_O_64.writeUInt32LE(2, 12);
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>
`;

const writeTree = async (
  root: string,
  files: Readonly<Record<string, string | Buffer>>,
): Promise<void> => {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
};

const probeOperations = async (path: string): Promise<string[]> => {
  const evidence = parseEvidence(
    await runProviderAnalysis(path, "inspect_artifact", {}).then(
      projectCliAnalysisResult,
    ),
  );
  const inspection = artifactInspectionResultSchema.parse(
    evidence.normalized_result,
  );
  expect(inspection.subject.root_format).toBe("directory");
  expect(
    inspection.unexplored_branches.map(({ next_probe }) => next_probe),
  ).toEqual(inspection.next_probes);
  return inspection.next_probes.map(({ operation }) => operation);
};

describe("directory inspection probes", () => {
  it("proposes native and plist probes for an application bundle without JavaScript", async () => {
    const root = await createTestTempDirectory("rea-artifact-bundle-");
    const bundle = join(root, "Fixture.app");
    await writeTree(bundle, {
      "Contents/MacOS/Fixture": MACH_O_64,
      "Contents/Info.plist": INFO_PLIST,
    });

    expect(await probeOperations(bundle)).toEqual([
      "open_binary",
      "inspect_plist",
    ]);
  });

  it("keeps JavaScript analysis first for an Electron-style bundle", async () => {
    const root = await createTestTempDirectory("rea-artifact-electron-");
    const source = join(root, "source");
    const bundle = join(root, "Fixture.app");
    await writeTree(source, { "main.js": "console.log('ok');\n" });
    await writeTree(bundle, {
      "Contents/MacOS/Fixture": MACH_O_64,
      "Contents/Info.plist": INFO_PLIST,
    });
    await createPackageWithOptions(
      source,
      join(bundle, "Contents/Resources/app.asar"),
      {},
    );

    expect(await probeOperations(bundle)).toEqual([
      "analyze_javascript_application",
      "open_binary",
      "inspect_plist",
    ]);
  });

  it.each(["cjs", "cts", "mjs", "mts", "js", "jsx", "ts", "tsx"])(
    "proposes JavaScript analysis for .%s sources the analyzer reads",
    async (extension) => {
      const root = await createTestTempDirectory("rea-artifact-typescript-");
      const bundle = join(root, "Fixture.app");
      await writeTree(bundle, {
        "Contents/MacOS/Fixture": MACH_O_64,
        "Contents/Info.plist": INFO_PLIST,
        [`Contents/Resources/app/main.${extension}`]:
          "export const ok = true;\n",
      });

      expect(await probeOperations(bundle)).toEqual([
        "analyze_javascript_application",
        "open_binary",
        "inspect_plist",
      ]);
    },
  );

  it("preserves plist inspection for a readable Info.plist symlink", async () => {
    const root = await createTestTempDirectory("rea-artifact-plist-link-");
    const bundle = join(root, "Fixture.app");
    await writeTree(bundle, { "Contents/MacOS/Fixture": MACH_O_64 });
    await writeFile(join(root, "bundle-metadata"), INFO_PLIST);
    await symlink(
      join(root, "bundle-metadata"),
      join(bundle, "Contents/Info.plist"),
    );
    expect(await probeOperations(bundle)).toEqual([
      "open_binary",
      "inspect_plist",
    ]);
  });

  it("does not propose JavaScript analysis for a symlink the analyzers never follow", async () => {
    const root = await createTestTempDirectory("rea-artifact-symlink-");
    const bundle = join(root, "Fixture.app");
    await writeTree(bundle, {
      "Contents/MacOS/Fixture": MACH_O_64,
      "Contents/Info.plist": INFO_PLIST,
    });
    await writeTree(root, { "outside.js": "console.log('outside');\n" });
    await mkdir(join(bundle, "Contents/Resources"));
    await symlink(
      join(root, "outside.js"),
      join(bundle, "Contents/Resources/main.js"),
    );

    expect(await probeOperations(bundle)).toEqual([
      "open_binary",
      "inspect_plist",
    ]);
  });
});
