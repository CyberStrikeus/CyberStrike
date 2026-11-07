import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import { snapshotHopperRuntime } from "../../../../scripts/lib/real-hopper-cleanup.mjs";
import { acquireHopperTargetLease } from "../../../../src/process/HopperLease.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "does not classify a released shared lease directory as a session leak",
  async () => {
    const parent = await createLeaseWorkspace();
    const directory = join(parent, "rea-hopper-501");
    const targetPath = join(parent, "target");
    await writeFile(targetPath, "source-owned lease target");
    const before = await snapshotHopperRuntime(parent, directory);
    const acquired = await acquireHopperTargetLease({
      targetPath,
      targetKind: "executable",
      loaderArgs: [],
      runId: "released-verifier-lease",
      directory,
    });
    if (!acquired.acquired) throw new Error("Expected the owned target lease");
    await acquired.lease.release();

    expect(await readdir(directory)).toEqual([]);
    expect(await snapshotHopperRuntime(parent, directory)).toEqual(before);
  },
);

it.skipIf(process.platform === "win32")(
  "retains an unreleased real target-lease socket in cleanup observations",
  async () => {
    const parent = await createLeaseWorkspace();
    const directory = join(parent, "rea-hopper-501");
    const targetPath = join(parent, "target");
    await writeFile(targetPath, "source-owned lease target");
    const acquired = await acquireHopperTargetLease({
      targetPath,
      targetKind: "executable",
      loaderArgs: [],
      runId: "retained-verifier-lease",
      directory,
    });
    if (!acquired.acquired) throw new Error("Expected the owned target lease");
    try {
      const children = await readdir(directory);
      expect(children).toHaveLength(1);
      expect(await snapshotHopperRuntime(parent, directory)).toEqual(
        new Set(children.map((name) => join(directory, name))),
      );
    } finally {
      await acquired.lease.release();
    }
  },
);

it("reports retained sessions belonging to observed MCP processes", async () => {
  const parent = await createTestTempDirectory("rea-cleanup-retained-session-");
  const directory = join(parent, "rea-hopper-501");
  const previous = join(parent, "rea-existing-session");
  await mkdir(previous);
  const before = await snapshotHopperRuntime(parent, directory);
  const retained = join(parent, "rea-retained-session");
  const unrelated = join(parent, "rea-unrelated-session");
  const unknown = join(parent, "rea-no-ownership-record");
  for (const path of [retained, unrelated, unknown]) await mkdir(path);
  await writeFile(join(retained, "bootstrap.py"), "source-owned fixture");
  await writeFile(
    join(retained, "ownership.json"),
    JSON.stringify({ parent_pid: process.pid }),
  );
  await writeFile(
    join(unrelated, "ownership.json"),
    JSON.stringify({ parent_pid: process.pid + 1 }),
  );
  const after = await snapshotHopperRuntime(
    parent,
    directory,
    new Set([process.pid]),
  );

  expect([...after].filter((path) => !before.has(path))).toEqual([retained]);
});

it("reports an unexpected file at the shared lease root", async () => {
  const parent = await createTestTempDirectory("rea-cleanup-invalid-lease-");
  const directory = join(parent, "rea-hopper-501");
  await writeFile(directory, "unexpected lease root file");

  expect(await snapshotHopperRuntime(parent, directory)).toEqual(
    new Set([directory]),
  );
});

const createLeaseWorkspace = async (): Promise<string> => {
  // Unix socket paths must fit the host sockaddr_un limit, independently of
  // the test runner's potentially long redirected temporary directory.
  const parent = await mkdtemp("/tmp/rhv-");
  onTestFinished(() => rm(parent, { recursive: true, force: true }));
  return parent;
};
