import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  failClose: "never" as "never" | "once" | "always",
  abortAtClose: undefined as
    | { controller: AbortController; reason: unknown }
    | undefined,
  abortAtStat: undefined as
    | { controller: AbortController; reason: unknown }
    | undefined,
  pauseAtStat: undefined as
    | { started: () => void; resume: Promise<void> }
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (args[0] !== fault.path) return handle;
      const close = handle.close.bind(handle);
      const stat = handle.stat.bind(handle);
      handle.stat = (async (...statArgs: Parameters<typeof stat>) => {
        const abort = fault.abortAtStat;
        fault.abortAtStat = undefined;
        abort?.controller.abort(abort.reason);
        const pause = fault.pauseAtStat;
        fault.pauseAtStat = undefined;
        if (pause !== undefined) {
          pause.started();
          await pause.resume;
        }
        return stat(...statArgs);
      }) as typeof handle.stat;
      handle.close = async () => {
        if (fault.failClose !== "never") {
          if (fault.failClose === "once") fault.failClose = "never";
          const abort = fault.abortAtClose;
          fault.abortAtClose = undefined;
          abort?.controller.abort(abort.reason);
          throw new Error("controlled descriptor close failure");
        }
        return close();
      };
      return handle;
    },
  };
});

import { ApkSignatureProvider } from "../../src/apkSignature/ApkSignatureProvider.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { createCli } from "../../src/cli.js";
import { CLI_COMMANDS } from "../../src/cliCommandNames.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";

let root = "";
let path = "";
const exitCode = process.exitCode;
const deferred = () => {
  let complete = () => {};
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: () => complete() };
};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rea-apk-lifecycle-"));
  path = join(root, "unsigned.apk");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("classes.dex", new TextReader("x"));
  await writeFile(path, await writer.close());
});
afterEach(() => {
  fault.path = "";
  fault.failClose = "never";
  fault.abortAtClose = undefined;
  fault.abortAtStat = undefined;
  fault.pauseAtStat = undefined;
  process.exitCode = exitCode;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

it("serializes reads across providers, preserves queued aborts and drains admitted work on close", async () => {
  const first = new ApkSignatureProvider();
  const second = new ApkSignatureProvider();
  const started = deferred();
  const resume = deferred();
  fault.path = path;
  fault.pauseAtStat = {
    started: () => started.resolve(),
    resume: resume.promise,
  };
  const reading = first.inspect({ path });
  await started.promise;
  const queued = second.inspect({ path });
  const controller = new AbortController();
  const reason = new Error("cancel while queued");
  const cancelled = second.inspect({ path }, { signal: controller.signal });
  let closed = false;
  const closing = second.close().then(() => {
    closed = true;
  });
  try {
    controller.abort(reason);
    expect(await cancelled).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cause: reason },
    });
    expect(closed).toBe(false);
    resume.resolve();
    expect((await reading).ok).toBe(true);
    expect((await queued).ok).toBe(true);
    await closing;
    expect(closed).toBe(true);
  } finally {
    resume.resolve();
    await Promise.all([reading, queued, cancelled, closing]);
    await first.close();
    await second.close();
  }
});

it("keeps the abort reason itself as the cancellation cause", async () => {
  const provider = new ApkSignatureProvider();
  const controller = new AbortController();
  const reason = new Error("caller abort reason");
  fault.path = path;
  fault.abortAtStat = { controller, reason };
  try {
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
  } finally {
    await provider.close();
  }
});

it("reports a completed read whose close failed, and a closed scope, as execution failures", async () => {
  const provider = new ApkSignatureProvider();
  fault.path = path;
  fault.failClose = "once";
  const first = await provider.inspect({ path });
  expect(first.ok).toBe(false);
  if (first.ok) return;
  expect(projectAnalysisError(first.error)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      diagnostics: { primary_error: { code: "execution_failure" } },
    },
  });
  expect(first.error.cause).toBeInstanceOf(AggregateError);
  if (!(first.error.cause instanceof AggregateError)) return;
  expect(first.error.cause.errors[1]).toMatchObject({
    cleanupResources: [path],
  });

  await provider.close();
  expect(first.error.cleanupIncomplete).toBe(false);
  const closed = await provider.inspect({ path });
  expect(closed.ok).toBe(false);
  if (!closed.ok)
    expect(projectAnalysisError(closed.error).code).toBe("execution_failure");
});

it("keeps a post-capture abort from reclassifying a completed close failure", async () => {
  const provider = new ApkSignatureProvider();
  const controller = new AbortController();
  const reason = { requested: "abort after close failure was captured" };
  const retain = ArtifactResourceScope.prototype.retain;
  const retainSpy = vi
    .spyOn(ArtifactResourceScope.prototype, "retain")
    .mockImplementation(function (this: ArtifactResourceScope, owner) {
      retain.call(this, owner);
      if (owner.kind === "lease" && owner.resource === path)
        controller.abort(reason);
    });
  fault.path = path;
  fault.failClose = "once";
  try {
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ cleanupIncomplete: true });
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: [path],
        diagnostics: { primary_error: { code: "execution_failure" } },
      },
    });

    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    retainSpy.mockRestore();
    await provider.close();
  }
});

it("preserves cancellation observed during a completed read's failed close", async () => {
  const provider = new ApkSignatureProvider();
  const controller = new AbortController();
  const reason = { requested: "abort during descriptor close" };
  fault.path = path;
  fault.failClose = "once";
  fault.abortAtClose = { controller, reason };
  try {
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ cleanupIncomplete: true });
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: [path],
        diagnostics: { primary_error: { code: "cancelled" } },
      },
    });
    expect(result.error.cleanupPrimary?.cause).toBe(reason);

    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    await provider.close();
  }
});

it("projects a provider close that still fails through the public CLI", async () => {
  fault.path = path;
  fault.failClose = "always";
  let stdout = "";
  await createCli({}).serve(
    [CLI_COMMANDS.inspectApkSignature, path, "--json"],
    {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: () => undefined,
    },
  );
  fault.failClose = "never";
  expect(JSON.parse(stdout)).toMatchObject({
    code: "cleanup_incomplete",
    details: { cleanup: "incomplete", resources: [path] },
  });
  expect(process.exitCode).toBe(1);
});
