import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { nativeMacOSCapabilities } from "./NativeMacOSProviderMetadata.js";
import { NativeMacOSProvider } from "./NativeMacOSProvider.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { ok } from "../domain/result.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
  nativeMachoTargetForFile,
} from "../../tests/fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { inspectionImage } from "./NativeMachoInspection.fixture.js";

describe("native dispatch metadata input boundary", () => {
  it("retains canonical argument failures before attempting target inspection", async () => {
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
    ).createClient(nativeMachoTarget("/does-not-exist"));
    const cases: ReadonlyArray<{
      parameters: Readonly<Record<string, JsonValue>>;
      path: string;
      reason: string;
    }> = [
      {
        parameters: { max_records: null },
        path: "max_records",
        reason: "invalid_type",
      },
      {
        parameters: { max_records: "5" },
        path: "max_records",
        reason: "invalid_type",
      },
      {
        parameters: { max_records: 0 },
        path: "max_records",
        reason: "out_of_range",
      },
      {
        parameters: { max_record: 5 },
        path: "max_record",
        reason: "unknown_argument",
      },
    ];
    for (const { parameters, path, reason } of cases) {
      const result = await client.execute(
        "inspect_native_dispatch_metadata",
        parameters,
      );
      if (result.ok)
        throw new Error("Expected invalid dispatch metadata input");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "inspect_native_dispatch_metadata",
          issues: [{ path: [path], reason }],
        },
      });
    }
  });

  it("closes only the native call tracer owned by that client", async () => {
    const closes = [0, 0];
    let next = 0;
    const provider = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => {
        const index = next++;
        return {
          trace: async () => {
            throw new Error("trace is unused in this lifecycle test");
          },
          close: async () => {
            closes[index] = (closes[index] ?? 0) + 1;
            return ok(null);
          },
        };
      },
    );
    const first = provider.createClient(nativeMachoTarget("/first"));
    const second = provider.createClient(nativeMachoTarget("/second"));

    expect((await first.close()).ok).toBe(true);
    expect(closes).toEqual([1, 0]);
    expect((await second.close()).ok).toBe(true);
    expect(closes).toEqual([1, 1]);
  });
});

it.each(["inspect_macho", "list_architectures"] as const)(
  "retains unreadable lipo output as an output failure for %s",
  async (operation) => {
    const root = await createTestTempDirectory("rea-macho-lipo-output-");
    const path = join(root, "fixture.macho");
    await writeFile(path, inspectionImage());
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner({ lipo: "unrecognized slice record\n" }),
      "darwin",
    ).createClient(await nativeMachoTargetForFile(path));
    const result = await client.execute(operation, {});
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisOutputError",
        capturedOutput: { stdout: "unrecognized slice record\n", exit_code: 0 },
      },
    });
  },
);

it("declares the signature snapshot write in provider capabilities", () => {
  expect(
    nativeMacOSCapabilities("darwin").find(
      ({ operation }) => operation === "inspect_signature",
    )?.effects,
  ).toMatchObject({ mayWriteFilesystem: true, mutatesArtifact: false });
});
