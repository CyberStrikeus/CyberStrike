import { nativeLoadImagePartialObservationSchema } from "../../../src/domain/native/nativeLoadImage.js";
import {
  fixtureDosLoadImage,
  compareDosFixture,
} from "../../../src/ghidra/GhidraLoadImage.fixture.js";
import { nativeAotSnapshotObservationSchema } from "../../../src/domain/native/nativeAotSnapshotObservation.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { fileSnapshotPartialObservationSchema } from "../../../src/domain/fileSnapshotObservation.js";
import { resolvedAnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { GhidraSessionError } from "../../../src/ghidra/GhidraSessionError.js";
import { err } from "../../../src/domain/result.js";
import {
  nativeAotPeFixture,
  nativeAotPeDigest,
} from "../../fixtures/nativeaotPe.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { expect, it } from "vitest";

import { logCliCommand } from "../../../src/cliLogging.js";
import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { ok } from "../../../src/domain/result.js";
import { GhidraRequestQueue } from "../../../src/ghidra/GhidraRequestQueue.js";
import { bindGhidraSessionFailure } from "../../../src/ghidra/GhidraSessionError.js";
import { silentLogger } from "../../../src/logger.js";
import { connectGhidraMcp } from "./ghidraMcpHarness.js";

it("preserves queue failure diagnostics through the provider, CLI adapter and SDK MCP transport", async () => {
  const token = "fixture-authentication-token";
  const cause = Object.assign(
    new TypeError(
      `Decode failed ${token}: /tmp/password-fixture http://localhost/secret?token=public-value`,
    ),
    { code: "EDECODE" },
  );
  const failure = bindGhidraSessionFailure(
    () => ({
      target_path: "/tmp/public-fixture",
      target_sha256: "a".repeat(64),
    }),
    (value) => value.replaceAll(token, "[REDACTED]"),
  );
  const queue = new GhidraRequestQueue(
    async () => {
      throw cause;
    },
    failure,
    () => Promise.resolve(ok(null)),
  );
  const harness = await connectGhidraMcp(
    "ghidra-failure-diagnostics",
    (operation, input, options) => queue.run(operation, input, options ?? {}),
  );
  const previousExitCode = process.exitCode;
  try {
    const cli = await logCliCommand(silentLogger, "inspect", async () => {
      const result = await harness.session.execute("list_procedures", {});
      if (!result.ok) throw result.error;
      return result.value.result;
    });
    expect(process.exitCode).toBe(1);
    const parsed = analysisErrorProjectionSchema.parse(cli);
    expect(parsed).toMatchObject({
      code: "execution_failure",
      details: {
        diagnostics: {
          target_path: "/tmp/public-fixture",
          failure_kind: "protocol",
          failure_message:
            "Ghidra serial request execution rejected unexpectedly",
          failure_cause: {
            name: "TypeError",
            code: "EDECODE",
            message:
              "Decode failed [REDACTED]: /tmp/password-fixture http://localhost/secret?token=public-value",
          },
        },
      },
    });
    const mcp = await harness.mcp.callTool({
      name: "list_procedures",
      arguments: {},
    });
    expect(mcp.isError).toBe(true);
    expect(parseMcpToolError(mcp)).toMatchObject({ error: parsed });
    expect(mcp.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("EDECODE"),
      }),
    );
    expect(JSON.stringify(mcp)).not.toContain(token);
    expect(JSON.stringify(mcp)).not.toContain(cause.stack);
  } finally {
    process.exitCode = previousExitCode;
    await harness.close();
  }
}, 30_000);

it.each(
  (["cancelled", "protocol"] as const).flatMap((kind) =>
    (["file", "native-aot", "load-image"] as const).map((observation) => ({
      kind,
      observation,
    })),
  ),
)(
  "retains completed $observation snapshot facts and exact cleanup over provider/CLI/MCP after $kind",
  async ({ kind, observation }) => {
    const directory = await createTestTempDirectory(
      "rea-ghidra-snapshot-projection-",
    );
    const path = join(directory, "Inert.exe");
    const dos = fixtureDosLoadImage();
    const bytes =
      observation === "load-image" ? dos.bytes : nativeAotPeFixture();
    await writeFile(path, bytes);
    const partialObservation =
      observation === "file"
        ? fileSnapshotPartialObservationSchema.parse({
            kind: "file-snapshot-hash",
            path,
            sha256: nativeAotPeDigest(bytes),
            bytes: bytes.length,
          })
        : observation === "native-aot"
          ? nativeAotSnapshotObservationSchema.parse({
              kind: "native-aot-snapshot",
              analysis_artifact_sha256: nativeAotPeDigest(bytes),
              image_base: "0x140000000",
              capture: { status: "captured", bytes: bytes.length },
            })
          : (() => {
              const compared = compareDosFixture(
                dos.bytes,
                dos.sha256,
                dos.observation,
              );
              if (!compared.ok) throw new Error(compared.error);
              return nativeLoadImagePartialObservationSchema.parse({
                kind: "native-load-image",
                stage: "completed",
                result: compared.value,
              });
            })();
    const cleanup = new ProviderCleanupError("ghidra", [path], {
      reason: "controlled snapshot descriptor remains",
    });
    const lease = new AnalysisCleanupLease(async () => {}, [path]);
    lease.bindCleanupError(cleanup);
    const reason = { caller: "snapshot-finalization" };
    const failure = new GhidraSessionError(
      kind,
      "Controlled snapshot finalization failure",
      {},
      {
        cause:
          kind === "cancelled"
            ? reason
            : new Error("controlled physical read failure"),
        ...(kind === "cancelled" ? { cancellation: { reason } } : {}),
        partialObservation,
      },
    ).withCleanupFailure(cleanup);
    const harness = await connectGhidraMcp(
      "ghidra-snapshot-finalization",
      async () => err(failure),
      { targetPath: path },
    );
    const previousExitCode = process.exitCode;
    try {
      const providerResult = await harness.session.execute(
        "list_procedures",
        {},
      );
      expect(providerResult.ok).toBe(false);
      if (providerResult.ok)
        throw new Error("Expected retained snapshot cleanup");
      expect(providerResult.error.partialObservation).toEqual(
        partialObservation,
      );
      expect(providerResult.error.cleanupIncomplete).toBe(true);
      const cli = analysisErrorProjectionSchema.parse(
        await logCliCommand(silentLogger, "inspect", async () => {
          throw providerResult.error;
        }),
      );
      expect(cli).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          resources: [path],
          partial_observation: partialObservation,
          diagnostics: {
            primary_error: {
              code: kind === "cancelled" ? "cancelled" : "execution_failure",
            },
          },
        },
      });
      const result = await harness.mcp.callTool({
        name: "list_procedures",
        arguments: {},
      });
      expect(parseMcpToolError(result)).toMatchObject({ error: cli });
      await lease.release();
      expect(providerResult.error.cleanupIncomplete).toBe(false);
      expect(providerResult.error.cleanupResources).toEqual([]);
      if (kind === "cancelled")
        expect(resolvedAnalysisError(providerResult.error).cause).toBe(reason);
    } finally {
      process.exitCode = previousExitCode;
      await lease.release();
      await harness.close();
    }
  },
);
