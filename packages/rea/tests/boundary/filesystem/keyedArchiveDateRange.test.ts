import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect } from "vitest";

import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "built CLI preserves dates with years beyond four digits",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-archive-date-");
    const path = join(root, "archive.plist");
    // XML property-list dates use an extended ISO year in the public schema.
    const xml = build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", "__FAR__", new Date("2020-01-01T00:00:00Z")],
      $top: { far: { CF$UID: 1 }, near: { CF$UID: 2 } },
    }).replace(
      "<string>__FAR__</string>",
      "<date>11507-08-17T05:20:00Z</date>",
    );
    await writeFile(path, xml);
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", path, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode).toBe(0);
    const result = keyedArchiveResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(
      result.objects.map(({ id, kind, value }) => ({ id, kind, value })),
    ).toEqual([
      { id: 0, kind: "nil", value: "$null" },
      {
        id: 1,
        kind: "scalar",
        value: { $plist_type: "date", iso8601: "+011507-08-17T05:20:00.000Z" },
      },
      {
        id: 2,
        kind: "scalar",
        value: { $plist_type: "date", iso8601: "2020-01-01T00:00:00.000Z" },
      },
    ]);
    expect(result.limitations).not.toContainEqual(
      expect.stringContaining("date value(s)"),
    );
  },
);
