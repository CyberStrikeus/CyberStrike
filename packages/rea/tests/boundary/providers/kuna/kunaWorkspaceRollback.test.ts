import { unlink, writeFile } from "node:fs/promises";
import { expect, it as test, vi } from "vitest";
import { withVerifierCleanup } from "../../../../scripts/lib/verifier-cleanup.mjs";
import { KunaTargetCommands } from "../../../../src/kuna/KunaTargetCommands.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { awaitAcknowledgement } from "../../../fixtures/lifecycleAcknowledgement.js";
import { session } from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

it.each(["changed", "missing"] as const)(
  "retains a %s target's failed workspace rollback and blocks replacement until retry",
  async (mode) => {
    const fixture = await session("rea-kuna-workspace-rollback-");
    if (mode === "changed")
      await writeFile(fixture.target.path, "changed bytes");
    else await unlink(fixture.target.path);
    const lifetime = new AbortController();
    const commands = new KunaTargetCommands(fixture.target, {
      signal: lifetime.signal,
    });
    const create = PrivateRuntimeRoot.create;
    let allocations = 0;
    let owned: PrivateRuntimeRoot | undefined;
    const closeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const roots = vi
      .spyOn(PrivateRuntimeRoot, "create")
      .mockImplementation(async (options) => {
        const root = await create(options);
        owned = root;
        allocations += 1;
        closeSpies.push(
          vi
            .spyOn(root, "close")
            .mockRejectedValue(new Error("controlled rollback refusal")),
        );
        return root;
      });
    try {
      const result = await commands.prepare();
      if (result.ok) throw new Error("Expected workspace failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual([owned?.path]);
      expect(result.error.cleanupPrimary?._tag).toBe(
        mode === "changed"
          ? "AnalysisArtifactChangedError"
          : "ProviderAdapterError",
      );
      const again = await commands.prepare();
      if (again.ok) throw new Error("Expected retained rollback failure");
      expect(again.error).toBe(result.error);
      expect(allocations).toBe(1);
      const failedClose = await commands.close();
      if (failedClose.ok) throw new Error("Expected cleanup refusal");
      expect(result.error.cleanupIncomplete).toBe(true);
      for (const spy of closeSpies) spy.mockRestore();
      expect((await commands.close()).ok).toBe(true);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(failedClose.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).toBe(
        mode === "changed" ? "artifact_changed" : "execution_failure",
      );
    } finally {
      roots.mockRestore();
      for (const spy of closeSpies) spy.mockRestore();
      expect((await commands.close()).ok).toBe(true);
    }
  },
);

it.each(["clean", "refuse"] as const)(
  "joins rollback finalization without replacing the primary failure when close cancels: %s",
  async (mode) => {
    const fixture = await session("rea-kuna-workspace-finalization-");
    await writeFile(fixture.target.path, "changed bytes");
    const lifetime = new AbortController();
    const commands = new KunaTargetCommands(fixture.target, {
      signal: lifetime.signal,
    });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = PrivateRuntimeRoot.create;
    let holdFailures = mode === "refuse";
    let rootClose: ReturnType<typeof vi.spyOn> | undefined;
    const roots = vi
      .spyOn(PrivateRuntimeRoot, "create")
      .mockImplementation(async (options) => {
        const root = await create(options);
        const close = root.close.bind(root);
        rootClose = vi.spyOn(root, "close").mockImplementation(async () => {
          entered();
          await gate;
          if (holdFailures) throw new Error("controlled finalization refusal");
          await close();
        });
        return root;
      });
    const pending = commands.prepare();
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    let closing: ReturnType<typeof commands.close> | undefined;
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(started, pending, "workspace rollback");
      lifetime.abort({ caller: "shutdown during rollback" });
      closing = commands.close();
      let closed = false;
      void closing.then(
        () => {
          closed = true;
        },
        () => {
          closed = true;
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(closed).toBe(false);
      release();
      const result = await pending;
      if (result.ok) throw new Error("Expected changed-target failure");
      expect(result.error.cleanupIncomplete).toBe(mode === "refuse");
      const outcome = await closing;
      expect(outcome.ok).toBe(mode === "clean");
      if (!outcome.ok) {
        holdFailures = false;
        expect((await commands.close()).ok).toBe(true);
        expect(outcome.error.cleanupIncomplete).toBe(false);
      }
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).toBe("artifact_changed");
    }, [
      () => {
        holdFailures = false;
        release();
      },
      async () => {
        await pending;
      },
      async () => {
        await closing;
      },
      () => rootClose?.mockRestore(),
      () => roots.mockRestore(),
      async () => {
        expect((await commands.close()).ok).toBe(true);
      },
    ]);
  },
);

it.each(["changed", "missing"] as const)(
  "permits a fresh workspace after a %s target rolls back cleanly",
  async (mode) => {
    const fixture = await session("rea-kuna-workspace-clean-retry-");
    if (mode === "changed")
      await writeFile(fixture.target.path, "changed bytes");
    else await unlink(fixture.target.path);
    const commands = new KunaTargetCommands(fixture.target, {
      signal: new AbortController().signal,
    });
    try {
      const failed = await commands.prepare();
      if (failed.ok) throw new Error("Expected target failure");
      expect(failed.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(failed.error).code).toBe(
        mode === "changed" ? "artifact_changed" : "execution_failure",
      );
      await writeFile(fixture.target.path, "program bytes");
      expect((await commands.prepare()).ok).toBe(true);
    } finally {
      expect((await commands.close()).ok).toBe(true);
    }
  },
);

it.each([
  new Error("controlled allocation failure"),
  null,
  new ProviderCleanupError("foreign", ["foreign-owner"], {}),
])(
  "returns an allocation failure without inventing an owner and permits retry: %j",
  async (reason) => {
    const fixture = await session("rea-kuna-workspace-allocation-");
    const commands = new KunaTargetCommands(fixture.target, {
      signal: new AbortController().signal,
    });
    const roots = vi
      .spyOn(PrivateRuntimeRoot, "create")
      .mockRejectedValue(reason);
    try {
      const failed = await commands.prepare();
      if (failed.ok) throw new Error("Expected allocation failure");
      expect(failed.error.cause).toBe(reason);
      expect(failed.error.cleanupIncomplete).toBe(false);
      expect(failed.error.cleanupResources).toEqual([]);
      roots.mockRestore();
      expect((await commands.prepare()).ok).toBe(true);
    } finally {
      roots.mockRestore();
      expect((await commands.close()).ok).toBe(true);
    }
  },
);

it("keeps caller attribution and the selected path through workspace rollback retry", async () => {
  const fixture = await session("rea-kuna-workspace-caller-");
  await writeFile(fixture.target.path, "changed bytes");
  const client = fixture.open();
  const create = PrivateRuntimeRoot.create;
  let refuseClose: ReturnType<typeof vi.spyOn> | undefined;
  const roots = vi
    .spyOn(PrivateRuntimeRoot, "create")
    .mockImplementation(async (options) => {
      const root = await create(options);
      refuseClose = vi
        .spyOn(root, "close")
        .mockRejectedValue(new Error("controlled rollback refusal"));
      return root;
    });
  try {
    const failed = await client.execute("search_procedures", {
      pattern: "main",
      mode: "literal",
    });
    if (failed.ok)
      throw new Error("Expected changed target with retained rollback");
    expect(failed.error.cleanupIncomplete).toBe(true);
    expect(failed.error.cleanupPrimary).toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      operation: "search_procedures",
      path: fixture.target.path,
    });
    expect(projectAnalysisError(failed.error).details).toMatchObject({
      operation: "search_procedures",
    });
    expect((await client.close()).ok).toBe(false);
    refuseClose?.mockRestore();
    expect((await client.close()).ok).toBe(true);
    expect(failed.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(failed.error)).toMatchObject({
      code: "artifact_changed",
      details: { operation: "search_procedures", path: fixture.target.path },
    });
  } finally {
    refuseClose?.mockRestore();
    roots.mockRestore();
    expect((await client.close()).ok).toBe(true);
  }
});
