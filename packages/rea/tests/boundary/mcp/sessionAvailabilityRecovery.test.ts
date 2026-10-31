import { expect, it } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { AnalysisTimeoutError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  createBinarySessionTargets,
  createCacheProvider,
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";

it("restores MCP tool availability after cancelling a target switch", async () => {
  const [first, second] = await createBinarySessionTargets();
  const closing = createDeferred<void>();
  const release = createDeferred<void>();
  const cancellationObserved = createDeferred<void>();
  const provider = createCacheProvider([]);
  const resolveProfile = provider.resolveAnalysisProfile;
  if (resolveProfile === undefined)
    throw new Error("Missing test analysis profile");
  const clients: { calls: number; closed: number }[] = [];
  provider.createClient = () => {
    const state = { calls: 0, closed: 0 };
    const firstClient = clients.length === 0;
    clients.push(state);
    return {
      execute: (operation) => {
        state.calls += 1;
        return Promise.resolve(
          firstClient
            ? err(new ProviderAdapterError("fixture", operation))
            : observed("restored-name"),
        );
      },
      close: async () => {
        state.closed += 1;
        if (firstClient) {
          closing.resolve();
          await release.promise;
        }
        return ok(null);
      },
    };
  };
  const session = createTestBinarySession(provider, {
    resolveAnalysisProfile: (target, options) => {
      if (target.path === second) {
        options?.signal?.addEventListener(
          "abort",
          () => cancellationObserved.resolve(),
          { once: true },
        );
      }
      return resolveProfile(target, options);
    },
  });
  const { client, close } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "session-recovery", version: "1" },
    serverOptions: { environment: {}, logger: silentLogger },
  });
  const controller = new AbortController();
  const readStatus = async () => {
    const reply = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    return toolContract("binary_session").outputSchema.parse(
      reply.structuredContent,
    ).result;
  };
  try {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: first },
    });
    expect(opened.isError).not.toBe(true);
    const query = { address: "0x1000", document: "fixture" };
    expect(
      (await client.callTool({ name: "address_name", arguments: query }))
        .isError,
    ).toBe(true);
    const before = await readStatus();
    expect(
      expandToolAvailability(before.tool_availability).find(
        (tool) => tool.name === "address_name",
      ),
    ).toMatchObject({
      available: false,
      reason: "provider_unavailable",
    });

    const switching = client.callTool(
      { name: "open_binary", arguments: { path: second } },
      { signal: controller.signal },
    );
    const cancelled = expect(switching).rejects.toThrow();
    await closing.promise;
    controller.abort();
    await cancellationObserved.promise;
    release.resolve();
    await cancelled;

    // Cancellation ends the client's wait before the server restores its session.
    const settled = await session.withAdmittedAnalysis(
      "binary_session",
      undefined,
      async () => null,
    );
    if (!settled.ok) throw settled.error;
    const restored = await readStatus();
    expect(restored).toMatchObject({ open: true, path: first });
    expect(before.analysis_run?.run_id).toEqual(expect.any(String));
    expect(restored.analysis_run?.run_id).toEqual(expect.any(String));
    expect(restored.analysis_run?.run_id).not.toBe(before.analysis_run?.run_id);
    expect(clients).toEqual([{ calls: 1, closed: 1 }]);
    expect(
      expandToolAvailability(restored.tool_availability).find(
        (tool) => tool.name === "address_name",
      ),
    ).toMatchObject({
      available: true,
      reason: "available",
      remediation: null,
    });

    const retried = await client.callTool({
      name: "address_name",
      arguments: query,
    });
    expect(retried.isError).not.toBe(true);
    expect(retried.structuredContent).toMatchObject({
      normalized_result: "restored-name",
    });
    expect(clients).toEqual([
      { calls: 1, closed: 1 },
      { calls: 1, closed: 0 },
    ]);
  } finally {
    controller.abort();
    release.resolve();
    await close();
  }
});

it("keeps a retired run and its lineage visible over MCP until cleanup succeeds", async () => {
  const [path] = await createBinarySessionTargets();
  let allowed = false;
  const provider = createCacheProvider([]);
  provider.createClient = (_target, _profile, context) => {
    if (context === undefined) throw new Error("missing analysis run context");
    return {
      execute: () => Promise.resolve(observed("fixture-name")),
      runtimeLineageSnapshots: () => [
        {
          provider: provider.identity(),
          observation: {
            status: "unavailable" as const,
            observedAt: "2026-10-16T00:00:00Z",
            runId: context.runId,
            launcherPid: 123,
            processGroupId: 123,
            reason: "fixture identity could not be revalidated",
          },
        },
      ],
      close: () =>
        Promise.resolve(
          allowed
            ? ok(null)
            : err(
                new ProviderCleanupError("fixture", ["owned-runtime"], {
                  reason: "fixture cleanup denied",
                }),
              ),
        ),
    };
  };
  const session = createTestBinarySession(provider);
  const { client, close } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "retained-run", version: "1" },
    serverOptions: { environment: {}, logger: silentLogger },
  });
  const readStatus = async () => {
    const reply = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    return toolContract("binary_session").outputSchema.parse(
      reply.structuredContent,
    ).result;
  };
  try {
    expect((await readStatus()).analysis_run).toBeNull();
    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: "address_name",
          arguments: { address: "0x1000", document: "fixture" },
        })
      ).isError,
    ).not.toBe(true);
    const before = await readStatus();
    expect(before.analysis_run).toMatchObject({
      run_id: expect.any(String),
      process_lineage: { status: "snapshots" },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        (await client.callTool({ name: "close_binary", arguments: {} }))
          .isError,
      ).toBe(true);
      expect(await readStatus()).toMatchObject({
        open: false,
        cleanup_pending: true,
        analysis_run: before.analysis_run,
      });
    }
    allowed = true;
    expect(
      (await client.callTool({ name: "close_binary", arguments: {} })).isError,
    ).not.toBe(true);
    expect(await readStatus()).toMatchObject({
      open: false,
      cleanup_pending: false,
      analysis_run: null,
    });
  } finally {
    allowed = true;
    await close();
  }
});

it("keeps provider tools available after one request reaches its deadline", async () => {
  const [path] = await createBinarySessionTargets();
  const provider = createCacheProvider([]);
  let calls = 0;
  provider.createClient = () => ({
    execute: (operation) => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? err(
              new AnalysisTimeoutError(operation, 5000, {
                userMessage:
                  "Fixture decompilation exceeded its 5-second limit. The session remains usable.",
              }),
            )
          : observed("after-timeout"),
      );
    },
    close: () => Promise.resolve(ok(null)),
  });
  const session = createTestBinarySession(provider);
  const { client, close } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "request-timeout", version: "1" },
    serverOptions: { environment: {}, logger: silentLogger },
  });
  const availability = async () => {
    const reply = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    return expandToolAvailability(
      toolContract("binary_session").outputSchema.parse(reply.structuredContent)
        .result.tool_availability,
    );
  };
  try {
    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    const before = await availability();
    const query = { address: "0x1000", document: "fixture" };
    const timedOut = await client.callTool({
      name: "address_name",
      arguments: query,
    });
    expect(timedOut.isError).toBe(true);
    expect(parseMcpToolError(timedOut)).toMatchObject({
      error: { code: "provider_timeout", retryable: true },
    });
    // A request-level deadline is not a provider failure: nothing is marked
    // unavailable, unlike the ProviderAdapterError case above.
    expect(await availability()).toEqual(before);
    const retried = await client.callTool({
      name: "address_name",
      arguments: query,
    });
    expect(retried.structuredContent).toMatchObject({
      normalized_result: "after-timeout",
    });
  } finally {
    await close();
  }
});
