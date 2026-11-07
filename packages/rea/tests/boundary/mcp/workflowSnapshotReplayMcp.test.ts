import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createAnalysisExecution,
  type AnalysisProvider,
  type CapabilityDescriptor,
} from "../../../src/application/AnalysisProvider.js";
import type { DirectAnalysisDependencies } from "../../../src/application/DirectAnalysisDependencies.js";
import { runDirectAnalysis } from "../../../src/application/DirectAnalysis.js";
import {
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { readAnalysisSnapshot } from "../../../src/application/binary/AnalysisSnapshotFiles.js";
import { ok } from "../../../src/domain/result.js";
import { evidenceBundleSchema } from "../../../src/domain/evidenceBundle.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { recordUnknownInputSchema } from "../../../src/domain/residualUnknown.js";

const identity = { id: "fixture", name: "Fixture", version: "1" } as const;
const profile = createAnalysisProfile(identity, { fixture: true });
const operations = [
  "list_segments",
  "list_documents",
  "list_procedures",
  "list_strings",
] as const;

const resources: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

describe("MCP external command snapshot retirement", () => {
  it.skipIf(process.platform === "win32")(
    "rejects a queued snapshot after mutation and preserves Evidence through explicit reopening",
    async () => {
      const { targetPaths, snapshotPath } = await createWorkflowFiles(
        "rea-mcp-admitted-reverse-",
        ["target.hop"],
      );
      const targetPath = targetPaths[0];
      if (targetPath === undefined)
        throw new Error("Expected one workflow target");
      const fixtureDirectory = dirname(snapshotPath);
      const startedPath = join(fixtureDirectory, "rizin-started");
      const releasePath = join(fixtureDirectory, "rizin-release");
      const providerPath = join(fixtureDirectory, "rizin-fixture.mjs");
      await writeFile(
        providerPath,
        `#!${process.execPath}\nimport { existsSync, writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(startedPath)}, "started");\nwhile (!existsSync(${JSON.stringify(releasePath)})) await new Promise((resolve) => setTimeout(resolve, 5));\nprocess.stdout.write("Rizin fixture output\\n");\n`,
      );
      await chmod(providerPath, 0o755);
      const session = createWorkflowSession(makeProvider([], []));
      const { mcp } = await connectWorkflowMcp(
        session,
        "admitted-reverse-engineering",
        { REA_RIZIN_COMMAND: providerPath },
      );
      await openWorkflowTarget(mcp, targetPath);

      const analysisRequest = mcp.callTool({
        name: "execute_rizin_command",
        arguments: { path: targetPath, command: "iI" },
      });
      let closeSettled = false;
      const closeStarted = createDeferred<void>();
      let closeRequest: ReturnType<typeof mcp.callTool> | undefined;
      try {
        const readyDeadline = Date.now() + 5_000;
        while (Date.now() < readyDeadline) {
          try {
            await access(startedPath);
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        await expect(access(startedPath)).resolves.toBeUndefined();
        closeRequest = mcp
          .callTool(
            {
              name: "close_binary",
              arguments: { snapshot_path: snapshotPath },
            },
            { onprogress: () => closeStarted.resolve() },
          )
          .finally(() => {
            closeSettled = true;
          });
        // Close queues its transition before sending its first progress event.
        await awaitAcknowledgement(
          closeStarted.promise,
          closeRequest,
          "snapshot close progress",
        );
        expect(closeSettled).toBe(false);
        await expect(access(snapshotPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await writeFile(releasePath, "release");
        await Promise.allSettled([
          analysisRequest,
          ...(closeRequest === undefined ? [] : [closeRequest]),
        ]);
      }
      const analyzed = await analysisRequest;
      expect(analyzed.isError, JSON.stringify(analyzed.content)).not.toBe(true);
      const evidence = toolContract("execute_rizin_command").outputSchema.parse(
        analyzed.structuredContent,
      );
      const closed = await closeRequest;
      expect(closed.isError).toBe(true);
      expect(JSON.stringify(closed.content)).toContain(
        "Analysis snapshots are unavailable",
      );
      expect(session.activeTarget()).toBeUndefined();
      await expect(access(snapshotPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      const exported = await mcp.callTool({
        name: "export_evidence_bundle",
        arguments: { path: join(fixtureDirectory, "observations.json") },
      });
      expect(exported.isError ?? false).toBe(false);
      const observations = evidenceBundleSchema.parse(
        JSON.parse(
          await readFile(join(fixtureDirectory, "observations.json"), "utf8"),
        ),
      );
      expect(observations.records).toContainEqual(
        expect.objectContaining({ evidence_id: evidence.evidence_id }),
      );

      // The provider process has completed; explicitly open fresh analysis
      // before saving an immutable snapshot of the new binding.
      await openWorkflowTarget(mcp, targetPath);
      const saved = await mcp.callTool({
        name: "close_binary",
        arguments: { snapshot_path: snapshotPath },
      });
      expect(saved.isError ?? false).toBe(false);
      const snapshot = await readAnalysisSnapshot(snapshotPath);
      if (!snapshot.ok) throw snapshot.error;
      expect(snapshot.value.evidence_bundle.records).toContainEqual(
        expect.objectContaining({
          evidence_id: evidence.evidence_id,
          operation: "execute_rizin_command",
          subject: expect.objectContaining({ local_path: targetPath }),
        }),
      );
    },
  );
});

describe("MCP composed workflow target admission", () => {
  it("keeps a composed result and snapshot on its admitted target across queued close and open", async () => {
    const { targetPaths, snapshotPath } = await createWorkflowFiles(
      "rea-mcp-admitted-workflow-",
      ["first.hop", "second.hop"],
    );
    const firstPath = targetPaths[0];
    const secondPath = targetPaths[1];
    if (firstPath === undefined || secondPath === undefined)
      throw new Error("Expected two workflow targets");
    const starts: string[] = [];
    const calls: string[] = [];
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const session = createWorkflowSession(
      makeProvider(starts, calls, undefined, { entered, release }),
    );
    const { mcp } = await connectWorkflowMcp(session, "admitted-workflow");
    const closeStarted = createDeferred<void>();
    mcp.setNotificationHandler("notifications/progress", () => {
      closeStarted.resolve();
    });
    await openWorkflowTarget(mcp, firstPath);

    const analysisRequest = mcp.callTool({
      name: "binary_overview",
      arguments: {},
    });
    let closeRequest: ReturnType<typeof mcp.callTool> | undefined;
    let openRequest: ReturnType<typeof mcp.callTool> | undefined;
    try {
      await awaitAcknowledgement(
        entered.promise,
        analysisRequest,
        "workflow provider entry",
      );
      closeRequest = mcp.callTool({
        name: "close_binary",
        arguments: { snapshot_path: snapshotPath },
        _meta: { progressToken: "close-race" },
      });
      await awaitAcknowledgement(
        closeStarted.promise,
        closeRequest,
        "workflow close progress",
      );
      openRequest = mcp.callTool({
        name: "open_binary",
        arguments: { path: secondPath },
      });
    } finally {
      release.resolve();
      await Promise.allSettled([
        analysisRequest,
        ...(closeRequest === undefined ? [] : [closeRequest]),
        ...(openRequest === undefined ? [] : [openRequest]),
      ]);
    }
    if (closeRequest === undefined || openRequest === undefined)
      throw new Error("Expected queued close and open requests");

    const analyzed = await analysisRequest;
    expect(analyzed.isError, JSON.stringify(analyzed.content)).not.toBe(true);
    const evidence = toolContract("binary_overview").outputSchema.parse(
      analyzed.structuredContent,
    );
    expect(evidence.analysis_profile).not.toBeNull();
    expect(evidence).toMatchObject({ subject: { local_path: firstPath } });
    const closed = await closeRequest;
    expect(closed.isError, JSON.stringify(closed.content)).not.toBe(true);
    const snapshot = await readAnalysisSnapshot(snapshotPath);
    if (!snapshot.ok) throw snapshot.error;
    expect(snapshot.value.workflow_entries).toHaveLength(1);
    expect(snapshot.value.evidence_bundle.records).toContainEqual(
      expect.objectContaining({
        operation: "binary_overview",
        subject: expect.objectContaining({ local_path: firstPath }),
      }),
    );
    const opened = await openRequest;
    expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
    expect(session.activeTarget()?.path).toBe(secondPath);
  });
});

describe("MCP composed workflow snapshot replay", () => {
  it("exports an MCP workflow binding and replays its Evidence without provider startup or calls", async () => {
    const { targetPaths, snapshotPath } = await createWorkflowFiles(
      "rea-mcp-workflow-snapshot-",
      ["fixture.hop"],
    );
    const targetPath = targetPaths[0];
    if (targetPath === undefined) throw new Error("Expected a workflow target");
    const starts: string[] = [];
    const calls: string[] = [];
    const provider = makeProvider(starts, calls);
    const session = createWorkflowSession(provider);
    const { mcp } = await connectWorkflowMcp(session, "workflow-snapshot");

    await openWorkflowTarget(mcp, targetPath);
    const analyzed = await mcp.callTool({
      name: "binary_overview",
      arguments: {},
    });
    expect(analyzed.isError, JSON.stringify(analyzed.content)).not.toBe(true);
    const output = toolContract("binary_overview").outputSchema.parse(
      analyzed.structuredContent,
    );
    const workflowEvidence = z
      .object({
        operation: z.literal("binary_overview"),
        analysis_profile: z.object({ digest: z.string() }),
      })
      .passthrough()
      .parse(output);
    const primitiveResult = await mcp.callTool({
      name: "list_strings",
      arguments: { document: "fixture" },
    });
    expect(
      primitiveResult.isError,
      JSON.stringify(primitiveResult.content),
    ).not.toBe(true);
    const primitiveEvidence = toolContract("list_strings").outputSchema.parse(
      primitiveResult.structuredContent,
    );
    expect(primitiveEvidence).toMatchObject({
      subject: { local_path: targetPath },
    });
    const afterAnalysisCalls = [...calls];
    const afterAnalysisStarts = [...starts];

    const closed = await mcp.callTool({
      name: "close_binary",
      arguments: { snapshot_path: snapshotPath },
    });
    expect(closed.isError, JSON.stringify(closed.content)).not.toBe(true);
    const snapshot = await readAnalysisSnapshot(snapshotPath);
    if (!snapshot.ok) throw snapshot.error;
    const receipt = toolContract("close_binary").outputSchema.parse(
      closed.structuredContent,
    ).result;
    expect(receipt).toMatchObject({
      path: snapshotPath,
      primitive_entries: snapshot.value.entries.length,
      workflow_entries: snapshot.value.workflow_entries.length,
      evidence_records: snapshot.value.evidence_bundle.records.length,
    });
    expect(snapshot.value.workflow_entries).toHaveLength(1);
    expect(snapshot.value.evidence_bundle.records).toContainEqual(
      expect.objectContaining({
        evidence_id: workflowEvidence.evidence_id,
        operation: "binary_overview",
      }),
    );

    const relocatedPath = join(dirname(targetPath), "relocated.hop");
    await writeFile(relocatedPath, "fixture.hop");
    const reopened = await mcp.callTool({
      name: "open_binary",
      arguments: { path: relocatedPath, snapshot_path: snapshotPath },
    });
    expect(reopened.isError, JSON.stringify(reopened.content)).not.toBe(true);
    const cachedPrimitive = await mcp.callTool({
      name: "list_strings",
      arguments: { document: "fixture" },
    });
    expect(
      cachedPrimitive.isError,
      JSON.stringify(cachedPrimitive.content),
    ).not.toBe(true);
    const cachedEvidence = toolContract("list_strings").outputSchema.parse(
      cachedPrimitive.structuredContent,
    );
    expect(cachedEvidence).toMatchObject({
      subject: { local_path: relocatedPath },
    });
    expect(cachedEvidence.normalized_result).toEqual(
      primitiveEvidence.normalized_result,
    );
    expect(cachedEvidence.raw_result).toEqual(primitiveEvidence.raw_result);
    const retained = await mcp.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(retained.isError, JSON.stringify(retained.content)).not.toBe(true);
    const retainedBundle = toolContract(
      "get_evidence_bundle",
    ).outputSchema.parse(retained.structuredContent).result;
    expect(
      retainedBundle.records.find(
        ({ evidence_id }) => evidence_id === primitiveEvidence.evidence_id,
      )?.subject?.local_path,
    ).toBe(targetPath);
    expect(calls).toEqual(afterAnalysisCalls);
    expect(starts).toEqual(afterAnalysisStarts);

    const dependencies: DirectAnalysisDependencies = {
      readConfiguration: () => parseConfig({}),
      createBinarySession: () => createWorkflowSession(provider),
      createArtifactBinarySession: () => createWorkflowSession(provider),
      createNativeDispatchBinarySession: () => createWorkflowSession(provider),
      createNativeBinarySession: () => createWorkflowSession(provider),
      createManagedBinarySession: () => createWorkflowSession(provider),
    };
    const replay = await runDirectAnalysis(
      dependencies,
      targetPath,
      "binary_overview",
      {},
      { snapshotPath },
    ).then(projectCliAnalysisResult);

    expect(output).not.toHaveProperty("caller_input_path");
    expect(replay).toEqual({ ...output, caller_input_path: targetPath });
    expect(calls).toEqual(afterAnalysisCalls);
    expect(starts).toEqual(afterAnalysisStarts);
  });
});

describe("MCP live workflow snapshot policy", () => {
  it("does not bind a workflow when an upstream operation is live", async () => {
    const { targetPaths, snapshotPath } = await createWorkflowFiles(
      "rea-mcp-live-workflow-snapshot-",
      ["fixture.hop"],
    );
    const targetPath = targetPaths[0];
    if (targetPath === undefined) throw new Error("Expected a workflow target");
    const starts: string[] = [];
    const calls: string[] = [];
    const session = createWorkflowSession(
      makeProvider(starts, calls, "list_strings"),
    );
    const { mcp } = await connectWorkflowMcp(session, "live-workflow-snapshot");

    await openWorkflowTarget(mcp, targetPath);
    const analyzed = await mcp.callTool({
      name: "binary_overview",
      arguments: {},
    });
    expect(analyzed.isError, JSON.stringify(analyzed.content)).not.toBe(true);
    expect(
      toolContract("binary_overview").outputSchema.parse(
        analyzed.structuredContent,
      ),
    ).toMatchObject({ operation: "binary_overview" });
    const closed = await mcp.callTool({
      name: "close_binary",
      arguments: { snapshot_path: snapshotPath },
    });
    expect(closed.isError, JSON.stringify(closed.content)).not.toBe(true);

    const snapshot = await readAnalysisSnapshot(snapshotPath);
    if (!snapshot.ok) throw snapshot.error;
    expect(snapshot.value.workflow_entries).toEqual([]);
  });
});

describe("MCP investigation history snapshot replay", () => {
  it.each(["verified", "withdrawn", "out-of-scope"] as const)(
    "preserves a target's %s resolution recorded while another target is active",
    async (disposition) => {
      const { targetPaths, snapshotPath } = await createWorkflowFiles(
        "rea-mcp-investigation-history-",
        ["first.hop", "second.hop"],
      );
      const firstPath = targetPaths[0];
      const secondPath = targetPaths[1];
      if (firstPath === undefined || secondPath === undefined)
        throw new Error("Expected two investigation targets");
      const session = createWorkflowSession(makeProvider([], []));
      const { mcp } = await connectWorkflowMcp(
        session,
        "investigation-history",
      );
      await openWorkflowTarget(mcp, firstPath);
      const input = recordUnknownInputSchema.parse({
        question: "Has the string inventory been inspected for this target?",
        severity: "medium",
        domain: "investigation-history",
        required_authority: null,
        required_confidence: "derived",
        required_environment: null,
        recommended_probes: [],
        relationships: [],
      });
      const recorded = await mcp.callTool({
        name: "record_unknown",
        arguments: input,
      });
      expect(recorded.isError).not.toBe(true);
      const unknown = toolContract("record_unknown").outputSchema.parse(
        recorded.structuredContent,
      ).result;
      const resolutionEvidenceIds: string[] = [];
      if (disposition === "verified") {
        const inspected = await mcp.callTool({
          name: "list_strings",
          arguments: {},
        });
        expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(
          true,
        );
        resolutionEvidenceIds.push(
          z
            .string()
            .parse(
              toolContract("list_strings").outputSchema.parse(
                inspected.structuredContent,
              ).evidence_id,
            ),
        );
      }
      await openWorkflowTarget(mcp, secondPath);
      const unrelated = await mcp.callTool({
        name: "list_strings",
        arguments: {},
      });
      expect(unrelated.isError).not.toBe(true);
      const foreignEvidence = toolContract("list_strings").outputSchema.parse(
        unrelated.structuredContent,
      );
      const updateInput = {
        unknown_id: unknown.unknown_id,
        expected_revision: unknown.revision,
        status: "resolved",
        severity: input.severity,
        supporting_evidence_ids: resolutionEvidenceIds,
        contradicting_evidence_ids: input.contradicting_evidence_ids,
        required_authority: input.required_authority,
        required_confidence: input.required_confidence,
        required_environment: input.required_environment,
        recommended_probes: input.recommended_probes,
        relationships: input.relationships,
        resolution: {
          disposition,
          rationale: "Disposition recorded after further investigation.",
          evidence_ids: resolutionEvidenceIds,
        },
      };
      const updated = await mcp.callTool({
        name: "update_unknown",
        arguments: updateInput,
      });
      expect(updated.isError, JSON.stringify(updated.content)).not.toBe(true);
      const resolved = toolContract("update_unknown").outputSchema.parse(
        updated.structuredContent,
      ).result;
      expect(resolved).toMatchObject({
        revision: 2,
        status: "resolved",
        scope_digest: unknown.scope_digest,
      });
      await openWorkflowTarget(mcp, firstPath);
      const closed = await mcp.callTool({
        name: "close_binary",
        arguments: { snapshot_path: snapshotPath },
      });
      expect(closed.isError, JSON.stringify(closed.content)).not.toBe(true);
      const snapshot = await readAnalysisSnapshot(snapshotPath);
      if (!snapshot.ok) throw snapshot.error;
      expect(snapshot.value.evidence_bundle.unknowns).toEqual([
        unknown,
        resolved,
      ]);
      expect(snapshot.value.evidence_bundle.records).toContainEqual(
        expect.objectContaining({
          operation: "update_unknown",
          parameters: updateInput,
          subject: expect.objectContaining({ local_path: secondPath }),
        }),
      );
      expect(snapshot.value.evidence_bundle.records).not.toContainEqual(
        foreignEvidence,
      );

      const replay = createWorkflowSession(makeProvider([], []));
      const { mcp: replayMcp } = await connectWorkflowMcp(
        replay,
        "investigation-history-replay",
      );
      const reopened = await replayMcp.callTool({
        name: "open_binary",
        arguments: { path: firstPath, snapshot_path: snapshotPath },
      });
      expect(reopened.isError, JSON.stringify(reopened.content)).not.toBe(true);
      const listed = await replayMcp.callTool({
        name: "list_unknowns",
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      expect(
        toolContract("list_unknowns").outputSchema.parse(
          listed.structuredContent,
        ).result,
      ).toEqual({
        items: [resolved],
        total: 1,
        offset: 0,
        next_offset: null,
      });
    },
  );
});

const createWorkflowFiles = async (
  prefix: string,
  filenames: readonly string[],
): Promise<{
  readonly targetPaths: readonly string[];
  readonly snapshotPath: string;
}> => {
  const directory = await createTestTempDirectory(prefix);
  const targetPaths = await Promise.all(
    filenames.map(async (filename) => {
      const path = join(directory, filename);
      await writeFile(path, filename);
      return path;
    }),
  );
  return { targetPaths, snapshotPath: join(directory, "analysis.json") };
};

const createWorkflowSession = (provider: AnalysisProvider) =>
  createTestBinarySession(provider, {
    resolveAnalysisProfile: () => Promise.resolve(ok({ profile })),
  });

const connectWorkflowMcp = async (
  session: ReturnType<typeof createWorkflowSession>,
  clientName: string,
  providerEnvironment?: Readonly<NodeJS.ProcessEnv>,
): Promise<{ readonly mcp: Client }> => {
  const server = createServer(
    { kind: "session", session },
    {
      logger: silentLogger,
      ...(providerEnvironment === undefined ? {} : { providerEnvironment }),
    },
  );
  const mcp = new Client({ name: clientName, version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(mcp, server);
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { mcp };
};

const openWorkflowTarget = async (mcp: Client, path: string): Promise<void> => {
  const opened = await mcp.callTool({
    name: "open_binary",
    arguments: { path },
  });
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
};

const makeProvider = (
  starts: string[],
  calls: string[],
  liveOperation?: (typeof operations)[number],
  pause?: {
    readonly entered: ReturnType<typeof createDeferred<void>>;
    readonly release: ReturnType<typeof createDeferred<void>>;
  },
): AnalysisProvider => {
  const capabilities: CapabilityDescriptor[] = operations.map((operation) => ({
    operation,
    provider: identity,
    available: true,
    reason: null,
    cachePolicy: operation === liveOperation ? "live" : "snapshot",
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
  }));
  return {
    identity: () => identity,
    capabilities: () => capabilities,
    resolveAnalysisProfile: () => Promise.resolve(ok({ profile })),
    createClient: () => {
      starts.push("start");
      return {
        execute: async (operation) => {
          calls.push(operation);
          if (operation === "list_documents" && pause !== undefined) {
            pause.entered.resolve();
            await pause.release.promise;
          }
          const result =
            operation === "health"
              ? null
              : operation === "list_segments"
                ? [
                    {
                      name: "__TEXT",
                      start: "0x1000",
                      end: "0x2000",
                      readable: null,
                      writable: null,
                      executable: null,
                    },
                  ]
                : operation === "list_documents"
                  ? ["fixture"]
                  : [{ address: "0x1000", value: "fixture" }];
          return ok(createAnalysisExecution(result, identity));
        },
        close: () => Promise.resolve(ok(null)),
      };
    },
  };
};
