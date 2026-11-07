import { afterEach, expect, it, vi } from "vitest";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../../src/domain/analysisErrorCore.js";
import { stopOwnedDebuggerProcess } from "../../../src/process/ownedDebuggerSession.js";
import {
  applyDebuggerAdmissionOverride,
  DEBUGGER_COMMAND_DEADLINE_SETTING,
  resolveDebuggerSessionLimits,
} from "../../../src/config/debuggerSessionLimits.js";
import { rizinCommandTimeoutLimitation } from "../../../src/rizin/RizinDebugSessionManager.js";
import { rizinTestInferiorTty } from "./RizinTestInferiorTty.js";
import {
  createRizinCoverageHarness,
  abortOnCheck,
  createInjectedProcess,
} from "./RizinDebugSessionCoverage.fixtures.js";

const { cleanup, startInjected, createManager } = createRizinCoverageHarness();
afterEach(cleanup);

it.skipIf(process.platform === "win32")(
  "times out when an active command produces no frame",
  async () => {
    const injected = createInjectedProcess();
    const { manager, started } = await startInjected(injected.spawnProcess, {
      frameTimeoutMs: 10,
      stopProcess: async () => ({ status: "stopped" }),
    });
    if (!started.ok) throw started.error;
    const deadline = applyDebuggerAdmissionOverride(
      resolveDebuggerSessionLimits({}).commandDeadline,
      10,
    );
    expect(deadline).toMatchObject({
      setting: DEBUGGER_COMMAND_DEADLINE_SETTING,
      value: 10,
      source: "runtime",
      unit: "ms",
    });
    const result = await manager.execute(started.value.session_id, "wait");
    if (!result.ok) throw result.error;
    expect(result.value.result.completion_status).toBe("unknown");
    expect(result.value.evidence.raw_result).toEqual(result.value.result);
    expect(result.value.evidence.parameters.launch_provenance).toEqual({
      caller_selected_path: "/tmp/injected",
      resolved_path: "/tmp/injected",
    });
    expect(result.value.evidence.limitations).toEqual([
      "The current debugger target identity is not established by the Rizin session identifier.",
      rizinCommandTimeoutLimitation(deadline),
      "The owned debugger session was stopped because output correlation could no longer be guaranteed.",
      "The command is unrestricted and may access local files, the shell, network, or mutate the target.",
      "Interrupted output may include an incomplete completion-marker prefix; it is retained because it cannot be distinguished from command diagnostics.",
      "Launch provenance records the original and resolved startup paths; it does not establish the current target after unrestricted debugger commands.",
    ]);
  },
);

it.skipIf(process.platform === "win32")(
  "preserves frame separators in partial output when a command times out",
  async () => {
    const injected = createInjectedProcess({
      onWrite: (_text, control) => {
        control.output("first frame\0second frame\0");
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      frameTimeoutMs: 1000,
      stopProcess: async () => ({ status: "stopped" }),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const result = await manager.execute(started.value.session_id, "wait");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result.output).toBe("first frame\nsecond frame");
      expect(result.value.result.completion_status).toBe("unknown");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "preserves queued partial frames when the command deadline reaches zero",
  async () => {
    const injected = createInjectedProcess({
      onWrite: (_text, control) => {
        control.output("first frame\0second frame\0third frame\0");
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      frameTimeoutMs: 1000,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const clock = vi.spyOn(Date, "now");
    clock
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValue(1100);
    let result;
    try {
      result = await manager.execute(started.value.session_id, "wait");
    } finally {
      clock.mockRestore();
    }

    expect(result.ok).toBe(true);
    if (result.ok) {
      // All three frames arrived before expiry; the third is still queued.
      expect(result.value.result.output).toBe(
        "first frame\nsecond frame\nthird frame",
      );
      expect(result.value.result.completion_status).toBe("unknown");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "does not convert an unexpected frame waiter error into a timeout",
  async () => {
    const injected = createInjectedProcess({
      onWrite: (_text, control) => {
        setImmediate(() => control.stdinError());
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      frameTimeoutMs: 100,
      stopProcess: async () => ({ status: "stopped" }),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const result = await manager.execute(started.value.session_id, "wait");

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toContain("Rizin stdin stream failed");
  },
);

it.skipIf(process.platform === "win32")(
  "cancels a command after capturing its completion frame",
  async () => {
    const reason = { stage: "completion frame captured" };
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        const marker = /!echo (.+)\n/u.exec(text)?.[1];
        if (marker !== undefined)
          control.output(Buffer.from(`registers${marker}\0`));
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      stopProcess: async () => ({ status: "stopped" }),
    });
    if (!started.ok) throw started.error;
    const signal = abortOnCheck(5, reason);
    const registration = vi.spyOn(signal, "addEventListener");
    const result = await manager.execute(
      started.value.session_id,
      "dr",
      signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(registration).toHaveBeenCalledTimes(1);
    expect(result.error.capturedOutput?.stdout).toBe("registers");
    expect(result.error.partialObservation).toMatchObject({
      parameters: { session_id: started.value.session_id, command: "dr" },
      raw_result: { output: "registers", completion_status: "unknown" },
    });
    expect(manager.status(started.value.session_id)?.state).toBe("closed");
  },
);

it.skipIf(process.platform === "win32")(
  "handles cancellation observed immediately after installing the frame waiter",
  async () => {
    const injected = createInjectedProcess();
    const { manager, started } = await startInjected(injected.spawnProcess, {
      stopProcess: async () => ({ status: "stopped" }),
    });
    if (!started.ok) throw started.error;
    const reason = { stage: "frame waiter installation" };
    const signal = abortOnCheck(5, reason);
    const registration = vi.spyOn(signal, "addEventListener");
    const result = await manager.execute(
      started.value.session_id,
      "wait",
      signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(registration).toHaveBeenCalledTimes(2);
    expect(registration).toHaveBeenCalledWith("abort", expect.any(Function), {
      once: true,
    });
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.capturedOutput?.stdout).toBe("");
    expect(result.error.partialObservation).toMatchObject({
      parameters: { session_id: started.value.session_id, command: "wait" },
      raw_result: { output: "", completion_status: "unknown" },
    });
    expect(manager.status(started.value.session_id)?.state).toBe("closed");
  },
);

it.skipIf(process.platform === "win32").each([false, true])(
  "maps a frame-wait listener installation failure without losing cleanup (incomplete=%s)",
  async (incomplete) => {
    const injected = createInjectedProcess();
    const { manager, started } = await startInjected(injected.spawnProcess, {
      stopProcess: async () =>
        incomplete
          ? { status: "incomplete", reason: "injected stop uncertainty" }
          : { status: "stopped" },
      frameTimeoutMs: 1000,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const controller = new AbortController();
    let registrations = 0;
    const signal = {
      get aborted() {
        return false;
      },
      addEventListener(
        type: Parameters<AbortSignal["addEventListener"]>[0],
        listener: Parameters<AbortSignal["addEventListener"]>[1],
        options?: Parameters<AbortSignal["addEventListener"]>[2],
      ) {
        registrations += 1;
        if (registrations === 2)
          throw new Error("injected frame waiter registration failure");
        controller.signal.addEventListener(type, listener, options);
      },
      removeEventListener: controller.signal.removeEventListener.bind(
        controller.signal,
      ),
      dispatchEvent: controller.signal.dispatchEvent.bind(controller.signal),
      onabort: null,
      reason: undefined,
      throwIfAborted: () => undefined,
    } as AbortSignal;
    const result = await manager.execute(
      started.value.session_id,
      "wait",
      signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && incomplete)
      expect(result.error.cleanup?.reason).toContain(
        "injected stop uncertainty",
      );
  },
);

it.skipIf(process.platform === "win32")(
  "correlates an injected command frame with its generated marker",
  async () => {
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        const marker = /!echo (.+)\n/u.exec(text)?.[1];
        if (marker !== undefined)
          setImmediate(() => control.output(Buffer.from(`output${marker}\0`)));
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.result.output).toBe("output");
  },
);

it.skipIf(process.platform === "win32")(
  "preserves process-exit evidence when exit occurs before frame waiting",
  async () => {
    const injected = createInjectedProcess({
      onWrite: (_text, control) => control.exit(),
    });
    const { manager, started } = await startInjected(injected.spawnProcess);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result.completion_status).toBe("unknown");
      expect(result.value.result).toMatchObject({
        command: "dr",
        output: "",
        output_truncated: false,
        completion_status: "unknown",
        backend: null,
      });
      expect(result.value.evidence.raw_result).toEqual(result.value.result);
      expect(result.value.evidence.limitations).toEqual([
        "The current debugger target identity is not established by the Rizin session identifier.",
        "Rizin exited before the command-completion marker; retained frame output is partial and command completion is unknown.",
        "The command is unrestricted and may access local files, the shell, network, or mutate the target.",
        "Interrupted output may include an incomplete completion-marker prefix; it is retained because it cannot be distinguished from command diagnostics.",
        "Launch provenance records the original and resolved startup paths; it does not establish the current target after unrestricted debugger commands.",
      ]);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a queued command when the process exits before its frame wait begins",
  async () => {
    const writes: string[] = [];
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        writes.push(text);
        const marker = /!echo (.+)\n/u.exec(text)?.[1];
        if (marker !== undefined) setImmediate(() => control.exit());
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const first = manager.execute(started.value.session_id, "first");
    const queued = manager.execute(started.value.session_id, "second");
    expect((await first).ok).toBe(true);
    const second = await queued;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBeInstanceOf(AnalysisInputError);
    expect(writes.some((text) => text.includes("second\n"))).toBe(false);
  },
);

it
  .skipIf(process.platform === "win32")
  .each([null, { selected: "opaque reason" }])(
  "preserves exact caller cancellation through incomplete cleanup: %j",
  async (reason) => {
    const controller = new AbortController();
    const injected = createInjectedProcess({
      onWrite: (_text, control) => {
        control.output("partial\0");
        controller.abort(reason);
      },
    });
    let retained = true;
    const { manager, started } = await startInjected(injected.spawnProcess, {
      stopProcess: async () =>
        retained
          ? { status: "incomplete", reason: "owned stop pending" }
          : { status: "stopped" },
    });
    if (!started.ok) throw started.error;
    const result = await manager.execute(
      started.value.session_id,
      "wait",
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.capturedOutput?.stdout).toContain("partial");
    expect(result.error.partialObservation).toBeDefined();
    expect(result.error.cleanupIncomplete).toBe(true);
    retained = false;
    expect((await manager.close(started.value.session_id)).ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
  },
);

it.skipIf(process.platform === "win32").each([false, true])(
  "recovers output-limit cleanup only after a fresh marker and inferior readback (retry=%s)",
  async (retry) => {
    let synchronizationAllowed = !retry;
    const writes: string[] = [];
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        writes.push(text);
        const marker = /!echo (.+)\n/u.exec(text)?.[1];
        if (marker === undefined) return;
        if (text.startsWith("noisy\n"))
          control.output(`too much output\0${marker}\0`);
        else if (text.startsWith("!echo __REA_CLEANUP_SYNC_")) {
          if (synchronizationAllowed)
            control.output(`stale frame\0${marker}\0`);
        } else if (text.startsWith("olj\n")) control.output(`[]\0${marker}\0`);
        else throw new Error(`Unexpected cleanup command: ${text}`);
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      // The injected stream has no OS process identity. Exercise protocol detach
      // here; real debugger process ownership is covered by process boundaries.
      stopProcess: async (session) => {
        if (session.exited) return { status: "already_exited" };
        try {
          await session.detachInferior?.();
          injected.control.exit();
          return { status: "stopped" };
        } catch (cause) {
          return { status: "incomplete", reason: String(cause) };
        }
      },
      maxCommandOutputBytes: 8,
    });
    if (!started.ok) throw started.error;
    const result = await manager.execute(started.value.session_id, "noisy");
    expect(result.ok).toBe(!retry);
    expect(writes.some((text) => text.startsWith("olj\n"))).toBe(!retry);
    if (retry) {
      if (result.ok) throw new Error("Expected retained cleanup");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(manager.status(started.value.session_id)).toBeDefined();
      expect(
        (await manager.execute(started.value.session_id, "later")).ok,
      ).toBe(false);
      synchronizationAllowed = true;
      expect((await manager.close(started.value.session_id)).ok).toBe(true);
      expect(result.error.cleanupIncomplete).toBe(false);
    }
    expect(writes.some((text) => text.startsWith("olj\n"))).toBe(true);
    if (!retry)
      expect((await manager.close(started.value.session_id)).ok).toBe(true);
    expect(manager.status(started.value.session_id)).toBeUndefined();
  },
);

it.skipIf(process.platform === "win32")(
  "retains the producing protocol diagnosis after cleanup synchronization recovers transport",
  async () => {
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        const marker = /!echo (.+)\n/u.exec(text)?.[1];
        if (marker === undefined) return;
        if (text.startsWith("!echo __REA_CLEANUP_SYNC_"))
          control.output(`${marker}\0`);
        else if (text.startsWith("olj\n")) control.output(`[]\0${marker}\0`);
        else throw new Error(`Unexpected command: ${text}`);
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      stopProcess: stopOwnedDebuggerProcess,
    });
    if (!started.ok) throw started.error;
    injected.control.output("unsolicited\0");
    const result = await manager.execute(
      started.value.session_id,
      "never dispatched",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        reason:
          "Unsolicited Rizin frames arrived before a command; command output can no longer be safely correlated.",
      });
      expect(result.error.cleanupIncomplete).toBe(false);
    }
    expect(manager.status(started.value.session_id)?.state).toBe("closed");
  },
);

it.skipIf(process.platform === "win32").each([
  { stage: "output", incomplete: false },
  { stage: "output", incomplete: true },
  { stage: "timeout", incomplete: false },
  { stage: "timeout", incomplete: true },
  { stage: "exited", incomplete: false },
  { stage: "exited", incomplete: true },
] as const)(
  "preserves cancellation during $stage final cleanup (incomplete=$incomplete)",
  async ({ stage, incomplete }) => {
    const controller = new AbortController();
    const reason = { boundary: "final cleanup" };
    let enterStop!: () => void;
    const entered = new Promise<void>((resolve) => {
      enterStop = resolve;
    });
    let releaseStop!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    let stopping = true;
    const injected = createInjectedProcess({
      onWrite: (_text, control) => {
        if (stage === "output")
          control.output("beyond selected output budget\0");
        if (stage === "exited") {
          control.output("partial\0");
          control.exit();
        }
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      maxCommandOutputBytes: stage === "output" ? 8 : 128,
      frameTimeoutMs: 10,
      stopProcess: async () => {
        if (stopping) {
          enterStop();
          await released;
        }
        return incomplete && stopping
          ? { status: "incomplete", reason: "stop settlement pending" }
          : { status: "stopped" };
      },
    });
    if (!started.ok) throw started.error;
    const pending = manager.execute(
      started.value.session_id,
      "noisy",
      controller.signal,
    );
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(entered, pending, "debugger final cleanup");
      controller.abort(reason);
      releaseStop();
      const result = await pending;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        _tag: "AnalysisCancelledError",
        cleanupIncomplete: incomplete,
      });
      expect(result.error.cause).toBe(reason);
      expect(result.error.capturedOutput?.stdout).toBe(
        stage === "output" ? "beyond s" : stage === "exited" ? "partial" : "",
      );
      expect(result.error.partialObservation).toBeDefined();
      if (incomplete) {
        stopping = false;
        expect((await manager.close(started.value.session_id)).ok).toBe(true);
        expect(result.error.cleanupIncomplete).toBe(false);
      }
    }, [
      releaseStop,
      async () => {
        await pending;
      },
      () => {
        stopping = false;
      },
    ]);
  },
);

it.skipIf(process.platform === "win32")(
  "accepts cleanup readback larger than the caller command-output cap",
  async () => {
    const cleanupReadback = `${" ".repeat(32)}[]`;
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        const marker = /!echo (.+)\n/u.exec(text)?.[1];
        if (marker === undefined) return;
        if (text.startsWith("ok\n")) control.output(`ok\0${marker}\0`);
        else if (text.startsWith("olj\n"))
          control.output(`${cleanupReadback}\0${marker}\0`);
        else control.output(`${marker}\0`);
      },
    });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      maxCommandOutputBytes: 8,
      stopProcess: async (session) => {
        try {
          await session.detachInferior?.();
          injected.control.exit();
          return { status: "stopped" };
        } catch (cause) {
          return { status: "incomplete", reason: String(cause) };
        }
      },
    });
    if (!started.ok) throw started.error;
    const executed = await manager.execute(started.value.session_id, "ok");
    if (!executed.ok) throw executed.error;
    expect(executed.value.result.completion_status).toBe("complete");
    expect(Buffer.byteLength(cleanupReadback, "utf8")).toBeGreaterThan(8);
    const closed = await manager.close(started.value.session_id);
    if (!closed.ok) throw closed.error;
    expect(closed.value).toEqual({ target_state: "unknown" });
  },
);

it.skipIf(process.platform === "win32")(
  "retains a startup protocol diagnosis across successful cleanup synchronization",
  async () => {
    const injected = createInjectedProcess({
      startup: (control) => control.stdinError(),
      onWrite: (text, control) => {
        const marker = /!echo (.+)\n/u.exec(text)?.[1];
        if (marker === undefined) return;
        control.output(
          text.startsWith("olj\n") ? `[]\0${marker}\0` : `${marker}\0`,
        );
      },
    });
    const { started } = await startInjected(injected.spawnProcess, {
      stopProcess: stopOwnedDebuggerProcess,
    });
    expect(started.ok).toBe(false);
    if (!started.ok)
      expect(started.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        reason: "Rizin stdin stream failed: injected stdin error",
        cleanupIncomplete: false,
      });
  },
);

it.skipIf(process.platform === "win32").each([false, true])(
  "preserves cancellation observed during failed startup cleanup (incomplete=%s)",
  async (incomplete) => {
    const controller = new AbortController();
    const reason = { boundary: "startup cleanup" };
    const injected = createInjectedProcess({
      startup: (control) => control.stdinError(),
    });
    let retained = true;
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      {
        spawnProcess: injected.spawnProcess,
        stopProcess: async () => {
          controller.abort(reason);
          return incomplete && retained
            ? { status: "incomplete", reason: "stop settlement pending" }
            : { status: "stopped" };
        },
      },
    );
    const result = await manager.start(
      { path: "/tmp/injected", inferior_tty: await rizinTestInferiorTty() },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const primary = result.error.cleanupPrimary ?? result.error;
    expect(primary).toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      reason: "Rizin stdin stream failed: injected stdin error",
    });
    expect(primary.secondaryFailures[0]).toMatchObject({
      _tag: "AnalysisCancelledError",
    });
    expect(primary.secondaryFailures[0]?.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(incomplete);
    if (incomplete) {
      retained = false;
      await manager.closeAll();
      expect(result.error.cleanupIncomplete).toBe(false);
    }
  },
);
