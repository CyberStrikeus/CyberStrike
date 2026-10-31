import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  installMacHopperBundle,
  systemMacHopperInstallHost,
  type MacHopperBundleInstallOperations,
} from "../../../src/application/MacHopper.js";
import { SetupCleanupOwner } from "../../../src/application/SetupCleanupOwner.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "rea-hopper-owned-stage-test-"));
  roots.push(root);
  return root;
};

const bundleFiles = (
  overrides: Partial<MacHopperBundleInstallOperations> = {},
  captureRoot?: (root: string, mode: number) => void,
): MacHopperBundleInstallOperations => ({
  async createStagingRoot(parent) {
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, ".rea-hopper-stage-"));
    captureRoot?.(root, (await stat(root)).mode & 0o777);
    return root;
  },
  async copyBundle(source, stage) {
    const executable = join(stage, "Contents/MacOS/hopper");
    await mkdir(join(stage, "Contents/MacOS"), { recursive: true });
    await writeFile(executable, source);
  },
  requireLauncher: async (path) => access(path).then(() => undefined),
  async pathExists(path) {
    try {
      await access(path);
      return true;
    } catch (cause: unknown) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "ENOENT"
      )
        return false;
      throw cause;
    }
  },
  rename,
  removeStagingRoot: (path) => rm(path, { recursive: true }),
  ...overrides,
});

const writeBundle = async (path: string, content: string): Promise<void> => {
  await mkdir(join(path, "Contents/MacOS"), { recursive: true });
  await writeFile(join(path, "Contents/MacOS/hopper"), content);
};

describe("macOS Hopper staging isolation", () => {
  it("rejects a staged bundle without its launcher before moving the original", async () => {
    const root = await temporaryRoot();
    const destination = join(root, "Applications/Hopper Disassembler.app");
    await writeBundle(destination, "original installation");
    let stagingRoot = "";

    const result = await installMacHopperBundle(
      "replacement without launcher",
      destination,
      true,
      bundleFiles(
        {
          async copyBundle(_source, stage) {
            await mkdir(join(stage, "Contents/MacOS"), { recursive: true });
          },
        },
        (path) => (stagingRoot = path),
      ),
      () => undefined,
    );

    expect(result).toMatchObject({
      status: "failed",
      reason: "launcher_missing",
      diagnostic: expect.stringContaining("hopper"),
    });
    expect(
      await readFile(join(destination, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("original installation");
    await expect(
      access(join(stagingRoot, "previous.app")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves pre-existing staging-looking sibling directories untouched", async () => {
    const root = await temporaryRoot();
    const applications = join(root, "Applications");
    const destination = join(applications, "Hopper Disassembler.app");
    const oldStage = `${destination}.rea-stage`;
    const oldPrevious = `${oldStage}-previous`;
    await Promise.all([
      writeBundle(oldStage, "user stage sentinel"),
      writeBundle(oldPrevious, "user backup sentinel"),
    ]);
    let stagingRoot = "";
    let stagingMode = 0;

    await expect(
      installMacHopperBundle(
        "new bundle",
        destination,
        false,
        bundleFiles({}, (path, mode) => {
          stagingRoot = path;
          stagingMode = mode;
        }),
        () => undefined,
      ),
    ).resolves.toEqual({ status: "installed" });

    expect(
      await readFile(join(oldStage, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("user stage sentinel");
    expect(
      await readFile(join(oldPrevious, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("user backup sentinel");
    expect(
      await readFile(join(destination, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("new bundle");
    expect(stagingMode).toBe(0o700);
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("macOS Hopper replacement ownership", () => {
  it("keeps the committed replacement when owned-root cleanup fails", async () => {
    const root = await temporaryRoot();
    const destination = join(root, "Applications/Hopper Disassembler.app");
    await writeBundle(destination, "previous installation");
    let stagingRoot = "";
    let failedCleanup = false;
    const retained: (() => Promise<void>)[] = [];

    const result = await installMacHopperBundle(
      "new installation",
      destination,
      true,
      bundleFiles(
        {
          removeStagingRoot: async (path) => {
            if (!failedCleanup) {
              failedCleanup = true;
              throw new Error("simulated cleanup denial");
            }
            await rm(path, { recursive: true });
          },
        },
        (path) => (stagingRoot = path),
      ),
      (cleanup, resources) => {
        expect(resources).toEqual([stagingRoot]);
        retained.push(cleanup);
      },
    );

    expect(result).toMatchObject({
      status: "installed",
      cleanupFailure: expect.stringContaining("simulated cleanup denial"),
    });
    expect(
      await readFile(join(destination, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("new installation");
    expect(
      await readFile(
        join(stagingRoot, "previous.app/Contents/MacOS/hopper"),
        "utf8",
      ),
    ).toBe("previous installation");
    expect(retained).toHaveLength(1);

    await retained[0]!();
    expect(
      await readFile(join(destination, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("new installation");
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains a moved backup and never overwrites a later destination on rollback", async () => {
    const root = await temporaryRoot();
    const destination = join(root, "Applications/Hopper Disassembler.app");
    await writeBundle(destination, "original installation");
    let stagingRoot = "";
    let backupMoved = false;
    let concurrentInstallCreated = false;
    const rollbackRetained: (() => Promise<void>)[] = [];
    const realRename = rename;

    const result = await installMacHopperBundle(
      "replacement installation",
      destination,
      true,
      bundleFiles(
        {
          rename: async (source, target) => {
            if (source === destination && target.endsWith("/previous.app")) {
              await realRename(source, target);
              backupMoved = true;
              return;
            }
            if (source.endsWith("/new.app") && target === destination) {
              await writeBundle(destination, "later installation");
              concurrentInstallCreated = true;
              throw new Error("simulated competing install");
            }
            await realRename(source, target);
          },
        },
        (path) => (stagingRoot = path),
      ),
      (cleanup, resources) => {
        expect(resources).toEqual([stagingRoot]);
        rollbackRetained.push(cleanup);
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      diagnostic: expect.stringContaining("simulated competing install"),
      cleanupFailure: expect.stringContaining(
        "previous Hopper bundle remains owned",
      ),
    });
    expect(backupMoved).toBe(true);
    expect(concurrentInstallCreated).toBe(true);
    expect(
      await readFile(join(destination, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("later installation");
    expect(
      await readFile(
        join(stagingRoot, "previous.app/Contents/MacOS/hopper"),
        "utf8",
      ),
    ).toBe("original installation");
    expect(rollbackRetained).toHaveLength(1);

    await expect(rollbackRetained[0]!()).rejects.toThrow(
      "destination is occupied",
    );
    expect(
      await readFile(
        join(stagingRoot, "previous.app/Contents/MacOS/hopper"),
        "utf8",
      ),
    ).toBe("original installation");
    await rm(destination, { recursive: true });
    await rollbackRetained[0]!();
    expect(
      await readFile(join(destination, "Contents/MacOS/hopper"), "utf8"),
    ).toBe("original installation");
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("reports only retained Mac cleanup roots and clears the live report after exact retries", async () => {
  const home = await temporaryRoot();
  const temporary = join(home, "owned-dmg");
  const stage = join(home, "owned-stage");
  await Promise.all([mkdir(temporary), mkdir(stage)]);
  const host = systemMacHopperInstallHost(home, { HOME: home });
  let allowTemporary = false;
  let allowStage = false;
  let temporaryCalls = 0;
  host.retainCleanup?.(async () => {
    temporaryCalls++;
    if (!allowTemporary) throw new Error("DMG root busy");
    await rm(temporary, { recursive: true });
  }, [temporary]);
  host.retainCleanup?.(async () => {
    if (!allowStage) throw new Error("staging root busy");
    await rm(stage, { recursive: true });
  }, [stage]);
  const cleanup = new SetupCleanupOwner([{ close: () => host.close() }]);
  const failure = await cleanup.close();
  expect(failure).toBeDefined();
  expect(projectAnalysisError(failure!).details?.resources).toEqual([
    temporary,
    stage,
  ]);
  allowTemporary = true;
  expect((await cleanup.close())?.cleanupResources).toEqual([stage]);
  expect(failure?.cleanupResources).toEqual([stage]);
  await expect(access(temporary)).rejects.toMatchObject({ code: "ENOENT" });
  allowStage = true;
  expect(await cleanup.close()).toBeUndefined();
  expect(failure?.cleanupIncomplete).toBe(false);
  expect(temporaryCalls).toBe(2);
  await expect(access(stage)).rejects.toMatchObject({ code: "ENOENT" });
});
