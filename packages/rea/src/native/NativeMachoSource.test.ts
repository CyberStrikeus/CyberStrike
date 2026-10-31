import { createHash } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactFileCleanupFailure } from "../artifacts/ArtifactFileOperation.js";
import { withNativeMachoSource } from "./NativeMachoSource.js";

const control = vi.hoisted(() => ({ failClose: false, attempts: 0 }));
vi.mock("../filesystem/RegularFile.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../filesystem/RegularFile.js")>();
  return {
    ...actual,
    openRegularFile: async (
      ...args: Parameters<typeof actual.openRegularFile>
    ) => {
      const source = await actual.openRegularFile(...args);
      const close = source.handle.close.bind(source.handle);
      source.handle.close = async () => {
        control.attempts += 1;
        if (control.failClose) throw new Error("controlled close failure");
        await close();
      };
      return source;
    },
  };
});
afterEach(() => {
  control.failClose = false;
  control.attempts = 0;
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-macho-source-"));
  const path = join(root, "image");
  const bytes = Buffer.from("0123456789abcdef");
  await writeFile(path, bytes);
  return {
    root,
    path,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

it("binds bounded reads and returned failures to the selected bytes", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  try {
    const value = await withNativeMachoSource(
      f,
      scope,
      undefined,
      async (source) => {
        expect(source.bytes).toBe(f.bytes.length);
        expect(Buffer.from(await source.readSlice(4, 8, 1, 4)).toString()).toBe(
          "5678",
        );
        await expect(source.readSlice(4, 8, 6, 3)).rejects.toMatchObject({
          reason: "format",
        });
        return { ok: false, error: "original failure" };
      },
    );
    expect(value).toEqual({ ok: false, error: "original failure" });
    expect(control.attempts).toBe(1);
  } finally {
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("refuses wrong initial digest and a changed selected file even after a returned failure", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  try {
    const run = vi.fn(async () => "must not run");
    await expect(
      withNativeMachoSource(
        { ...f, sha256: "0".repeat(64) },
        scope,
        undefined,
        run,
      ),
    ).rejects.toMatchObject({ reason: "integrity" });
    expect(run).not.toHaveBeenCalled();
    await expect(
      withNativeMachoSource(f, scope, undefined, async () => {
        await writeFile(f.path, "changed");
        return { ok: false, error: "producer failure" };
      }),
    ).rejects.toMatchObject({
      reason: "integrity",
      completed: { ok: false, error: "producer failure" },
    });
  } finally {
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("refuses a path replacement during the producer callback", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  try {
    await expect(
      withNativeMachoSource(f, scope, undefined, async () => {
        await rename(f.path, `${f.path}.original`);
        await writeFile(f.path, f.bytes);
        return "result";
      }),
    ).rejects.toMatchObject({ reason: "integrity" });
  } finally {
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("keeps callback cancellation and retries the exact descriptor after close failure", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  const abort = new AbortController();
  const reason = new Error("caller cancelled");
  try {
    control.failClose = true;
    const failure = await withNativeMachoSource(
      f,
      scope,
      abort.signal,
      async (source) => {
        abort.abort(reason);
        await source.readSlice(0, f.bytes.length, 0, 1);
      },
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
    expect(scope.hasPending).toBe(true);
    expect(failure).toMatchObject({ reason: "cancelled" });
    control.failClose = false;
    await scope.retryCleanup();
    expect(scope.hasPending).toBe(false);
    expect(control.attempts).toBe(2);
  } finally {
    control.failClose = false;
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("retains the completed producer failure when cancellation prevents final verification", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  const abort = new AbortController();
  const reason = new Error("cancelled after producer result");
  try {
    const failure = await withNativeMachoSource(
      f,
      scope,
      abort.signal,
      async () => {
        abort.abort(reason);
        return { ok: false, error: "captured producer output" };
      },
    ).catch((cause: unknown) => cause);
    expect(failure).toMatchObject({
      reason: "cancelled",
      completed: { ok: false, error: "captured producer output" },
      cancellation: { reason },
    });
  } finally {
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("retains a returned producer failure when final descriptor close fails", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  try {
    control.failClose = true;
    const failure = await withNativeMachoSource(
      f,
      scope,
      undefined,
      async () => ({
        ok: false,
        error: "producer failure with captured output",
      }),
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
    expect(failure).toMatchObject({
      fileCleanupFailure: {
        outcome: {
          kind: "completed",
          value: { ok: false, error: "producer failure with captured output" },
        },
      },
    });
    expect(scope.hasPending).toBe(true);
    control.failClose = false;
    await scope.retryCleanup();
    expect(scope.hasPending).toBe(false);
  } finally {
    control.failClose = false;
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("rechecks source after a thrown producer failure and retains both failures", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  const producerFailure = new Error("producer failure with captured output");
  try {
    await expect(
      withNativeMachoSource(f, scope, undefined, async () => {
        throw producerFailure;
      }),
    ).rejects.toBe(producerFailure);
    const failure = await withNativeMachoSource(
      f,
      scope,
      undefined,
      async () => {
        await writeFile(f.path, "changed");
        throw producerFailure;
      },
    ).catch((cause: unknown) => cause);
    expect(failure).toMatchObject({
      reason: "integrity",
      outcome: { kind: "failed", cause: producerFailure },
      verificationCause: { reason: "integrity" },
    });
  } finally {
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("retains a thrown producer failure if cancellation prevents final verification", async () => {
  const f = await fixture();
  const scope = new ArtifactResourceScope();
  const abort = new AbortController();
  const cancellation = new Error("cancelled after producer failure");
  const producerFailure = new Error("producer failure");
  try {
    const failure = await withNativeMachoSource(
      f,
      scope,
      abort.signal,
      async () => {
        abort.abort(cancellation);
        throw producerFailure;
      },
    ).catch((cause: unknown) => cause);
    expect(failure).toMatchObject({
      reason: "cancelled",
      outcome: { kind: "failed", cause: producerFailure },
      cancellation: { reason: cancellation },
    });
  } finally {
    await scope.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
