import { expect, it } from "vitest";
import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
import { analysisErrorProjectionSchema } from "../../contracts/errorSchemas.js";
import { AnalysisAccessDeniedError } from "../../domain/analysisErrorCore.js";
import {
  AnalysisError,
  primaryAnalysisError,
} from "../../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { emptyProcessCapture } from "../../domain/process/processCapture.fixture.js";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import { ProcessCaptureSnapshotFailure } from "./FilesystemSnapshot.js";
import { prepareProcessCapture } from "./ProcessCaptureLifecycle.js";

it.each(["EACCES", "EPERM"] as const)(
  "retains %s admission facts through snapshot finalization and exact cleanup retry",
  async (systemCode) => {
    const selected = "/fixture/denied/selected";
    const temporaryRoot = "/fixture/observer-owned";
    let allocations = 0;
    const cleanedRoots: string[] = [];
    const native = Object.assign(new Error("selected root lookup denied"), {
      code: systemCode,
    });
    const primary = new AnalysisAccessDeniedError(
      "capture_process_scenario",
      selected,
      systemCode,
      { cause: native },
    );
    const snapshot = {
      files: [],
      completeRoots: ["root_0"],
      truncated: true,
      coverage: {
        ...emptyProcessCapture().truncation_details.filesystem_before,
        enumeration_truncated: true,
        enumeration_reasons: ["entry_unavailable" as const],
        enumeration_omissions: [
          {
            path: "root_1:.",
            reason: "entry_unavailable" as const,
            system_code: systemCode,
          },
        ],
      },
    };
    let closes = 0;
    const lease = new AnalysisCleanupLease(async () => {
      closes++;
    }, ["fixture:earlier-snapshot-descriptor"]);
    const snapshotFailure = new ProcessCaptureSnapshotFailure({
      cause: primary,
      snapshot,
      cleanupLeases: [lease],
    });
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      filesystem_observation_paths: ["/fixture/absent", selected],
    });
    const failure = await prepareProcessCapture(
      scenario,
      undefined,
      async (_scenario, _signal, _admission, resources) => {
        expect(allocations).toBe(1);
        expect(resources?.observerPaths).toEqual([temporaryRoot]);
        throw snapshotFailure;
      },
      {
        createTemporaryRoot: async () => {
          allocations++;
          return temporaryRoot;
        },
        cleanup: async (path) => {
          cleanedRoots.push(path);
        },
      },
    ).catch((cause: unknown) => cause);
    if (!(failure instanceof AnalysisError))
      throw new Error("Expected a canonical retained admission failure", {
        cause: failure,
      });
    expect(primaryAnalysisError(failure)).toBe(primary);
    expect(primary.cause).toBe(native);
    expect(allocations).toBe(1);
    expect(cleanedRoots).toEqual([temporaryRoot]);
    expect(closes).toBe(0);
    expect(
      analysisErrorProjectionSchema.parse(projectAnalysisError(failure)),
    ).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: ["fixture:earlier-snapshot-descriptor"],
        partial_observation: {
          observations: {
            target_pid: { state: "unavailable" },
            filesystem_snapshots: {
              before: { state: "available", value: snapshot },
            },
          },
        },
      },
    });
    await lease.release();
    await lease.release();
    expect(closes).toBe(1);
    expect(cleanedRoots).toEqual([temporaryRoot]);
    expect(
      analysisErrorProjectionSchema.parse(projectAnalysisError(failure)),
    ).toMatchObject({
      code: "access_denied",
      category: "unavailable",
      details: {
        path: selected,
        system_code: systemCode,
        boundary: "filesystem-read",
        partial_observation: {
          observations: {
            filesystem_snapshots: {
              before: { state: "available", value: snapshot },
            },
          },
        },
      },
    });
  },
);
