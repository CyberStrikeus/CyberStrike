import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { CAPTURE_SKIP_REASON } from "./processCaptureCapability.js";

const captureCliTest = cliTest.skipIf(
  CAPTURE_SKIP_REASON ||
    (process.platform === "win32" ? "requires POSIX symlink semantics" : false),
);

const racePreload = `
import fs from "node:fs";
import { resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";

const cliEntry = process.env.REA_TEST_CLI_ENTRY;
if (cliEntry !== undefined && resolve(process.argv[1] ?? "") === cliEntry) {
  const target = resolve(process.env.REA_TEST_SYMLINK ?? "");
  const countPath = process.env.REA_TEST_READLINK_COUNT;
  const removeOnSecondRead = process.env.REA_TEST_REMOVE_ON_SECOND_READ === "1";
  let matchingReads = 0;
  const originalReadlink = fs.promises.readlink;
  fs.promises.readlink = async function (path, ...options) {
    if (resolve(String(path)) === target) {
      matchingReads += 1;
      if (countPath !== undefined) fs.appendFileSync(countPath, "read\\n");
      if (removeOnSecondRead && matchingReads === 2) {
        await fs.promises.unlink(path);
      }
    }
    return originalReadlink.call(this, path, ...options);
  };
  syncBuiltinESMExports();
}
`;

const createScenario = async (removeOnSecondRead: boolean) => {
  const root = await createTestTempDirectory("rea-snapshot-race-cli-");
  const observed = join(root, "observed");
  const link = join(observed, "vanishing-link");
  const scenario = join(root, "scenario.json");
  const preload = join(root, "readlink-race-preload.mjs");
  const readlinkCount = join(root, "readlink-count.txt");
  await mkdir(observed);
  await writeFile(join(observed, "sibling.txt"), "sibling evidence\n");
  await symlink("target-does-not-need-to-exist", link);
  await writeFile(preload, racePreload);
  await writeFile(
    scenario,
    JSON.stringify({
      executable: process.execPath,
      arguments: ["-e", "process.stdout.write('controlled capture\\n')"],
      working_directory: root,
      filesystem_observation_paths: [observed],
    }),
  );
  return { root, link, scenario, preload, readlinkCount, removeOnSecondRead };
};

captureCliTest(
  "retains a stable symlink while reporting its unfollowed scope through the public CLI",
  async ({ cli }) => {
    const fixture = await createScenario(false);
    const result = await cli.run({
      arguments: ["capture-process", fixture.scenario, "--json"],
      cwd: fixture.root,
      environment: {
        NODE_OPTIONS: `--import=${pathToFileURL(fixture.preload).href}`,
        REA_TEST_CLI_ENTRY: resolve("scripts/rea.mjs"),
        REA_TEST_SYMLINK: fixture.link,
        REA_TEST_READLINK_COUNT: fixture.readlinkCount,
        REA_TEST_REMOVE_ON_SECOND_READ: fixture.removeOnSecondRead ? "1" : "0",
      },
    });

    expect(result.exitCode, result.stderr || result.stdout).toBe(0);
    expect(await readFile(fixture.readlinkCount, "utf8")).toBe("read\nread\n");
    expect((await lstat(fixture.link)).isSymbolicLink()).toBe(true);
    expect(result.json).toMatchObject({
      normalized_result: {
        truncated: true,
        files_before: expect.arrayContaining([
          expect.objectContaining({
            path: "root_0:vanishing-link",
            type: "symlink",
            symlink_target: "target-does-not-need-to-exist",
          }),
        ]),
        files_after: expect.arrayContaining([
          expect.objectContaining({
            path: "root_0:vanishing-link",
            type: "symlink",
            symlink_target: "target-does-not-need-to-exist",
          }),
        ]),
        truncation_details: {
          filesystem_after: {
            enumeration_truncated: true,
            enumeration_reasons: ["symlink_not_followed"],
            enumeration_omissions: [
              {
                path: "root_0:vanishing-link",
                reason: "symlink_not_followed",
                system_code: null,
              },
            ],
          },
        },
      },
    });
  },
);

captureCliTest(
  "retains sibling evidence and marks a vanished symlink unknown",
  async ({ cli }) => {
    const fixture = await createScenario(true);
    const result = await cli.run({
      arguments: ["capture-process", fixture.scenario, "--json"],
      cwd: fixture.root,
      environment: {
        NODE_OPTIONS: `--import=${pathToFileURL(fixture.preload).href}`,
        REA_TEST_CLI_ENTRY: resolve("scripts/rea.mjs"),
        REA_TEST_SYMLINK: fixture.link,
        REA_TEST_READLINK_COUNT: fixture.readlinkCount,
        REA_TEST_REMOVE_ON_SECOND_READ: "1",
      },
    });

    expect(await readFile(fixture.readlinkCount, "utf8")).toBe("read\nread\n");
    await expect(readFile(fixture.link)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(result.exitCode, result.stderr || result.stdout).toBe(0);
    expect(result.json).toMatchObject({
      normalized_result: {
        truncated: true,
        files_before: expect.arrayContaining([
          expect.objectContaining({
            path: "root_0:vanishing-link",
            type: "symlink",
          }),
          expect.objectContaining({ path: "root_0:sibling.txt", type: "file" }),
        ]),
        files_after: expect.arrayContaining([
          expect.objectContaining({ path: "root_0:sibling.txt", type: "file" }),
        ]),
        filesystem_effects: expect.arrayContaining([
          expect.objectContaining({
            path: "root_0:vanishing-link",
            status: "unknown",
            after: null,
          }),
        ]),
        truncation_details: {
          filesystem_after: {
            enumeration_truncated: true,
            enumeration_reasons: expect.arrayContaining(["entry_unavailable"]),
            enumeration_omissions: [
              {
                path: "root_0:vanishing-link",
                reason: "entry_unavailable",
                system_code: "ENOENT",
              },
            ],
          },
        },
      },
    });
  },
);
