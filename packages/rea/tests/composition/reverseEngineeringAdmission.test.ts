import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { TestReverseEngineeringService } from "../support/reverseEngineeringService.js";

it("bounds concurrent reverse-engineering provider calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-reverse-capacity-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let mode: "success" | "failure" | "timeout" = "success";
  const service = new TestReverseEngineeringService({
    run: async () => {
      calls += 1;
      if (mode === "failure")
        throw Object.assign(new Error("provider failed"), { code: "ENOENT" });
      if (mode === "timeout")
        throw Object.assign(new Error("provider timed out"), {
          code: "ETIMEDOUT",
        });
      await gate;
      return { stdout: "", stderr: "" };
    },
  });

  try {
    const active = Array.from({ length: 8 }, () =>
      service.inspectWithObjdump({ path, operation: "file_headers" }),
    );
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      service.inspectWithObjdump(
        { path, operation: "file_headers" },
        { signal: preAborted.signal },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    await expect(
      service.inspectWithObjdump({ path, operation: "file_headers" }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        resource: "transport",
        reportedLimits: {
          max_concurrent_operations: 8,
          active_operations: 8,
        },
      },
    });
    release();
    const results = await Promise.all(active);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(calls).toBe(8);

    mode = "failure";
    const failed = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.inspectWithObjdump({ path, operation: "file_headers" }),
      ),
    );
    expect(failed.every((result) => !result.ok)).toBe(true);

    mode = "timeout";
    const timedOut = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.inspectWithObjdump({ path, operation: "file_headers" }),
      ),
    );
    expect(timedOut.every((result) => !result.ok)).toBe(true);

    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.inspectWithObjdump(
          { path, operation: "file_headers" },
          { signal: aborted.signal },
        ),
      ),
    );
    expect(cancelled.every((result) => !result.ok)).toBe(true);

    mode = "success";
    await expect(
      service.inspectWithObjdump({ path, operation: "file_headers" }),
    ).resolves.toMatchObject({ ok: true });
  } finally {
    release();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves the exact caller reason when objdump admission is already aborted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-reverse-preabort-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  const reason = Object.freeze({ requested: "stop" });
  const controller = new AbortController();
  controller.abort(reason);
  let runs = 0;
  const service = new TestReverseEngineeringService({
    run: async () => {
      runs += 1;
      return { stdout: "", stderr: "" };
    },
  });
  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "symbols" },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    expect(runs).toBe(0);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves the caller reason when cancellation arrives after provider output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-reverse-postabort-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  const reason = Object.freeze({ requested: "stop-after-output" });
  const controller = new AbortController();
  const service = new TestReverseEngineeringService({
    run: async () => {
      controller.abort(reason);
      return { stdout: "symbols", stderr: "" };
    },
  });
  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "symbols" },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    expect(result.error.partialObservation).toMatchObject({
      raw_result: { stdout: "symbols" },
    });
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps a physical digest denial primary when the caller aborts during that failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-reverse-digest-deny-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  const reason = Object.freeze({ requested: "stop-during-denial" });
  const controller = new AbortController();
  const denied = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  let runs = 0;
  const service = new TestReverseEngineeringService({
    digest: async () => {
      controller.abort(reason);
      throw denied;
    },
    run: async () => {
      runs += 1;
      return { stdout: "", stderr: "" };
    },
  });
  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "symbols" },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisAccessDeniedError" },
    });
    if (result.ok) return;
    expect(result.error.cause).toBe(denied);
    expect(runs).toBe(0);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps an unrelated digest ABORT_ERR as an adapter failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-reverse-digest-abort-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  const denied = Object.assign(new Error("digest aborted elsewhere"), {
    code: "ABORT_ERR",
  });
  const service = new TestReverseEngineeringService({
    digest: async () => {
      throw denied;
    },
  });
  try {
    const result = await service.inspectWithObjdump({
      path,
      operation: "symbols",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError" },
    });
    if (result.ok) return;
    expect(result.error.cause).toBe(denied);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  {
    captured: true,
    code: "EACCES",
    tag: "AnalysisCapabilityUnavailableError",
  },
  {
    captured: true,
    code: "ETIMEDOUT",
    tag: "AnalysisTimeoutError",
  },
  {
    captured: true,
    code: "ABORT_ERR",
    tag: "AnalysisCancelledError",
  },
  {
    captured: false,
    code: "EACCES",
    tag: "AnalysisCapabilityUnavailableError",
  },
  {
    captured: false,
    code: "ETIMEDOUT",
    tag: "AnalysisTimeoutError",
  },
  {
    captured: false,
    code: "ABORT_ERR",
    tag: "AnalysisCancelledError",
  },
] as const)(
  "classifies a $code command failure with captured output $captured while the caller is aborted",
  async ({ captured, code, tag }) => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-reverse-command-abort-"),
    );
    const path = join(directory, "fixture.bin");
    await writeFile(path, "fixture");
    const reason = Object.freeze({ requested: `stop-${code}` });
    const controller = new AbortController();
    const failure = Object.assign(new Error("provider failure"), {
      code,
      ...(captured
        ? { stdout: "partial stdout", stderr: "partial stderr" }
        : {}),
    });
    const service = new TestReverseEngineeringService({
      run: async () => {
        controller.abort(reason);
        throw failure;
      },
    });
    try {
      const result = await service.inspectWithObjdump(
        { path, operation: "symbols" },
        { signal: controller.signal },
      );
      expect(result).toMatchObject({ ok: false, error: { _tag: tag } });
      if (result.ok) return;
      expect(result.error.cause).toBe(code === "ABORT_ERR" ? reason : failure);
      if (code === "EACCES") {
        expect(result.error).toMatchObject({
          providerId: "objdump",
          diagnostics: {
            boundary: "provider-launch",
            command: "objdump",
            system_code: code,
          },
        });
      }
      if (captured && code === "ABORT_ERR") {
        expect(result.error.capturedOutput).toMatchObject({
          stdout: "partial stdout",
          stderr: "partial stderr",
        });
        expect(result.error.partialObservation).toMatchObject({
          raw_result: { stdout: "partial stdout" },
        });
      }
    } finally {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
