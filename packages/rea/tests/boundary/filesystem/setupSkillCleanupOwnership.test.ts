import { createHash } from "node:crypto";
import {
  mkdir,
  open as fsOpen,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createDoctorHostFixture } from "../../../src/application/Doctor.fixture.js";
import { runDoctorOwned } from "../../../src/application/Doctor.js";
import {
  readSkillFile,
  skillDestinations,
} from "../../../src/application/SetupSkill.js";
import { RegularFileCleanupFailure } from "../../../src/filesystem/OwnedRegularFile.js";
import { systemSetupHost } from "../../../src/application/SetupHost.js";
import { runSetup } from "../../../src/application/Setup.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ConfigurationError } from "../../../src/domain/configurationErrors.js";
import {
  runUninstall,
  systemUninstallHost,
} from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const openMock = vi.mocked(fsOpen);
let actualFs: typeof import("node:fs/promises");

beforeEach(async () => {
  actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  openMock.mockImplementation((...args) => actualFs.open(...args));
});

afterEach(() => openMock.mockReset());

const failFirstCloses = (path: string) => {
  const attempts: FileHandle[] = [];
  let allowClose = false;
  openMock.mockImplementation(async (...args) => {
    const handle = await actualFs.open(...args);
    if (String(args[0]) !== path) return handle;
    const nativeClose = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      attempts.push(handle);
      if (!allowClose) throw new Error("test holds the skill handle open");
      await nativeClose();
    });
    return handle;
  });
  return {
    attempts,
    release: () => {
      allowClose = true;
    },
  };
};

describe("setup skill backup cleanup ownership", () => {
  it.each(["first", "recovery", "verification"] as const)(
    "retains a failed %s backup read until setup host disposal",
    async (stage) => {
      const home = await createTestTempDirectory(
        "rea-setup-skill-backup-close-",
      );
      const [destination] = skillDestinations(home, [], {}, "linux");
      if (destination === undefined)
        throw new Error("Shared skill root missing");
      const manifest = join(destination.path, "SKILL.md");
      const original = "stale managed skill\n";
      const firstBackup = `${manifest}.rea.backup`;
      const backup =
        stage === "recovery"
          ? `${firstBackup}.${createHash("sha256").update(original).digest("hex")}.recovery`
          : firstBackup;
      await mkdir(dirname(manifest), { recursive: true });
      await writeFile(manifest, original);
      if (stage === "recovery")
        await writeFile(firstBackup, "historical skill\n");
      if (stage !== "verification") await writeFile(backup, original);
      const close = failFirstCloses(backup);
      const host = systemSetupHost(
        createDoctorHostFixture({ platform: "linux", homeDirectory: home }),
        { HOME: home },
      );

      try {
        const result = await host.installSkill([]);
        expect(result).toMatchObject({ ok: false, error: { stage: "backup" } });
        expect(close.attempts.length).toBeGreaterThan(0);
        expect(new Set(close.attempts).size).toBe(1);
        const opensBeforeAdmission = openMock.mock.calls.length;
        expect((await host.installSkill([])).ok).toBe(false);
        expect(openMock).toHaveBeenCalledTimes(opensBeforeAdmission);
        expect(new Set(close.attempts).size).toBe(1);
        expect(await actualFs.readFile(manifest, "utf8")).toBe(original);
        const report = await host.close?.();
        expect(report?.cleanup?.reason).toBe(
          "test holds the skill handle open",
        );
        expect(report?.cleanupResources).toEqual([backup]);
        const primary = new ConfigurationError(
          "Controlled setup state failure",
          {
            settings: [
              { setting: "fixture", constraint: "Controlled primary failure" },
            ],
          },
        );
        const failure = await runSetup(
          { approved: true, installHopper: false, structured: true },
          {
            ...host,
            nodeVersion: "24.22.1",
            initialSetupState: async () => {
              throw primary;
            },
          },
        ).then(
          () => undefined,
          (cause: unknown) => cause,
        );
        expect(failure).toBeInstanceOf(AnalysisError);
        if (!(failure instanceof AnalysisError))
          throw new Error("Expected the typed setup and host cleanup failure");
        expect(projectAnalysisError(failure)).toMatchObject({
          code: "cleanup_incomplete",
          details: {
            resources: [backup],
            diagnostics: {
              cleanup_error: { details: { resources: [backup] } },
            },
          },
        });
        expect(failure.diagnostics?.primary_error).toEqual(
          projectAnalysisError(primary),
        );
        const attemptsBeforeClose = close.attempts.length;
        close.release();
        expect(await host.close?.()).toBeUndefined();
        expect(failure.cleanupIncomplete).toBe(false);
        expect(projectAnalysisError(failure)).toMatchObject(
          projectAnalysisError(primary),
        );
        expect(projectAnalysisError(failure).details).not.toHaveProperty(
          "cleanup",
        );
        expect(projectAnalysisError(failure).details).not.toHaveProperty(
          "resources",
        );
        expect(projectAnalysisError(failure).details).toHaveProperty(
          "cleanup_history",
        );
        expect(close.attempts.length).toBeGreaterThan(attemptsBeforeClose);
        expect(close.attempts[0]?.fd).toBe(-1);
      } finally {
        close.release();
        await host.close?.();
        // Reclaim the real test descriptor even when the retention regression fails.
        for (const handle of new Set(close.attempts)) await handle.close();
      }
    },
  );
});

describe("skill regular-file cleanup ownership", () => {
  it("retains a failed setup skill read until setup host disposal", async () => {
    const home = await createTestTempDirectory("rea-setup-skill-close-");
    const [destination] = skillDestinations(home, [], {}, "linux");
    if (destination === undefined) throw new Error("Shared skill root missing");
    const manifest = join(destination.path, "SKILL.md");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, "stale managed skill\n");
    const close = failFirstCloses(manifest);
    const host = systemSetupHost(
      createDoctorHostFixture({ platform: "linux", homeDirectory: home }),
      { HOME: home },
    );

    try {
      const failure = await host.skillNeedsInstall([]).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(RegularFileCleanupFailure);
      expect(failure).toMatchObject({
        path: manifest,
        outcome: { kind: "completed" },
        cleanupCause: expect.objectContaining({
          message: "test holds the skill handle open",
        }),
      });
      expect(close.attempts.length).toBeGreaterThan(0);
      expect(new Set(close.attempts).size).toBe(1);
      const attemptsBeforeClose = close.attempts.length;
      close.release();
      expect(await host.close?.()).toBeUndefined();
      expect(close.attempts.length).toBeGreaterThan(attemptsBeforeClose);
      expect(new Set(close.attempts).size).toBe(1);
      expect(close.attempts[0]?.fd).toBe(-1);
    } finally {
      close.release();
      await host.close?.();
    }
  });

  it("waits for an admitted skill read before its resource scope closes", async () => {
    const home = await createTestTempDirectory("rea-setup-skill-inflight-");
    const [destination] = skillDestinations(home, []);
    if (destination === undefined) throw new Error("Shared skill root missing");
    const manifest = join(destination.path, "SKILL.md");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, "stale managed skill\n");
    const resources = new ArtifactResourceScope();
    let beginRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      beginRead = resolve;
    });
    let unblockRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      unblockRead = resolve;
    });
    let heldRead = false;
    openMock.mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (String(args[0]) !== manifest || heldRead) return handle;
      heldRead = true;
      const nativeRead = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs) => {
        beginRead();
        await readGate;
        return nativeRead(...readArgs);
      });
      return handle;
    });

    const reading = readSkillFile(manifest, resources);
    let closing: Promise<void> | undefined;
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(readStarted, reading, "skill read");
      let closed = false;
      closing = resources.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      unblockRead();
      expect(await reading).toBe("stale managed skill\n");
      await closing;
      expect(closed).toBe(true);
    }, [
      unblockRead,
      async () => {
        await reading;
      },
      async () => {
        await closing;
      },
      () => resources.close(),
    ]);
  });
});

describe("skill cleanup diagnostics", () => {
  it("preserves read and host cleanup failures when doctor identity cannot complete", async () => {
    const home = await createTestTempDirectory("rea-doctor-skill-close-");
    const [destination] = skillDestinations(home, []);
    if (destination === undefined) throw new Error("Shared skill root missing");
    const manifest = join(destination.path, "SKILL.md");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, "managed skill fixture\n");
    const close = failFirstCloses(manifest);
    const resources = new ArtifactResourceScope();
    const host = createDoctorHostFixture({
      installedSkillIdentity: async () => {
        await readSkillFile(manifest, resources);
        return { version: null, toolCount: null, canonical: true };
      },
      close: async () => {
        try {
          await resources.close();
          return undefined;
        } catch (cause: unknown) {
          return cause instanceof Error ? cause.message : String(cause);
        }
      },
    });

    try {
      const failure = await runDoctorOwned(undefined, host, {
        skill: true,
      }).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError))
        throw new Error("Doctor cleanup should preserve both failures");
      expect(failure.errors[0]).toBeInstanceOf(RegularFileCleanupFailure);
      expect(failure.errors[0]).toMatchObject({
        path: manifest,
        outcome: { kind: "completed" },
      });
      expect(failure.errors[1]).toEqual(
        expect.objectContaining({
          message: expect.stringContaining(manifest),
        }),
      );
      expect(close.attempts.length).toBeGreaterThan(0);
      expect(new Set(close.attempts).size).toBe(1);
      const attemptsBeforeClose = close.attempts.length;
      close.release();
      expect(await host.close?.()).toBeUndefined();
      expect(close.attempts.length).toBeGreaterThan(attemptsBeforeClose);
      expect(new Set(close.attempts).size).toBe(1);
      expect(close.attempts[0]?.fd).toBe(-1);
    } finally {
      close.release();
      await host.close?.();
    }
  });

  it("returns uninstall changes with a failed cleanup item for a retained handle", async () => {
    const home = await createTestTempDirectory("rea-uninstall-skill-close-");
    const [destination] = skillDestinations(home, []);
    if (destination === undefined) throw new Error("Shared skill root missing");
    const manifest = join(destination.path, "SKILL.md");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(
      manifest,
      `---\nname: ${PRODUCT_IDENTITY.skillName}\n---\nmanaged fixture\n`,
    );
    const close = failFirstCloses(manifest);
    const host = systemUninstallHost(home, undefined, { HOME: home });

    try {
      const result = await runUninstall(false, host);

      expect(result.status).toBe("failed");
      expect(result.items).toContainEqual(
        expect.objectContaining({
          name: "uninstall_cleanup",
          status: "failed",
          detail: expect.stringContaining(manifest),
        }),
      );
      expect(close.attempts.length).toBeGreaterThan(0);
      expect(new Set(close.attempts).size).toBe(1);
      const attemptsBeforeClose = close.attempts.length;
      close.release();
      expect(await host.close?.()).toBeUndefined();
      expect(close.attempts.length).toBeGreaterThan(attemptsBeforeClose);
      expect(new Set(close.attempts).size).toBe(1);
      expect(close.attempts[0]?.fd).toBe(-1);
    } finally {
      close.release();
      await host.close?.();
    }
  });
});
