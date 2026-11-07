import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "compiled CLI inspects an XML keyed archive with a non-plist suffix",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-xml-extension-cli-");
    const path = join(root, "Model.archive");
    await writeFile(
      path,
      build({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null", "leaf"],
        $top: { root: { UID: 1 } },
      }),
    );
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", path, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    expect(parseEvidence(output.json).normalized_result).toMatchObject({
      archive_path: "Model.archive",
      archive_format: "xml-plist",
      objects: expect.arrayContaining([
        expect.objectContaining({ value: "leaf" }),
      ]),
    });
  },
);
