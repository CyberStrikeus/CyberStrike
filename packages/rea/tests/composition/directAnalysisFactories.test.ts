import { projectCliAnalysisResult } from "../../src/cli/projectCliAnalysisResult.js";
import { EvidenceFileError } from "../../src/domain/evidenceErrors.js";
import { err, ok as resultOk } from "../../src/domain/result.js";
import { dirname, join } from "node:path";
import { parseConfig } from "../../src/config/parseConfig.js";
import { describe, expect, it, vi } from "vitest";
import {
  runDirectAnalysis,
  runProviderAnalysis,
  runManagedProviderExecution,
} from "../../src/application/DirectAnalysis.js";
import type { DirectAnalysisDependencies } from "../../src/application/DirectAnalysisDependencies.js";
import type { NativeToolName } from "../../src/contracts/native/nativeToolContracts.js";
import type { BinarySession } from "../../src/application/binary/BinarySession.js";
import { observed } from "../fixtures/analysisExecution.js";
import { createAnalysisProfile } from "../../src/domain/analysisProfile.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../fixtures/binarySession.js";

const recordingFactories = (
  failure?: Error,
  profile?: ReturnType<typeof createAnalysisProfile>,
) => {
  const sessions: BinarySession[] = [];
  let clientsClosed = 0;
  const createSession = () => {
    const session = createTestBinarySession(
      () => ({
        execute: (operation) => {
          if (failure !== undefined && operation === "read_bytes")
            return Promise.reject(failure);
          return Promise.resolve(observed({ operation }));
        },
        close: () => {
          clientsClosed += 1;
          return Promise.resolve(resultOk(null));
        },
      }),
      profile === undefined
        ? {}
        : {
            resolveAnalysisProfile: () =>
              Promise.resolve(resultOk({ profile })),
          },
    );
    sessions.push(session);
    return session;
  };
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig({}),
    createBinarySession: createSession,
    createArtifactBinarySession: createSession,
    createNativeDispatchBinarySession: createSession,
    createNativeBinarySession: createSession,
    createManagedBinarySession: createSession,
  };
  return { dependencies, sessions, clientsClosed: () => clientsClosed };
};

it("requires a durable summary destination before acquiring a managed session", async () => {
  const factories = recordingFactories();
  const result = await runProviderAnalysis(
    factories.dependencies,
    "/fixture/missing.dll",
    "inspect_managed_members",
    {},
    undefined,
    undefined,
    { detail: "summary" },
  ).then(projectCliAnalysisResult);
  expect(result).toMatchObject({
    code: "invalid_request",
    details: {
      operation: "inspect_managed_members",
      issues: [{ path: ["evidence_bundle"], reason: "missing_argument" }],
    },
  });
  expect(factories.sessions).toEqual([]);
});

it.each([
  "inspect_macho",
  "inventory_artifact",
  "inspect_managed_artifact",
] as const)(
  "rejects delivery options for %s before selecting a provider",
  async (tool) => {
    const factories = recordingFactories();
    const invocation = [
      factories.dependencies,
      "/fixture/missing",
      tool,
      {},
      undefined,
      undefined,
      { detail: "summary", evidenceBundlePath: "/fixture/bundle.json" },
    ] as const;
    // @ts-expect-error JavaScript callers can bypass managed-members-only delivery.
    const result = await runProviderAnalysis(...invocation).then(
      projectCliAnalysisResult,
    );
    expect(result).toMatchObject({
      code: "invalid_request",
      details: {
        operation: tool,
        issues: [{ path: ["delivery"], reason: "invalid_value" }],
      },
    });
    expect(factories.sessions).toEqual([]);
  },
);

describe("one-shot analysis factory boundary", () => {
  it("preserves thrown failures while releasing clients and cancellation listeners", async () => {
    const [path] = await createBinarySessionTargets();
    const failure = new Error("fixture execution failed");
    const factories = recordingFactories(failure);
    const interruptListeners = process.listenerCount("SIGINT");
    const terminateListeners = process.listenerCount("SIGTERM");
    await expect(
      runDirectAnalysis(factories.dependencies, path, "read_bytes", {}).then(
        projectCliAnalysisResult,
      ),
    ).rejects.toBe(failure);
    expect(factories.clientsClosed()).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(interruptListeners);
    expect(process.listenerCount("SIGTERM")).toBe(terminateListeners);
    expect(factories.sessions[0]?.activeTarget()).toBeUndefined();
  });

  it("does not acquire a client after cancellation before target opening", async () => {
    const [path] = await createBinarySessionTargets();
    const factories = recordingFactories();
    const controller = new AbortController();
    controller.abort();
    const result = await runDirectAnalysis(
      factories.dependencies,
      path,
      "read_bytes",
      {},
      { signal: controller.signal },
    ).then(projectCliAnalysisResult);
    expect(result).toMatchObject({
      error: "Analysis failed",
      code: "cancelled",
    });
    expect(factories.clientsClosed()).toBe(0);
    expect(factories.sessions[0]?.activeTarget()).toBeUndefined();
  });

  it("keeps managed execution independent of native construction", async () => {
    const [path] = await createBinarySessionTargets();
    const factories = recordingFactories();
    const managedDependencies = {
      ...factories.dependencies,
      readConfiguration: () => {
        throw new Error("native configuration must stay unused");
      },
      createBinarySession: () => {
        throw new Error("native factory must stay unused");
      },
    };
    const result = await runManagedProviderExecution(
      managedDependencies,
      path,
      "inspect_managed_artifact",
    );
    expect(result).toMatchObject({
      ok: true,
      value: { result: { operation: "inspect_managed_artifact" } },
    });
    expect(factories.clientsClosed()).toBe(1);
    expect(factories.sessions[0]?.activeTarget()).toBeUndefined();
  });

  it.each([undefined, "/fixture/committed.snapshot"])(
    "selects the dispatch inspection factory only without a requested snapshot (%s)",
    async (snapshotPath) => {
      const factories = recordingFactories();
      const expected = new Error("selected factory");
      const unexpected = (): never => {
        throw new Error("wrong session policy");
      };
      const selected = (): never => {
        throw expected;
      };
      await expect(
        runDirectAnalysis(
          {
            ...factories.dependencies,
            createBinarySession:
              snapshotPath === undefined ? unexpected : selected,
            createNativeDispatchBinarySession:
              snapshotPath === undefined ? selected : unexpected,
          },
          "/fixture/target",
          "inspect_native_dispatch_metadata",
          {},
          { snapshotPath },
        ).then(projectCliAnalysisResult),
      ).rejects.toBe(expected);
      expect(factories.sessions).toEqual([]);
    },
  );

  it.each([
    "inspect_macho",
    "inspect_signature",
    "list_architectures",
    "inspect_plist",
    "demangle_swift",
  ] satisfies readonly NativeToolName[])(
    "runs %s without reading deep-engine configuration or constructing its session",
    async (tool) => {
      const [path] = await createBinarySessionTargets();
      const factories = recordingFactories();
      const unexpected = (): never => {
        throw new Error("unrelated session factory must stay unused");
      };
      const arguments_ =
        tool === "demangle_swift" ? { symbols: ["$s4Test3fooyyF"] } : {};
      const result = await runProviderAnalysis(
        {
          ...factories.dependencies,
          readConfiguration: unexpected,
          createBinarySession: unexpected,
          createArtifactBinarySession: unexpected,
          createManagedBinarySession: unexpected,
        },
        path,
        tool,
        arguments_,
      ).then(projectCliAnalysisResult);
      expect(result).toMatchObject({
        operation: tool,
        normalized_result: { operation: tool },
      });
      expect(factories.clientsClosed()).toBe(1);
      expect(factories.sessions[0]?.activeTarget()).toBeUndefined();
    },
  );

  it.each([
    "observe_native_ui",
    "capture_native_ui_scenario",
    "observe_native_calls",
  ] satisfies readonly NativeToolName[])(
    "keeps %s on the ordinary session route",
    async (tool) => {
      const [path] = await createBinarySessionTargets();
      const factories = recordingFactories();
      const result = await runProviderAnalysis(
        {
          ...factories.dependencies,
          createNativeBinarySession: () => {
            throw new Error("static inspection factory must stay unused");
          },
        },
        path,
        tool,
        {},
      ).then(projectCliAnalysisResult);
      expect(result).toMatchObject({ operation: tool });
      expect(factories.clientsClosed()).toBe(1);
    },
  );
});

it("preserves a managed execution profile in direct analysis Evidence", async () => {
  const [path] = await createBinarySessionTargets();
  const profile = createAnalysisProfile(
    {
      id: "fixture",
      name: "Fixture analysis provider",
      version: "1",
    },
    { fixture: true },
  );
  const factories = recordingFactories(undefined, profile);
  const evidence = await runProviderAnalysis(
    factories.dependencies,
    path,
    "inspect_managed_artifact",
    {},
  ).then(projectCliAnalysisResult);
  expect(evidence).toMatchObject({ analysis_profile: profile });
});

it("direct analysis snapshot target mismatch retains actionable snapshot recovery", async () => {
  const [path, other] = await createBinarySessionTargets();
  const profile = createAnalysisProfile(
    { id: "fixture", name: "Fixture analysis provider", version: "1" },
    { fixture: true },
  );
  const factories = recordingFactories(undefined, profile);
  const snapshotPath = join(dirname(path), "snapshot.json");
  expect(
    await runDirectAnalysis(
      factories.dependencies,
      path,
      "read_bytes",
      {},
      { snapshotPath },
    ).then(projectCliAnalysisResult),
  ).not.toHaveProperty("code");
  const mismatch = await runDirectAnalysis(
    factories.dependencies,
    other,
    "read_bytes",
    {},
    { snapshotPath },
  ).then(projectCliAnalysisResult);
  expect(mismatch).toMatchObject({
    code: "evidence_integrity_mismatch",
    remediation: {
      action:
        "Run analysis without this snapshot, then save a fresh snapshot using the intended artifact, provider, and analysis profile.",
    },
  });
  expect(
    await runDirectAnalysis(
      factories.dependencies,
      path,
      "read_bytes",
      {},
      { snapshotPath },
    ).then(projectCliAnalysisResult),
  ).not.toHaveProperty("code");
});

it("retries snapshot file cleanup before final close even when a published identity is excluded", async () => {
  const [path] = await createBinarySessionTargets();
  const profile = createAnalysisProfile(
    { id: "fixture", name: "Fixture analysis provider", version: "1" },
    { fixture: true },
  );
  const factories = recordingFactories(undefined, profile);
  const events: string[] = [];
  const publication = new EvidenceFileError("write", "io", {
    published: { bytes: 42 },
  });
  const dependencies: DirectAnalysisDependencies = {
    ...factories.dependencies,
    createBinarySession: async (...args) => {
      const session = await factories.dependencies.createBinarySession(...args);
      vi.spyOn(session, "writeAnalysisSnapshot").mockResolvedValue(
        err(publication),
      );
      const closeResources = session.closeFileResources.bind(session);
      vi.spyOn(session, "closeFileResources").mockImplementation(async () => {
        events.push("file-cleanup");
        return closeResources();
      });
      const close = session.close.bind(session);
      vi.spyOn(session, "close").mockImplementation(async () => {
        events.push("session-close");
        return close();
      });
      return session;
    },
  };
  const result = await runDirectAnalysis(
    dependencies,
    path,
    "read_bytes",
    {},
    { snapshotPath: join(dirname(path), "excluded.snapshot") },
  ).then(projectCliAnalysisResult);
  expect(events[0]).toBe("file-cleanup");
  expect(events).toContain("session-close");
  expect(result).toMatchObject({ details: { published: true, bytes: 42 } });
  expect(result).not.toHaveProperty("details.published_path");
});
