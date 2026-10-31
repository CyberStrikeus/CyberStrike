import { once } from "node:events";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { HopperProcessError } from "../../../../src/domain/hopperErrors.js";
import { HOPPER_OPERATIONS } from "../../../../src/hopper/HopperProviderCapabilities.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import type { HopperDiagnostic } from "../../../../src/hopper/HopperDiagnostics.js";
import { providerCleanupFailure } from "../../../../src/hopper/HopperDiagnostics.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";

import {
  HopperFixtureLauncher as FixtureLauncher,
  startHopperFixtureClient as startClient,
} from "./hopperClient.fixture.js";

describe("HopperClient protocol", () => {
  it("does not start cold and preserves normal dispatch once ready", async () => {
    const launcher = new FixtureLauncher();
    const client = new HopperClient({ launcher, startupTimeoutMs: 1_000 });
    onTestFinished(async () => {
      await client.close();
    });

    await expect(
      client.callToolIfReady("echo", { label: "cold" }),
    ).resolves.toBe(undefined);
    expect(launcher.processes).toEqual([]);

    const started = await client.start();
    if (!started.ok) throw started.error;
    await expect(
      client.callToolIfReady("echo", { label: "warm" }),
    ).resolves.toEqual({ ok: true, value: { label: "warm" } });
    expect(launcher.processes).toHaveLength(1);
  });

  it("sanitizes unexpected owned-cleanup exceptions", () => {
    expect(
      providerCleanupFailure(
        new Error("secret-run-token 22222222-2222-4222-8222-222222222222"),
      ),
    ).toEqual({
      cleaned: false,
      reason: "owned provider cleanup failed",
    });
  });

  it("uses the caller-assigned provider run identity", async () => {
    const launcher = new FixtureLauncher();
    const client = new HopperClient({
      launcher,
      runId: "11111111-1111-4111-8111-111111111111",
      startupTimeoutMs: 1_000,
    });
    onTestFinished(async () => {
      await client.close();
    });

    expect((await client.start()).ok).toBe(true);
    expect(launcher.runIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("keeps the native socket path below macOS sockaddr_un limits", async () => {
    const launcher = new FixtureLauncher();
    const client = new HopperClient({ launcher, startupTimeoutMs: 1_000 });
    onTestFinished(async () => {
      await client.close();
    });
    const started = await client.start();
    expect(started.ok).toBe(true);
    expect(Buffer.byteLength(launcher.socketPaths[0] ?? "")).toBeLessThan(104);
  });

  it("serializes concurrent calls until the active Hopper reply arrives", async () => {
    const launcher = new FixtureLauncher();
    const client = await startClient(launcher);
    const slow = client.callTool("echo", { label: "slow", gate: "serial" });
    const request = await launcher.waitForRequest("echo", "serial");
    const fast = client.callTool("echo", { label: "fast" });
    let fastSettled = false;
    void fast.then(() => {
      fastSettled = true;
    });
    await vi.waitFor(() =>
      expect(client.requestActivity()).toMatchObject({
        operation: "echo",
        queuedRequests: 1,
      }),
    );
    expect(fastSettled).toBe(false);
    expect(launcher.requests.filter(({ method }) => method === "echo")).toEqual(
      [request],
    );
    await launcher.release(request);
    await expect(Promise.all([slow, fast])).resolves.toEqual([
      { ok: true, value: { label: "slow", gate: "serial" } },
      { ok: true, value: { label: "fast" } },
    ]);
  });

  it("routes every established operation through the authenticated bridge", async () => {
    const client = await startClient();
    const results = await Promise.all(
      HOPPER_OPERATIONS.map((name) => client.callTool(name, {})),
    );
    expect(results).toHaveLength(HOPPER_OPERATIONS.length);
    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe("HopperClient response lifecycle", () => {
  it("reassembles a fragmented Unicode reply from the owned socket", async () => {
    const client = await startClient();

    await expect(
      client.callTool("echo", { label: "雪🦊", fragmented: true }),
    ).resolves.toEqual({
      ok: true,
      value: { label: "雪🦊", fragmented: true },
    });
  });

  it("accepts an owned-socket response above the former 10 MiB ceiling", async () => {
    const client = await startClient();
    const label = "x".repeat(10 * 1024 * 1024 + 1);

    const result = await client.callTool("echo", { label });

    expect(result).toEqual({ ok: true, value: { label } });
  });

  it("clears a partial reply when closing and restarting the owned session", async () => {
    const launcher = new FixtureLauncher();
    const client = await startClient(launcher);
    const partialReply = client.callTool("partial_then_wait", {});
    const request = await launcher.waitForRequest("partial_then_wait");
    const partialWrite = await launcher.waitForRequest("fixture_partial_write");
    expect(partialWrite.id).toBe(request.id);

    await client.close();
    await expect(partialReply).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperProcessError" },
    });
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    await expect(client.callTool("echo", { label: "fresh" })).resolves.toEqual({
      ok: true,
      value: { label: "fresh" },
    });
  });

  it("rejects a bridge session with the wrong capability token", async () => {
    const client = new HopperClient({
      launcher: new FixtureLauncher("wrong-token"),
      startupTimeoutMs: 1_000,
    });
    onTestFinished(async () => {
      await client.close();
    });
    const result = await client.start();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("HopperRemoteError");
  });

  it.each([
    ["malformed", "HopperProtocolError"],
    ["wrong_id", "HopperProtocolError"],
    ["wrong_event_id", "HopperProtocolError"],
    ["malformed_event", "HopperProtocolError"],
    ["remote_error", "HopperRemoteError"],
    ["exit", "HopperProcessError"],
  ])("projects %s as %s", async (method, expectedTag) => {
    const launcher = new FixtureLauncher();
    const client = await startClient(launcher);
    const result = await client.callTool(method);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe(expectedTag);
      if (result.error._tag === "HopperRemoteError")
        expect(result.error).toMatchObject({
          operation: method,
          requestId: (await launcher.waitForRequest(method)).id,
        });
    }
    if (expectedTag === "HopperProtocolError") {
      await client.close();
      const child = launcher.processes.at(-1);
      expect({
        exitCode: child?.exitCode,
        signalCode: child?.signalCode,
      }).toEqual({
        exitCode: 0,
        signalCode: null,
      });
    }
  });

  it("preserves a sanitized bridge exception diagnostic", async () => {
    const launcher = new FixtureLauncher();
    const diagnostics: HopperDiagnostic[] = [];
    const client = new HopperClient({
      launcher,
      startupTimeoutMs: 1_000,
      onDiagnostic: (event) => diagnostics.push(event),
    });
    onTestFinished(async () => {
      await client.close();
    });
    await expect(client.start()).resolves.toMatchObject({ ok: true });
    const result = await client.callTool("remote_error");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        _tag: "HopperRemoteError",
        diagnosticType: "bridge_exception",
      });
    expect(diagnostics).toContainEqual({
      type: "bridge-diagnostic",
      request_id: (await launcher.waitForRequest("remote_error")).id,
      code: -32001,
      category: "bridge_exception",
      message: "safe fake failure",
    });
  });
});

describe("HopperClient operational diagnostics", () => {
  it("records process exit code, stage, and restart guidance on unexpected exit", async () => {
    const launcher = new FixtureLauncher();
    const client = await startClient(launcher);
    const child = launcher.processes.at(-1);
    if (child === undefined) throw new Error("Missing fixture process");
    const exited = once(child, "exit");
    const result = await client.callTool("exit");
    await exited;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      if (!(result.error instanceof HopperProcessError))
        throw new Error("Expected a provider process error");
      expect(["unreachable", "exited"]).toContain(result.error.providerState);
      expect(result.error.exitCode).toBe(
        result.error.providerState === "exited" ? 7 : null,
      );
      expect(result.error).toMatchObject({
        _tag: "HopperProcessError",
        operation: "exit",
      });
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        code: "provider_unavailable",
        retryable: true,
        details: {
          stage: "analysis",
          provider_state: result.error.providerState,
          retry_action: "restart_provider",
          operation: "exit",
          exit_code: result.error.exitCode,
        },
      });
      expect(projected.remediation.action).toContain("close_binary");
    }
    expect(client.operationHealth()).toMatchObject({
      state: "exited",
      stage: "analysis",
      retryAction: "restart_provider",
      exitCode: 7,
      requests: [
        expect.objectContaining({
          operation: "exit",
          stage: "analysis",
        }),
      ],
    });
  });

  it("retains request correlation and health across concurrent requests when the bridge process terminates", async () => {
    const launcher = new FixtureLauncher();
    const client = await startClient(launcher);
    const hanging = client.callTool("hang");
    const inFlight = await launcher.waitForRequest("hang");
    const queued = client.callTool("echo", { label: "queued" });

    const child = launcher.processes.at(-1);
    if (child === undefined) throw new Error("Missing fixture process");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;

    const [hangingResult, queuedResult] = await Promise.all([hanging, queued]);
    expect(hangingResult.ok).toBe(false);
    expect(queuedResult.ok).toBe(false);
    if (!hangingResult.ok && !queuedResult.ok) {
      if (
        !(hangingResult.error instanceof HopperProcessError) ||
        !(queuedResult.error instanceof HopperProcessError)
      )
        throw new Error("Expected correlated provider process errors");
      // Socket loss may be observed before the separate child-exit event.
      // The immutable reply must preserve what was known when it settled.
      expect(["unreachable", "exited"]).toContain(
        hangingResult.error.providerState,
      );
      expect(["unreachable", "exited"]).toContain(
        queuedResult.error.providerState,
      );
      expect(hangingResult.error).toMatchObject({
        _tag: "HopperProcessError",
        operation: "hang",
        requestId: inFlight.id,
      });
      expect(queuedResult.error).toMatchObject({
        _tag: "HopperProcessError",
        operation: "echo",
        requestId: inFlight.id + 1,
      });
      const hangingProjected = projectAnalysisError(hangingResult.error);
      const queuedProjected = projectAnalysisError(queuedResult.error);
      expect(hangingProjected.details).toMatchObject({
        stage: "analysis",
        provider_state: hangingResult.error.providerState,
        retry_action: "restart_provider",
        operation: "hang",
        request_id: inFlight.id,
      });
      expect(queuedProjected.details).toMatchObject({
        stage: "analysis",
        provider_state: queuedResult.error.providerState,
        retry_action: "restart_provider",
        operation: "echo",
        request_id: inFlight.id + 1,
      });
      expect(hangingProjected.remediation.action).toContain("close_binary");
      expect(queuedProjected.remediation.action).toContain("close_binary");
    }
    expect(client.operationHealth()).toMatchObject({
      state: "exited",
      retryAction: "restart_provider",
    });
    expect(client.operationHealth().requests).toEqual([
      expect.objectContaining({ requestId: inFlight.id, operation: "hang" }),
      expect.objectContaining({
        requestId: inFlight.id + 1,
        operation: "echo",
      }),
    ]);
  });
});
