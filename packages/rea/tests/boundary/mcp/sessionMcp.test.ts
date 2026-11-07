import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { ProcessCaptureResourceScope } from "../../../src/process/capture/ProcessCaptureLifecycle.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import type {
  AnalysisClient,
  AnalysisProvider,
  CapabilityDescriptor,
  ProviderAvailability,
} from "../../../src/application/AnalysisProvider.js";
import type { AndroidAnalysisPort } from "../../../src/application/android/AndroidAnalysisPort.js";
import type { AdbDeviceAnalysisPort } from "../../../src/application/adb/AdbDeviceAnalysisPort.js";
import type { ApktoolResourceAnalysisPort } from "../../../src/application/apktool/ApktoolResourceAnalysisPort.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import { createServer } from "../../../src/server/createServer.js";
import { ApktoolProvider } from "../../../src/apktool/ApktoolProvider.js";
import {
  LinuxOwnedProcessPrerequisiteError,
  systemProcessOwnershipHost,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { silentLogger } from "../../../src/logger.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { MAX_JSON_DEPTH } from "../../../src/domain/jsonValue.js";
import { parseAnalysisSnapshot } from "../../../src/domain/analysisSnapshot.js";
import { INVESTIGATION_EXAMPLES } from "../../../src/contracts/investigationExamples.js";
import {
  expandProviderCapabilities,
  toolAvailabilitySummaryInventory,
} from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";
import {
  createSessionMcpHarness,
  snapshotAndRecordUnknown,
} from "./sessionMcpHarness.js";

const SNAPSHOT_PROFILE = createAnalysisProfile(
  { id: "fixture", name: "Fixture analysis provider", version: "1" },
  { fixture: true },
);

const resources: Array<{ close(): Promise<unknown> }> = [];
let directory: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("MCP snapshot lifecycle ordering", () => {
  it("saves earlier in-flight observations, blocks later calls, and preserves the session on write failure", async () => {
    directory = await createTestTempDirectory("rea-mcp-snapshot-order-");
    const started = createDeferred<void>();
    const release = createDeferred<ReturnType<typeof ok>>();
    const { mcp, first, closed } = await createSessionMcpHarness(
      directory,
      (closed) => {
        const base = provider(closed);
        return {
          ...base,
          capabilities: () =>
            base.capabilities().map((capability) => ({
              ...capability,
              operation: "address_name",
            })),
          createClient: (target) => ({
            ...client(target.path, closed),
            execute: (name) => {
              if (name === "health") return Promise.resolve(ok(null));
              started.resolve();
              return release.promise;
            },
          }),
        };
      },
      resources,
    );
    expect(
      (await mcp.callTool({ name: "open_binary", arguments: { path: first } }))
        .isError,
    ).not.toBe(true);
    const observation = mcp.callTool({
      name: "address_name",
      arguments: { address: "0x1000", document: "fixture" },
    });
    await started.promise;
    const snapshotPath = join(directory, "analysis.json");
    const closing = mcp.callTool({
      name: "close_binary",
      arguments: { snapshot_path: snapshotPath },
    });
    const later = mcp.callTool({
      name: "address_name",
      arguments: { address: "0x1001", document: "fixture" },
    });
    expect(
      structured(await mcp.callTool({ name: "binary_session", arguments: {} }))
        .result,
    ).toMatchObject({ open: true });
    expect(closed).toEqual([]);
    release.resolve(ok(first));
    expect((await observation).isError).not.toBe(true);
    expect((await closing).isError).not.toBe(true);
    expect((await later).isError).toBe(true);
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(await readFile(snapshotPath, "utf8")),
    );
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.execution.result).toBe(first);
    expect(
      snapshot.evidence_bundle.records.some(
        (record) =>
          record.operation === "address_name" &&
          record.normalized_result === first,
      ),
    ).toBe(true);

    expect(
      (await mcp.callTool({ name: "open_binary", arguments: { path: first } }))
        .isError,
    ).not.toBe(true);
    const bytes = await readFile(snapshotPath);
    expect(
      (
        await mcp.callTool({
          name: "close_binary",
          arguments: { snapshot_path: snapshotPath },
        })
      ).isError,
    ).toBe(true);
    expect(Buffer.compare(await readFile(snapshotPath), bytes)).toBe(0);
    expect(
      (
        await mcp.callTool({
          name: "address_name",
          arguments: { address: "0x1000", document: "fixture" },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      structured(await mcp.callTool({ name: "binary_session", arguments: {} }))
        .result,
    ).toMatchObject({ open: true });
    expect(
      (
        await mcp.callTool({
          name: "close_binary",
          arguments: { snapshot_path: snapshotPath, overwrite: true },
        })
      ).isError,
    ).not.toBe(true);
  }, 10_000);
});

describe("public provider availability", () => {
  it("reports ADB and Apktool host probes in the public session inventory", async () => {
    const closed: string[] = [];
    const session = createTestBinarySession(provider(closed));
    const available: ProviderAvailability = {
      status: "available",
      code: null,
      reason: null,
      diagnostics: { version: "1.0.41" },
    };
    const unavailable: ProviderAvailability = {
      status: "unavailable",
      code: "unsupported_version",
      reason: "Use Apktool 2.7.0 or newer.",
      diagnostics: { minimum_version: "2.7.0" },
    };
    const adbDeviceAnalysis: AdbDeviceAnalysisPort = {
      inspectAvailability: async () => available,
      close: async () => {},
      execute: async () => ok(null),
    };
    const apktoolAnalysis: ApktoolResourceAnalysisPort = {
      inspectAvailability: async () => unavailable,
      close: async () => {},
      execute: async () => ok(null),
    };
    const server = createServer(
      { kind: "session", session },
      { adbDeviceAnalysis, apktoolAnalysis, logger: silentLogger },
    );
    const mcp = new Client({
      name: "provider-host-readiness",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(mcp, server);
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);

    const status = structured(
      await mcp.callTool({ name: "binary_session", arguments: {} }),
    );
    const availability = toolAvailabilitySummaryInventory.parse(
      (status.result as { tool_availability: unknown }).tool_availability,
    );
    expect(
      availability.groups.find(({ names }) =>
        names.includes("inspect_adb_client"),
      ),
    ).toMatchObject({ available: true, reason: "available" });
    expect(
      availability.groups.find(({ names }) =>
        names.includes("inspect_apktool_client"),
      ),
    ).toMatchObject({ available: false, reason: "provider_unavailable" });
  });
});

describe("owned-process prerequisite during status discovery", () => {
  it.skipIf(process.platform === "win32")(
    "keeps every other provider's status when the Apktool probe cannot prepare an owned child",
    async () => {
      directory = await createTestTempDirectory("rea-mcp-ps-prerequisite-");
      const launcher = join(directory, "apktool");
      await writeFile(launcher, "#!/bin/sh\nprintf '2.9.3\\n'\n", {
        mode: 0o755,
      });
      const apktoolAnalysis = new ApktoolProvider({
        environment: { REA_APKTOOL_COMMAND: launcher },
      });
      vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
        async () => {
          throw new LinuxOwnedProcessPrerequisiteError(
            new Error("spawn ps ENOENT"),
          );
        },
      );
      const adbDeviceAnalysis: AdbDeviceAnalysisPort = {
        inspectAvailability: async () => ({
          status: "available",
          code: null,
          reason: null,
          diagnostics: { version: "1.0.41" },
        }),
        close: async () => {},
        execute: async () => ok(null),
      };
      const closed: string[] = [];
      const session = createTestBinarySession(provider(closed));
      const server = createServer(
        { kind: "session", session },
        { adbDeviceAnalysis, apktoolAnalysis, logger: silentLogger },
      );
      const mcp = new Client({ name: "ps-prerequisite", version: "1.0.0" });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      resources.push(mcp, server, apktoolAnalysis);
      await server.connect(serverTransport);
      await mcp.connect(clientTransport);

      const reply = await mcp.callTool({
        name: "binary_session",
        arguments: {},
      });
      expect(reply.isError ?? false).toBe(false);
      const status = structured(reply);
      const availability = toolAvailabilitySummaryInventory.parse(
        (status.result as { tool_availability: unknown }).tool_availability,
      );
      const apktool = availability.groups.find(({ names }) =>
        names.includes("inspect_apktool_client"),
      );
      expect(apktool).toMatchObject({
        available: false,
        reason: "provider_unavailable",
      });
      expect(apktool?.remediation).toContain("procps-compatible ps");
      expect(apktool?.remediation).toContain("spawn ps ENOENT");
      expect(
        availability.groups.find(({ names }) =>
          names.includes("inspect_adb_client"),
        ),
      ).toMatchObject({ available: true, reason: "available" });
    },
  );
});

describe("target-free MCP fixture host isolation", () => {
  it("uses fixed unavailable ports instead of probing installed Android tools", async () => {
    directory = await createTestTempDirectory("rea-mcp-host-isolation-");
    const { mcp } = await createSessionMcpHarness(
      directory,
      provider,
      resources,
    );

    const status = structured(
      await mcp.callTool({ name: "binary_session", arguments: {} }),
    );
    const availability = toolAvailabilitySummaryInventory.parse(
      (status.result as { tool_availability: unknown }).tool_availability,
    );
    for (const name of [
      "inspect_android_package",
      "inspect_adb_client",
      "inspect_apktool_client",
    ]) {
      expect(
        availability.groups.find((group) => group.names.includes(name)),
      ).toMatchObject({ available: false, reason: "provider_missing" });
    }
  });
});

describe("target-free MCP lifecycle", () => {
  it("takes the session snapshot after Android readiness inspection completes", async () => {
    directory = await createTestTempDirectory("rea-mcp-status-readiness-");
    const targetPath = join(directory, "target.hop");
    await writeFile(targetPath, "fixture target");
    const entered = createDeferred<void>();
    const availability = createDeferred<ProviderAvailability>();
    const closed: string[] = [];
    const session = createTestBinarySession(provider(closed));
    const androidAnalysis: AndroidAnalysisPort = {
      inspectAvailability: () => {
        entered.resolve();
        return availability.promise;
      },
      close: () => Promise.resolve(),
      execute: () => Promise.resolve(ok(null)),
    };
    const server = createServer(
      { kind: "session", session },
      {
        androidAnalysis,
        logger: silentLogger,
      },
    );
    const mcp = new Client({ name: "status-readiness", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(mcp, server);
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);

    const status = mcp.callTool({ name: "binary_session", arguments: {} });
    await entered.promise;
    expect((await session.open(targetPath)).ok).toBe(true);
    availability.resolve({
      status: "available",
      code: null,
      reason: null,
      diagnostics: { configured: true },
    });

    expect(structured(await status).result).toMatchObject({
      open: true,
      path: targetPath,
    });
  });

  it("reopens replaced content at one canonical path through MCP", async () => {
    directory = await createTestTempDirectory("rea-mcp-replaced-target-");
    const targetPath = join(directory, "mutable.hop");
    await writeFile(targetPath, "first");
    const closed: string[] = [];
    const session = createTestBinarySession(provider(closed), {
      resolveAnalysisProfile: () =>
        Promise.resolve(resultOk({ profile: SNAPSHOT_PROFILE })),
    });
    const server = createServer(
      { kind: "session", session },
      { logger: silentLogger },
    );
    const mcp = new Client({ name: "replaced-target", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(mcp, server);
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);

    const first = structured(
      await mcp.callTool({
        name: "open_binary",
        arguments: { path: targetPath },
      }),
    ).result;
    expect(
      (await mcp.callTool({ name: "current_document", arguments: {} })).isError,
    ).not.toBe(true);
    await writeFile(targetPath, "second");
    const second = structured(
      await mcp.callTool({
        name: "open_binary",
        arguments: { path: targetPath },
      }),
    ).result;

    const canonicalTargetPath = await realpath(targetPath);
    expect(first).toMatchObject({ path: canonicalTargetPath });
    expect(second).toMatchObject({ path: canonicalTargetPath });
    expect(z.object({ sha256: z.string() }).parse(second).sha256).not.toBe(
      z.object({ sha256: z.string() }).parse(first).sha256,
    );
    expect(closed).toEqual([canonicalTargetPath]);
    expect(
      z
        .object({
          result: z.object({ path: z.string(), sha256: z.string() }),
        })
        .parse(
          structured(
            await mcp.callTool({
              name: "binary_session",
              arguments: {},
            }),
          ),
        ).result,
    ).toEqual({
      path: canonicalTargetPath,
      sha256: z.object({ sha256: z.string() }).parse(second).sha256,
    });
  }, 30_000);
});

describe("snapshot receipt after MCP cleanup", () => {
  it.each([false, true])(
    "retains the saved snapshot receipt when process cleanup fails (session failure=%s)",
    async (sessionFailure) => {
      directory = await createTestTempDirectory(
        "rea-mcp-snapshot-process-cleanup-",
      );
      const cleanupObservation = createEvidence(
        undefined,
        { id: "fixture", name: "Fixture", version: "1" },
        { operation: "health", parameters: {}, result: "cleanup facts" },
      );
      const { mcp, first } = await createSessionMcpHarness(
        directory,
        (closed) => {
          const base = provider(closed);
          return {
            ...base,
            createClient: (target, options) => {
              const active = base.createClient(target, options);
              let failed = false;
              return {
                ...active,
                close: async () => {
                  if (sessionFailure && !failed) {
                    failed = true;
                    return err(
                      new ProviderCleanupError(
                        "fixture",
                        ["fixture child"],
                        {},
                        { partialObservation: cleanupObservation },
                      ),
                    );
                  }
                  return active.close();
                },
              };
            },
          };
        },
        resources,
      );
      const opened = await mcp.callTool({
        name: "open_binary",
        arguments: { path: first },
      });
      expect(opened.isError).not.toBe(true);
      expect(
        (await mcp.callTool({ name: "current_document", arguments: {} }))
          .isError,
      ).not.toBe(true);
      const cleanup = vi
        .spyOn(ProcessCaptureResourceScope.prototype, "retryCleanup")
        .mockRejectedValueOnce(new Error("Process cleanup failed"));
      const path = join(directory, "saved.json");
      const result = await mcp.callTool({
        name: "close_binary",
        arguments: { snapshot_path: path },
      });
      expect(result.isError).toBe(true);
      const committed = await readFile(path);
      expect(
        parseMcpToolError(result).error.details?.partial_observation,
      ).toEqual({
        saved_snapshot: {
          path,
          bytes: committed.byteLength,
          primitive_entries: 0,
          workflow_entries: 0,
          evidence_records: 1,
        },
        ...(sessionFailure ? { cleanup_observation: cleanupObservation } : {}),
      });
      cleanup.mockRestore();
      expect(
        (await mcp.callTool({ name: "close_binary", arguments: {} })).isError,
      ).not.toBe(true);
      expect((await readFile(path)).equals(committed)).toBe(true);
    },
  );
});

describe("target-free MCP workflow", () => {
  it("reports no-target, opens, analyzes, switches, reports status, and closes", async () => {
    directory = await createTestTempDirectory("rea-mcp-session-");
    const lifecycle = await createSessionMcpHarness(
      directory,
      provider,
      resources,
    );
    const { mcp, first, second, closed } = lifecycle;

    const beforeTools = (await mcp.listTools()).tools;
    const beforeNames = beforeTools.map(({ name }) => name);
    expect(mcp.getInstructions()).toContain(
      "Use the tool that directly answers the question",
    );
    expect(
      beforeTools.find(({ name }) => name === "inspect_artifact")?.description,
    ).toMatch(/\breturns the complete content-addressed artifact graph\b/iu);
    expect(beforeNames).toContain("open_binary");
    expect(beforeNames).toContain("binary_session");
    expect(beforeNames).toContain("current_document");
    expect(beforeNames).toContain("capture_process_scenario");
    expect(
      (await mcp.callTool({ name: "open_binary", arguments: { path: first } }))
        .isError,
    ).not.toBe(true);
    const openedStatus = structured(
      await mcp.callTool({ name: "binary_session", arguments: {} }),
    );
    expect(openedStatus).toMatchObject({
      result: { path: await realpath(first) },
    });
    const sessionStatus =
      toolContract("binary_session").outputSchema.parse(openedStatus);
    expect(
      expandProviderCapabilities(sessionStatus.result.capabilities).map(
        ({ operation }) => operation,
      ),
    ).not.toContain("inventory_artifact");
    expect(
      text(await mcp.callTool({ name: "current_document", arguments: {} })),
    ).toContain("first.hop");
    const { recordedUnknown } = await snapshotAndRecordUnknown(
      lifecycle,
      directory,
    );
    const resolved = await mcp.callTool({
      name: "update_unknown",
      arguments: {
        unknown_id: recordedUnknown.unknown_id,
        expected_revision: 1,
        status: "resolved",
        severity: "medium",
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        required_authority: "controlled-replay",
        required_confidence: "observed",
        required_environment: null,
        recommended_probes: [],
        relationships: [],
        resolution: {
          disposition: "out-of-scope",
          rationale: "Operator explicitly excluded this branch from scope.",
          evidence_ids: [],
        },
      },
    });
    expect(resolved.isError).not.toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      structured(
        await mcp.callTool({
          name: "verify_unknown_resolution",
          arguments: { unknown_id: recordedUnknown.unknown_id },
        }),
      ).result,
    ).toMatchObject({ valid: true, truthVerified: false });
    await mcp.callTool({ name: "open_binary", arguments: { path: second } });
    expect(closed.some((path) => path.endsWith("first.hop"))).toBe(true);
    expect(
      text(await mcp.callTool({ name: "binary_session", arguments: {} })),
    ).toContain("second.hop");
    const snapshotPath = join(directory, "analysis.json");
    expect(
      structured(
        await mcp.callTool({
          name: "close_binary",
          arguments: { snapshot_path: snapshotPath },
        }),
      ).result,
    ).toMatchObject({
      path: snapshotPath,
      primitive_entries: 0,
      workflow_entries: 0,
      evidence_records: 0,
    });
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toMatchObject({
      evidence_bundle: { records: [], unknowns: [] },
    });
    expect(
      text(await mcp.callTool({ name: "binary_session", arguments: {} })),
    ).toContain('"open":false');
    expect(
      (
        await mcp.callTool({
          name: "open_binary",
          arguments: { path: first, snapshot_path: snapshotPath },
        })
      ).isError,
    ).toBe(true);
    expect(
      structured(await mcp.callTool({ name: "list_unknowns", arguments: {} }))
        .result,
    ).toMatchObject({ items: [] });
    expect(
      (
        await mcp.callTool({
          name: "open_binary",
          arguments: { path: second, snapshot_path: snapshotPath },
        })
      ).isError,
    ).not.toBe(true);
    await mcp.callTool({ name: "close_binary", arguments: {} });
  });
});

describe("MCP snapshot open ordering", () => {
  it("keeps a snapshot open ahead of later reads and closes on the same connection", async () => {
    directory = await createTestTempDirectory("rea-mcp-snapshot-open-order-");
    const { mcp, first, second } = await createSessionMcpHarness(
      directory,
      provider,
      resources,
    );
    const snapshotPath = join(directory, "analysis.json");
    await mcp.callTool({ name: "open_binary", arguments: { path: second } });
    expect(
      (
        await mcp.callTool({
          name: "close_binary",
          arguments: { snapshot_path: snapshotPath },
        })
      ).isError,
    ).not.toBe(true);
    await mcp.callTool({ name: "open_binary", arguments: { path: first } });

    // Dispatched without awaiting, like a client issuing one turn's calls.
    const opening = mcp.callTool({
      name: "open_binary",
      arguments: { path: second, snapshot_path: snapshotPath },
    });
    const reading = mcp.callTool({ name: "current_document", arguments: {} });
    const closing = mcp.callTool({ name: "close_binary", arguments: {} });

    expect((await opening).isError, JSON.stringify(await opening)).not.toBe(
      true,
    );
    expect(text(await reading)).toContain("second.hop");
    expect((await closing).isError).not.toBe(true);
    expect(
      text(await mcp.callTool({ name: "binary_session", arguments: {} })),
    ).toContain('"open":false');
  }, 10_000);
});

describe("session filesystem path boundaries over MCP", () => {
  it("rejects relative snapshot and export paths with an absolute-path error", async () => {
    directory = await createTestTempDirectory("rea-mcp-path-boundary-");
    const { mcp, first } = await createSessionMcpHarness(
      directory,
      provider,
      resources,
    );

    const exported = await mcp.callTool({
      name: "export_evidence_bundle",
      arguments: { path: "relative-bundle.json" },
    });
    expect(exported.isError, JSON.stringify(exported.content)).toBe(true);
    expect(JSON.stringify(exported.content)).toContain("absolute");

    const opened = await mcp.callTool({
      name: "open_binary",
      arguments: { path: first },
    });
    expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
    const closed = await mcp.callTool({
      name: "close_binary",
      arguments: { snapshot_path: "relative-analysis.json" },
    });
    expect(closed.isError, JSON.stringify(closed.content)).toBe(true);
    expect(JSON.stringify(closed.content)).toContain("absolute");
    await mcp.callTool({ name: "close_binary", arguments: {} });
  }, 10_000);
});

describe("json depth bounds over MCP", () => {
  it("preserves source integrity and nesting-limit diagnostics for borrowed parameters", async () => {
    directory = await createTestTempDirectory("rea-mcp-depth-bound-");
    const createClient = vi.fn<AnalysisProvider["createClient"]>(() => {
      throw new Error("Offline comparison must not open a provider");
    });
    const { mcp } = await createSessionMcpHarness(
      directory,
      (closed) => ({ ...provider(closed), createClient }),
      resources,
      4_096,
    );
    const input = INVESTIGATION_EXAMPLES.compare_process_captures.input;
    const baseline = await mcp.callTool({
      name: "compare_process_captures",
      arguments: input,
    });
    expect(baseline.isError, JSON.stringify(baseline)).not.toBe(true);
    let value: unknown = 1;
    for (let index = 0; index <= MAX_JSON_DEPTH; index += 1)
      value = { nested: value };
    const result = await mcp.callTool({
      name: "compare_process_captures",
      arguments: {
        left: {
          ...input.left,
          parameters: { attack: value },
        },
        right: input.right,
      },
    });
    expect(result.isError, JSON.stringify(result.content)).toBe(true);
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        // The Evidence owner authenticates borrowed source records after
        // envelope admission and preserves the JSON bound before cloning.
        code: "evidence_integrity_mismatch",
        category: "integrity_mismatch",
        message: expect.stringContaining(
          `The left Evidence failed validation (at parameters: JSON value exceeds maximum nesting depth of ${MAX_JSON_DEPTH}. This release has no runtime override.)`,
        ),
        details: { reason: "left Evidence failed validation" },
      },
    });
    const recovered = await mcp.callTool({
      name: "compare_process_captures",
      arguments: input,
    });
    expect(recovered.isError, JSON.stringify(recovered.content)).not.toBe(true);
    expect(recovered.structuredContent).toEqual(baseline.structuredContent);
    expect(createClient).not.toHaveBeenCalled();
  }, 10_000);
});

const client = (path: string, closed: string[]): AnalysisClient => ({
  execute: (name) =>
    Promise.resolve(
      ok(name === "health" ? null : name === "current_document" ? path : null),
    ),
  close: () => {
    closed.push(path);
    return Promise.resolve(resultOk(null));
  },
});

const provider = (closed: string[]): AnalysisProvider => {
  const identity = {
    id: "fixture",
    name: "Fixture analysis provider",
    version: "1",
  };
  const capability: CapabilityDescriptor = {
    provider: identity,
    operation: "current_document",
    available: true,
    reason: null,
    effects: {
      mutatesArtifact: false,
      launchesProcess: false,
      mayShowUi: false,
      mayAccessNetwork: false,
      mayWriteFilesystem: false,
      changesPermissions: false,
      requiresRoot: false,
    },
    limitations: [],
  };
  return {
    identity: () => identity,
    capabilities: () => [capability],
    createClient: (target) => client(target.path, closed),
  };
};

const text = (result: CallToolResult): string => {
  const content = result.content.find((item) => item.type === "text");
  if (content?.type !== "text") throw new Error("missing text result");
  return content.text;
};

const structured = (result: CallToolResult): Record<string, unknown> => {
  if (result.isError === true) return parseMcpToolError(result);
  if (
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null
  )
    throw new Error(
      `missing structured result: ${JSON.stringify(result.content)}`,
    );
  return z.record(z.string(), z.unknown()).parse(result.structuredContent);
};
