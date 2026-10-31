import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { ApktoolResourceAnalysisService } from "../application/apktool/ApktoolResourceAnalysisService.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  DEFAULT_APKTOOL_DECODE_TIMEOUT_MS,
  MAX_APKTOOL_DECODE_TIMEOUT_MS,
} from "../domain/apktool/apktoolResourceAnalysis.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../process/OwnedCommand.js";
import type {
  ProcessDiagnosticBudget,
  ProviderProcessSnapshot,
} from "../process/ProviderProcess.js";
import { ApktoolProvider } from "./ApktoolProvider.js";

vi.mock("../process/OwnedCommand.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../process/OwnedCommand.js")>()),
  runOwnedCommand: vi.fn(),
}));

const YML = [
  "!!brut.androlib.meta.MetaInfo",
  "sdkInfo:",
  "  minSdkVersion: '24'",
  "  targetSdkVersion: '34'",
  "versionInfo:",
  "  versionCode: '7'",
  "  versionName: 1.2.3",
  "",
].join("\n");
const MANIFEST = [
  '<?xml version="1.0" encoding="utf-8" standalone="no"?>',
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.rea.apktool.probe"/>',
  "",
].join("\n");

const decodeTimeouts: (number | null)[] = [];
const outputBudgets: ProcessDiagnosticBudget[] = [];

afterEach(() => {
  decodeTimeouts.length = 0;
  outputBudgets.length = 0;
  vi.mocked(runOwnedCommand).mockReset();
});

const completed = (text: string): ProviderProcessSnapshot =>
  ({
    stdout: { text },
    stderr: { text: "" },
  }) as ProviderProcessSnapshot;

const installLauncher = (): void => {
  vi.mocked(runOwnedCommand).mockImplementation(async (spawn, limits) => {
    if (spawn.arguments[0] === "--version") {
      const output = completed("2.9.3\n");
      limits.observeCompleted?.(output);
      return output;
    }
    decodeTimeouts.push(limits.timeoutMs);
    outputBudgets.push(limits.diagnosticBytes);
    // Projects the deadline sentence only. A real launcher expiry and its
    // process-tree cleanup are covered by apktoolDecodeDeadline.test.ts.
    if (
      limits.timeoutMs === 200 ||
      limits.timeoutMs === MAX_APKTOOL_DECODE_TIMEOUT_MS
    )
      throw new OwnedCommandFailure("timeout", "Command deadline elapsed.");
    const outputIndex = spawn.arguments.indexOf("-o");
    const workspace = spawn.arguments[outputIndex + 1];
    if (workspace === undefined) throw new Error("decode output was not named");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "apktool.yml"), YML);
    await writeFile(join(workspace, "AndroidManifest.xml"), MANIFEST);
    return completed("I: Using Apktool on stub\n");
  });
};

const decode = async (
  provider: ApktoolProvider,
  path: string,
  decodeTimeoutMs?: number,
) =>
  new ApktoolResourceAnalysisService(provider).execute(
    "decode_android_resources",
    {
      path,
      include_strings: false,
      ...(decodeTimeoutMs === undefined
        ? {}
        : { decode_timeout_ms: decodeTimeoutMs }),
    },
  );

it("applies the omitted 600000 ms decode deadline and a selected value on the next decode", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-apktool-deadline-"));
  const path = join(root, "probe.apk");
  await writeFile(path, "apk-bytes");
  installLauncher();
  const provider = new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: "/opt/apktool/apktool" },
  });
  try {
    const omitted = await decode(provider, path);
    expect(omitted.ok).toBe(true);
    if (!omitted.ok) return;
    expect(omitted.value.parameters).not.toHaveProperty("decode_timeout_ms");
    expect(decodeTimeouts).toEqual([DEFAULT_APKTOOL_DECODE_TIMEOUT_MS]);
    expect(outputBudgets).toEqual([4 * 1024 * 1024]);

    const timedOut = await decode(provider, path, 200);
    expect(timedOut.ok).toBe(false);
    if (timedOut.ok) throw new Error("Expected a decode deadline");
    const projected = projectAnalysisError(timedOut.error);
    expect(projected).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: 200 },
    });
    expect(projected.message).toContain("200 ms");
    expect(projected.remediation.action).toContain("decode_timeout_ms");
    expect(projected.remediation.action).toContain(
      String(MAX_APKTOOL_DECODE_TIMEOUT_MS),
    );
    expect(projected.remediation.action).toContain("600000");
    expect(projected.remediation.action).toContain("next decode");
    expect(projected.remediation.action).toContain("no runtime override");
    expect(decodeTimeouts).toEqual([DEFAULT_APKTOOL_DECODE_TIMEOUT_MS, 200]);

    const selected = await decode(provider, path, 5_000);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.parameters).toMatchObject({
      decode_timeout_ms: 5_000,
    });
    expect(decodeTimeouts).toEqual([
      DEFAULT_APKTOOL_DECODE_TIMEOUT_MS,
      200,
      5_000,
    ]);

    const maximum = await decode(provider, path, MAX_APKTOOL_DECODE_TIMEOUT_MS);
    expect(maximum.ok).toBe(false);
    if (maximum.ok) throw new Error("Expected the maximum decode deadline");
    expect(projectAnalysisError(maximum.error).remediation.action).toContain(
      "do not increase it further",
    );
  } finally {
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});
