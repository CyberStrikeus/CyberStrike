import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "plist";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "compiled CLI retains a standalone keyed archive alias and accepts either admitted basename",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-selected-cli-");
    const stored = join(root, "stored.plist");
    const selected = join(root, "chosen.plist");
    await writeFile(
      stored,
      build({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null", "leaf"],
        $top: { root: { CF$UID: 1 } },
      }),
    );
    await symlink(stored, selected);
    for (const selection of [undefined, "chosen.plist", "stored.plist"]) {
      const output = await cli.run({
        arguments: [
          "inspect-keyed-archive",
          selected,
          ...(selection === undefined ? [] : [selection]),
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const evidence = parseEvidence(output.json);
      expect(evidence.subject?.local_path).toBe(selected);
      expect(evidence.normalized_result).toMatchObject({
        archive_path: selection ?? "chosen.plist",
      });
    }
  },
);
