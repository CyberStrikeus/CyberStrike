import { expect, it as test, vi } from "vitest";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { fakeKunaCalls } from "./fakeKuna.js";
import { session, unprovenCleanupLauncher } from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

it.each([
  null,
  "selected reason",
  new ProviderCleanupError("foreign", ["foreign-owner"], {}),
])(
  "keeps the exact last string waiter's command cancellation reason: %j",
  async (reason) => {
    const fixture = await session("rea-kuna-string-reason-", {
      strings: "hang",
    });
    const client = fixture.open();
    const caller = new AbortController();
    const pending = client.execute(
      "list_strings",
      {},
      { signal: caller.signal },
    );
    try {
      await expect
        .poll(
          async () =>
            (await fakeKunaCalls(fixture.kuna)).some(
              ({ argv }) => argv[0] === "strings",
            ),
          { timeout: 5000 },
        )
        .toBe(true);
      caller.abort(reason);
      const result = await pending;
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.capturedOutput).toBeDefined();
    } finally {
      caller.abort(reason);
      await pending;
      expect((await client.close()).ok).toBe(true);
    }
  },
);

it.each(["peer", "last"] as const)(
  "retains the exact %s single-function waiter reason",
  async (mode) => {
    const fixture = await session("rea-kuna-function-reason-", {
      project: "hang",
      decompile: "hang",
    });
    const client = fixture.open();
    const caller = new AbortController();
    const reason = { caller: "function" };
    const pending = client.execute(
      "procedure_pseudo_code",
      { procedure: "main" },
      { signal: caller.signal },
    );
    const peer =
      mode === "peer"
        ? client.execute("procedure_pseudo_code", { procedure: "main" })
        : undefined;
    try {
      await expect
        .poll(
          async () =>
            (await fakeKunaCalls(fixture.kuna)).some(
              ({ argv }) => argv[0] === "decompile",
            ),
          { timeout: 5000 },
        )
        .toBe(true);
      caller.abort(reason);
      const result = await pending;
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(
        (await fakeKunaCalls(fixture.kuna)).filter(
          ({ argv }) => argv[0] === "decompile",
        ),
      ).toHaveLength(1);
    } finally {
      caller.abort(reason);
      expect((await client.close()).ok).toBe(true);
      await Promise.all([pending, peer]);
    }
  },
);

it("keeps cancellation output and primary reason while exact command cleanup is retried", async () => {
  const unproven = unprovenCleanupLauncher("strings");
  const fixture = await session(
    "rea-kuna-query-cleanup-reason-",
    { strings: "hang" },
    {},
    unproven.launcher,
  );
  const client = fixture.open();
  const caller = new AbortController();
  const reason = "selected cleanup reason";
  const createRoot = PrivateRuntimeRoot.create;
  let workspace: PrivateRuntimeRoot | undefined;
  const roots = vi
    .spyOn(PrivateRuntimeRoot, "create")
    .mockImplementation(async (options) => {
      const root = await createRoot(options);
      if (options?.prefix === "rea-kuna-") workspace = root;
      return root;
    });
  let refuseRootClose: ReturnType<typeof vi.spyOn> | undefined;
  const pending = client.execute("list_strings", {}, { signal: caller.signal });
  try {
    await expect
      .poll(async () =>
        (await fakeKunaCalls(fixture.kuna)).some(
          ({ argv }) => argv[0] === "strings",
        ),
      )
      .toBe(true);
    caller.abort(reason);
    const result = await pending;
    if (result.ok) throw new Error("Expected retained cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupPrimary).toMatchObject({
      _tag: "AnalysisCancelledError",
    });
    expect(result.error.cleanupPrimary?.cause).toBe(reason);
    expect(result.error.capturedOutput).toBeDefined();
    expect((await client.close()).ok).toBe(false);
    if (workspace === undefined) throw new Error("Missing owned workspace");
    refuseRootClose = vi
      .spyOn(workspace, "close")
      .mockRejectedValue(new Error("controlled workspace close refusal"));
    unproven.release();
    const [rootFailure, concurrentFailure] = await Promise.all([
      client.close(),
      client.close(),
    ]);
    expect(rootFailure.ok).toBe(false);
    if (rootFailure.ok) throw new Error("Expected workspace cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual([workspace.path]);
    expect(refuseRootClose).toHaveBeenCalledTimes(1);
    refuseRootClose.mockRestore();
    expect((await client.close()).ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(rootFailure.error.cleanupIncomplete).toBe(false);
    if (concurrentFailure.ok)
      throw new Error("Expected concurrent cleanup failure");
    expect(concurrentFailure.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error).code).toBe("cancelled");
  } finally {
    caller.abort(reason);
    unproven.release();
    roots.mockRestore();
    refuseRootClose?.mockRestore();
    await pending;
    expect((await client.close()).ok).toBe(true);
  }
});
