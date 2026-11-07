import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type ProviderIdentity,
} from "../AnalysisProvider.js";
import { parseBinaryTarget } from "../BinaryTargetResolver.js";
import { InvestigationRecords } from "../investigation/InvestigationRecords.js";
import { AnalysisProviderRegistry } from "./AnalysisProviderRegistry.js";
import { BinarySession } from "./BinarySession.js";
import { SessionProviderRouter } from "./SessionProviderRouter.js";
import { bundleResourceRootSchema } from "../../domain/apple/bundleResourceRoot.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorRemediationAction } from "../../domain/analysisErrorPresentation.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { ResourceSnapshotMismatchError } from "../../domain/evidenceErrors.js";
import type { AnalysisSnapshot } from "../../domain/analysisSnapshot.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { err, ok } from "../../domain/result.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { createEvidence } from "../../domain/evidence.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { createTestProviderRouter } from "../../../tests/fixtures/binarySession.js";

const identity: ProviderIdentity = {
  id: "bundle-resource-fixture",
  name: "Bundle resource fixture",
  version: "1",
};
const binaryIdentity: ProviderIdentity = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
};
const temporaryDirectories: string[] = [];

const expectResourceSnapshotRefusal = (
  error: AnalysisError,
  operation: "export" | "import",
): void => {
  expect(error).toBeInstanceOf(ResourceSnapshotMismatchError);
  expect(error).toMatchObject({
    _tag: "EvidenceIntegrityError",
    operation,
  });
  const projected = projectAnalysisError(error);
  expect(projected.code).toBe("evidence_integrity_mismatch");
  expect(projected.category).toBe("integrity_mismatch");
  expect(projected.retryable).toBe(false);
  expect(projected.remediation).toEqual({
    action: analysisErrorRemediationAction(error),
  });
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it.skipIf(process.platform === "win32")(
  "refuses invalid selected traversal before creating a bundle resource client",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-resource-selected-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "Fixture.app"));
    await writeFile(
      join(root, "Fixture.app", "Info.plist"),
      "<plist><dict/></plist>",
    );
    await writeFile(join(root, "regular"), "file");
    let created = false;
    const session = new BinarySession(
      SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
      new InvestigationRecords(),
      {
        createClient: () => {
          created = true;
          throw new Error("Invalid selection must not create a client");
        },
      },
    );
    const selected = `${root}/regular/../Fixture.app`;
    await expect(stat(selected)).rejects.toMatchObject({ code: "ENOTDIR" });
    expect((await session.openBundleResources(selected)).ok).toBe(false);
    expect(created).toBe(false);
  },
);

it("opens a resource-only bundle without executable identity and keeps snapshot operations inapplicable", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "rea-resource-session-"));
  temporaryDirectories.push(rootPath);
  await writeFile(
    join(rootPath, "Info.plist"),
    '<?xml version="1.0"?><plist><dict/></plist>',
  );
  let openedRoot: string | undefined;
  let closed = false;
  const client: AnalysisClient = {
    execute: async (operation) => {
      if (operation === "health")
        return { ok: true, value: createAnalysisExecution(null, identity) };
      return {
        ok: true,
        value: createAnalysisExecution(
          { operation, target_sha256: null },
          identity,
        ),
      };
    },
    close: async () => {
      closed = true;
      return { ok: true, value: null };
    },
  };
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
    {
      createClient: (root) => {
        openedRoot = root.canonicalPath;
        return { client, capabilities: [] };
      },
    },
  );

  const opened = await session.openBundleResources(rootPath);
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw opened.error;
  expect(session.allowsSnapshotReplay("inspect_plist")).toBe(false);
  expect(opened.value.executableSha256).toBeNull();
  expect(openedRoot).toBe(opened.value.canonicalPath);
  expect(
    bundleResourceRootSchema.parse({
      caller_path: opened.value.callerPath,
      canonical_path: opened.value.canonicalPath,
      info_plist_path: opened.value.infoPlistPath,
      layout: opened.value.layout,
      executable_sha256: opened.value.executableSha256,
    }).executable_sha256,
  ).toBeNull();

  const result = await session.execute("inspect_plist", {});
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.subject).toBeNull();
  const binaryOnly = await session.execute("binary_overview", {});
  expect(binaryOnly.ok).toBe(false);
  expect(await session.status()).toMatchObject({
    open: true,
    session_kind: "bundle_resources",
    resource_root: { canonical_path: opened.value.canonicalPath },
  });
  const snapshot = session.exportAnalysisSnapshot();
  if (snapshot.ok)
    throw new Error("resource session exported a binary snapshot");
  expectResourceSnapshotRefusal(snapshot.error, "export");
  const imported = session.importAnalysisSnapshot({} as AnalysisSnapshot);
  if (imported.ok)
    throw new Error("resource session imported a binary snapshot");
  expectResourceSnapshotRefusal(imported.error, "import");
  expect(await session.status()).toMatchObject({
    open: true,
    session_kind: "bundle_resources",
  });
  const closedResult = await session.close();
  expect(closedResult.ok).toBe(true);
  expect(closed).toBe(true);
});

it("keeps the exact caller reason for cancellation before resource-root resolution", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "rea-resource-pre-cancel-"));
  temporaryDirectories.push(rootPath);
  const reason = { origin: "caller-pre-aborted" };
  const controller = new AbortController();
  controller.abort(reason);
  let clientCreated = false;
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
    {
      createClient: () => {
        clientCreated = true;
        throw new Error("pre-aborted call must not create a client");
      },
    },
  );
  const result = await session.openBundleResources(rootPath, {
    signal: controller.signal,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError", cause: reason },
  });
  expect(clientCreated).toBe(false);
});

it("retains ownership when an unhealthy resource client cannot be closed", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "rea-resource-cleanup-"));
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
  let closeAttempts = 0;
  const client: AnalysisClient = {
    execute: async () => err(new ProviderAdapterError(identity.id, "health")),
    close: async () => {
      closeAttempts += 1;
      return closeAttempts === 1
        ? err(new ProviderAdapterError(identity.id, "close_binary"))
        : { ok: true, value: null };
    },
  };
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
    { createClient: () => ({ client, capabilities: [] }) },
  );

  const opened = await session.openBundleResources(rootPath);
  expect(opened.ok).toBe(false);
  expect(closeAttempts).toBe(1);
  expect(await session.status()).toMatchObject({ cleanup_pending: true });
  expect(await session.status()).toMatchObject({ open: false });

  const closed = await session.close();
  expect(closed.ok).toBe(true);
  expect(closeAttempts).toBe(2);
  expect(await session.status()).toMatchObject({ cleanup_pending: false });
});

it("cancels a resource switch during prior-client retirement and closes its candidate", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "rea-resource-cancel-switch-"));
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");

  let closeStarted!: () => void;
  const closing = new Promise<void>((resolve) => {
    closeStarted = resolve;
  });
  let releaseClose!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  let created = 0;
  let candidateCloseCalls = 0;
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
    {
      createClient: () => {
        created += 1;
        const candidate = created > 1;
        return {
          client: {
            execute: async () => ({
              ok: true,
              value: createAnalysisExecution(null, identity),
            }),
            close: async () => {
              if (candidate) candidateCloseCalls += 1;
              else {
                closeStarted();
                await closeGate;
              }
              return { ok: true, value: null };
            },
          },
          capabilities: [],
        };
      },
    },
  );

  expect((await session.openBundleResources(rootPath)).ok).toBe(true);
  const controller = new AbortController();
  const reason = { phase: "prior-resource-retirement" };
  const opening = session.openBundleResources(rootPath, {
    signal: controller.signal,
  });
  await Promise.race([
    closing,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("prior resource client close did not start")),
        1_000,
      ),
    ),
  ]);
  controller.abort(reason);
  releaseClose();

  const result = await opening;
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  if (!result.ok) expect(result.error.cause).toBe(reason);
  expect(candidateCloseCalls).toBe(1);
  expect(await session.status()).toMatchObject({ open: false });
  expect(await session.close()).toMatchObject({ ok: true });
});

it.each([false, true])(
  "keeps cancellation primary through resource retirement retry (live cleanup: %s)",
  async (liveCleanup) => {
    const rootPath = await mkdtemp(
      join(tmpdir(), "rea-resource-cancel-close-failure-"),
    );
    temporaryDirectories.push(rootPath);
    await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
    let closeStarted!: () => void;
    const closing = new Promise<void>((resolve) => {
      closeStarted = resolve;
    });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let created = 0;
    let oldCloseAttempts = 0;
    const cleanupFailure = liveCleanup
      ? new ProviderCleanupError(identity.id, ["previous-reader"], {
          reason: "previous reader remains open",
        })
      : new ProviderAdapterError(identity.id, "close_binary");
    let candidateCloseAttempts = 0;
    const session = new BinarySession(
      SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
      new InvestigationRecords(),
      {
        createClient: () => {
          created += 1;
          const candidate = created > 1;
          return {
            client: {
              execute: async () => ({
                ok: true,
                value: createAnalysisExecution(null, identity),
              }),
              close: async () => {
                if (candidate) {
                  candidateCloseAttempts += 1;
                  return { ok: true, value: null };
                }
                oldCloseAttempts += 1;
                if (oldCloseAttempts === 1) {
                  closeStarted();
                  await closeGate;
                }
                if (oldCloseAttempts < 3) return err(cleanupFailure);
                if (liveCleanup) cleanupFailure.resolveCleanup();
                return { ok: true, value: null };
              },
            },
            capabilities: [],
          };
        },
      },
    );

    expect((await session.openBundleResources(rootPath)).ok).toBe(true);
    const controller = new AbortController();
    const reason = { phase: "resource-close-failed" };
    const opening = session.openBundleResources(rootPath, {
      signal: controller.signal,
    });
    await Promise.race([
      closing,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("resource close did not start")),
          1_000,
        ),
      ),
    ]);
    controller.abort(reason);
    releaseClose();

    const result = await opening;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failed resource switch");
    expect(result.error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cleanupPrimary?.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(candidateCloseAttempts).toBe(1);
    expect(oldCloseAttempts).toBe(2);
    expect(await session.status()).toMatchObject({
      open: false,
      cleanup_pending: true,
    });
    expect(await session.close()).toMatchObject({ ok: true });
    expect(oldCloseAttempts).toBe(3);
    expect(result.error.cleanupIncomplete).toBe(!liveCleanup);
    if (liveCleanup) expect(result.error.cleanupResources).toEqual([]);
    expect(result.error.cleanupPrimary?.cause).toBe(reason);
  },
);

it("keeps an earlier resource close failure primary when a later cleanup is cancelled", async () => {
  const rootPath = await mkdtemp(
    join(tmpdir(), "rea-resource-close-before-cancel-"),
  );
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
  let candidateCloseStarted!: () => void;
  const candidateClosing = new Promise<void>((resolve) => {
    candidateCloseStarted = resolve;
  });
  let releaseCandidateClose!: () => void;
  const candidateCloseGate = new Promise<void>((resolve) => {
    releaseCandidateClose = resolve;
  });
  let created = 0;
  let oldCloseAttempts = 0;
  const originalFailure = new ProviderAdapterError(identity.id, "close_binary");
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
    {
      createClient: () => {
        created += 1;
        const candidate = created > 1;
        return {
          client: {
            execute: async () => ({
              ok: true,
              value: createAnalysisExecution(null, identity),
            }),
            close: async () => {
              if (candidate) {
                candidateCloseStarted();
                await candidateCloseGate;
                return { ok: true, value: null };
              }
              oldCloseAttempts += 1;
              return oldCloseAttempts === 1
                ? err(originalFailure)
                : { ok: true, value: null };
            },
          },
          capabilities: [],
        };
      },
    },
  );

  expect((await session.openBundleResources(rootPath)).ok).toBe(true);
  const controller = new AbortController();
  const reason = { phase: "after-physical-close-failure" };
  const opening = session.openBundleResources(rootPath, {
    signal: controller.signal,
  });
  await Promise.race([
    candidateClosing,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("candidate close did not start")),
        1_000,
      ),
    ),
  ]);
  controller.abort(reason);
  releaseCandidateClose();

  const result = await opening;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed resource switch");
  expect(result.error).toBe(originalFailure);
  expect(result.error.cleanupPrimary).toBeUndefined();
  expect(oldCloseAttempts).toBe(2);
  expect(await session.close()).toMatchObject({ ok: true });
});

it("keeps cancellation primary when binary retirement fails before opening resources", async () => {
  const rootPath = await mkdtemp(
    join(tmpdir(), "rea-binary-close-cancel-resource-"),
  );
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
  let closeStarted!: () => void;
  const closing = new Promise<void>((resolve) => {
    closeStarted = resolve;
  });
  let releaseClose!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  let binaryCloseAttempts = 0;
  let resourceCloseAttempts = 0;
  const binaryClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health" ? null : "fixture-name",
        binaryIdentity,
      ),
    }),
    close: async () => {
      binaryCloseAttempts += 1;
      if (binaryCloseAttempts === 1) {
        closeStarted();
        await closeGate;
        return err(new ProviderAdapterError(binaryIdentity.id, "close_binary"));
      }
      return { ok: true, value: null };
    },
  };
  const resourceClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health" ? null : { operation, target_sha256: null },
        identity,
        { subject: null },
      ),
    }),
    close: async () => {
      resourceCloseAttempts += 1;
      return { ok: true, value: null };
    },
  };
  const session = new BinarySession(
    createTestProviderRouter(() => binaryClient, {
      resolveAnalysisProfile: async () =>
        ok({
          profile: createAnalysisProfile(
            { ...binaryIdentity, version: binaryIdentity.version ?? "1" },
            { fixture: true },
          ),
        }),
    }),
    new InvestigationRecords(),
    {
      createClient: () => ({ client: resourceClient, capabilities: [] }),
    },
  );
  expect((await session.open(process.execPath)).ok).toBe(true);
  expect((await session.execute("address_name", {})).ok).toBe(true);

  const controller = new AbortController();
  const reason = { phase: "binary-retirement" };
  const opening = session.openBundleResources(rootPath, {
    signal: controller.signal,
  });
  await Promise.race([
    closing,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("binary close did not start")), 1_000),
    ),
  ]);
  controller.abort(reason);
  releaseClose();

  const result = await opening;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed resource open");
  expect(result.error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cleanupPrimary?.cause).toBe(reason);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(resourceCloseAttempts).toBe(1);
  expect(await session.status()).toMatchObject({
    open: false,
    cleanup_pending: true,
  });
  expect(await session.close()).toMatchObject({ ok: true });
  expect(binaryCloseAttempts).toBe(2);
});

it("keeps an earlier resource close failure primary when binary candidate cleanup is cancelled", async () => {
  const rootPath = await mkdtemp(
    join(tmpdir(), "rea-resource-close-before-binary-cancel-"),
  );
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
  let candidateCloseStarted!: () => void;
  const candidateClosing = new Promise<void>((resolve) => {
    candidateCloseStarted = resolve;
  });
  let releaseCandidateClose!: () => void;
  const candidateCloseGate = new Promise<void>((resolve) => {
    releaseCandidateClose = resolve;
  });
  let resourceCloseAttempts = 0;
  let binaryCloseAttempts = 0;
  const originalFailure = new ProviderAdapterError(identity.id, "close_binary");
  const resourceClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health" ? null : { operation, target_sha256: null },
        identity,
        { subject: null },
      ),
    }),
    close: async () => {
      resourceCloseAttempts += 1;
      return resourceCloseAttempts === 1
        ? err(originalFailure)
        : { ok: true, value: null };
    },
  };
  const binaryClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health" ? null : "fixture-name",
        binaryIdentity,
      ),
    }),
    close: async () => {
      binaryCloseAttempts += 1;
      if (binaryCloseAttempts === 1) {
        candidateCloseStarted();
        await candidateCloseGate;
      }
      return { ok: true, value: null };
    },
  };
  const router = createTestProviderRouter(() => binaryClient);
  const route = router.initialRoute();
  const parsedTarget = await parseBinaryTarget(process.execPath);
  if (!parsedTarget.ok) throw parsedTarget.error;
  const session = new BinarySession(router, new InvestigationRecords(), {
    createClient: () => ({ client: resourceClient, capabilities: [] }),
  });
  expect((await session.openBundleResources(rootPath)).ok).toBe(true);

  const controller = new AbortController();
  const reason = { phase: "after-resource-close-failure" };
  const opening = session.openResolvedTarget(
    { target: parsedTarget.value, route },
    { signal: controller.signal },
  );
  await Promise.race([
    candidateClosing,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("binary candidate close did not start")),
        1_000,
      ),
    ),
  ]);
  controller.abort(reason);
  releaseCandidateClose();

  const result = await opening;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed binary open");
  expect(result.error).toBe(originalFailure);
  expect(result.error.cleanupPrimary).toBeUndefined();
  expect(binaryCloseAttempts).toBe(1);
  expect(resourceCloseAttempts).toBe(1);
  expect(await session.close()).toMatchObject({ ok: true });
  expect(resourceCloseAttempts).toBe(2);
});

it("keeps an earlier binary close failure primary when candidate cleanup is cancelled", async () => {
  const rootPath = await mkdtemp(
    join(tmpdir(), "rea-binary-close-before-cancel-"),
  );
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
  let candidateCloseStarted!: () => void;
  const candidateClosing = new Promise<void>((resolve) => {
    candidateCloseStarted = resolve;
  });
  let releaseCandidateClose!: () => void;
  const candidateCloseGate = new Promise<void>((resolve) => {
    releaseCandidateClose = resolve;
  });
  let binaryCloseAttempts = 0;
  let resourceCloseAttempts = 0;
  const originalFailure = new ProviderAdapterError(
    binaryIdentity.id,
    "close_binary",
  );
  const binaryClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health" ? null : "fixture-name",
        binaryIdentity,
      ),
    }),
    close: async () => {
      binaryCloseAttempts += 1;
      return binaryCloseAttempts === 1
        ? err(originalFailure)
        : { ok: true, value: null };
    },
  };
  const resourceClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health" ? null : { operation, target_sha256: null },
        identity,
        { subject: null },
      ),
    }),
    close: async () => {
      resourceCloseAttempts += 1;
      if (resourceCloseAttempts === 1) {
        candidateCloseStarted();
        await candidateCloseGate;
      }
      return { ok: true, value: null };
    },
  };
  const session = new BinarySession(
    createTestProviderRouter(() => binaryClient, {
      resolveAnalysisProfile: async () =>
        ok({
          profile: createAnalysisProfile(
            { ...binaryIdentity, version: binaryIdentity.version ?? "1" },
            { fixture: true },
          ),
        }),
    }),
    new InvestigationRecords(),
    {
      createClient: () => ({ client: resourceClient, capabilities: [] }),
    },
  );
  expect((await session.open(process.execPath)).ok).toBe(true);
  expect((await session.execute("address_name", {})).ok).toBe(true);

  const controller = new AbortController();
  const reason = { phase: "after-binary-close-failure" };
  const opening = session.openBundleResources(rootPath, {
    signal: controller.signal,
  });
  await Promise.race([
    candidateClosing,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("resource candidate close did not start")),
        1_000,
      ),
    ),
  ]);
  controller.abort(reason);
  releaseCandidateClose();

  const result = await opening;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed resource open");
  expect(result.error).toBe(originalFailure);
  expect(result.error.cleanupPrimary).toBeUndefined();
  expect(binaryCloseAttempts).toBe(1);
  expect(resourceCloseAttempts).toBe(1);
  expect(await session.close()).toMatchObject({ ok: true });
  expect(binaryCloseAttempts).toBe(2);
});

it("cancels a binary switch during resource retirement and retains null-subject Evidence", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "rea-resource-cancel-binary-"));
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
  let resourceCloseStarted!: () => void;
  const closing = new Promise<void>((resolve) => {
    resourceCloseStarted = resolve;
  });
  let releaseResourceClose!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    releaseResourceClose = resolve;
  });
  let resourceCloseAttempts = 0;
  const binaryClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health"
          ? null
          : { document: "fixture", procedure_count: 0, string_count: 0 },
        binaryIdentity,
      ),
    }),
    close: async () => ({ ok: true, value: null }),
  };
  const resourceClient: AnalysisClient = {
    execute: async (operation) => ({
      ok: true,
      value: createAnalysisExecution(
        operation === "health" ? null : { operation, target_sha256: null },
        identity,
        { subject: null },
      ),
    }),
    close: async () => {
      resourceCloseAttempts += 1;
      resourceCloseStarted();
      if (resourceCloseAttempts === 1) {
        await closeGate;
        return err(new ProviderAdapterError(identity.id, "close_binary"));
      }
      return { ok: true, value: null };
    },
  };
  const session = new BinarySession(
    createTestProviderRouter(() => binaryClient, {
      resolveAnalysisProfile: async () =>
        ok({
          profile: createAnalysisProfile(
            { ...binaryIdentity, version: binaryIdentity.version ?? "1" },
            { fixture: true },
          ),
        }),
    }),
    new InvestigationRecords(),
    {
      createClient: () => ({ client: resourceClient, capabilities: [] }),
    },
  );
  expect((await session.openBundleResources(rootPath)).ok).toBe(true);
  const observed = await session.execute("inspect_plist", {});
  expect(observed.ok).toBe(true);
  if (!observed.ok) throw observed.error;
  const recorded = session.recordEvidence(
    createEvidence(undefined, identity, {
      operation: "inspect_plist",
      parameters: {},
      result: observed.value.result,
    }),
  );
  expect(recorded.ok).toBe(true);
  const recordsBefore = session.exportEvidenceBundle().records;
  expect(recordsBefore).toHaveLength(1);
  const evidenceId = recordsBefore[0]?.evidence_id;
  if (evidenceId === undefined) throw new Error("Expected retained Evidence");

  const controller = new AbortController();
  const reason = { phase: "resource-retirement" };
  const opening = session.open(process.execPath, { signal: controller.signal });
  await Promise.race([
    closing,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("resource client close did not start")),
        1_000,
      ),
    ),
  ]);
  controller.abort(reason);
  releaseResourceClose();

  const result = await opening;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancelled binary open");
  expect(result.error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cleanupPrimary?.cause).toBe(reason);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(await session.status()).toMatchObject({ open: false });
  expect(session.exportEvidenceBundle().records).toHaveLength(1);
  expect(session.evidenceById(evidenceId)).toMatchObject({ subject: null });
  expect(await session.status()).toMatchObject({ cleanup_pending: true });
  expect(await session.close()).toMatchObject({ ok: true });
  expect(resourceCloseAttempts).toBe(2);
});

it("tracks independent pending resource owners after a failed session replacement", async () => {
  const rootPath = await mkdtemp(
    join(tmpdir(), "rea-resource-pending-owners-"),
  );
  temporaryDirectories.push(rootPath);
  await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
  const failures = [
    new ProviderCleanupError(identity.id, ["previous-reader"], {}),
    new ProviderCleanupError(identity.id, ["candidate-reader"], {}),
  ];
  const released = [false, false];
  let created = 0;
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
    {
      createClient: () => {
        const index = created++;
        const failure = failures[index];
        if (failure === undefined)
          throw new Error("Unexpected resource client");
        return {
          capabilities: [],
          client: {
            execute: async () => ok(createAnalysisExecution(null, identity)),
            close: async () => {
              if (!released[index]) return err(failure);
              failure.resolveCleanup();
              return ok(null);
            },
          },
        };
      },
    },
  );
  expect(await session.openBundleResources(rootPath)).toMatchObject({
    ok: true,
  });
  const replacement = await session.openBundleResources(rootPath);
  if (replacement.ok) throw new Error("Expected failed resource replacement");
  expect(new Set(replacement.error.cleanupResources)).toEqual(
    new Set(["previous-reader", "candidate-reader"]),
  );
  const first = await session.close();
  if (first.ok)
    throw new Error("Expected both resource owners to remain pending");
  expect(new Set(first.error.cleanupResources)).toEqual(
    new Set(["previous-reader", "candidate-reader"]),
  );

  released[0] = true;
  expect(await session.close()).toMatchObject({ ok: false });
  expect(first.error.cleanupIncomplete).toBe(true);
  expect(first.error.cleanupResources).toEqual(["candidate-reader"]);
  expect(replacement.error.cleanupIncomplete).toBe(true);
  expect(replacement.error.cleanupResources).toEqual(["candidate-reader"]);

  released[1] = true;
  expect(await session.close()).toMatchObject({ ok: true });
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(first.error.cleanupResources).toEqual([]);
  expect(replacement.error.cleanupIncomplete).toBe(false);
  expect(replacement.error.cleanupResources).toEqual([]);
  expect(await session.status()).toMatchObject({ cleanup_pending: false });
});

it.each([false, true])(
  "retains failed-open primary through cleanup retry (live cleanup: %s)",
  async (liveCleanup) => {
    const primary = new ProviderAdapterError(binaryIdentity.id, "health", {
      userMessage: "candidate health failed",
    });
    const cleanup = liveCleanup
      ? new ProviderCleanupError(
          binaryIdentity.id,
          ["candidate-reader"],
          {},
          {
            cleanup: {
              reason: "candidate reader remains open",
              resources: ["candidate-reader"],
            },
          },
        )
      : new ProviderAdapterError(binaryIdentity.id, "close_binary");
    let attempts = 0;
    const session = new BinarySession(
      createTestProviderRouter(() => ({
        execute: async () => err(primary),
        close: async () => {
          attempts += 1;
          if (attempts === 1) return err(cleanup);
          if (liveCleanup) cleanup.resolveCleanup();
          return ok(null);
        },
      })),
      new InvestigationRecords(),
    );
    const opened = await session.open(process.execPath);
    if (opened.ok) throw new Error("Expected failed candidate health");
    expect(opened.error.cleanupPrimary).toBe(primary);
    expect(opened.error.cleanupIncomplete).toBe(true);
    if (liveCleanup)
      expect(opened.error.cleanup?.reason).toBe(
        "candidate reader remains open",
      );
    expect(await session.close()).toMatchObject({ ok: true });
    expect(attempts).toBe(2);
    expect(opened.error.cleanupIncomplete).toBe(!liveCleanup);
    if (liveCleanup) expect(opened.error.cleanupResources).toEqual([]);
    expect(opened.error.cleanupPrimary).toBe(primary);
  },
);

it.each([0, 1])(
  "retains unknown cleanup completion alongside a retryable owner (unknown owner: %s)",
  async (unknownOwner) => {
    const rootPath = await mkdtemp(
      join(tmpdir(), "rea-resource-mixed-cleanup-"),
    );
    temporaryDirectories.push(rootPath);
    await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
    const ownedFailure = new ProviderCleanupError(
      identity.id,
      ["owned-reader"],
      {},
    );
    const unknownFailure = new ProviderAdapterError(
      identity.id,
      "close_binary",
      {
        userMessage: "cleanup completion unknown",
      },
    );
    let created = 0;
    let released = false;
    const session = new BinarySession(
      SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
      new InvestigationRecords(),
      {
        createClient: () => {
          const owner = created++;
          return {
            capabilities: [],
            client: {
              execute: async () => ok(createAnalysisExecution(null, identity)),
              close: async () => {
                if (!released)
                  return err(
                    owner === unknownOwner ? unknownFailure : ownedFailure,
                  );
                if (owner !== unknownOwner) ownedFailure.resolveCleanup();
                return ok(null);
              },
            },
          };
        },
      },
    );
    expect(await session.openBundleResources(rootPath)).toMatchObject({
      ok: true,
    });
    const replacement = await session.openBundleResources(rootPath);
    if (replacement.ok) throw new Error("Expected failed resource replacement");
    expect(replacement.error.cleanupIncomplete).toBe(true);
    released = true;
    expect(await session.close()).toMatchObject({ ok: true });
    expect(ownedFailure.cleanupIncomplete).toBe(false);
    expect(replacement.error.cleanupIncomplete).toBe(true);
    expect(await session.status()).toMatchObject({ cleanup_pending: false });
  },
);

it.each([
  ["binary", "client"],
  ["binary", "files"],
  ["bundle", "client"],
  ["bundle", "files"],
] as const)(
  "keeps unknown %s close completion when the %s owner has no cleanup signal",
  async (targetKind, unknownOwner) => {
    const tracked = new ProviderCleanupError(identity.id, ["owned-reader"], {});
    const unknown = new ProviderAdapterError(identity.id, "close_binary", {
      userMessage: "cleanup completion unknown",
    });
    let released = false;
    let failCleanup = false;
    const closeOwner = async (owner: "client" | "files") => {
      if (!failCleanup) return ok(null);
      if (!released) return err(owner === unknownOwner ? unknown : tracked);
      if (owner !== unknownOwner) tracked.resolveCleanup();
      return ok(null);
    };
    const client: AnalysisClient = {
      execute: async () => ok(createAnalysisExecution(null, binaryIdentity)),
      close: () => closeOwner("client"),
    };
    // Exercise the public session close composition with independently owned
    // file cleanup; the file owner's failure shape is the regression boundary.
    class SessionWithFileCleanup extends BinarySession {
      override closeFileResources() {
        return closeOwner("files");
      }
    }
    const session = new SessionWithFileCleanup(
      createTestProviderRouter(() => client),
      new InvestigationRecords(),
      { createClient: () => ({ client, capabilities: [] }) },
    );
    if (targetKind === "binary") {
      expect(await session.open(process.execPath)).toMatchObject({ ok: true });
    } else {
      const rootPath = await mkdtemp(join(tmpdir(), "rea-resource-close-"));
      temporaryDirectories.push(rootPath);
      await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
      expect(await session.openBundleResources(rootPath)).toMatchObject({
        ok: true,
      });
    }
    failCleanup = true;
    const closed = await session.close();
    if (closed.ok) throw new Error("Expected incomplete close");
    expect(closed.error.cleanupIncomplete).toBe(true);
    released = true;
    expect(await session.close()).toMatchObject({ ok: true });
    expect(tracked.cleanupIncomplete).toBe(false);
    expect(closed.error.cleanupIncomplete).toBe(true);
    expect(await session.status()).toMatchObject({ cleanup_pending: false });
  },
);

it.each(["health", "cancellation"] as const)(
  "updates early resource-open %s cleanup after its candidate retries",
  async (failureStage) => {
    const rootPath = await mkdtemp(
      join(tmpdir(), "rea-resource-early-cleanup-"),
    );
    temporaryDirectories.push(rootPath);
    await writeFile(join(rootPath, "Info.plist"), "<plist><dict/></plist>");
    const primary = new ProviderAdapterError(identity.id, "health");
    const cleanup = new ProviderCleanupError(
      identity.id,
      ["candidate-reader"],
      {},
    );
    const controller = new AbortController();
    const reason = { stage: "candidate-health" };
    let closeAttempts = 0;
    const session = new BinarySession(
      SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
      new InvestigationRecords(),
      {
        createClient: () => ({
          capabilities: [],
          client: {
            execute: async () => {
              if (failureStage === "health") return err(primary);
              controller.abort(reason);
              return ok(createAnalysisExecution(null, identity));
            },
            close: async () => {
              if (++closeAttempts === 1) return err(cleanup);
              cleanup.resolveCleanup();
              return ok(null);
            },
          },
        }),
      },
    );
    const opened = await session.openBundleResources(rootPath, {
      signal: controller.signal,
    });
    if (opened.ok) throw new Error("Expected early resource open failure");
    expect(opened.error.cleanupIncomplete).toBe(true);
    if (failureStage === "health")
      expect(opened.error.cleanupPrimary).toBe(primary);
    else {
      expect(opened.error.cleanupPrimary).toBeInstanceOf(
        AnalysisCancelledError,
      );
      expect(opened.error.cleanupPrimary?.cause).toBe(reason);
    }
    expect(await session.close()).toMatchObject({ ok: true });
    expect(closeAttempts).toBe(2);
    expect(opened.error.cleanupIncomplete).toBe(false);
    expect(opened.error.cleanupResources).toEqual([]);
  },
);
