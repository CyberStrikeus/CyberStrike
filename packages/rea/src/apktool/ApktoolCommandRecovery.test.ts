import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
  prepareOwnedCommand,
} from "../process/OwnedCommand.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import { ApktoolProvider } from "./ApktoolProvider.js";

vi.mock("../process/OwnedCommand.js", async (original) => ({
  ...(await original<typeof import("../process/OwnedCommand.js")>()),
  runOwnedCommand: vi.fn(),
  prepareOwnedCommand: vi.fn(async () => undefined),
}));
afterEach(() => {
  vi.mocked(runOwnedCommand).mockReset();
  vi.mocked(prepareOwnedCommand).mockReset().mockResolvedValue(undefined);
  vi.useRealTimers();
});
const provider = () =>
  new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: "/authored/apktool" },
  });
const version = {
  stdout: { text: "2.9.3\n" },
  stderr: { text: "" },
} as Awaited<ReturnType<typeof runOwnedCommand>>;
const inspect = (client: ApktoolProvider, signal?: AbortSignal) =>
  client.execute(
    { operation: "inspect_apktool_client", input: {} },
    signal === undefined ? {} : { signal },
  );

it.each(["process", "helper"] as const)(
  "retains %s cleanup, fences replacement acquisition and clears original and retry errors",
  async (kind) => {
    const client = provider();
    let denied = true;
    const reason = { caller: "authored cancellation" };
    const controller = new AbortController();
    const helperCleanup = new ProviderCleanupError(
      "process-ownership",
      ["authored-helper-root"],
      {},
    );
    const stop = vi.fn(async () =>
      denied
        ? { status: "incomplete" as const, reason: "authored stop denial" }
        : { status: "verified-cleanup" as const },
    );
    const helperClose = vi.fn(async () => {
      if (denied) throw helperCleanup;
      helperCleanup.resolveCleanup();
    });
    const compilerOutput = {
      stdout: "authored compiler stdout",
      stderr: "authored compiler stderr",
      truncated: true,
      stdout_bytes: 99,
      stderr_bytes: 105,
      exit_code: null,
      signal: "SIGTERM",
    };
    const preparation = new DarwinProcessOwnershipInspectionError(
      "helper cancellation",
      {
        cancellation: { reason },
        capturedOutput: compilerOutput,
        cleanupFailure: helperCleanup,
        cleanupOwner: { close: helperClose },
      },
    );
    vi.mocked(runOwnedCommand)
      .mockImplementationOnce(async () => {
        controller.abort(reason);
        throw new OwnedCommandFailure(
          "cancelled",
          "authored command cancellation",
          null,
          kind === "process" ? "authored stop denial" : null,
          {
            cancellation: { reason },
            ...(kind === "helper" ? { preparationFailure: preparation } : {}),
          },
          kind === "process" ? ["authored-process-family"] : [],
          kind === "process"
            ? ({ stop } as unknown as ProviderProcessSupervisor)
            : undefined,
        );
      })
      .mockImplementation(async (_spawn, limits) => {
        limits.observeCompleted?.(version);
        return version;
      });
    try {
      const first = await inspect(client, controller.signal);
      if (first.ok) throw new Error("Expected retained cleanup");
      expect(first.error.cleanupIncomplete).toBe(true);
      expect(first.error.cleanupPrimary?.cause).toBe(reason);
      if (kind === "helper")
        expect(first.error.capturedOutput).toEqual(compilerOutput);
      const blocked = await inspect(client);
      if (blocked.ok) throw new Error("Expected cleanup admission refusal");
      expect(blocked.error.cleanupIncomplete).toBe(true);
      expect(runOwnedCommand).toHaveBeenCalledOnce();
      denied = false;
      expect((await inspect(client)).ok).toBe(true);
      expect(first.error.cleanupIncomplete).toBe(false);
      expect(blocked.error.cleanupIncomplete).toBe(false);
      expect(first.error.cleanupResources).toEqual([]);
      if (kind === "helper")
        expect(first.error.capturedOutput).toEqual(compilerOutput);
      expect(blocked.error.cleanupResources).toEqual([]);
    } finally {
      denied = false;
      await client.close();
    }
  },
);

it("keeps a physical version failure primary when cancellation arrives after the owner observed it", async () => {
  const client = provider();
  const controller = new AbortController();
  vi.mocked(runOwnedCommand).mockImplementationOnce(async () => {
    controller.abort({ caller: "after physical failure" });
    throw new OwnedCommandFailure("process", "launcher exited 7");
  });
  try {
    const result = await inspect(client, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error._tag).not.toBe("AnalysisCancelledError");
  } finally {
    await client.close();
  }
});

it("finishes independent preparation before giving the version process its twenty-second deadline", async () => {
  vi.useFakeTimers();
  const client = provider();
  const ready = createDeferred<void>();
  vi.mocked(prepareOwnedCommand).mockImplementationOnce(() => ready.promise);
  vi.mocked(runOwnedCommand).mockImplementation(async (_spawn, limits) => {
    limits.observeCompleted?.(version);
    return version;
  });
  const pending = inspect(client);
  try {
    await vi.advanceTimersByTimeAsync(21_000);
    expect(runOwnedCommand).not.toHaveBeenCalled();
    ready.resolve();
    expect((await pending).ok).toBe(true);
    expect(vi.mocked(runOwnedCommand).mock.lastCall?.[1].timeoutMs).toBe(
      20_000,
    );
  } finally {
    ready.resolve();
    await pending;
    await client.close();
  }
});

it.each(["2.9.3", "not-a-version", "2.1.0"])(
  "preserves a completed version report through cancellation during final cleanup: %s",
  async (text) => {
    const client = provider();
    const controller = new AbortController();
    const reason = { caller: "during final version cleanup" };
    vi.mocked(runOwnedCommand).mockImplementationOnce(
      async (_spawn, limits) => {
        limits.observeCompleted?.({ ...version, stdout: { text } } as Awaited<
          ReturnType<typeof runOwnedCommand>
        >);
        controller.abort(reason);
        throw new OwnedCommandFailure(
          "cancelled",
          "authored finalization cancellation",
          null,
          null,
          { cancellation: { reason } },
        );
      },
    );
    try {
      const result = await inspect(client, controller.signal);
      if (result.ok) throw new Error("Expected finalization failure");
      if (text === "2.9.3") {
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(reason);
        expect(result.error.diagnostics).toMatchObject({
          client: { version: text },
        });
      } else expect(result.error._tag).not.toBe("AnalysisCancelledError");
    } finally {
      await client.close();
    }
  },
);

it("keeps cleanup without a recovery capability unresolved and fences its workspace", async () => {
  const { ApktoolCommandCleanup } = await import("./ApktoolCommandCleanup.js");
  const commands = new ApktoolCommandCleanup();
  const failure = commands.retainFailure(
    new OwnedCommandFailure(
      "process",
      "launcher failed",
      null,
      "ownership unavailable",
      undefined,
      ["authored-family"],
    ),
    new ProviderAdapterError("apktool", "inspect_apktool_client"),
    "decode_android_resources",
    "/authored/workspace",
  );
  expect(failure.cleanupIncomplete).toBe(true);
  expect(commands.pendingFor("/authored/workspace")).toBe(true);
  expect(commands.pendingFor("/other/workspace")).toBe(false);
  const acquire = vi.fn(async () => undefined);
  await expect(
    commands.run(acquire, "inspect_apktool_client"),
  ).rejects.toMatchObject({ cleanupIncomplete: true });
  expect(acquire).not.toHaveBeenCalled();
  await expect(commands.close()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  expect(failure.cleanupIncomplete).toBe(true);
  expect(failure.cleanupResources).toEqual(["authored-family"]);
});

it("attributes prerequisite cleanup to decode and preserves its live recovery", async () => {
  const client = provider();
  const reason = { caller: "during decode prerequisite" };
  const stop = vi.fn(async () => ({ status: "verified-cleanup" as const }));
  vi.mocked(runOwnedCommand).mockRejectedValueOnce(
    new OwnedCommandFailure(
      "cancelled",
      "cancelled",
      null,
      "stop denied",
      { cancellation: { reason } },
      ["family"],
      { stop } as unknown as ProviderProcessSupervisor,
    ),
  );
  try {
    const result = await client.execute({
      operation: "decode_android_resources",
      input: {},
    } as never);
    if (result.ok) throw new Error("Expected prerequisite failure");
    expect(result.error).toMatchObject({
      operation: "decode_android_resources",
    });
    expect(result.error.cleanupPrimary?.cause).toBe(reason);
    await client.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    await client.close();
  }
});

it("retries failed command peers without repeating successful helper cleanup", async () => {
  const { ApktoolCommandCleanup } = await import("./ApktoolCommandCleanup.js");
  const commands = new ApktoolCommandCleanup();
  const helper = new ProviderCleanupError("process-ownership", ["helper"], {});
  const close = vi.fn(async () => {
    helper.resolveCleanup();
  });
  let denied = true;
  const stop = vi.fn(async () =>
    denied
      ? { status: "incomplete" as const, reason: "denied" }
      : { status: "verified-cleanup" as const },
  );
  const failure = commands.retainFailure(
    new OwnedCommandFailure(
      "process",
      "failed",
      null,
      "denied",
      {
        preparationFailure: new DarwinProcessOwnershipInspectionError(
          "helper failed",
          { cleanupFailure: helper, cleanupOwner: { close } },
        ),
      },
      ["process"],
      { stop } as unknown as ProviderProcessSupervisor,
    ),
    new ProviderAdapterError("apktool", "inspect_apktool_client"),
    "inspect_apktool_client",
  );
  try {
    await expect(commands.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(failure.cleanupResources).toEqual(["process"]);
    denied = false;
    await commands.close();
    expect(close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(failure.cleanupIncomplete).toBe(false);
    expect(failure.cleanupResources).toEqual([]);
  } finally {
    denied = false;
    await commands.close();
  }
});

it("joins preparation during close and retains a late helper handoff", async () => {
  const client = provider();
  const ready = createDeferred<void>();
  const entered = createDeferred<void>();
  const cleanup = new ProviderCleanupError(
    "process-ownership",
    ["late-helper"],
    {},
  );
  const close = vi.fn(async () => {
    cleanup.resolveCleanup();
  });
  vi.mocked(prepareOwnedCommand).mockImplementationOnce(async () => {
    entered.resolve();
    await ready.promise;
    throw new DarwinProcessOwnershipInspectionError(
      "physical preparation failure",
      { cleanupFailure: cleanup, cleanupOwner: { close } },
    );
  });
  const pending = inspect(client);
  let closed = false;
  let closing: Promise<void> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered.promise, pending, "command preparation");
    closing = client.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    ready.resolve();
    const result = await pending;
    if (result.ok) throw new Error("Expected preparation failure");
    expect(result.error._tag).not.toBe("AnalysisCancelledError");
    await closing;
    expect(close).toHaveBeenCalledOnce();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(runOwnedCommand).not.toHaveBeenCalled();
  }, [
    () => ready.resolve(),
    async () => {
      await pending;
    },
    async () => {
      await closing;
    },
    () => client.close(),
  ]);
});

it("preserves an opaque cancellation reason before acquiring a command", async () => {
  const client = provider();
  const reason = new ProviderCleanupError(
    "foreign-owner",
    ["foreign-resource"],
    {},
  );
  const controller = new AbortController();
  controller.abort(reason);
  try {
    const result = await inspect(client, controller.signal);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(runOwnedCommand).not.toHaveBeenCalled();
    expect(prepareOwnedCommand).not.toHaveBeenCalled();
    expect(reason.cleanupIncomplete).toBe(true);
  } finally {
    await client.close();
  }
});

it.each([
  "refusal",
  "spawn",
  "collection",
  "signal",
  "incomplete",
  "preparation",
] as const)(
  "keeps target identity separate from a %s command outcome",
  async (kind) => {
    const root = await createTestTempDirectory("rea-apktool-attribution-");
    const path = join(root, "caller-selected.apk");
    await writeFile(path, "authored input");
    const client = provider();
    const output = {
      stdout: { text: "authored stdout", bytes: 15, observedBytes: 15 },
      stderr: { text: "authored decode refusal", bytes: 23, observedBytes: 23 },
      exitCode: 1,
      signal: null,
      diagnosticTruncated: false,
    } satisfies Awaited<ReturnType<typeof runOwnedCommand>>;
    const compiler = {
      stdout: "compiler output",
      stderr: "compiler diagnostic",
      truncated: false,
      stdout_bytes: 15,
      stderr_bytes: 19,
      exit_code: 1,
      signal: null,
    };
    const failure =
      kind === "preparation"
        ? new DarwinProcessOwnershipInspectionError(
            "authored preparation failure",
            { capturedOutput: compiler },
          )
        : new OwnedCommandFailure(
            "process",
            "authored command failure",
            {
              ...output,
              ...(kind === "signal"
                ? { exitCode: null, signal: "SIGTERM" }
                : {}),
              ...(kind === "incomplete" ? { outputIncomplete: true } : {}),
            },
            null,
            {
              ...(kind === "spawn"
                ? { processError: new Error("authored startup failure") }
                : {}),
              ...(kind === "collection" ? { collectionFailure: true } : {}),
            },
          );
    vi.mocked(runOwnedCommand)
      .mockImplementationOnce(async (_spawn, limits) => {
        limits.observeCompleted?.(version);
        return version;
      })
      .mockRejectedValueOnce(failure);
    try {
      const result = await client.execute({
        operation: "decode_android_resources",
        input: { path, include_strings: true },
      });
      if (result.ok) throw new Error("Expected authored failure");
      if (kind === "refusal") {
        expect(result.error).toMatchObject({
          _tag: "AnalysisUnsupportedTargetError",
          path,
        });
        expect(result.error.message).toContain(path);
        expect(result.error.message).not.toContain("/authored/apktool");
      } else
        expect(result.error).toMatchObject({
          _tag: "ProviderAdapterError",
          diagnostics: {
            target_path: path,
            selected_command: "/authored/apktool",
          },
        });
      expect(result.error.capturedOutput).toMatchObject(
        kind === "preparation"
          ? compiler
          : { stdout: output.stdout.text, stderr: output.stderr.text },
      );
      expect(result.error.partialObservation).toMatchObject({
        kind: "file-snapshot-hash",
        path,
      });
    } finally {
      await client.close();
    }
  },
);
