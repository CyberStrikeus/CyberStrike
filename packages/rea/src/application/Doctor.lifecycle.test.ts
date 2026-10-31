import { expect, it } from "vitest";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { createDoctorHostFixture } from "./Doctor.fixture.js";
import { runDoctorOwned, systemDoctorHost } from "./Doctor.js";

it("joins a late provider inspection and retries only its unresolved cleanup owners", async () => {
  let enter!: (signal: AbortSignal) => void;
  const entered = new Promise<AbortSignal>((resolve) => {
    enter = resolve;
  });
  let handOff!: () => void;
  const handoff = new Promise<void>((resolve) => {
    handOff = resolve;
  });
  let finish!: () => void;
  const finishing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let denied = true;
  let closed = false;
  const closes = { successful: 0, refused: 0 };
  const host = systemDoctorHost({
    environment: {},
    providerInspections: async (owner, signal) => {
      enter(signal);
      await handoff;
      owner.retain(
        {
          close: async () => {
            closes.successful++;
            await finishing;
          },
        },
        "successful-prerequisite",
      );
      owner.retain(
        {
          close: async () => {
            closes.refused++;
            if (denied) throw new Error("controlled cleanup refusal");
          },
        },
        "refused-prerequisite",
      );
      return [];
    },
  });
  const inspection = host.providerInspections!();
  let closing: Promise<unknown> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(
      entered.then(() => {}),
      inspection,
      "provider inspection",
    );
    const signal = await entered;
    closing = host.close!().then(
      () => {
        closed = true;
        return undefined;
      },
      (cause: unknown) => {
        closed = true;
        return cause;
      },
    );
    expect(signal.aborted).toBe(true);
    expect(closed).toBe(false);
    handOff();
    await inspection;
    expect(closed).toBe(false);
    finish();
    const failure = await closing;
    if (!(failure instanceof AnalysisError))
      throw new Error("Expected attributed cleanup failure");
    expect(failure.cleanupResources).toEqual(["refused-prerequisite"]);
    expect(failure.cleanupIncomplete).toBe(true);
    expect(closes).toEqual({ successful: 1, refused: 1 });
    denied = false;
    await host.close!();
    expect(failure.cleanupIncomplete).toBe(false);
    expect(closes).toEqual({ successful: 1, refused: 2 });
    await expect(host.providerInspections!()).rejects.toThrow(
      "scope is closed",
    );
  }, [
    () => {
      denied = false;
      handOff();
      finish();
    },
    async () => {
      await inspection;
    },
    async () => {
      await closing;
    },
    () => host.close!(),
  ]);
});

it("retains a completed healthy report when cancellation arrives during final cleanup", async () => {
  const controller = new AbortController();
  const reason = { request: "cancel final doctor cleanup" };
  await expect(
    runDoctorOwned(
      undefined,
      createDoctorHostFixture({
        signal: controller.signal,
        close: async () => {
          controller.abort(reason);
          return undefined;
        },
      }),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
    diagnostics: { doctor_report: { healthy: true } },
  });
});

it("preserves an inspection-authored physical failure when final cleanup also observes cancellation", async () => {
  const controller = new AbortController();
  const physical = new ProviderAdapterError("ghidra", "doctor", {
    diagnostics: { reason: "controlled inspection fault" },
  });
  await expect(
    runDoctorOwned(
      undefined,
      createDoctorHostFixture({
        signal: controller.signal,
        providerInspections: async () => {
          throw physical;
        },
        close: async () => {
          controller.abort(physical);
          return undefined;
        },
      }),
    ),
  ).rejects.toBe(physical);
  expect(physical.cause).toBeUndefined();
});
