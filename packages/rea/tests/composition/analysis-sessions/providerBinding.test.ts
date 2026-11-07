import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisOperation,
  type AnalysisProvider,
  type AnalysisProviderCandidate,
  type CapabilityDescriptor,
  type ProviderIdentity,
} from "../../../src/application/AnalysisProvider.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import type { BinarySession } from "../../../src/application/binary/BinarySession.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { SessionProviderRouter } from "../../../src/application/binary/SessionProviderRouter.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { err, ok } from "../../../src/domain/result.js";

type DeclaredOperation = Exclude<AnalysisOperation, "health">;

describe("target-bound provider routing", () => {
  it("rejects provider identity and operation-family collisions at composition", () => {
    const alpha = deepProvider("alpha");
    const registry = new AnalysisProviderRegistry([alpha.provider]);
    expect(() =>
      SessionProviderRouter.selectable(registry, [auxiliaryProvider("alpha")]),
    ).toThrow(/Duplicate configured provider ID: alpha/u);
    expect(() =>
      SessionProviderRouter.selectable(registry, [
        auxiliaryProvider("auxiliary", "address_name"),
      ]),
    ).toThrow(
      /Deep and auxiliary providers both declare operation address_name/u,
    );
  });

  it("binds one overlapping provider, preserves provenance, and never falls back", async () => {
    const target = await databaseTarget();
    const alpha = deepProvider("alpha");
    const beta = deepProvider("beta");
    const auxiliary = auxiliaryProvider();
    const session = selectableSession(
      [beta.provider, alpha.provider],
      auxiliary,
    );

    const ambiguous = await session.open(target);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok)
      expect(ambiguous.error).toMatchObject({ reason: "ambiguous" });
    expect(alpha.clients).toHaveLength(0);
    expect(beta.clients).toHaveLength(0);
    expect(session.activeTarget()).toBeUndefined();

    expect((await session.open(target, { providerId: "alpha" })).ok).toBe(true);
    expect(await bindingStatus(session)).toMatchObject({
      analysis_provider_binding: {
        provider: { id: "alpha", version: "1" },
        selection_source: "request",
      },
      analysis_provider_candidates: [
        { provider: { id: "alpha" }, selected: true },
        { provider: { id: "beta" }, selected: false },
      ],
    });
    expect(alpha.clients).toHaveLength(0);

    const observed = await session.execute("address_name", { address: "0x1" });
    expect(observed.ok).toBe(true);
    if (observed.ok)
      expect(observed.value).toMatchObject({
        provider: { id: "alpha", version: "1" },
        analysisProfile: { provider: { id: "alpha", version: "1" } },
        result: "alpha:address_name",
        subject: {
          sha256: expect.any(String),
          path: target,
          format: "analysis-database",
        },
      });
    expect(alpha.clients).toHaveLength(1);
    expect(beta.clients).toHaveLength(0);

    expect((await session.open(target, { providerId: "alpha" })).ok).toBe(true);
    expect(alpha.clients).toHaveLength(1);
    expect(alpha.clients[0]?.closed).toBe(false);

    const auxiliaryResult = await session.execute("inspect_macho", {});
    expect(auxiliaryResult.ok && auxiliaryResult.value.provider.id).toBe(
      "auxiliary",
    );

    alpha.available = false;
    expect((await session.open(target)).ok).toBe(true);
    expect(await bindingStatus(session)).toMatchObject({
      analysis_provider_binding: { provider: { id: "alpha" } },
    });

    const unknown = await session.open(target, { providerId: "missing" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(unknown.error).toMatchObject({ reason: "unknown_provider" });
    expect(await bindingStatus(session)).toMatchObject({
      analysis_provider_binding: { provider: { id: "alpha" } },
    });

    expect((await session.open(target, { providerId: "beta" })).ok).toBe(true);
    expect(alpha.clients[0]?.closed).toBe(true);
    beta.fail = true;
    const failed = await session.execute("address_name", { address: "0x2" });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error._tag).toBe("ProviderAdapterError");
    expect(alpha.clients[0]?.calls).toEqual(["address_name"]);
    expect(await bindingStatus(session)).toMatchObject({
      analysis_provider_binding: { provider: { id: "beta" } },
    });

    await session.close();
    expect(beta.clients[0]?.closed).toBe(true);
  });

  it("preserves the active client when a provider switch is cancelled with a call in flight", async () => {
    const target = await databaseTarget();
    const alpha = deepProvider("alpha");
    const beta = deepProvider("beta");
    const pending = deferred<ReturnType<typeof successfulExecution>>();
    const callStarted = deferred<void>();
    const profileStarted = deferred<void>();
    alpha.pending = pending.promise;
    alpha.onPending = () => callStarted.resolve();
    beta.onProfile = () => profileStarted.resolve();
    const session = selectableSession([alpha.provider, beta.provider]);
    const controller = new AbortController();
    const reason = new Error("cancel provider switch");
    let running: Promise<unknown> | undefined;
    let switching: ReturnType<typeof session.open> | undefined;
    onTestFinished(async () => {
      controller.abort(reason);
      pending.resolve(successfulExecution("alpha"));
      await Promise.allSettled([
        ...(running === undefined ? [] : [running]),
        ...(switching === undefined ? [] : [switching]),
      ]);
      expect(await session.close()).toEqual(ok(null));
    });
    expect((await session.open(target, { providerId: "alpha" })).ok).toBe(true);
    running = session.execute("address_name", { address: "0x1" });
    await awaitAcknowledgement(callStarted.promise, running, "provider call");

    switching = session.open(target, {
      providerId: "beta",
      signal: controller.signal,
    });
    await awaitAcknowledgement(
      profileStarted.promise,
      switching,
      "provider profile resolution",
    );
    expect(alpha.clients[0]?.closed).toBe(false);
    controller.abort(reason);
    pending.resolve(successfulExecution("alpha"));

    expect(await running).toMatchObject({ ok: true });
    const cancelled = await switching;
    expect(cancelled).toEqual({
      ok: false,
      error: new AnalysisCancelledError("open_binary", { cause: reason }),
    });
    if (!cancelled.ok) expect(cancelled.error.cause).toBe(reason);
    expect(alpha.clients[0]?.closed).toBe(false);
    expect(beta.clients).toHaveLength(0);
    expect(await bindingStatus(session)).toMatchObject({
      analysis_provider_binding: { provider: { id: "alpha" } },
    });

    alpha.pending = undefined;
    const retained = await session.execute("address_name", { address: "0x2" });
    expect(retained.ok && retained.value.provider.id).toBe("alpha");
    expect(alpha.clients).toHaveLength(1);
    expect(await session.close()).toEqual(ok(null));
    expect(alpha.clients[0]?.closed).toBe(true);
  });
});

it("preserves bundle-root identity for artifact inventory operations", async () => {
  const directory = await createTestTempDirectory("rea-provider-bundle-");
  const target = join(directory, "Fixture.app");
  const executable = join(target, "Fixture");
  const infoPlist = join(target, "Info.plist");
  await mkdir(target);
  await writeFile(
    infoPlist,
    "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
  );
  await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
  const analysis = deepProvider("alpha");
  const artifact = auxiliaryProvider("artifact", "inventory_artifact");
  const session = selectableSession([analysis.provider], artifact);
  onTestFinished(async () => {
    await session.close();
  });

  expect((await session.open(target, { providerId: "alpha" })).ok).toBe(true);
  expect(session.activeTarget()).toMatchObject({
    path: await realpath(executable),
    sourcePath: await realpath(target),
    bundleInfoPlist: await realpath(infoPlist),
  });
  const result = await session.execute("inventory_artifact", {});
  if (!result.ok) throw result.error;

  expect(result).toMatchObject({
    ok: true,
    value: {
      subject: {
        path: target,
        sha256: "f".repeat(64),
        format: "directory",
      },
    },
  });
});

describe("selected provider capability provenance", () => {
  it("labels selected-provider capabilities with the resolved identity", async () => {
    const target = await databaseTarget();
    const alpha = deepProvider("alpha");
    const session = selectableSession([alpha.provider], auxiliaryProvider());

    expect((await session.open(target, { providerId: "alpha" })).ok).toBe(true);
    const resolved = { id: "alpha", name: "alpha provider", version: "1" };
    const status = await bindingStatus(session);
    expect(status).toMatchObject({
      analysis_provider_binding: { provider: resolved },
      analysis_provider_candidates: [
        {
          provider: resolved,
          selected: true,
          capabilities: [{ provider: resolved }],
        },
      ],
    });
    expect(
      z
        .object({ capabilities: z.array(z.object({ provider: z.unknown() })) })
        .parse(status)
        .capabilities.map(({ provider }) => provider),
    ).toEqual([
      { id: "alpha", name: "alpha provider", version: "1" },
      { id: "auxiliary", name: "auxiliary provider", version: "1" },
    ]);
    await session.close();
  });
});

interface ClientState {
  readonly calls: string[];
  closed: boolean;
}

interface DeepProviderFixture {
  provider: AnalysisProviderCandidate;
  readonly clients: ClientState[];
  available: boolean;
  fail: boolean;
  onProfile: (() => void) | undefined;
  onPending: (() => void) | undefined;
  pending: Promise<ReturnType<typeof successfulExecution>> | undefined;
}

const deepProvider = (id: string): DeepProviderFixture => {
  const identity: ProviderIdentity = {
    id,
    name: `${id} provider`,
    version: null,
  };
  const fixture: Omit<DeepProviderFixture, "provider"> = {
    clients: [],
    available: true,
    fail: false,
    onProfile: undefined,
    onPending: undefined,
    pending: undefined,
  };
  const provider: AnalysisProviderCandidate = {
    identity: () => identity,
    capabilities: () => [capability(identity, "address_name")],
    inspectAvailability: () =>
      fixture.available
        ? {
            status: "available",
            code: null,
            reason: null,
            diagnostics: { executable_path: `/opt/${id}/bin/analyze` },
          }
        : {
            status: "unavailable",
            code: "runtime_missing",
            reason: `${id} runtime is unavailable`,
            diagnostics: { executable_path: `/opt/${id}/bin/analyze` },
          },
    inspectTargetSupport: () => ({
      status: "supported",
      code: null,
      reason: null,
      diagnostics: {},
    }),
    resolveAnalysisProfile: () => {
      fixture.onProfile?.();
      return Promise.resolve(
        ok({
          profile: createAnalysisProfile(
            { id, name: identity.name, version: "1" },
            { provider: id },
          ),
        }),
      );
    },
    createClient: (_target, profile): AnalysisClient => {
      const state: ClientState = { calls: [], closed: false };
      fixture.clients.push(state);
      return {
        execute: (operation) => {
          if (operation === "health")
            return Promise.resolve(successfulExecution(id, profile?.provider));
          state.calls.push(operation);
          if (fixture.fail)
            return Promise.resolve(
              err(new ProviderAdapterError(id, operation)),
            );
          if (fixture.pending !== undefined) {
            fixture.onPending?.();
            return fixture.pending;
          }
          return Promise.resolve(successfulExecution(id, profile?.provider));
        },
        close: () => {
          state.closed = true;
          return Promise.resolve(ok(null));
        },
      };
    },
  };
  return Object.assign(fixture, { provider });
};

const successfulExecution = (
  id: string,
  provider: ProviderIdentity = {
    id,
    name: `${id} provider`,
    version: "1",
  },
) => ok(createAnalysisExecution(`${id}:address_name`, provider));

const auxiliaryProvider = (
  id = "auxiliary",
  operation: DeclaredOperation = "inspect_macho",
): AnalysisProvider => {
  const identity = {
    id,
    name: `${id} provider`,
    version: "1",
  };
  return {
    identity: () => identity,
    capabilities: () => [capability(identity, operation)],
    createClient: (target) => ({
      execute: (operation) =>
        Promise.resolve(
          ok(
            createAnalysisExecution(
              `${operation}:auxiliary`,
              identity,
              operation === "inventory_artifact" ||
                operation === "inspect_artifact"
                ? {
                    subject: {
                      path: target.sourcePath ?? target.path,
                      sha256: "f".repeat(64),
                      format: "directory",
                    },
                  }
                : {},
            ),
          ),
        ),
      close: () => Promise.resolve(ok(null)),
    }),
  };
};

const selectableSession = (
  providers: readonly AnalysisProviderCandidate[],
  auxiliary?: AnalysisProvider,
): BinarySession =>
  composeBinarySession(
    new AnalysisProviderRegistry(providers),
    auxiliary === undefined ? [] : [auxiliary],
  );

const capability = (
  provider: ProviderIdentity,
  operation: DeclaredOperation,
): CapabilityDescriptor => ({
  provider,
  operation,
  available: true,
  reason: null,
  effects: {
    mutatesArtifact: false,
    launchesProcess: operation === "address_name",
    mayShowUi: false,
    mayAccessNetwork: false,
    mayWriteFilesystem: false,
    changesPermissions: false,
    requiresRoot: false,
  },
  limitations: [],
});

const databaseTarget = async (): Promise<string> => {
  const directory = await createTestTempDirectory("rea-provider-binding-");
  const path = join(directory, "fixture.hop");
  await writeFile(path, "fixture");
  return path;
};

const bindingStatus = async (session: BinarySession) =>
  z
    .object({
      analysis_provider_binding: z.unknown(),
      analysis_provider_candidates: z.array(z.unknown()),
    })
    .passthrough()
    .parse(await session.status());

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
};
