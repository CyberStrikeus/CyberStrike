import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "plist";
import { afterEach, expect, it } from "vitest";

import { createCli } from "./cli.js";
import { parseEvidence } from "./domain/evidence.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("inspects a keyless app bundle through the public CLI and preserves resource provenance", async () => {
  const parent = await mkdtemp(join(tmpdir(), "rea-bundle-resource-cli-"));
  temporaryDirectories.push(parent);
  const bundle = join(parent, "Fixture.app");
  const resources = join(bundle, "Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(join(bundle, "Info.plist"), "<plist><dict/></plist>");
  await writeFile(
    join(resources, "Archive.plist"),
    build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", "resource-only-value"],
      $top: { root: { UID: 1 } },
    }),
  );

  const cli = createCli({ REA_LOG_LEVEL: "silent" });
  let stdout = "";
  let exitCode = 0;
  await cli.serve(
    ["inspect-keyed-archive", bundle, "Resources/Archive.plist", "--json"],
    {
      env: {},
      exit: (code) => {
        exitCode = code;
      },
      stdout: (text) => {
        stdout += text;
      },
    },
  );
  expect(exitCode, stdout).toBe(0);
  expect(parseEvidence(JSON.parse(stdout))).toMatchObject({
    subject: null,
    normalized_result: {
      archive_path: "Resources/Archive.plist",
      target_sha256: null,
      resource_root: {
        caller_path: bundle,
        canonical_path: bundle,
        executable_sha256: null,
      },
      objects: expect.arrayContaining([
        expect.objectContaining({ value: "resource-only-value" }),
      ]),
    },
  });
});
