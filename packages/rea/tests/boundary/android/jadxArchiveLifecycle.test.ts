import { inspectJadxProvider } from "../../../src/android/JadxDoctor.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { stat, writeFile } from "node:fs/promises";
import { expect, it as test, vi } from "vitest";
import { createJadxProtocolFixture } from "../../fixtures/android/jadx.js";
import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";

const it = test.skipIf(process.platform === "win32");

it.each(["valid", "malformed", "missing-classes"] as const)(
  "retains exact archive cleanup and its %s admission outcome through retry",
  async (inventory) => {
    const f = await createJadxProtocolFixture();
    if (inventory === "malformed") await writeFile(f.jar, "not a zip");
    if (inventory === "missing-classes")
      await writeOrderedZip(f.jar, ["unrelated/Library.class"]);
    const identity = await stat(f.jar);
    const original = OwnedFileHandle.prototype.close;
    const handles = new Set<OwnedFileHandle>();
    let allowClose = false;
    const closeFailure = new Error("injected archive descriptor close failure");
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        if (!handles.has(this) && this.handle.fd >= 0) {
          const observed = await this.handle.stat();
          if (observed.dev === identity.dev && observed.ino === identity.ino)
            handles.add(this);
        }
        if (handles.has(this) && !allowClose) throw closeFailure;
        await original.call(this);
      });
    try {
      const error: unknown = await f.provider
        .inspectAvailability()
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(AnalysisError);
      if (!(error instanceof AnalysisError))
        throw new Error("Expected retained archive cleanup");
      expect(error.cleanupIncomplete).toBe(true);
      expect(error.cleanupResources).toEqual([f.jar]);
      expect(handles.size).toBe(1);
      expect([...handles][0]?.handle.fd).toBeGreaterThanOrEqual(0);
      if (inventory === "valid") {
        expect(error.diagnostics).toMatchObject({
          archive_observation: { jar_path: f.jar, required_classes: true },
        });
      } else {
        expect(error.cleanupPrimary).toMatchObject({
          _tag: "AnalysisCapabilityUnavailableError",
          diagnostics: {
            failure_kind: "jar",
            failure_code:
              inventory === "malformed"
                ? "version_unresolved"
                : "unsupported_version",
          },
        });
      }
      const probes = await f.javaProbeCount();
      const refused: unknown = await f.provider
        .inspectAvailability()
        .catch((cause: unknown) => cause);
      expect(refused).toMatchObject({ cleanupIncomplete: true });
      expect(await f.javaProbeCount()).toBe(probes);
      const shutdown: unknown = await f.provider
        .close()
        .catch((cause: unknown) => cause);
      expect(shutdown).toMatchObject({ cleanupIncomplete: true });
      expect(f.launches).toEqual([]);
      allowClose = true;
      await f.provider.close();
      expect([...handles].every((owner) => owner.handle.fd === -1)).toBe(true);
      expect(error.cleanupIncomplete).toBe(false);
      expect(error.cleanupResources).toEqual([]);
      if (refused instanceof AnalysisError)
        expect(refused.cleanupIncomplete).toBe(false);
      if (shutdown instanceof AnalysisError)
        expect(shutdown.cleanupIncomplete).toBe(false);
    } finally {
      allowClose = true;
      close.mockRestore();
      await f.provider.close();
      for (const owner of handles) await original.call(owner);
    }
  },
);

it.each([
  { valid: true, failsClose: false },
  { valid: true, failsClose: true },
  { valid: false, failsClose: false },
  { valid: false, failsClose: true },
])(
  "owns late cancellation during archive close (%j)",
  async ({ valid, failsClose }) => {
    const f = await createJadxProtocolFixture();
    if (!valid) await writeOrderedZip(f.jar, ["unrelated.class"]);
    const caller = new AbortController();
    const reason = { caller: "during final archive close" };
    const identity = await stat(f.jar);
    const original = OwnedFileHandle.prototype.close;
    let owner: OwnedFileHandle | undefined;
    let allowClose = false;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        const observed = await this.handle.stat();
        if (observed.dev === identity.dev && observed.ino === identity.ino) {
          owner = this;
          caller.abort(reason);
          if (failsClose && !allowClose)
            throw new Error("injected close failure after cancellation");
        }
        await original.call(this);
      });
    try {
      const outcome: unknown = await f.provider
        .inspectAvailability(caller.signal)
        .catch((cause: unknown) => cause);
      expect(owner).toBeDefined();
      if (!failsClose && !valid) {
        expect(outcome).toMatchObject({
          status: "unavailable",
          code: "unsupported_version",
        });
      } else {
        expect(outcome).toBeInstanceOf(AnalysisError);
        if (!(outcome instanceof AnalysisError))
          throw new Error("Expected owned lifecycle outcome");
        const primary = failsClose ? outcome.cleanupPrimary : outcome;
        if (valid) {
          expect(primary).toMatchObject({ _tag: "AnalysisCancelledError" });
          expect(primary?.cause).toBe(reason);
          expect(primary?.diagnostics).toMatchObject({
            archive_observation: { required_classes: true },
          });
        } else {
          expect(primary).toMatchObject({
            _tag: "AnalysisCapabilityUnavailableError",
            diagnostics: { failure_code: "unsupported_version" },
          });
        }
        expect(outcome.cleanupIncomplete).toBe(failsClose);
        allowClose = true;
        await f.provider.close();
        expect(outcome.cleanupIncomplete).toBe(false);
      }
      expect(f.launches).toEqual([]);
      expect(owner?.handle.fd).toBe(-1);
    } finally {
      allowClose = true;
      close.mockRestore();
      await f.provider.close();
      if (owner !== undefined) await original.call(owner);
    }
  },
);

it("resolves mixed archive owners independently without reclosing a released peer", async () => {
  const f = await createJadxProtocolFixture();
  const identity = await stat(f.jar);
  const original = OwnedFileHandle.prototype.close;
  const handles: OwnedFileHandle[] = [];
  const attempts = new Map<OwnedFileHandle, number>();
  const allowed = new Set<OwnedFileHandle>();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const bothClosing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      if (!handles.includes(this) && this.handle.fd >= 0) {
        const observed = await this.handle.stat();
        if (observed.dev === identity.dev && observed.ino === identity.ino)
          handles.push(this);
      }
      if (handles.includes(this)) {
        attempts.set(this, (attempts.get(this) ?? 0) + 1);
        if (handles.length === 2) entered();
        await held;
        if (!allowed.has(this))
          throw new Error("injected concurrent archive close failure");
      }
      await original.call(this);
    });
  const first = f.provider
    .inspectAvailability()
    .catch((cause: unknown) => cause);
  const second = f.provider
    .inspectAvailability()
    .catch((cause: unknown) => cause);
  try {
    await bothClosing;
    release();
    const errors = await Promise.all([first, second]);
    expect(
      errors.every(
        (error) => error instanceof AnalysisError && error.cleanupIncomplete,
      ),
    ).toBe(true);
    const [released, pending] = handles;
    if (released === undefined || pending === undefined)
      throw new Error("Expected two exact archive owners");
    allowed.add(released);
    const aggregate: unknown = await f.provider
      .close()
      .catch((cause: unknown) => cause);
    expect(aggregate).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [f.jar],
    });
    expect(
      errors.filter(
        (error) => error instanceof AnalysisError && error.cleanupIncomplete,
      ),
    ).toHaveLength(1);
    expect(released.handle.fd).toBe(-1);
    expect(pending.handle.fd).toBeGreaterThanOrEqual(0);
    const releasedAttempts = attempts.get(released);
    allowed.add(pending);
    await f.provider.close();
    expect(attempts.get(released)).toBe(releasedAttempts);
    expect(
      errors.every(
        (error) => error instanceof AnalysisError && !error.cleanupIncomplete,
      ),
    ).toBe(true);
    if (!(aggregate instanceof AnalysisError))
      throw new Error("Expected retained aggregate cleanup");
    expect(aggregate.cleanupIncomplete).toBe(false);
    expect(aggregate.cleanupResources).toEqual([]);
    expect(f.launches).toEqual([]);
  } finally {
    release();
    close.mockRestore();
    await Promise.allSettled([first, second]);
    await f.provider.close();
    for (const owner of handles) await original.call(owner);
  }
});

it("joins independent doctor archive finalization and retries its exact failed close", async () => {
  const f = await createJadxProtocolFixture();
  const resources = createInspectionResources();
  const identity = await stat(f.jar);
  const original = OwnedFileHandle.prototype.close;
  let owner: OwnedFileHandle | undefined;
  let allowClose = false;
  let entered: () => void = () => {};
  const closing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      const observed = await this.handle.stat();
      if (observed.dev === identity.dev && observed.ino === identity.ino) {
        owner = this;
        entered();
        await held;
        if (!allowClose)
          throw new Error("injected independent doctor archive close failure");
      }
      await original.call(this);
    });
  const inspection = inspectJadxProvider(f.environment, resources.owner).catch(
    (cause: unknown) => cause,
  );
  let settled = false;
  let shutdown: Promise<unknown> | undefined;
  try {
    await closing;
    shutdown = resources.close().then(
      () => {
        settled = true;
      },
      (cause: unknown) => {
        settled = true;
        return cause;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    const error = await inspection;
    expect(error).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [f.jar],
    });
    expect(await shutdown).toMatchObject({ cleanup: { resources: [f.jar] } });
    expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
    allowClose = true;
    await resources.close();
    expect(owner?.handle.fd).toBe(-1);
    if (!(error instanceof AnalysisError))
      throw new Error("Expected owned doctor failure");
    expect(error.cleanupIncomplete).toBe(false);
    expect(error.cleanupResources).toEqual([]);
    expect(f.launches).toEqual([]);
  } finally {
    release();
    allowClose = true;
    close.mockRestore();
    await inspection;
    await shutdown;
    await resources.close();
    if (owner !== undefined) await original.call(owner);
  }
});
