import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";

const replyClose = vi.hoisted(() => ({
  path: "",
  denied: false,
  onClose: undefined as (() => void) | undefined,
  handles: [] as FileHandle[],
}));

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (args[0] === replyClose.path) {
        replyClose.handles.push(handle);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          if (replyClose.denied) {
            replyClose.onClose?.();
            throw new Error("controlled debugger reply close denial");
          }
          await close();
          replyClose.onClose?.();
        };
      }
      return handle;
    },
  };
});

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import {
  AnalysisError,
  primaryAnalysisError,
} from "../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { recordedCrashSchema } from "../../../src/domain/native/recordedCrash.js";
import { PwntoolsRecordedCrashProvider } from "../../../src/native/pwntools/PwntoolsRecordedCrashProvider.js";
import { runOwnedCommand } from "../../../src/process/OwnedCommand.js";
import { snapshotEnvironment } from "../../../src/process/snapshotEnvironment.js";
import {
  recordedCrashDebuggerFixture,
  recordedCrashFixture,
  recordedCrashFixtureBytes,
} from "../../fixtures/binaryDiagnostics/recordedCrash.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const fixture = async (
  reply = Buffer.from(
    JSON.stringify({ ok: true, value: recordedCrashDebuggerFixture() }),
  ),
) => {
  const workspace = await createTestWorkspace("rea-pwndbg-reply-finalization-");
  const path = workspace.path("recorded.core");
  const value = recordedCrashFixture(path);
  const bytes = recordedCrashFixtureBytes(value);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path, bytes);
  const init = workspace.path("gdbinit.py");
  const venv = workspace.path("venv");
  await writeFile(init, "# authored debugger fixture\n");
  await mkdir(venv);
  const resources = new ArtifactResourceScope();
  replyClose.path = workspace.path("debugger/reply.json");
  replyClose.denied = false;
  replyClose.onClose = undefined;
  replyClose.handles = [];
  const environment = snapshotEnvironment({
    REA_PWNDBG_GDB: process.execPath,
    REA_PWNDBG_GDBINIT: init,
    REA_PWNDBG_VENV_PATH: venv,
  });
  const provider = new PwntoolsRecordedCrashProvider(environment);
  onTestFinished(async () => {
    replyClose.denied = false;
    replyClose.onClose = undefined;
    await resources.close();
    await provider.close();
    await removeTestWorkspace(workspace.root);
  });
  const {
    artifact: _artifact,
    diagnostics: _diagnostics,
    decoder_diagnostics: _decoderDiagnostics,
    debugger: _debugger,
    ...payload
  } = value;
  const exits: (number | null | undefined)[] = [];
  // Exercise the real projection and owned-process boundary on every host.
  // The child authors debugger output; this does not establish GDB/pwndbg support.
  const project = async (signal: AbortSignal) =>
    provider.profile.enrich!({
      environment,
      input: { path, include_debugger_context: true },
      report: provider.profile.project({
        input: { path, include_debugger_context: true },
        payload,
        snapshot: { bytes, sha256 },
        diagnostics: value.decoder_diagnostics,
      }),
      snapshot: { bytes, sha256 },
      rootPath: workspace.root,
      resources,
      options: { signal },
      timeoutMs: 10_000,
      runCommand: async (spawn) => {
        const output = await runOwnedCommand(
          {
            ...spawn,
            command: process.execPath,
            arguments: [
              "-e",
              `const fs=require('node:fs');const request=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));fs.writeFileSync(request.reply_path,Buffer.from(${JSON.stringify(reply.toString("base64"))},'base64'));process.stdout.write('authored debugger output');`,
              spawn.arguments.at(-1) ?? "",
            ],
          },
          { timeoutMs: 10_000, diagnosticBytes: 1024 * 1024 },
        );
        exits.push(output.exitCode);
        return output;
      },
    });
  return { project, resources, value, sha256, exits };
};

it.each([
  { cancel: false, denied: false },
  { cancel: true, denied: false },
  { cancel: false, denied: true },
  { cancel: true, denied: true },
])(
  "retains authored completed debugger output through reply close (cancel=$cancel, denied=$denied)",
  async ({ cancel, denied }) => {
    const selected = await fixture();
    replyClose.denied = denied;
    const controller = new AbortController();
    const reason = { stage: "completed debugger output close" };
    if (cancel) replyClose.onClose = () => controller.abort(reason);
    const result = await selected.project(controller.signal).then(
      (value) => ({ ok: true as const, value }),
      (cause: unknown) => {
        if (!(cause instanceof AnalysisError)) throw cause;
        return { ok: false as const, error: cause };
      },
    );
    expect(result.ok).toBe(!cancel && !denied);
    const completed = recordedCrashSchema.parse(
      result.ok ? result.value : result.error.partialObservation,
    );
    expect(completed).toMatchObject({
      artifact: { path: selected.value.artifact.path, sha256: selected.sha256 },
      threads: selected.value.threads,
      debugger: {
        ...recordedCrashDebuggerFixture(),
        diagnostics: {
          stdout: "authored debugger output",
          stderr: "",
          truncated: false,
        },
      },
    });
    expect(selected.exits).toEqual([0]);
    if (!result.ok) {
      if (cancel) {
        expect(primaryAnalysisError(result.error)._tag).toBe(
          "AnalysisCancelledError",
        );
        expect(primaryAnalysisError(result.error).cause).toBe(reason);
      }
      expect(result.error.cleanupIncomplete).toBe(denied);
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: { partial_observation: completed },
      });
      if (denied) {
        expect(result.error.cleanupResources).toEqual([replyClose.path]);
        expect(replyClose.handles[0]?.fd).toBeGreaterThanOrEqual(0);
        await expect(selected.resources.close()).rejects.toBeDefined();
        replyClose.denied = false;
        await selected.resources.close();
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(result.error.cleanupResources).toEqual([]);
        expect(result.error.partialObservation).toEqual(completed);
      }
    }
    expect(replyClose.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it.each(["malformed JSON", "malformed UTF-8", "producer refusal"])(
  "keeps %s primary alongside denied close and retains only the earlier core facts",
  async (scenario) => {
    const reply =
      scenario === "malformed JSON"
        ? Buffer.from("{")
        : scenario === "producer refusal"
          ? Buffer.from(
              JSON.stringify({
                ok: false,
                reason: "unsupported",
                message: "authored refusal",
              }),
            )
          : Buffer.from(
              JSON.stringify({
                ok: true,
                value: recordedCrashDebuggerFixture(),
              }),
            );
    if (scenario === "malformed UTF-8") {
      const marker = reply.indexOf("source seam");
      expect(marker).toBeGreaterThanOrEqual(0);
      reply[marker] = 0xff;
    }
    const selected = await fixture(reply);
    replyClose.denied = true;
    const controller = new AbortController();
    const reason = { stage: "rejected debugger reply close" };
    replyClose.onClose = () => controller.abort(reason);
    const error: unknown = await selected
      .project(controller.signal)
      .catch((cause: unknown) => cause);
    if (!(error instanceof AnalysisError))
      throw new Error("Expected debugger reply failure");
    expect(controller.signal.reason).toBe(reason);
    expect(primaryAnalysisError(error)._tag).toBe(
      scenario === "producer refusal"
        ? "AnalysisCapabilityUnavailableError"
        : "AnalysisOutputError",
    );
    expect(error.partialObservation).toMatchObject({
      artifact: { path: selected.value.artifact.path, sha256: selected.sha256 },
      threads: selected.value.threads,
      debugger: { status: "unavailable", requested: true },
    });
    expect(error.cleanupIncomplete).toBe(true);
    replyClose.denied = false;
    await selected.resources.close();
    expect(error.cleanupIncomplete).toBe(false);
    expect(error.cleanupResources).toEqual([]);
    expect(replyClose.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);
