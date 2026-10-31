import { afterEach, expect, it } from "vitest";
import { rizinTestInferiorTty } from "./RizinTestInferiorTty.js";
import {
  createRizinCoverageHarness,
  abortOnCheck,
  createInjectedProcess,
  incompleteStop,
} from "./RizinDebugSessionCoverage.fixtures.js";

const { cleanup, makeProvider, start, startInjected, createManager } =
  createRizinCoverageHarness();
afterEach(cleanup);

it.skipIf(process.platform === "win32")(
  "stops the session when the provider closes its stdin pipe",
  async () => {
    const provider = await makeProvider(
      // Readiness must guarantee that the child's stdin is already closed.
      'exec 0<&-; printf "\\000"; while :; do :; done',
      "#!/bin/sh",
    );
    const { manager, sessionId } = await start(provider, {
      frameTimeoutMs: 500,
    });
    const result = await manager.execute(sessionId, "dr");
    expect(result.ok).toBe(false);
    expect(manager.status(sessionId)?.state).toBe("closed");
  },
);

it
  .skipIf(process.platform === "win32")
  .each([
    "null",
    "destroyed",
    "throws",
    "throws-opaque",
    "write-error",
  ] as const)(
  "fails safely when injected Rizin stdin is %s",
  async (stdinMode) => {
    const injected = createInjectedProcess({ stdin: stdinMode });
    const { manager, started } = await startInjected(injected.spawnProcess);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "fails an active command when the injected stdin stream closes",
  async () => {
    const injected = createInjectedProcess();
    const { manager, started } = await startInjected(injected.spawnProcess);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    injected.control.closeStdin();
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32").each([false, true])(
  "uses protocol cleanup when an injected write callback fails (incomplete=%s)",
  async (incomplete) => {
    const injected = createInjectedProcess({ stdin: "write-error" });
    const { manager, started } = await startInjected(injected.spawnProcess, {
      stopProcess: incomplete
        ? incompleteStop
        : async () => ({ status: "stopped" }),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(false);
    if (!result.ok && incomplete)
      expect(result.error.cleanup?.reason).toContain(
        "injected stop uncertainty",
      );
  },
);

it.skipIf(process.platform === "win32")(
  "maps injected spawn errors and startup protocol failure",
  async () => {
    for (const spawnError of [new Error("injected spawn failure"), "opaque"]) {
      const injected = createInjectedProcess({ spawnError });
      const manager = createManager(
        { REA_RIZIN_COMMAND: "injected-rizin" },
        { spawnProcess: injected.spawnProcess },
      );
      const result = await manager.start({
        path: "/tmp/injected",
        inferior_tty: await rizinTestInferiorTty(),
      });
      expect(result.ok).toBe(false);
    }

    const injected = createInjectedProcess({
      startup: (control) => control.closeStdin(),
    });
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      { spawnProcess: injected.spawnProcess },
    );
    const result = await manager.start({
      path: "/tmp/injected",
      inferior_tty: await rizinTestInferiorTty(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toContain("stdin stream closed");
  },
);

it.skipIf(process.platform === "win32")(
  "maps spawn rejection as cancellation when the signal changes during spawn",
  async () => {
    const abort = new AbortController();
    const injected = createInjectedProcess({
      beforeSpawnReturns: () => abort.abort(),
      spawnError: new Error("spawn interrupted"),
    });
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      { spawnProcess: injected.spawnProcess },
    );
    const result = await manager.start(
      { path: "/tmp/injected", inferior_tty: await rizinTestInferiorTty() },
      abort.signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("cancelled");
  },
);

it.skipIf(process.platform === "win32")(
  "cancels startup after receiving its initial frame",
  async () => {
    const abort = new AbortController();
    const injected = createInjectedProcess({
      startup: (control) => {
        control.output(Buffer.from([0]));
        abort.abort();
      },
    });
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      { spawnProcess: injected.spawnProcess },
    );
    const result = await manager.start(
      { path: "/tmp/injected", inferior_tty: await rizinTestInferiorTty() },
      abort.signal,
    );
    expect(result.ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "observes startup cancellation before the first frame waiter is installed",
  async () => {
    const abort = new AbortController();
    const injected = createInjectedProcess({
      beforeSpawnReturns: () => abort.abort(),
    });
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      { spawnProcess: injected.spawnProcess },
    );
    const result = await manager.start(
      { path: "/tmp/injected", inferior_tty: await rizinTestInferiorTty() },
      abort.signal,
    );
    expect(result.ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "cancels a command after its turn is granted",
  async () => {
    const injected = createInjectedProcess();
    const { manager, started } = await startInjected(injected.spawnProcess);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const result = await manager.execute(
      started.value.session_id,
      "dr",
      abortOnCheck(3),
    );
    expect(result.ok).toBe(false);
  },
);
