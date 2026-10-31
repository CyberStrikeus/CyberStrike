import { afterEach, beforeEach, expect, it, vi } from "vitest";

const gates = vi.hoisted(() => {
  const createGate = () => {
    let enter!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { started, hold, enter, release };
  };
  return {
    createGate,
    hashClose: createGate(),
    identityRead: createGate(),
    opens: 0,
    failClose: false,
    holdHashClose: false,
    holdIdentityRead: false,
  };
});

vi.mock("../../../../src/filesystem/RegularFile.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../../../src/filesystem/RegularFile.js")
    >();
  return {
    ...original,
    openRegularFile: vi.fn(
      async (...args: Parameters<typeof original.openRegularFile>) => {
        const descriptor = await original.openRegularFile(...args);
        const { handle } = descriptor;
        const index = gates.opens++;
        const read = handle.read.bind(handle);
        const close = handle.close.bind(handle);
        vi.spyOn(handle, "read").mockImplementation(async (...readArgs) => {
          if (index === 1 && gates.holdIdentityRead) {
            gates.identityRead.enter();
            await gates.identityRead.hold;
          }
          return read(...readArgs);
        });
        vi.spyOn(handle, "close").mockImplementation(async () => {
          if (index === 1 && gates.holdHashClose) {
            gates.hashClose.enter();
            await gates.hashClose.hold;
          }
          if (gates.failClose)
            throw new Error("controlled final close refusal");
          await close();
        });
        return descriptor;
      },
    ),
  };
});

import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import type { RetainedResourceScope } from "../../../../src/application/AnalysisProvider.js";
import {
  inspectKunaInstallation,
  kunaInstallationCancellation,
} from "../../../../src/kuna/KunaInstallation.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { writeFakeKuna } from "./fakeKuna.js";
import { session } from "./kunaSessionFixture.js";

beforeEach(() => {
  gates.opens = 0;
  gates.failClose = false;
  gates.holdHashClose = false;
  gates.holdIdentityRead = false;
  gates.hashClose = gates.createGate();
  gates.identityRead = gates.createGate();
});

afterEach(() => {
  gates.failClose = false;
  gates.hashClose.release();
  gates.identityRead.release();
});

it
  .skipIf(process.platform === "win32")
  .each(["hash-close", "identity-read"] as const)(
  "keeps installation cleanup waiting for its active phase when cancelled during %s",
  async (phase) => {
    const root = await createTestTempDirectory("rea-kuna-inspection-lifetime-");
    const executable = await writeFakeKuna(root);
    const scope = new ArtifactResourceScope();
    const resourceScope: RetainedResourceScope = {
      retain: (owner, resource) =>
        scope.retain({
          kind: "lease",
          resource,
          lease: { release: () => owner.close() },
        }),
      run: (operation) => scope.run(operation),
    };
    const controller = new AbortController();
    gates.holdHashClose = phase === "hash-close";
    gates.holdIdentityRead = phase === "identity-read";
    const inspection = inspectKunaInstallation(
      { REA_KUNA_COMMAND: executable },
      { resourceScope, signal: controller.signal },
    );

    const inspectionOutcome = inspection.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let cleanup: Promise<void> | undefined;
    try {
      await (phase === "hash-close"
        ? gates.hashClose.started
        : gates.identityRead.started);
      cleanup = scope.retryCleanup();
      let cleanupFinished = false;
      void cleanup.then(() => {
        cleanupFinished = true;
      });
      await Promise.resolve();
      expect(cleanupFinished).toBe(false);
      controller.abort();
      if (phase === "hash-close") gates.hashClose.release();
      else gates.identityRead.release();
      await Promise.resolve();
      expect(cleanupFinished).toBe(false);
      const failure: unknown = await inspection.catch(
        (cause: unknown) => cause,
      );
      const cancellation = kunaInstallationCancellation(failure);
      expect(cancellation).toBeDefined();
      expect(cancellation?.reason).toBe(controller.signal.reason);
      await expect(cleanup).resolves.toBeUndefined();
      expect(gates.opens).toBe(2);
      expect(scope.hasPending).toBe(false);
    } finally {
      gates.hashClose.release();
      gates.identityRead.release();
      await inspectionOutcome;
      await cleanup;
      await scope.close();
    }
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["hash-close", "identity-read", "close-refusal"] as const)(
  "joins session acquisition finalization and retains cleanup retry during %s cancellation",
  async (phase) => {
    gates.hashClose.release();
    gates.identityRead.release();
    const fixture = await session("rea-kuna-session-finalization-");
    gates.opens = 0;
    gates.hashClose = gates.createGate();
    gates.identityRead = gates.createGate();
    gates.holdHashClose = phase !== "identity-read";
    gates.holdIdentityRead = phase === "identity-read";
    const client = fixture.open();
    const controller = new AbortController();
    const reason = { selected: "caller reason" };
    const pending = client.execute("health", {}, { signal: controller.signal });
    let finished = false;
    let replacement: ReturnType<typeof client.execute> | undefined;
    void pending.then(() => {
      finished = true;
    });
    try {
      await (phase === "identity-read"
        ? gates.identityRead.started
        : gates.hashClose.started);
      controller.abort(reason);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
      if (phase === "hash-close") replacement = client.execute("health", {});
      gates.failClose = phase === "close-refusal";
      gates.hashClose.release();
      gates.identityRead.release();
      const result = await pending;
      if (result.ok) throw new Error("Expected interrupted installation");
      if (phase === "close-refusal") {
        expect(result.error.cleanupIncomplete).toBe(true);
        const retained = await client.execute("health", {});
        if (retained.ok) throw new Error("Expected retained cleanup failure");
        expect(retained.error).toBe(result.error);
        expect((await client.close()).ok).toBe(false);
        gates.failClose = false;
        expect((await client.close()).ok).toBe(true);
        expect(result.error.cleanupIncomplete).toBe(false);
      } else {
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(reason);
        expect(result.error.cleanupIncomplete).toBe(false);
        if (replacement !== undefined)
          expect((await replacement).ok).toBe(true);
        expect((await client.close()).ok).toBe(true);
      }
    } finally {
      gates.failClose = false;
      gates.hashClose.release();
      gates.identityRead.release();
      await pending;
      await replacement;
      expect((await client.close()).ok).toBe(true);
    }
  },
);
