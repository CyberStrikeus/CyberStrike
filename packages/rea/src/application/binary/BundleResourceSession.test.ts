import { expect, it } from "vitest";

import { combineBundleResourceClients } from "./BundleResourceSession.js";
import {
  createAnalysisExecution,
  type AnalysisClient,
  type ProviderIdentity,
} from "../AnalysisProvider.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { err, ok } from "../../domain/result.js";

const identity: ProviderIdentity = {
  id: "bundle-resource-close-fixture",
  name: "Bundle resource close fixture",
  version: "1",
};

it("retains both child close failures when a resource owner rejects", async () => {
  const attempts: string[] = [];
  const artifact: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      attempts.push("artifact");
      throw new Error("artifact close rejected");
    },
  };
  const native: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      attempts.push("native");
      throw new Error("native close rejected");
    },
  };

  const closed = await combineBundleResourceClients(artifact, native).close();
  expect(attempts.sort()).toEqual(["artifact", "native"]);
  expect(closed.ok).toBe(false);
  if (!closed.ok) expect(closed.error.cleanupIncomplete).toBe(true);
});

it("reports the first mixed child failure before awaiting the other owner and retries both", async () => {
  let artifactCloseAttempts = 0;
  let nativeCloseAttempts = 0;
  let nativeCloseStarted!: () => void;
  const nativeStarted = new Promise<void>((resolve) => {
    nativeCloseStarted = resolve;
  });
  let releaseNativeClose!: () => void;
  const nativeCloseGate = new Promise<void>((resolve) => {
    releaseNativeClose = resolve;
  });
  let cleanupFailureObserved!: (failure: Error) => void;
  const failureObserved = new Promise<Error>((resolve) => {
    cleanupFailureObserved = resolve;
  });
  const artifact: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      artifactCloseAttempts += 1;
      return artifactCloseAttempts === 1
        ? err(
            new ProviderCleanupError(identity.id, ["artifact-reader"], {
              reason: "artifact owner remains open",
            }),
          )
        : { ok: true, value: null };
    },
  };
  const native: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      nativeCloseAttempts += 1;
      if (nativeCloseAttempts === 1) {
        nativeCloseStarted();
        await nativeCloseGate;
      }
      return { ok: true, value: null };
    },
  };
  const combined = combineBundleResourceClients(artifact, native);
  const closing = combined.close({
    onCleanupFailure: cleanupFailureObserved,
  });
  await Promise.all([nativeStarted, failureObserved]);
  releaseNativeClose();
  const first = await closing;
  expect(first.ok).toBe(false);
  if (first.ok) throw new Error("Expected mixed close failure");
  expect(first.error.cleanupIncomplete).toBe(true);

  expect(await combined.close()).toMatchObject({ ok: true });
  expect(artifactCloseAttempts).toBe(2);
  expect(nativeCloseAttempts).toBe(2);
});

it("updates retained cleanup facts as the two child owners release independently", async () => {
  const artifactFailure = new ProviderCleanupError(
    identity.id,
    ["artifact-reader"],
    {},
  );
  const nativeFailure = new ProviderCleanupError(
    identity.id,
    ["native-reader"],
    {},
  );
  let releaseArtifact = false;
  let releaseNative = false;
  const client = (
    failure: ProviderCleanupError,
    released: () => boolean,
  ): AnalysisClient => ({
    execute: async () => ok(createAnalysisExecution(null, identity)),
    close: async () => {
      if (!released()) return err(failure);
      failure.resolveCleanup();
      return ok(null);
    },
  });
  const artifact = client(artifactFailure, () => releaseArtifact);
  const native = client(nativeFailure, () => releaseNative);
  const combined = combineBundleResourceClients(artifact, native);
  const first = await combined.close();
  if (first.ok) throw new Error("Expected both child owners to remain open");
  expect(new Set(first.error.cleanupResources)).toEqual(
    new Set(["artifact-reader", "native-reader"]),
  );

  releaseArtifact = true;
  expect(await artifact.close()).toMatchObject({ ok: true });
  expect(first.error.cleanupIncomplete).toBe(true);
  expect(first.error.cleanupResources).toEqual(["native-reader"]);

  releaseNative = true;
  expect(await combined.close()).toMatchObject({ ok: true });
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(first.error.cleanupResources).toEqual([]);
  expect(new Set(first.error.cleanup?.resources)).toEqual(
    new Set(["artifact-reader", "native-reader"]),
  );
});

it("keeps cleanup unknown when a child close failure has no cleanup lifecycle", async () => {
  const owned = new ProviderCleanupError(identity.id, ["artifact-reader"], {});
  const client = (
    failure: AnalysisInputError | ProviderCleanupError,
  ): AnalysisClient => ({
    execute: async () => ok(createAnalysisExecution(null, identity)),
    close: async () => err(failure),
  });
  const closed = await combineBundleResourceClients(
    client(owned),
    client(new AnalysisInputError("close_binary")),
  ).close();
  if (closed.ok) throw new Error("Expected child close failures");
  owned.resolveCleanup();
  expect(closed.error.cleanupIncomplete).toBe(true);
});
