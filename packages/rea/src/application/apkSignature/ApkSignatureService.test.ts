import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it } from "vitest";

import { ApkSignatureProvider } from "../../apkSignature/ApkSignatureProvider.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { ok } from "../../domain/result.js";
import { ApkSignatureService } from "./ApkSignatureService.js";

it("preserves pre-aborted cancellation reasons without starting the provider", async () => {
  const reason = new Error("cancelled before inspection");
  const service = new ApkSignatureService({
    close: () => Promise.resolve(),
    inspect: () => {
      throw new Error("provider must not start");
    },
  });
  const result = await service.inspect(
    { path: join(tmpdir(), "unopened.apk") },
    { signal: AbortSignal.abort(reason) },
  );
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
});

it("retains completed APK Evidence and the abort reason on late cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-apk-service-"));
  const provider = new ApkSignatureProvider();
  try {
    const path = join(root, "unsigned.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("classes.dex", new TextReader("x"));
    await writeFile(path, await writer.close());
    const completed = await provider.inspect({ path });
    if (!completed.ok) throw completed.error;

    const controller = new AbortController();
    const reason = new Error("late abort reason");
    const result = await new ApkSignatureService({
      close: () => Promise.resolve(),
      inspect: () => {
        controller.abort(reason);
        return Promise.resolve(ok(completed.value));
      },
    }).inspect({ path, detail: "complete" }, { signal: controller.signal });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.partialObservation).toMatchObject({
      operation: "inspect_apk_signature",
      normalized_result: completed.value.result,
    });
  } finally {
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses summary acquisition before reading when complete Evidence cannot be retained", async () => {
  const service = new ApkSignatureService({
    close: () => Promise.resolve(),
    inspect: () => {
      throw new Error("inspection must not start without retention");
    },
  });
  const result = await service.inspect({
    path: join(tmpdir(), "not-opened.apk"),
  });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
});

it("rejects a live provider subject path that differs from the selected APK", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-apk-subject-"));
  const provider = new ApkSignatureProvider();
  try {
    const path = join(root, "selected.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("classes.dex", new TextReader("x"));
    await writeFile(path, await writer.close());
    const inspected = await provider.inspect({ path });
    if (!inspected.ok) throw inspected.error;
    const execution = inspected.value;
    const service = new ApkSignatureService({
      close: () => Promise.resolve(),
      inspect: async () =>
        ok({
          ...execution,
          subject: { ...execution.subject, path: join(root, "other.apk") },
        }),
    });
    expect(await service.inspect({ path, detail: "complete" })).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError" },
    });
  } finally {
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});
