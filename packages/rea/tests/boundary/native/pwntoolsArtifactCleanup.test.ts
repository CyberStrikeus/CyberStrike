import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { z } from "zod";

const closeState = vi.hoisted(() => ({
  fail: false,
  failOnce: false,
  opened: 0,
  closes: 0,
  replyFail: false,
  abort: undefined as AbortController | undefined,
  inputAbort: undefined as AbortController | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      closeState.opened++;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closeState.closes++;
        if (String(args[0]).endsWith("selected.bin"))
          closeState.inputAbort?.abort("selected-close-cancel");
        if (String(args[0]).endsWith("reply.json")) {
          closeState.abort?.abort("reply-close-cancel");
          if (closeState.replyFail)
            throw new Error("injected reply close failure");
        }
        if (closeState.fail || closeState.failOnce) {
          closeState.failOnce = false;
          throw new Error("injected stable artifact close failure");
        }
        return close();
      };
      return handle;
    },
  };
});

import { PwntoolsRecordedCrashProvider } from "../../../src/native/pwntools/PwntoolsRecordedCrashProvider.js";
import {
  recordedCrashFixture,
  recordedCrashFixtureBytes,
  recordedCrashDebuggerFixture,
} from "../../fixtures/binaryDiagnostics/recordedCrash.js";
import { PwntoolsLayoutProvider } from "../../../src/native/pwntools/PwntoolsLayoutProvider.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { prepareProcessOwnershipInspection } from "../../../src/process/ProcessOwnershipObservation.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { binaryLayoutFixture } from "../../fixtures/binaryDiagnostics/layout.js";
import { PwntoolsDecoder } from "../../../src/native/pwntools/PwntoolsDecoder.js";
import { PWNTOOLS_PROVIDER_IDENTITY } from "../../../src/native/pwntools/PwntoolsRelease.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

const makeDecoder = () =>
  new PwntoolsDecoder(
    {
      identity: PWNTOOLS_PROVIDER_IDENTITY,
      operation: "test_pwntools_artifact_read",
      bridge: new URL("file:///unused-bridge.py"),
      payloadSchema: z.string(),
      project: () => {
        throw new Error("input read should fail before decoder launch");
      },
    },
    { REA_PWNTOOLS_PYTHON: process.execPath },
    undefined,
    async () => {
      throw new Error("runtime should not be created for failed input read");
    },
  );

const emulateSupportedHost = async (
  run: () => Promise<void>,
): Promise<void> => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  Object.defineProperty(process, "arch", { ...arch, value: "x64" });
  try {
    await run();
  } finally {
    if (platform !== undefined)
      Object.defineProperty(process, "platform", platform);
    if (arch !== undefined) Object.defineProperty(process, "arch", arch);
  }
};

it("reports the read failure without stale incomplete-cleanup state when close retry succeeds", async () =>
  emulateSupportedHost(async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-pwntools-close-retry-"));
    const path = join(root, "selected.bin");
    await writeFile(path, "selected evidence");
    closeState.fail = false;
    closeState.failOnce = true;
    closeState.opened = 0;
    closeState.closes = 0;
    const decoder = makeDecoder();
    try {
      const result = await decoder.inspect({ path });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Injected close failure was not returned");
      expect(result.error.partialObservation).toEqual({
        kind: "file-snapshot-hash",
        path,
        bytes: 17,
        sha256: createHash("sha256").update("selected evidence").digest("hex"),
      });
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).not.toBe(
        "cleanup_incomplete",
      );
      expect(result.error.cause).toMatchObject({
        cleanup: {
          resources: [path],
          reason: expect.stringContaining(
            "injected stable artifact close failure",
          ),
        },
      });
      expect(closeState.closes).toBeGreaterThanOrEqual(2);
    } finally {
      closeState.fail = false;
      closeState.failOnce = false;
      await decoder.close();
      await rm(root, { recursive: true, force: true });
    }
  }));

it("retains a persistent failed input descriptor and refuses the next acquisition", async () =>
  emulateSupportedHost(async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-pwntools-held-close-"));
    const path = join(root, "selected.bin");
    await writeFile(path, "selected evidence");
    closeState.fail = true;
    closeState.failOnce = false;
    closeState.opened = 0;
    closeState.closes = 0;
    const decoder = makeDecoder();
    try {
      const first = await decoder.inspect({ path });
      expect(first.ok).toBe(false);
      if (first.ok)
        throw new Error("Persistent close failure was not returned");
      expect(projectAnalysisError(first.error).code).toBe("cleanup_incomplete");
      const openedAfterFailure = closeState.opened;

      const retry = await decoder.inspect({ path });
      expect(retry.ok).toBe(false);
      if (retry.ok) throw new Error("Retained descriptor was not retried");
      expect(projectAnalysisError(retry.error).code).toBe("cleanup_incomplete");
      expect(closeState.opened).toBe(openedAfterFailure);

      await expect(decoder.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
      closeState.fail = false;
      await decoder.close();
    } finally {
      closeState.fail = false;
      closeState.failOnce = false;
      try {
        await decoder.close();
      } catch {
        // The test already asserts persistent cleanup failure before releasing it.
      }
      await rm(root, { recursive: true, force: true });
    }
  }));

it("retains selected target identity when cancellation arrives after its completed read", async () =>
  emulateSupportedHost(async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-pwntools-input-cancel-"));
    const path = join(root, "selected.bin");
    await writeFile(path, "selected evidence");
    closeState.inputAbort = new AbortController();
    const decoder = makeDecoder();
    try {
      const result = await decoder.inspect(
        { path },
        { signal: closeState.inputAbort.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok)
        throw new Error("input finalization unexpectedly succeeded");
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      expect(result.error.cause).toBe("selected-close-cancel");
      expect(result.error.partialObservation).toEqual({
        kind: "file-snapshot-hash",
        path,
        bytes: 17,
        sha256: createHash("sha256").update("selected evidence").digest("hex"),
      });
    } finally {
      closeState.inputAbort = undefined;
      await decoder.close();
      await rm(root, { recursive: true, force: true });
    }
  }));

// Simulated decoder writes a reply; the selected object is never executed.
it("retains admitted layout through reply close failure and cancellation, then resolves cleanup", async () => {
  await prepareProcessOwnershipInspection();
  await emulateSupportedHost(async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-pwntools-reply-close-"));
    const path = join(root, "selected.bin");
    await writeFile(path, Buffer.alloc(128));
    const runtime = await PrivateRuntimeRoot.create({
      parent: root,
      prefix: "worker-",
    });
    const {
      artifact: _artifact,
      diagnostics: _diagnostics,
      ...payload
    } = binaryLayoutFixture(path);
    closeState.replyFail = true;
    closeState.abort = new AbortController();
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        const request = JSON.parse(
          await readFile(join(runtime.path, "request.json"), "utf8"),
        ) as { reply_path: string };
        return spawnOwnedProviderProcess({
          ...spawn,
          arguments: [
            "-e",
            'require("node:fs").writeFileSync(process.argv[1], process.argv[2])',
            request.reply_path,
            JSON.stringify({
              ok: true,
              profile: PWNTOOLS_PROVIDER_IDENTITY.version,
              value: payload,
            }),
          ],
        });
      },
      async () => runtime,
    );
    try {
      const result = await provider.inspect(
        { path },
        { signal: closeState.abort.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok)
        throw new Error("reply finalization unexpectedly succeeded");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.partialObservation).toMatchObject({
        artifact: { path, bytes: 128 },
      });
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
      });
      closeState.replyFail = false;
      closeState.abort = undefined;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cancelled",
      });
    } finally {
      closeState.replyFail = false;
      closeState.abort = undefined;
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

it.each([
  "normal",
  "close",
  "cancel",
  "cancel-close",
  "invalid-source",
  "invalid-source-cancel",
  "malformed-cancel",
  "invalid-profile",
  "malformed",
] as const)(
  "admits base core facts before optional debugger enrichment: %s",
  async (scenario) => {
    await prepareProcessOwnershipInspection();
    await emulateSupportedHost(async () => {
      const root = await mkdtemp(join(tmpdir(), "rea-pwntools-core-reply-"));
      const path = join(root, "selected.core");
      const value = recordedCrashFixture(path);
      await writeFile(path, recordedCrashFixtureBytes(value));
      const runtime = await PrivateRuntimeRoot.create({
        parent: root,
        prefix: "worker-",
      });
      const plugin = join(root, "gdbinit.py");
      const venv = join(root, "venv");
      await writeFile(plugin, "# simulated debugger fixture");
      await mkdir(venv);
      const {
        artifact: _artifact,
        diagnostics: _diagnostics,
        debugger: _debugger,
        decoder_diagnostics: _decoderDiagnostics,
        ...payload
      } = value;
      if (scenario === "invalid-source" || scenario === "invalid-source-cancel")
        payload.notes[0]!.owner_bytes_base64 =
          Buffer.from("FAKE\0").toString("base64");
      closeState.replyFail =
        scenario !== "normal" &&
        scenario !== "cancel" &&
        scenario !== "invalid-source-cancel" &&
        scenario !== "malformed-cancel";
      closeState.abort =
        scenario === "cancel-close" ||
        scenario === "cancel" ||
        scenario === "invalid-source-cancel" ||
        scenario === "malformed-cancel"
          ? new AbortController()
          : undefined;
      let launches = 0;
      const provider = new PwntoolsRecordedCrashProvider(
        {
          REA_PWNTOOLS_PYTHON: process.execPath,
          REA_PWNDBG_GDB: process.execPath,
          REA_PWNDBG_GDBINIT: plugin,
          REA_PWNDBG_VENV_PATH: venv,
        },
        async (spawn) => {
          launches++;
          const request = JSON.parse(
            await readFile(
              join(spawn.cwd ?? runtime.path, "request.json"),
              "utf8",
            ),
          ) as { reply_path: string };
          const reply =
            launches === 1
              ? {
                  ok: true,
                  profile:
                    scenario === "invalid-profile"
                      ? "foreign-profile"
                      : PWNTOOLS_PROVIDER_IDENTITY.version,
                  value: payload,
                }
              : { ok: true, value: recordedCrashDebuggerFixture() };
          return spawnOwnedProviderProcess({
            ...spawn,
            arguments: [
              "-e",
              'require("node:fs").writeFileSync(process.argv[1], process.argv[2])',
              request.reply_path,
              scenario === "malformed" || scenario === "malformed-cancel"
                ? "{broken"
                : JSON.stringify(reply),
            ],
          });
        },
        async () => runtime,
      );
      try {
        const result = await provider.inspect(
          { path, include_debugger_context: true },
          closeState.abort === undefined
            ? undefined
            : { signal: closeState.abort.signal },
        );
        expect(launches).toBe(scenario === "normal" ? 2 : 1);
        if (scenario === "normal") {
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value.debugger.status).toBe("available");
        } else {
          expect(result.ok).toBe(false);
          if (result.ok)
            throw new Error("reply finalization unexpectedly succeeded");
          if (
            scenario === "close" ||
            scenario === "cancel-close" ||
            scenario === "cancel"
          ) {
            expect(result.error.partialObservation).toMatchObject({
              artifact: { path, bytes: value.artifact.bytes },
              debugger: { status: "unavailable", requested: true },
            });
          } else expect(result.error.partialObservation).toBeUndefined();
          closeState.replyFail = false;
          closeState.abort = undefined;
          await provider.close();
          expect(result.error.cleanupIncomplete).toBe(false);
          if (
            scenario === "invalid-source" ||
            scenario === "invalid-profile" ||
            scenario === "malformed" ||
            scenario === "invalid-source-cancel" ||
            scenario === "malformed-cancel"
          )
            expect(projectAnalysisError(result.error).code).toBe(
              "unreadable_output",
            );
          if (
            scenario === "invalid-source-cancel" ||
            scenario === "malformed-cancel"
          ) {
            expect(projectAnalysisError(result.error)).toMatchObject({
              code: "unreadable_output",
              details: {
                diagnostics: {
                  reply_finalization_error: { code: "cancelled" },
                },
              },
            });
            expect(
              result.error.diagnostics?.reply_finalization_error,
            ).not.toHaveProperty("captured_output");
          }
        }
      } finally {
        closeState.replyFail = false;
        closeState.abort = undefined;
        await provider.close();
        await rm(root, { recursive: true, force: true });
      }
    });
  },
);
