import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonObjectSchema } from "../../../src/domain/jsonValue.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  createAnalysisExecution,
  type AnalysisProviderCandidate,
  type AnalysisProviderInspectionOptions,
  type CapabilityDescriptor,
  type ProviderIdentity,
} from "../../../src/application/AnalysisProvider.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { err, ok } from "../../../src/domain/result.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { BINARY_SESSION_SUMMARY_OMITTED_FIELDS } from "../../../src/contracts/sessionStatusContract.js";
import {
  toolContract,
  TOOL_CONTRACTS,
} from "../../../src/contracts/toolContracts.js";
import {
  analysisProviderCandidate,
  analysisProviderCandidateSummary,
  expandToolAvailability,
  toolAvailabilityInventory,
  toolAvailabilitySummaryInventory,
} from "../../../src/contracts/toolOutputSchemaPrimitives.js";

const resources: Array<{ close(): Promise<unknown> }> = [];
let directory: string | undefined;
afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it("delivers provider-owned diagnostic keys without narrowing their JSON facts", async () => {
  const diagnostics = jsonObjectSchema.parse(
    JSON.parse(
      '{"__proto__":{"observed":true},"constructor":null,"empty":"","count":0}',
    ),
  );
  const provider = candidate("alpha", []);
  const session = composeBinarySession(
    new AnalysisProviderRegistry([
      {
        ...provider,
        inspectAvailability: () => ({
          status: "available",
          code: null,
          reason: null,
          diagnostics,
        }),
      },
    ]),
  );
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const mcp = new Client({ name: "provider-diagnostics", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(mcp, server, { close: () => session.close() });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  const response = await mcp.callTool({
    name: "binary_session",
    arguments: { detail: "complete" },
  });
  expect(response.isError).toBeFalsy();
  const payload = toolContract("binary_session").outputSchema.parse(
    response.structuredContent,
  );
  const found = analysisProviderCandidate
    .array()
    .parse(payload.result.analysis_provider_candidates)
    .find((entry) => entry.provider.id === "alpha");
  if (found === undefined) throw new Error("Missing provider candidate");
  expect(found.availability.diagnostics).toEqual(diagnostics);
  expect(Object.hasOwn(found.availability.diagnostics, "__proto__")).toBe(true);
  const text = response.content.find((item) => item.type === "text");
  if (text?.type !== "text")
    throw new Error("Missing serialized session status");
  expect(JSON.parse(text.text)).toEqual(response.structuredContent);
});

describe("provider selection over MCP", () => {
  it("keeps open_binary and binary_session binding semantics exact", async () => {
    directory = await createTestTempDirectory("rea-provider-mcp-");
    const target = join(directory, "fixture.hop");
    await writeFile(target, "fixture");
    const starts: string[] = [];
    const session = composeBinarySession(
      new AnalysisProviderRegistry([
        candidate("beta", starts),
        candidate("alpha", starts),
      ]),
    );
    const server = createServer(
      { kind: "session", session },
      { logger: silentLogger },
    );
    const mcp = new Client({ name: "provider-selection", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(mcp, server);
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);

    const before = structured(
      await mcp.callTool({
        name: "binary_session",
        arguments: {},
      }),
    );
    expect(before.result).toMatchObject({
      open: false,
      analysis_run: null,
      analysis_provider_binding: null,
      analysis_provider_candidates: [
        {
          provider: { id: "alpha" },
          target_support: { status: "unknown" },
          selected: false,
        },
        {
          provider: { id: "beta" },
          target_support: { status: "unknown" },
          selected: false,
        },
      ],
    });
    expect(starts).toEqual([]);

    const malformed = await mcp.callTool({
      name: "open_binary",
      arguments: { path: target, provider_id: "Beta" },
    });
    expect(malformed.isError).toBe(true);
    expect(starts).toEqual([]);

    const ambiguous = await mcp.callTool({
      name: "open_binary",
      arguments: { path: target },
    });
    expect(ambiguous.isError).toBe(true);
    expect(structured(ambiguous)).toMatchObject({
      error: {
        code: "capability_unavailable",
        details: {
          selection_reason: "ambiguous",
          requested_provider_id: "auto",
          candidate_ids: ["alpha", "beta"],
        },
      },
    });
    expect(starts).toEqual([]);

    const opened = await mcp.callTool({
      name: "open_binary",
      arguments: { path: target, provider_id: "beta" },
    });
    expect(opened.isError).not.toBe(true);
    expect(starts).toEqual([]);

    const observed = await mcp.callTool({
      name: "address_name",
      arguments: {},
    });
    expect(observed.isError).not.toBe(true);
    expect(structured(observed)).toMatchObject({
      normalized_result: "beta:address_name",
      evidence_id: expect.stringMatching(/^ev_/u),
    });
    expect(starts).toEqual(["beta"]);

    const status = structured(
      await mcp.callTool({
        name: "binary_session",
        arguments: {},
      }),
    );
    expect(status.result).toMatchObject({
      open: true,
      analysis_run: {
        run_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        process_lineage: { status: "not_observed" },
      },
      analysis_provider_binding: {
        provider: { id: "beta", version: "1" },
        selection_source: "request",
      },
      analysis_provider_candidates: [
        { provider: { id: "alpha" }, selected: false },
        { provider: { id: "beta", version: "1" }, selected: true },
      ],
    });

    const unknown = await mcp.callTool({
      name: "open_binary",
      arguments: { path: target, provider_id: "missing" },
    });
    expect(unknown.isError).toBe(true);
    expect(structured(unknown)).toMatchObject({
      error: { details: { selection_reason: "unknown_provider" } },
    });
    expect(
      structured(
        await mcp.callTool({
          name: "binary_session",
          arguments: {},
        }),
      ).result,
    ).toMatchObject({
      analysis_provider_binding: { provider: { id: "beta" } },
    });
  });
});

it("offers admitted providers and retains unconfigured rejections", async () => {
  directory = await createTestTempDirectory("rea-provider-mcp-mixed-");
  const target = join(directory, "fixture.hop");
  await writeFile(target, "fixture");
  const starts: string[] = [];
  const session = composeBinarySession(
    new AnalysisProviderRegistry([
      candidate("beta", starts),
      candidate("ghidra", starts, false),
      candidate("alpha", starts),
      candidate("kuna", starts, false),
    ]),
  );
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const mcp = new Client({ name: "provider-selection", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(mcp, server);
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);

  const ambiguous = await mcp.callTool({
    name: "open_binary",
    arguments: { path: target },
  });
  expect(ambiguous.isError).toBe(true);
  expect(structured(ambiguous)).toMatchObject({
    error: {
      code: "capability_unavailable",
      details: {
        selection_reason: "ambiguous",
        candidate_ids: ["alpha", "beta"],
        rejections: [
          { provider_id: "ghidra", code: "not_configured" },
          { provider_id: "kuna", code: "not_configured" },
        ],
      },
    },
  });
  expect(starts).toEqual([]);

  const retried = await mcp.callTool({
    name: "open_binary",
    arguments: { path: target, provider_id: "alpha" },
  });
  expect(retried.isError).not.toBe(true);
  expect(
    structured(
      await mcp.callTool({
        name: "binary_session",
        arguments: {},
      }),
    ).result,
  ).toMatchObject({
    analysis_provider_binding: {
      provider: { id: "alpha", version: "1" },
      selection_source: "request",
    },
  });
  expect(starts).toEqual([]);
});

const sessionStatusOf = async (
  mcp: Client,
  arguments_: Record<string, unknown>,
) => {
  const reply = await mcp.callTool({
    name: "binary_session",
    arguments: arguments_,
  });
  expect(reply.isError).not.toBe(true);
  const parsed = toolContract("binary_session").outputSchema.parse(
    reply.structuredContent,
  ).result;
  const text = reply.content?.[0];
  if (text?.type !== "text") throw new Error("binary_session omitted text");
  expect(JSON.parse(text.text)).toEqual(reply.structuredContent);
  return {
    parsed,
    raw: z
      .object({ result: z.record(z.string(), z.unknown()) })
      .parse(reply.structuredContent),
    bytes: Buffer.byteLength(text.text),
  };
};

type SessionStatus = Awaited<ReturnType<typeof sessionStatusOf>>;

/** Per-tool decision facts that both projections must carry. */
const toolStatus = (inventory: Parameters<typeof expandToolAvailability>[0]) =>
  expandToolAvailability(inventory)
    .map(
      ({
        name,
        available,
        reason,
        remediation,
        modes,
        client_requirements,
      }) => ({
        name,
        available,
        reason,
        remediation,
        modes,
        client_requirements,
      }),
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));

/** Per-candidate decision facts that both projections must carry. */
const candidateStatus = (candidates: unknown) =>
  analysisProviderCandidateSummary.array().parse(
    z
      .array(z.record(z.string(), z.unknown()))
      .parse(candidates)
      .map(({ provider, selected, availability, target_support }) => {
        const state = (value: unknown) => {
          const { status, code, reason } = z
            .object({
              status: z.string(),
              code: z.unknown(),
              reason: z.unknown(),
            })
            .parse(value);
          return { status, code, reason };
        };
        return {
          provider,
          selected,
          availability: state(availability),
          target_support: state(target_support),
        };
      }),
  );

const expectSummaryKeepsDecisionFacts = (
  summary: SessionStatus,
  complete: SessionStatus,
  open: boolean,
) => {
  expect(summary.parsed).toMatchObject({
    open,
    detail: "summary",
    omitted_fields: [...BINARY_SESSION_SUMMARY_OMITTED_FIELDS],
  });
  expect(complete.parsed.detail).toBe("complete");
  expect(Object.hasOwn(complete.parsed, "omitted_fields")).toBe(false);
  expect(summary.bytes).toBeLessThan(complete.bytes);
  expect(JSON.stringify(summary.parsed)).not.toContain('"diagnostics"');

  // Summary candidates parse only as summaries and keep status, code and reason.
  expect(
    analysisProviderCandidateSummary
      .array()
      .parse(summary.parsed.analysis_provider_candidates),
  ).toEqual(candidateStatus(complete.parsed.analysis_provider_candidates));
  // Route capabilities and the binding stay inline at both levels of detail.
  expect(summary.parsed.capabilities).toEqual(complete.parsed.capabilities);
  expect(summary.parsed.analysis_provider_binding).toEqual(
    complete.parsed.analysis_provider_binding,
  );

  const summaryTools = toolAvailabilitySummaryInventory.parse(
    summary.parsed.tool_availability,
  );
  const completeTools = toolAvailabilityInventory.parse(
    complete.parsed.tool_availability,
  );
  expect(summaryTools.groups.length).toBeLessThan(completeTools.groups.length);
  expect(toolStatus(summaryTools)).toEqual(toolStatus(completeTools));
  expect(toolStatus(summaryTools).map(({ name }) => name)).toEqual(
    TOOL_CONTRACTS.map(({ name }) => name).toSorted((left, right) =>
      left.localeCompare(right),
    ),
  );
};

const connectDetailFixture = async (starts: string[]) => {
  const session = composeBinarySession(
    new AnalysisProviderRegistry([
      candidate("alpha", starts),
      candidate("beta", starts, false),
    ]),
  );
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const mcp = new Client({ name: "session-detail", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(mcp, server, { close: () => session.close() });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return mcp;
};

describe("binary_session detail over MCP", () => {
  it("defaults to a summary that keeps every decision fact and names what complete detail adds", async () => {
    directory = await createTestTempDirectory("rea-session-detail-mcp-");
    const target = join(directory, "fixture.hop");
    await writeFile(target, "fixture");
    const starts: string[] = [];
    const mcp = await connectDetailFixture(starts);

    for (const open of [false, true]) {
      if (open) {
        const opened = await mcp.callTool({
          name: "open_binary",
          arguments: { path: target, provider_id: "alpha" },
        });
        expect(opened.isError).not.toBe(true);
      }
      const summary = await sessionStatusOf(mcp, {});
      const explicit = await sessionStatusOf(mcp, { detail: "summary" });
      const complete = await sessionStatusOf(mcp, { detail: "complete" });
      expect(explicit.parsed).toEqual(summary.parsed);
      expectSummaryKeepsDecisionFacts(summary, complete, open);
      expect(
        analysisProviderCandidate
          .array()
          .parse(complete.parsed.analysis_provider_candidates),
      ).toMatchObject([
        {
          provider: { id: "alpha" },
          selected: open,
          availability: {
            status: "available",
            diagnostics: { executable_path: "/opt/alpha/bin/analyze" },
          },
          capabilities: [{ provider: { id: "alpha" } }],
        },
        {
          provider: { id: "beta" },
          selected: false,
          availability: {
            status: "unavailable",
            code: "not_configured",
            reason: "beta is not configured",
          },
        },
      ]);
    }
    expect(starts).toEqual([]);
  });

  it("rejects results whose fields do not match their detail, canonically and as advertised", async () => {
    const mcp = await connectDetailFixture([]);
    const summary = (await sessionStatusOf(mcp, {})).raw.result;
    const complete = (await sessionStatusOf(mcp, { detail: "complete" })).raw
      .result;
    const advertised = (await mcp.listTools()).tools.find(
      ({ name }) => name === "binary_session",
    )?.outputSchema;
    if (advertised === undefined)
      throw new Error("binary_session omitted its output schema");
    const validate = new AjvJsonSchemaValidator().getValidator(
      z.record(z.string(), z.unknown()).parse(advertised),
    );
    const canonical = toolContract("binary_session").outputSchema;
    const { omitted_fields: _omitted, ...summaryWithoutOmissions } = summary;
    const cases = {
      summary,
      complete,
      "complete labelled summary": { ...complete, detail: "summary" },
      "summary labelled complete": { ...summary, detail: "complete" },
      "summary without omitted_fields": summaryWithoutOmissions,
      "complete with omitted_fields": {
        ...complete,
        omitted_fields: summary.omitted_fields,
      },
      "summary with complete candidates": {
        ...summary,
        analysis_provider_candidates: complete.analysis_provider_candidates,
      },
      "summary with complete tool groups": {
        ...summary,
        tool_availability: complete.tool_availability,
      },
      "complete with summary candidates": {
        ...complete,
        analysis_provider_candidates: summary.analysis_provider_candidates,
      },
      "complete with summary tool groups": {
        ...complete,
        tool_availability: summary.tool_availability,
      },
    };
    for (const [name, result] of Object.entries(cases)) {
      const valid = name === "summary" || name === "complete";
      expect(canonical.safeParse({ result }).success, name).toBe(valid);
      expect(validate({ result }).valid, name).toBe(valid);
    }
  });

  it("rejects an unknown detail without starting a provider", async () => {
    const starts: string[] = [];
    const mcp = await connectDetailFixture(starts);
    const rejected = await mcp.callTool({
      name: "binary_session",
      arguments: { detail: "verbose" },
    });
    expect(rejected.isError).toBe(true);
    expect(starts).toEqual([]);
  });
});

const candidate = (
  id: string,
  starts: string[],
  available = true,
): AnalysisProviderCandidate => {
  const identity: ProviderIdentity = {
    id,
    name: `${id} provider`,
    version: null,
  };
  return {
    identity: () => identity,
    capabilities: () => [capability(identity)],
    inspectAvailability: () =>
      available
        ? {
            status: "available",
            code: null,
            reason: null,
            diagnostics: { executable_path: `/opt/${id}/bin/analyze` },
          }
        : {
            status: "unavailable",
            code: "not_configured",
            reason: `${id} is not configured`,
            diagnostics: {},
          },
    inspectTargetSupport: () => ({
      status: "supported",
      code: null,
      reason: null,
      diagnostics: {},
    }),
    resolveAnalysisProfile: () =>
      Promise.resolve(
        ok({
          profile: createAnalysisProfile(
            { id, name: identity.name, version: "1" },
            { fixture: id },
          ),
        }),
      ),
    createClient: (_target, profile) => {
      starts.push(id);
      return {
        execute: (operation) =>
          Promise.resolve(
            ok(
              createAnalysisExecution(
                `${id}:${operation}`,
                profile?.provider ?? identity,
              ),
            ),
          ),
        close: () => Promise.resolve(ok(null)),
      };
    },
  };
};

const capability = (provider: ProviderIdentity): CapabilityDescriptor => ({
  provider,
  operation: "address_name",
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

const structured = (result: CallToolResult): Record<string, unknown> =>
  result.isError === true
    ? parseMcpToolError(result)
    : z.record(z.string(), z.unknown()).parse(result.structuredContent);

it("retains attributed mixed profile cleanup through registered MCP calls and partial retry", async () => {
  directory = await createTestTempDirectory("rea-profile-completion-mcp-");
  const path = join(directory, "fixture.hop");
  await writeFile(path, "fixture");
  const starts: string[] = [];
  const released = new Set<string>();
  const failures = {
    alpha: new AnalysisCancelledError("resolve_analysis_profile", {
      cause: { caller: "controlled producer cancellation" },
      cleanup: { reason: "alpha close failed", resources: ["alpha-file"] },
    }),
    beta: new ProviderCleanupError("beta", ["beta-file"], {
      reason: "beta close failed",
    }),
  };
  const providers = (["alpha", "beta"] as const).map((id) => ({
    ...candidate(id, starts),
    resolveAnalysisProfile: async () => err(failures[id]),
    closeOwnedResources: async () => {
      if (!released.has(id)) return err(failures[id]);
      failures[id].resolveCleanup();
      return ok(null);
    },
  }));
  const session = composeBinarySession(new AnalysisProviderRegistry(providers));
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const mcp = new Client({ name: "profile-completion", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(mcp, server, { close: () => session.close() });
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const opening = parseMcpToolError(
      await mcp.callTool({
        name: "open_binary",
        arguments: { path, provider_id: "auto" },
      }),
    );
    expect(opening.error).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: ["alpha-file", "beta-file"],
        diagnostics: {
          profile_errors: expect.arrayContaining([
            expect.objectContaining({ provider_id: "alpha" }),
            expect.objectContaining({ provider_id: "beta" }),
          ]),
        },
      },
    });
    expect(starts).toEqual([]);
    released.add("alpha");
    const closing = parseMcpToolError(
      await mcp.callTool({ name: "close_binary", arguments: {} }),
    );
    expect(closing.error).toMatchObject({
      code: "cleanup_incomplete",
      details: { resources: ["beta-file"] },
    });
    expect(await session.status()).toMatchObject({ cleanup_pending: true });
    released.add("beta");
    expect(
      (await mcp.callTool({ name: "close_binary", arguments: {} })).isError,
    ).not.toBe(true);
    expect(await session.status()).toMatchObject({ cleanup_pending: false });
    expect(failures.alpha.cleanupIncomplete).toBe(false);
    expect(failures.beta.cleanupIncomplete).toBe(false);
  } finally {
    released.add("alpha");
    released.add("beta");
    await session.close();
  }
});

it.each(["ready", "cancelled", "physical"] as const)(
  "awaits asynchronous candidate finalization through registered MCP status (%s)",
  async (mode) => {
    const starts: string[] = [];
    const base = candidate("alpha", starts);
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const session = composeBinarySession(
      new AnalysisProviderRegistry([
        {
          ...base,
          inspectAvailability: async ({
            signal,
          }: AnalysisProviderInspectionOptions = {}) => {
            enter();
            await gate;
            if (mode === "physical")
              throw new ProviderAdapterError("alpha", "binary_session", {
                diagnostics: {
                  reason: "controlled physical readiness failure",
                },
              });
            if (signal?.aborted)
              throw new AnalysisCancelledError("binary_session", {
                cause: signal.reason,
              });
            return base.inspectAvailability();
          },
        },
      ]),
    );
    const server = createServer(
      { kind: "session", session },
      { logger: silentLogger },
    );
    const mcp = new Client({ name: "async-readiness", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(mcp, server, { close: () => session.close() });
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    let settled = false;
    const observing = mcp
      .callTool({ name: "binary_session", arguments: {} })
      .then((result) => {
        settled = true;
        return result;
      });
    let closing: ReturnType<typeof session.close> | undefined;
    try {
      await entered;
      if (mode !== "ready") {
        closing = session.close();
        const during = structured(
          await mcp.callTool({
            name: "binary_session",
            arguments: { detail: "complete" },
          }),
        );
        expect(during.result).toMatchObject({
          cleanup_pending: true,
          analysis_provider_candidates: [
            {
              provider: { id: "alpha" },
              availability: {
                status: "unknown",
                diagnostics: { finalization: "in_progress" },
              },
            },
          ],
        });
        // The summary keeps the unknown status and its reason, not diagnostics.
        const summary = structured(
          await mcp.callTool({ name: "binary_session", arguments: {} }),
        );
        expect(summary.result).toMatchObject({
          cleanup_pending: true,
          analysis_provider_candidates: [
            {
              provider: { id: "alpha" },
              availability: {
                status: "unknown",
                code: null,
                reason: expect.stringContaining("finalization is in progress"),
              },
            },
          ],
        });
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      finish();
      const result = await observing;
      if (mode === "ready") {
        expect(result.isError).not.toBe(true);
        expect(structured(result).result).toMatchObject({
          analysis_provider_candidates: [
            {
              provider: { id: "alpha" },
              availability: { status: "available" },
            },
          ],
        });
      } else {
        expect(parseMcpToolError(result).error).toMatchObject(
          mode === "cancelled"
            ? { code: "cancelled", details: { operation: "binary_session" } }
            : {
                code: "execution_failure",
                details: {
                  operation: "binary_session",
                  diagnostics: {
                    reason: "controlled physical readiness failure",
                  },
                },
              },
        );
        expect(await closing).toEqual(ok(null));
      }
      expect(starts).toEqual([]);
    } finally {
      finish();
      await observing;
      await closing;
      await session.close();
    }
  },
);
