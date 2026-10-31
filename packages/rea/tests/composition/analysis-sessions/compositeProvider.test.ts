import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { CompositeProvider } from "../../../src/application/binary/CompositeProvider.js";
import type {
  AnalysisOperation,
  AnalysisProvider,
  CapabilityDescriptor,
  ProviderIdentity,
} from "../../../src/application/AnalysisProvider.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import type { BinaryTarget } from "../../../src/domain/binaryTargetTypes.js";
import { ok } from "../../../src/domain/result.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const target: BinaryTarget = {
  path: "/fixture",
  kind: "database",
  format: "analysis-database",
  sha256: "0".repeat(64),
};

describe("composite analysis provider", () => {
  it("routes disjoint operations and does not start children during health", async () => {
    const hopperCalls: string[] = [];
    const nativeCalls: string[] = [];
    const hopper = provider("hopper", "address_name", hopperCalls);
    const native = provider("native", "analyze_function", nativeCalls);
    const composite = new CompositeProvider([hopper, native]);
    const client = composite.createClient(target);

    expect(await client.execute("health", {})).toMatchObject({
      ok: true,
      value: { result: null, provider: { id: "composite:hopper+native" } },
    });
    expect(hopperCalls).toEqual([]);
    expect(nativeCalls).toEqual([]);
    expect(await client.execute("address_name", {})).toEqual({
      ok: true,
      value: createAnalysisExecution("hopper:address_name", hopper.identity()),
    });
    expect(await client.execute("analyze_function", {})).toEqual({
      ok: true,
      value: createAnalysisExecution(
        "native:analyze_function",
        native.identity(),
      ),
    });
    expect(await client.execute("list_names", {})).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError" },
    });
  });

  it("rejects ambiguous provider routes", () => {
    const hopper = provider("hopper", "address_name", []);
    expect(
      () =>
        new CompositeProvider([
          hopper,
          provider("duplicate", "address_name", []),
        ]),
    ).toThrow(/Multiple providers declare operation address_name/u);
  });

  it("retains lineage snapshots from two lazily started dynamic providers", async () => {
    const directory = await createTestTempDirectory("rea-composite-lineage-");
    const targetPath = join(directory, "fixture.hop");
    await writeFile(targetPath, "fixture");
    const first = dynamicProvider("first", "address_name", 100);
    const second = dynamicProvider("second", "analyze_function", 200);
    const session = createTestBinarySession(
      new CompositeProvider([second, first]),
    );

    expect((await session.open(targetPath)).ok).toBe(true);
    expect(await session.execute("address_name", {})).toMatchObject({
      ok: true,
    });
    expect(await session.execute("analyze_function", {})).toMatchObject({
      ok: true,
    });

    expect(await session.status()).toMatchObject({
      analysis_run: {
        process_lineage: {
          status: "snapshots",
          snapshots: [
            {
              provider: { id: "first" },
              observation: {
                status: "verified",
                observed_at: "2026-07-22T10:00:00.000Z",
                launcher_pid: 100,
                descendants: [
                  { pid: 101, parent_pid: 100, process_group_id: 100 },
                ],
              },
            },
            {
              provider: { id: "second" },
              observation: {
                status: "verified",
                observed_at: "2026-07-22T10:00:00.000Z",
                launcher_pid: 200,
              },
            },
          ],
        },
      },
      analysis_activity: {
        status: "busy",
        providers: [
          {
            provider: { id: "first" },
            active: { operation: "address_name", caller_state: "cancelled" },
            queued_requests: 2,
          },
          {
            provider: { id: "second" },
            active: {
              operation: "analyze_function",
              caller_state: "cancelled",
            },
            queued_requests: 2,
          },
        ],
      },
    });
    await session.close();
  });
});

describe("composite provider health status", () => {
  it("keeps a known failed child visible in public status when another child has no health snapshot", async () => {
    const [targetPath] = await createBinarySessionTargets();
    const failedIdentity: ProviderIdentity = {
      id: "failed-child",
      name: "Failed child",
      version: "1",
    };
    const unobservedIdentity: ProviderIdentity = {
      id: "unobserved-child",
      name: "Unobserved child",
      version: "1",
    };
    let failed = false;
    const failedProvider: AnalysisProvider = {
      identity: () => failedIdentity,
      capabilities: () => [capability(failedIdentity, "address_name")],
      createClient: () => ({
        execute: async () => ok(createAnalysisExecution(null, failedIdentity)),
        operationHealthSnapshot: () => ({
          state: failed ? "exited" : "idle",
          stage: failed ? "connection" : null,
          retryAction: failed ? "restart_provider" : null,
          exitCode: failed ? 7 : null,
          requests: [],
        }),
        close: async () => ok(null),
      }),
    };
    const unobservedProvider: AnalysisProvider = {
      identity: () => unobservedIdentity,
      capabilities: () => [capability(unobservedIdentity, "procedure_info")],
      createClient: () => ({
        execute: async () =>
          ok(createAnalysisExecution(null, unobservedIdentity)),
        close: async () => ok(null),
      }),
    };
    const session = createTestBinarySession(
      new CompositeProvider([failedProvider, unobservedProvider]),
    );

    expect((await session.open(targetPath)).ok).toBe(true);
    expect((await session.execute("address_name", {})).ok).toBe(true);
    expect((await session.execute("procedure_info", {})).ok).toBe(true);
    failed = true;

    expect(await session.status()).toMatchObject({
      provider_operation_health: {
        state: "exited",
        stage: "connection",
        retry_action: "restart_provider",
        exit_code: 7,
      },
    });
    await session.close();
  });
});

const dynamicProvider = (
  id: string,
  operation: Exclude<AnalysisOperation, "health">,
  launcherPid: number,
): AnalysisProvider => {
  const identity: ProviderIdentity = { id, name: id, version: "1" };
  return {
    identity: () => identity,
    capabilities: () => [capability(identity, operation)],
    createClient: (_target, _profile, context) => {
      if (context === undefined)
        throw new Error("missing analysis run context");
      return {
        execute: (called) =>
          Promise.resolve(
            ok(createAnalysisExecution(`${id}:${called}`, identity)),
          ),
        runtimeLineageSnapshots: () => [
          {
            provider: identity,
            observation: {
              status: "verified",
              observedAt: "2026-07-22T10:00:00.000Z",
              lineage: {
                runId: context.runId,
                launcherPid,
                launcherParentPid: 1,
                processGroupId: launcherPid,
                descendants: [
                  {
                    pid: launcherPid + 1,
                    parentPid: launcherPid,
                    processGroupId: launcherPid,
                  },
                ],
              },
            },
          },
        ],
        requestActivitySnapshots: () => [
          {
            provider: identity,
            active: {
              requestId: 7,
              operation,
              elapsedMs: 31_000,
              callerState: "cancelled",
            },
            queuedRequests: 2,
          },
        ],
        close: () => Promise.resolve(ok(null)),
      };
    },
  };
};

const provider = (
  id: string,
  operation: Exclude<AnalysisOperation, "health">,
  calls: string[],
): AnalysisProvider => {
  const identity: ProviderIdentity = { id, name: id, version: "1" };
  return {
    identity: () => identity,
    capabilities: () => [capability(identity, operation)],
    createClient: () => ({
      execute: (called) => {
        calls.push(called);
        return Promise.resolve(
          ok(createAnalysisExecution(`${id}:${called}`, identity)),
        );
      },
      close: () => Promise.resolve(ok(null)),
    }),
  };
};

const capability = (
  providerIdentity: ProviderIdentity,
  operation: Exclude<AnalysisOperation, "health">,
): CapabilityDescriptor => ({
  provider: providerIdentity,
  operation,
  available: true,
  reason: null,
  effects: {
    mutatesArtifact: false,
    launchesProcess: true,
    mayShowUi: false,
    mayAccessNetwork: false,
    mayWriteFilesystem: false,
    changesPermissions: false,
    requiresRoot: false,
  },
  limitations: [],
});
