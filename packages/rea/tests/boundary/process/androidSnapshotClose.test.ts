import { createHash } from "node:crypto";
import { type FileHandle, readFile, stat } from "node:fs/promises";
import { sep } from "node:path";

import { expect, test, vi } from "vitest";

import { captureJadxFailure } from "../../../src/android/JadxFailure.js";
import type { AndroidRequest } from "../../../src/domain/android/androidAnalysis.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import {
  RegularFileCancelled,
  RegularFileCleanupFailure,
} from "../../../src/filesystem/OwnedRegularFile.js";
import {
  createJadxProtocolFixture,
  verifyJadxFixtureCleanup,
} from "../../fixtures/android/jadx.js";

const state = vi.hoisted(() => ({
  enabled: false,
  change: false,
  fail: false,
  failSource: false,
  failAdmission: false,
  source: "",
  closeCalls: 0,
  sourceCloseCalls: 0,
  opens: 0,
  sourceOpens: 0,
  handles: [] as { handle: FileHandle; close: () => Promise<void> }[],
  sourceHandles: [] as { handle: FileHandle; close: () => Promise<void> }[],
  latestSource: undefined as
    | {
        handle: FileHandle;
        close: () => Promise<void>;
        snapshot: boolean;
      }
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const path = String(args[0]);
      if (
        state.enabled &&
        path === state.source &&
        typeof args[1] === "number"
      ) {
        state.sourceOpens += 1;
        const close = handle.close.bind(handle);
        const record = {
          handle,
          close,
          snapshot: false,
          admit: state.failAdmission && state.sourceOpens > 1,
        };
        state.latestSource = record;
        state.sourceHandles.push(record);
        if (record.admit) {
          handle.stat = async () => {
            throw Object.assign(new Error("controlled admission stat EIO"), {
              code: "EIO",
            });
          };
        }
        handle.close = async () => {
          state.sourceCloseCalls += 1;
          // Only the descriptor still open when the snapshot destination is
          // created belongs to the copy. Later admission reads must close.
          if (record.admit && state.failAdmission)
            throw Object.assign(new Error("controlled admission close EIO"), {
              code: "EIO",
            });
          if (record.snapshot && state.failSource)
            throw Object.assign(new Error("controlled source close EIO"), {
              code: "EIO",
            });
          return close();
        };
      }
      if (
        state.enabled &&
        path.endsWith(`${sep}target.apk`) &&
        args[1] === "wx"
      ) {
        state.opens += 1;
        if (
          state.latestSource !== undefined &&
          state.latestSource.handle.fd >= 0
        )
          state.latestSource.snapshot = true;
        if (state.change) await actual.appendFile(state.source, "changed");
        const close = handle.close.bind(handle);
        state.handles.push({ handle, close });
        handle.close = async () => {
          state.closeCalls += 1;
          if (state.fail)
            throw Object.assign(new Error("controlled snapshot close EIO"), {
              code: "EIO",
            });
          return close();
        };
      }
      return handle;
    },
  };
});

const snapshotResource = (resources: readonly string[]): string | undefined =>
  resources.find((resource) => resource.endsWith(`${sep}target.apk`));

test("keeps the stable-file diagnosis when snapshot close succeeds", async () => {
  const fixture = await createJadxProtocolFixture();
  state.source = fixture.apk;
  state.change = true;
  state.fail = false;
  state.failSource = false;
  state.enabled = true;
  state.closeCalls = 0;
  state.sourceCloseCalls = 0;
  state.opens = 0;
  state.sourceOpens = 0;
  state.handles = [];
  state.sourceHandles = [];
  state.latestSource = undefined;
  try {
    const result = await fixture.service.execute("inspect_android_package", {
      path: fixture.apk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error).code).toBe("invalid_request");
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    expect(result.error.cause?.constructor.name).toBe(
      "AndroidSnapshotChangedError",
    );
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(state.handles[0]?.handle.fd).toBe(-1);
    expect(fixture.launches).toHaveLength(0);
    await fixture.provider.close();
  } finally {
    state.enabled = false;
    state.fail = false;
    await fixture.provider.close().catch(() => undefined);
    await verifyJadxFixtureCleanup(fixture.launches);
  }
});

for (const mode of [
  "changed-close-failure",
  "completed-close-failure",
] as const)
  test(`retains the destination descriptor when snapshot close fails (${mode})`, async () => {
    const fixture = await createJadxProtocolFixture();
    const sourceBytes = await readFile(fixture.apk);
    const sha256 = createHash("sha256").update(sourceBytes).digest("hex");
    state.source = fixture.apk;
    state.change = mode === "changed-close-failure";
    state.fail = true;
    state.failSource = false;
    state.enabled = true;
    state.closeCalls = 0;
    state.sourceCloseCalls = 0;
    state.opens = 0;
    state.sourceOpens = 0;
    state.handles = [];
    state.sourceHandles = [];
    state.latestSource = undefined;
    try {
      const result = await fixture.service.execute("inspect_android_package", {
        path: fixture.apk,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(projectAnalysisError(result.error).code).toBe(
        "cleanup_incomplete",
      );
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(JSON.stringify(projectAnalysisError(result.error))).toContain(
        "controlled snapshot close EIO",
      );
      const owned = state.handles[0];
      if (owned === undefined)
        throw new Error("missing destination descriptor");
      expect(owned.handle.fd).toBeGreaterThanOrEqual(0);
      expect(state.opens).toBe(1);
      expect(fixture.launches).toHaveLength(0);
      const snapshot = snapshotResource(result.error.cleanupResources);
      expect(snapshot).toBeDefined();
      const workspace = snapshot?.slice(0, -`${sep}target.apk`.length);
      if (workspace === undefined)
        throw new Error("missing snapshot workspace");
      await expect(stat(workspace)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      if (mode === "changed-close-failure") {
        expect(result.error.cleanupPrimary?.cleanupPrimary).toBeInstanceOf(
          AnalysisInputError,
        );
        expect(
          result.error.cleanupPrimary?.cleanupPrimary?.cause?.constructor.name,
        ).toBe("AndroidSnapshotChangedError");
        expect(
          projectAnalysisError(
            result.error.cleanupPrimary?.cleanupPrimary ?? result.error,
          ).code,
        ).toBe("invalid_request");
      } else {
        expect(result.error.cleanupPrimary).toBeInstanceOf(
          ProviderCleanupError,
        );
        expect(result.error.cleanupPrimary?.diagnostics).toMatchObject({
          snapshot_copy: "completed",
          snapshot_sha256: sha256,
          snapshot_bytes: sourceBytes.length,
          reason: "controlled snapshot close EIO",
        });
        expect(result.error.partialObservation).toMatchObject({
          kind: "file-snapshot-hash",
          sha256,
          bytes: sourceBytes.length,
        });
      }

      const opens = state.opens;
      const closeCalls = state.closeCalls;
      const blocked = await fixture.service.execute("inspect_android_package", {
        path: fixture.apk,
      });
      expect(blocked.ok).toBe(false);
      if (blocked.ok) return;
      expect(blocked.error.cleanupIncomplete).toBe(true);
      expect(state.opens).toBe(opens);
      expect(state.closeCalls).toBeGreaterThan(closeCalls);
      expect(owned.handle.fd).toBeGreaterThanOrEqual(0);
      await expect(stat(workspace)).resolves.toBeTruthy();

      const closeCallsBeforeShutdown = state.closeCalls;
      await expect(fixture.provider.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
      expect(state.closeCalls).toBeGreaterThan(closeCallsBeforeShutdown);
      expect(owned.handle.fd).toBeGreaterThanOrEqual(0);
      expect(result.error.cleanupIncomplete).toBe(true);
      await expect(stat(workspace)).resolves.toBeTruthy();

      state.fail = false;
      await fixture.provider.close();
      expect(owned.handle.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(blocked.error.cleanupIncomplete).toBe(false);
      await expect(stat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      state.enabled = false;
      state.fail = false;
      await fixture.provider.close().catch(() => undefined);
      for (const owned of [...state.handles, ...state.sourceHandles])
        if (owned.handle.fd >= 0) await owned.close().catch(() => undefined);
      await verifyJadxFixtureCleanup(fixture.launches);
    }
  });

for (const mode of ["source-close-failure", "both-close-failure"] as const)
  test(`attributes a finished copy to the descriptor that rejected close (${mode})`, async () => {
    const fixture = await createJadxProtocolFixture();
    const sourceBytes = await readFile(fixture.apk);
    const sha256 = createHash("sha256").update(sourceBytes).digest("hex");
    state.source = fixture.apk;
    state.change = false;
    state.fail = mode === "both-close-failure";
    state.failSource = true;
    state.enabled = true;
    state.closeCalls = 0;
    state.sourceCloseCalls = 0;
    state.opens = 0;
    state.sourceOpens = 0;
    state.handles = [];
    state.sourceHandles = [];
    state.latestSource = undefined;
    try {
      const result = await fixture.service.execute("inspect_android_package", {
        path: fixture.apk,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(projectAnalysisError(result.error).code).toBe(
        "cleanup_incomplete",
      );
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupPrimary).toBeInstanceOf(ProviderCleanupError);
      expect(result.error.cleanupPrimary?.diagnostics).toMatchObject({
        snapshot_copy: "completed",
        source_path: fixture.apk,
        snapshot_sha256: sha256,
        snapshot_bytes: sourceBytes.length,
      });
      expect(result.error.partialObservation).toMatchObject({
        kind: "file-snapshot-hash",
        sha256,
        bytes: sourceBytes.length,
      });
      const observation = result.error.partialObservation;
      if (
        observation === undefined ||
        !("path" in observation) ||
        typeof observation.path !== "string"
      )
        throw new Error("missing snapshot observation");
      const snapshotPath = observation.path;
      expect(snapshotPath).toContain(`${sep}target.apk`);
      const ownedPaths = [fixture.apk];
      if (mode === "both-close-failure" && snapshotPath !== undefined)
        ownedPaths.push(snapshotPath);
      expect(result.error.cleanupPrimary?.cleanupResources).toEqual(ownedPaths);
      expect(result.error.diagnostics).toMatchObject({
        primary_error: {
          details: {
            resources: ownedPaths,
            diagnostics: {
              snapshot_copy: "completed",
              snapshot_sha256: sha256,
              snapshot_bytes: sourceBytes.length,
            },
          },
        },
      });
      const source = state.sourceHandles.find(
        (candidate) => candidate.handle.fd >= 0,
      );
      if (source === undefined) throw new Error("missing source descriptor");
      expect(source.handle.fd).toBeGreaterThanOrEqual(0);
      expect(state.opens).toBe(1);
      const destination = state.handles[0];
      if (destination === undefined)
        throw new Error("missing destination descriptor");
      if (mode === "both-close-failure")
        expect(destination.handle.fd).toBeGreaterThanOrEqual(0);
      else expect(destination.handle.fd).toBe(-1);
      const workspace = snapshotPath?.slice(0, -`${sep}target.apk`.length);
      if (workspace === undefined)
        throw new Error("missing snapshot workspace");
      await expect(stat(workspace)).resolves.toBeTruthy();

      const opens = state.opens;
      const blocked = await fixture.service.execute("inspect_android_package", {
        path: fixture.apk,
      });
      expect(blocked.ok).toBe(false);
      if (blocked.ok) return;
      expect(blocked.error.cleanupIncomplete).toBe(true);
      expect(state.opens).toBe(opens);
      expect(source.handle.fd).toBeGreaterThanOrEqual(0);

      await expect(fixture.provider.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
      expect(source.handle.fd).toBeGreaterThanOrEqual(0);
      expect(result.error.cleanupIncomplete).toBe(true);

      state.fail = false;
      state.failSource = false;
      await fixture.provider.close();
      expect(source.handle.fd).toBe(-1);
      if (mode === "both-close-failure") expect(destination.handle.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(blocked.error.cleanupIncomplete).toBe(false);
      await expect(stat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      state.enabled = false;
      state.fail = false;
      state.failSource = false;
      await fixture.provider.close().catch(() => undefined);
      for (const owned of [...state.handles, ...state.sourceHandles])
        if (owned.handle.fd >= 0) await owned.close().catch(() => undefined);
      await verifyJadxFixtureCleanup(fixture.launches);
    }
  });

test("keeps the changed-file diagnosis when both snapshot closes fail", async () => {
  const fixture = await createJadxProtocolFixture();
  state.source = fixture.apk;
  state.change = true;
  state.fail = true;
  state.failSource = true;
  state.enabled = true;
  state.closeCalls = 0;
  state.sourceCloseCalls = 0;
  state.opens = 0;
  state.sourceOpens = 0;
  state.handles = [];
  state.sourceHandles = [];
  state.latestSource = undefined;
  try {
    const result = await fixture.service.execute("inspect_android_package", {
      path: fixture.apk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
    expect(result.error.cleanupPrimary?.cleanupPrimary).toBeInstanceOf(
      AnalysisInputError,
    );
    expect(
      result.error.cleanupPrimary?.cleanupPrimary?.cause?.constructor.name,
    ).toBe("AndroidSnapshotChangedError");
    const source = state.sourceHandles.find(
      (candidate) => candidate.handle.fd >= 0,
    );
    const destination = state.handles[0];
    if (source === undefined || destination === undefined)
      throw new Error("missing snapshot descriptors");
    expect(source.handle.fd).toBeGreaterThanOrEqual(0);
    expect(destination.handle.fd).toBeGreaterThanOrEqual(0);
    const resources = result.error.cleanupPrimary?.cleanupResources ?? [];
    expect(resources).toContain(fixture.apk);
    expect(snapshotResource(resources)).toBeDefined();
  } finally {
    state.enabled = false;
    state.fail = false;
    state.failSource = false;
    await fixture.provider.close().catch(() => undefined);
    for (const owned of [...state.handles, ...state.sourceHandles])
      if (owned.handle.fd >= 0) await owned.close().catch(() => undefined);
    await verifyJadxFixtureCleanup(fixture.launches);
  }
});

test("retains the source descriptor when snapshot admission cleanup fails", async () => {
  const fixture = await createJadxProtocolFixture();
  state.source = fixture.apk;
  state.change = false;
  state.fail = false;
  state.failSource = false;
  state.failAdmission = true;
  state.enabled = true;
  state.closeCalls = 0;
  state.sourceCloseCalls = 0;
  state.opens = 0;
  state.sourceOpens = 0;
  state.handles = [];
  state.sourceHandles = [];
  state.latestSource = undefined;
  try {
    const result = await fixture.service.execute("inspect_android_package", {
      path: fixture.apk,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(fixture.apk);
    expect(state.opens).toBe(0);
    const source = state.sourceHandles.find(
      (candidate) => candidate.handle.fd >= 0,
    );
    if (source === undefined) throw new Error("missing source descriptor");
    expect(source.handle.fd).toBeGreaterThanOrEqual(0);
    await expect(fixture.provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(source.handle.fd).toBeGreaterThanOrEqual(0);

    state.failAdmission = false;
    await fixture.provider.close();
    expect(source.handle.fd).toBe(-1);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    state.enabled = false;
    state.failAdmission = false;
    await fixture.provider.close().catch(() => undefined);
    for (const owned of [...state.handles, ...state.sourceHandles])
      if (owned.handle.fd >= 0) await owned.close().catch(() => undefined);
    await verifyJadxFixtureCleanup(fixture.launches);
  }
});

test("keeps the snapshot hash when a successful close is cancelled", () => {
  const reason = { requested: "snapshot-close" };
  const copy = {
    kind: "android-snapshot-copy" as const,
    sha256: "c".repeat(64),
    sourcePath: "/workspace/sample.apk",
    snapshotPath: "/workspace/snap/target.apk",
    bytes: 36,
  };
  const cancelled = new RegularFileCancelled(
    copy.snapshotPath,
    new OwnedFileHandle({
      fd: 7,
      close: async () => undefined,
    } as FileHandle),
    { outcome: { kind: "completed", value: copy }, reason },
  );
  const error = captureJadxFailure({
    cause: cancelled,
    request: {
      operation: "inspect_android_package",
      input: { path: copy.sourcePath },
    } as AndroidRequest,
    timeout: new AbortController().signal,
    timeoutMs: 1000,
    signal: AbortSignal.abort(reason),
    session: undefined,
  })();
  expect(error).toBeInstanceOf(AnalysisCancelledError);
  expect(error.cause).toBe(reason);
  expect(error.cleanupIncomplete).toBe(false);
  expect(error.partialObservation).toMatchObject({
    kind: "file-snapshot-hash",
    path: copy.snapshotPath,
    sha256: copy.sha256,
    bytes: copy.bytes,
  });
  expect(error.diagnostics).toMatchObject({
    snapshot_copy: "completed",
    source_path: copy.sourcePath,
    snapshot_sha256: copy.sha256,
    snapshot_bytes: copy.bytes,
  });
});

test("keeps the snapshot hash when cancellation wraps the finished copy", () => {
  const reason = { requested: "snapshot-close" };
  const copy = {
    kind: "android-snapshot-copy" as const,
    sha256: "b".repeat(64),
    sourcePath: "/workspace/sample.apk",
    snapshotPath: "/workspace/snap/target.apk",
    bytes: 24,
  };
  const destination = new RegularFileCancelled(
    copy.snapshotPath,
    new OwnedFileHandle({
      fd: 7,
      close: async () => undefined,
    } as FileHandle),
    { outcome: { kind: "completed", value: copy }, reason },
  );
  const source = new RegularFileCleanupFailure({
    path: copy.sourcePath,
    owner: new OwnedFileHandle({
      fd: 8,
      close: async () => undefined,
    } as FileHandle),
    outcome: { kind: "failed", cause: destination },
    cleanupCause: new Error("source EIO"),
  });
  const error = captureJadxFailure({
    cause: source,
    request: {
      operation: "inspect_android_package",
      input: { path: copy.sourcePath },
    } as AndroidRequest,
    timeout: new AbortController().signal,
    timeoutMs: 1000,
    signal: AbortSignal.abort(reason),
    session: undefined,
  })();
  expect(error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
  expect(error.cleanupPrimary?.cause).toBe(reason);
  expect(error.cleanupIncomplete).toBe(true);
  expect(error.cleanupResources).toEqual([copy.sourcePath]);
  expect(error.partialObservation).toMatchObject({
    kind: "file-snapshot-hash",
    path: copy.snapshotPath,
    sha256: copy.sha256,
    bytes: copy.bytes,
  });
});

test("classifies a nested snapshot close as cancellation", () => {
  const reason = { requested: "snapshot-close" };
  const copy = {
    kind: "android-snapshot-copy" as const,
    sha256: "a".repeat(64),
    sourcePath: "/workspace/sample.apk",
    snapshotPath: "/workspace/snap/target.apk",
    bytes: 12,
  };
  const destination = new RegularFileCleanupFailure({
    path: copy.snapshotPath,
    owner: new OwnedFileHandle({
      fd: 7,
      close: async () => undefined,
    } as FileHandle),
    outcome: { kind: "completed", value: copy },
    cleanupCause: new Error("dest EIO"),
    retention: { kind: "not_requested" },
    completionCancellation: { reason },
  });
  const source = new RegularFileCleanupFailure({
    path: copy.sourcePath,
    owner: new OwnedFileHandle({
      fd: 8,
      close: async () => undefined,
    } as FileHandle),
    outcome: { kind: "failed", cause: destination },
    cleanupCause: new Error("source EIO"),
  });
  const error = captureJadxFailure({
    cause: source,
    request: {
      operation: "inspect_android_package",
      input: { path: copy.sourcePath },
    } as AndroidRequest,
    timeout: new AbortController().signal,
    timeoutMs: 1000,
    signal: AbortSignal.abort(reason),
    session: undefined,
  })();
  expect(error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
  expect(error.cleanupIncomplete).toBe(true);
  expect(error.cleanupResources).toEqual([copy.sourcePath, copy.snapshotPath]);
  expect(error.partialObservation).toMatchObject({
    kind: "file-snapshot-hash",
    path: copy.snapshotPath,
    sha256: copy.sha256,
    bytes: copy.bytes,
  });
});
