import { expect, it } from "vitest";

import { SetupCleanupOwner } from "./SetupCleanupOwner.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";

const errorSources = (error: unknown): ReadonlySet<unknown> => {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Error) pending.push(value.cause);
    if (value instanceof AggregateError) pending.push(...value.errors);
    if (value instanceof AnalysisError)
      pending.push(value.cleanupPrimary, ...value.secondaryFailures);
  }
  return seen;
};

it("updates every report through mixed cleanup outcomes and exact retries", async () => {
  let firstHeld = true;
  let secondHeld = true;
  let firstCalls = 0;
  const owner = new SetupCleanupOwner([
    {
      close: async () => {
        if (++firstCalls > 2)
          throw new Error("Completed child must not close again");
        return firstHeld
          ? { reason: "first held", resources: ["/first"] }
          : undefined;
      },
    },
    {
      close: async () =>
        secondHeld
          ? { reason: "second held", resources: ["/second"] }
          : undefined,
    },
  ]);
  const first = await owner.close();
  expect(first?.cleanupResources).toEqual(["/first", "/second"]);
  firstHeld = false;
  const second = await owner.close();
  expect(first?.cleanupIncomplete).toBe(true);
  expect(first?.cleanupResources).toEqual(["/second"]);
  expect(second?.cleanupResources).toEqual(["/second"]);
  secondHeld = false;
  expect(await owner.close()).toBeUndefined();
  expect(first?.cleanupIncomplete).toBe(false);
  expect(first?.cleanupResources).toEqual([]);
  expect(second?.cleanupIncomplete).toBe(false);
  expect(firstCalls).toBe(2);
});

it("keeps opaque cleanup unresolved without inventing paths or retaining released labels", async () => {
  let fileHeld = true;
  let opaqueHeld = true;
  const owner = new SetupCleanupOwner([
    {
      close: async () =>
        fileHeld ? { reason: "held file", resources: ["/owned"] } : undefined,
    },
    {
      close: async () => {
        if (opaqueHeld) throw new Error("opaque /not-an-owned-path");
      },
    },
  ]);
  const report = await owner.close();
  expect(report?.cleanupResources).toEqual(["/owned"]);
  fileHeld = false;
  await owner.close();
  expect(report?.cleanupIncomplete).toBe(true);
  expect(report?.cleanupResources).toEqual([]);
  opaqueHeld = false;
  expect(await owner.close()).toBeUndefined();
  expect(report?.cleanupIncomplete).toBe(false);
});

it("starts child finalization synchronously and shares concurrent closes", async () => {
  let calls = 0;
  let complete: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const owner = new SetupCleanupOwner([
    {
      close: () => {
        calls++;
        return gate;
      },
    },
  ]);
  const first = owner.close();
  expect(calls).toBe(1);
  expect(owner.close()).toBe(first);
  complete?.();
  expect(await first).toBeUndefined();
  expect(await owner.close()).toBeUndefined();
  expect(calls).toBe(1);
});

it("adopts later cleanup without reopening a completed generation", async () => {
  let held = true;
  const task = {
    close: async () =>
      held ? { reason: "held", resources: ["/same-label"] } : undefined,
  };
  const owner = new SetupCleanupOwner([task]);
  const previous = await owner.close();
  held = false;
  expect(await owner.close()).toBeUndefined();
  held = true;
  owner.admit(task);
  const current = await owner.close();
  expect(previous?.cleanupIncomplete).toBe(false);
  expect(previous?.cleanupResources).toEqual([]);
  expect(current?.cleanupIncomplete).toBe(true);
  expect(current?.cleanupResources).toEqual(["/same-label"]);
  held = false;
  expect(await owner.close()).toBeUndefined();
});

it("keeps finalization cancellation unresolved and still attempts the other child", async () => {
  let interrupted = true;
  let otherAttempts = 0;
  const owner = new SetupCleanupOwner([
    {
      close: async () => {
        if (interrupted)
          throw new DOMException("close interrupted", "AbortError");
      },
    },
    {
      close: async () => {
        otherAttempts++;
      },
    },
  ]);
  const report = await owner.close();
  expect(report?.cleanupIncomplete).toBe(true);
  expect(otherAttempts).toBe(1);
  interrupted = false;
  expect(await owner.close()).toBeUndefined();
  expect(report?.cleanupIncomplete).toBe(false);
});

it.each(["group", "direct"])(
  "observes exact concurrent recovery before aggregate binding: %s",
  async (binding) => {
    const source = new ProviderCleanupError("fixture", ["/shared"], {});
    const lease = new AnalysisCleanupLease(async () => {}, ["/shared"]);
    if (binding === "direct") lease.bindCleanupError(source);
    else new AnalysisCleanupLeaseGroup(source, [lease]);
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let sourceCalls = 0;
    const owner = new SetupCleanupOwner([
      {
        close: async () => {
          sourceCalls++;
          throw source;
        },
      },
      { close: () => gate },
    ]);
    const closing = owner.close();
    await lease.release();
    finish?.();
    expect(await closing).toBeUndefined();
    expect(await owner.close()).toBeUndefined();
    expect(sourceCalls).toBe(1);
  },
);

it.each(["pending", "already recovered"] as const)(
  "keeps delegated cleanup pending when the next report has an independent owner: %s",
  async (timing) => {
    const source = new ProviderCleanupError("fixture", ["/independent"], {});
    const sourceLease = new AnalysisCleanupLease(async () => {}, [
      "/independent",
    ]);
    new AnalysisCleanupLeaseGroup(source, [sourceLease]);
    let calls = 0;
    const owner = new SetupCleanupOwner([
      {
        close: async () => {
          calls++;
          if (calls === 1)
            return {
              reason: "delegated work pending",
              resources: ["/delegated"],
            };
          if (calls === 2) return source;
          return undefined;
        },
      },
    ]);
    const first = await owner.close();
    if (timing === "already recovered") await sourceLease.release();
    const second = await owner.close();
    await sourceLease.release();
    expect(source.cleanupIncomplete).toBe(false);
    expect(first?.cleanupIncomplete).toBe(true);
    expect(second?.cleanupIncomplete).toBe(true);
    expect(first?.cleanupResources).toContain("/delegated");
    expect(second?.cleanupResources).toContain("/delegated");
    expect(first?.cleanupResources).toEqual(["/delegated"]);
    expect(second?.cleanupResources).toEqual(["/delegated"]);
    expect(await owner.close()).toBeUndefined();
    expect(calls).toBe(3);
    expect(first?.cleanupIncomplete).toBe(false);
    expect(second?.cleanupIncomplete).toBe(false);
  },
);

it("keeps an immutable ownerless source snapshot while its owned report recovers", async () => {
  const source = new ProviderCleanupError("fixture", ["/delegated"], {});
  Object.freeze(source);
  let held = true;
  const owner = new SetupCleanupOwner([
    {
      close: async () => (held ? source : undefined),
    },
  ]);
  const first = await owner.close();
  expect(first?.cleanupResources).toEqual(["/delegated"]);
  const second = await owner.close();
  expect(second?.cleanupResources).toEqual(["/delegated"]);
  held = false;
  expect(await owner.close()).toBeUndefined();
  expect(source.hasCleanupOwner).toBe(false);
  expect(source.cleanupIncomplete).toBe(true);
  expect(first?.cleanupIncomplete).toBe(false);
  expect(second?.cleanupIncomplete).toBe(false);
});

it("keeps both authorities pending when the callback succeeds before its independent source", async () => {
  const source = new ProviderCleanupError("fixture", ["/independent"], {});
  const sourceLease = new AnalysisCleanupLease(async () => {}, [
    "/independent",
  ]);
  new AnalysisCleanupLeaseGroup(source, [sourceLease]);
  let calls = 0;
  const owner = new SetupCleanupOwner([
    {
      close: async () => {
        calls++;
        if (calls === 1)
          return {
            reason: "delegated work pending",
            resources: ["/delegated"],
          };
        if (calls === 2) return source;
        return undefined;
      },
    },
  ]);
  const first = await owner.close();
  const second = await owner.close();
  const third = await owner.close();
  expect(source.cleanupIncomplete).toBe(true);
  for (const report of [first, second, third]) {
    expect(report?.cleanupIncomplete).toBe(true);
    expect(report?.cleanupResources).toEqual(["/independent"]);
  }
  expect(await owner.close()).toBeDefined();
  expect(calls).toBe(3);
  await sourceLease.release();
  expect(await owner.close()).toBeUndefined();
  expect(calls).toBe(3);
  for (const report of [first, second, third])
    expect(report?.cleanupIncomplete).toBe(false);
});

it("starts a fresh report when a prior source resolves inside a retry before a new source fails", async () => {
  const firstSource = new ProviderCleanupError(
    "fixture",
    ["/first-source"],
    {},
  );
  const secondSource = new ProviderCleanupError(
    "fixture",
    ["/second-source"],
    {},
  );
  const firstLease = new AnalysisCleanupLease(async () => {}, [
    "/first-source",
  ]);
  const secondLease = new AnalysisCleanupLease(async () => {}, [
    "/second-source",
  ]);
  new AnalysisCleanupLeaseGroup(firstSource, [firstLease]);
  new AnalysisCleanupLeaseGroup(secondSource, [secondLease]);
  let calls = 0;
  const owner = new SetupCleanupOwner([
    {
      close: async () => {
        calls++;
        if (calls === 1) return firstSource;
        await firstLease.release();
        return secondSource;
      },
    },
  ]);
  const first = await owner.close();
  const second = await owner.close();
  expect(first?.cleanupIncomplete).toBe(false);
  expect(second?.cleanupIncomplete).toBe(true);
  expect(second?.cleanupResources).toEqual(["/second-source"]);
  await secondLease.release();
  expect(await owner.close()).toBeUndefined();
  expect(calls).toBe(2);
});

it.each(["artifact", "analysis"] as const)(
  "preserves a rejected %s producer's detailed cleanup reason",
  async (kind) => {
    const observation = {
      reason: "Unlink denied because the owned file remains locked",
      resources: ["/fixture/owned"],
    };
    const failure =
      kind === "artifact"
        ? new ArtifactReaderFailure(
            "unavailable",
            "Retained resources: /fixture/owned",
            { cleanup: observation },
          )
        : new ProviderCleanupError(
            "fixture",
            observation.resources,
            {},
            { cleanup: observation },
          );
    const owner = new SetupCleanupOwner([
      {
        rejectedPrefix: "Publisher cleanup failed",
        close: async () => {
          throw failure;
        },
      },
    ]);
    const report = await owner.close();
    expect(report?.cleanup?.reason).toBe(
      "Publisher cleanup failed: " + observation.reason,
    );
    expect(report?.cleanupResources).toEqual(observation.resources);
  },
);

it("retains the latest typed retry cause independently of its completion owner", async () => {
  const firstCause = new ProviderCleanupError("fixture", ["/owned"], {
    stage: "first",
  });
  const secondCause = new ProviderCleanupError(
    "fixture",
    ["/owned"],
    { stage: "retry" },
    {
      capturedOutput: {
        stdout: "retry-specific output",
        stderr: "",
        truncated: false,
      },
    },
  );
  let calls = 0;
  const owner = new SetupCleanupOwner([
    {
      close: async () => {
        if (++calls === 1) throw firstCause;
        if (calls === 2) throw secondCause;
      },
    },
  ]);
  const first = await owner.close();
  const second = await owner.close();
  expect(errorSources(second).has(secondCause)).toBe(true);
  expect(secondCause.capturedOutput?.stdout).toBe("retry-specific output");
  expect(await owner.close()).toBeUndefined();
  expect(first?.cleanupIncomplete).toBe(false);
  expect(second?.cleanupIncomplete).toBe(false);
});

it("does not share callback ownership through a reused ownerless source error", async () => {
  const source = new ProviderCleanupError("fixture", ["/same-file"], {});
  let firstHeld = true;
  let secondHeld = true;
  const owner = new SetupCleanupOwner([
    { close: async () => (firstHeld ? source : undefined) },
    { close: async () => (secondHeld ? source : undefined) },
  ]);
  const first = await owner.close();
  firstHeld = false;
  const second = await owner.close();
  expect(second?.cleanupIncomplete).toBe(true);
  expect(second?.cleanupResources).toEqual(["/same-file"]);
  secondHeld = false;
  expect(await owner.close()).toBeUndefined();
  expect(first?.cleanupIncomplete).toBe(false);
  expect(second?.cleanupIncomplete).toBe(false);
  expect(source.hasCleanupOwner).toBe(false);
  expect(source.cleanupIncomplete).toBe(true);
});

it("retains earlier independent owner evidence alongside the latest retry cause", async () => {
  const firstSource = new ProviderCleanupError("fixture", ["/first"], {
    stage: "first",
  });
  const secondSource = new ProviderCleanupError("fixture", ["/second"], {
    stage: "retry",
  });
  const firstLease = new AnalysisCleanupLease(async () => {}, ["/first"]);
  const secondLease = new AnalysisCleanupLease(async () => {}, ["/second"]);
  new AnalysisCleanupLeaseGroup(firstSource, [firstLease]);
  new AnalysisCleanupLeaseGroup(secondSource, [secondLease]);
  let calls = 0;
  const owner = new SetupCleanupOwner([
    { close: async () => (++calls === 1 ? firstSource : secondSource) },
  ]);
  await owner.close();
  const latest = await owner.close();
  expect(errorSources(latest).has(firstSource)).toBe(true);
  expect(errorSources(latest).has(secondSource)).toBe(true);
  await firstLease.release();
  await secondLease.release();
  expect(await owner.close()).toBeUndefined();
});
