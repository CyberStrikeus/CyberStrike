import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  captureProcessScenarioFile,
  compareProcessEvidenceFiles,
  PROCESS_UNEXPECTED_FAILURE_REMEDIATION,
} from "../../../src/application/process/ProcessCli.js";
import { JSON_BYTE_ORDER_MARK_MESSAGE } from "../../../src/application/Utf8JsonInput.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { analysisCliErrorEnvelopeSchema } from "../../../src/contracts/errorSchemas.js";
import { EvidenceFileError } from "../../../src/domain/evidenceErrors.js";
import { err } from "../../../src/domain/result.js";
import * as jsonFiles from "../../../src/application/JsonFiles.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { holdFirstFileRead } from "../../support/holdFirstFileRead.js";
import { failFileReadAfterAbort } from "../../support/failFileReadAfterAbort.js";
import { JsonInputPhysicalReadFailure } from "../../../src/application/JsonInputFile.js";

describe("process CLI error projection", () => {
  it.each([
    {
      operation: "capture_process_scenario",
      execute: (path: string) => captureProcessScenarioFile(path),
    },
    {
      operation: "compare_process_captures",
      execute: (path: string) => compareProcessEvidenceFiles(path, path),
    },
  ] as const)(
    "projects an unexpected $operation failure canonically",
    async ({ operation, execute }) => {
      const failure = new Error("SECRET internal failure /private/path");
      const read = vi
        .spyOn(jsonFiles, "readJsonFile")
        .mockImplementation(async () => {
          throw failure;
        });

      try {
        const projected = await execute("/selected/input.json");
        expect(
          analysisCliErrorEnvelopeSchema.safeParse(projected).success,
        ).toBe(true);
        expect(projected).toMatchObject({
          error: "Process command failed",
          code: "execution_failure",
          category: "execution_failure",
          retryable: false,
          message:
            "Process command could not complete: SECRET internal failure /private/path",
          remediation: { action: PROCESS_UNEXPECTED_FAILURE_REMEDIATION },
          details: {
            operation,
            provider_id: PROCESS_PROVIDER.id,
            diagnostics: { phase: "process_cli" },
          },
        });
        expect(JSON.stringify(projected)).not.toContain("stack");
        expect(PROCESS_UNEXPECTED_FAILURE_REMEDIATION).not.toContain("SECRET");
        expect(PROCESS_UNEXPECTED_FAILURE_REMEDIATION).not.toMatch(
          /\bretry\b/iu,
        );
      } finally {
        read.mockRestore();
      }
    },
  );
});

describe("process CLI file cancellation", () => {
  it("projects pre-aborted file reads as cancellation", async () => {
    const root = await createTestTempDirectory("rea-process-cli-cancel-");
    const controller = new AbortController();
    controller.abort();
    expect(
      await captureProcessScenarioFile(
        join(root, "missing-scenario.json"),
        process.env,
        controller.signal,
      ),
    ).toMatchObject({
      error: "Process command failed",
      code: "cancelled",
      category: "cancelled",
      details: { operation: "capture_process_scenario" },
    });
    expect(
      await compareProcessEvidenceFiles(
        join(root, "missing-left.json"),
        join(root, "missing-right.json"),
        join(root, "missing-trace.json"),
        controller.signal,
      ),
    ).toMatchObject({
      code: "cancelled",
      category: "cancelled",
      details: { operation: "compare_process_captures" },
    });
  });

  it.each([
    { workflow: "capture", input: "scenario" },
    { workflow: "compare", input: "left" },
    { workflow: "compare", input: "right" },
    { workflow: "compare", input: "trace specification" },
  ] as const)(
    "stops streamed $workflow $input reads after cancellation",
    async ({ workflow, input }) => {
      const root = await createTestTempDirectory("rea-process-cli-stream-");
      const paths = {
        scenario: join(root, "scenario.json"),
        left: join(root, "left.json"),
        right: join(root, "right.json"),
        trace: join(root, "trace.json"),
      };
      const evidence = JSON.stringify(processCaptureEvidence());
      const scenario = JSON.stringify({
        executable: process.execPath,
        arguments: [],
      });
      const traceSpecification = JSON.stringify(validTraceSpecification());
      const contentsByInput = {
        scenario: input === "scenario" ? stream(scenario) : scenario,
        left: input === "left" ? stream(evidence) : evidence,
        right: input === "right" ? stream(evidence) : evidence,
        trace:
          input === "trace specification"
            ? stream(traceSpecification)
            : traceSpecification,
      };
      await Promise.all([
        writeFile(paths.scenario, contentsByInput.scenario),
        writeFile(paths.left, contentsByInput.left),
        writeFile(paths.right, contentsByInput.right),
        writeFile(paths.trace, contentsByInput.trace),
      ]);
      const targetPath =
        paths[input === "trace specification" ? "trace" : input];
      const contents =
        contentsByInput[input === "trace specification" ? "trace" : input];
      const reader = await holdFirstFileRead(targetPath);
      onTestFinished(reader.release);
      const controller = new AbortController();
      try {
        const pending =
          workflow === "capture"
            ? captureProcessScenarioFile(
                paths.scenario,
                process.env,
                controller.signal,
              )
            : compareProcessEvidenceFiles(
                paths.left,
                paths.right,
                paths.trace,
                controller.signal,
              );
        await reader.firstRead;
        controller.abort();
        reader.release();
        expect(await pending).toMatchObject({
          error: "Process command failed",
          code: "cancelled",
          category: "cancelled",
        });
        expect(reader.readCount).toBe(1);
        expect(reader.totalReadBytes).toBeLessThan(contents.length);
      } finally {
        controller.abort();
        reader.release();
        vi.restoreAllMocks();
      }
    },
  );
});

it.each(
  [
    {
      label: "EIO",
      physical: Object.assign(new Error("physical descriptor failure"), {
        code: "EIO",
      }),
    },
    { label: "null", physical: null },
    { label: "undefined", physical: undefined },
  ].flatMap((failure) => [
    { ...failure, reader: "native" as const },
    { ...failure, reader: "streamed" as const },
  ]),
)(
  "preserves a $reader descriptor $label when cancellation arrives after the read fails",
  async ({ physical, reader }) => {
    const root = await createTestTempDirectory("rea-process-cli-late-io-");
    const path = join(root, "scenario.json");
    const input = JSON.stringify({
      executable: process.execPath,
      arguments: [],
    });
    await writeFile(path, reader === "streamed" ? stream(input) : input);
    const controller = new AbortController();
    await failFileReadAfterAbort(
      path,
      controller,
      new Error("later caller cancellation"),
      physical,
    );
    try {
      expect(
        await captureProcessScenarioFile(path, process.env, controller.signal),
      ).toMatchObject({
        code: "execution_failure",
        category: "execution_failure",
        retryable: false,
        details: { operation: "read", reason: "io", path },
      });
    } finally {
      vi.restoreAllMocks();
    }
  },
);

it("keeps a physical read primary when its cause is also the abort reason", async () => {
  const root = await createTestTempDirectory(
    "rea-process-cli-identical-abort-",
  );
  const path = join(root, "scenario.json");
  await writeFile(
    path,
    JSON.stringify({ executable: process.execPath, arguments: [] }),
  );
  const controller = new AbortController();
  const physical = new JsonInputPhysicalReadFailure(
    Object.assign(new Error("descriptor EIO"), { code: "EIO" }),
  );
  await failFileReadAfterAbort(path, controller, physical, physical);
  try {
    expect(
      await captureProcessScenarioFile(path, process.env, controller.signal),
    ).toMatchObject({
      code: "execution_failure",
      category: "execution_failure",
      details: { operation: "read", reason: "io", path },
    });
  } finally {
    vi.restoreAllMocks();
  }
});

describe("process CLI input diagnostics", () => {
  it("keeps physical file I/O failures in the execution-error projection", async () => {
    const path = "/selected/scenario.json";
    const ioFailure = new EvidenceFileError("read", "io", {
      cause: Object.assign(new Error("disk I/O failed"), { code: "EIO" }),
      path,
    });
    const read = vi
      .spyOn(jsonFiles, "readJsonFile")
      .mockResolvedValue(err(ioFailure));

    try {
      const result = await captureProcessScenarioFile(path);
      expect(result).toMatchObject({
        error: "Process command failed",
        code: "execution_failure",
        category: "execution_failure",
        retryable: false,
        details: { operation: "read", reason: "io", path },
      });
      expect(analysisCliErrorEnvelopeSchema.safeParse(result).success).toBe(
        true,
      );
    } finally {
      read.mockRestore();
    }
  });

  it("projects missing, malformed JSON, and invalid scenario files", async () => {
    const root = await createTestTempDirectory("rea-process-cli-diagnostics-");
    const malformed = join(root, "malformed.json");
    const invalid = join(root, "invalid.json");
    const invalidUtf8 = join(root, "invalid-utf8.json");
    await writeFile(malformed, "not-json");
    await writeFile(invalid, "{}");
    await writeFile(
      invalidUtf8,
      Buffer.concat([
        Buffer.from('{"executable":"'),
        Buffer.from([0xff]),
        Buffer.from('"}'),
      ]),
    );

    const missing = await captureProcessScenarioFile(
      join(root, "missing.json"),
    );
    expect(missing).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining("Process input file could not be read:"),
      retryable: false,
      remediation: {
        action: expect.stringContaining("Correct the listed fields"),
      },
      details: {
        issues: [
          {
            path: ["input_file"],
            reason: "invalid_value",
            message: expect.stringContaining(
              `Process input file could not be read: ${join(root, "missing.json")} (ENOENT`,
            ),
          },
        ],
      },
    });
    expect(analysisCliErrorEnvelopeSchema.safeParse(missing).success).toBe(
      true,
    );

    const invalidJson = await captureProcessScenarioFile(malformed);
    expect(invalidJson).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining(
        `Process input file is not valid UTF-8 JSON: ${malformed}`,
      ),
      retryable: false,
      remediation: {
        action: expect.stringContaining("Correct the listed fields"),
      },
      details: {
        issues: [{ path: ["input_file"], reason: "invalid_value" }],
      },
    });
    expect(analysisCliErrorEnvelopeSchema.safeParse(invalidJson).success).toBe(
      true,
    );

    const invalidUtf8Json = await captureProcessScenarioFile(invalidUtf8);
    expect(invalidUtf8Json).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      message: expect.stringContaining(
        `Process input file is not valid UTF-8 JSON: ${invalidUtf8}`,
      ),
      details: { issues: [{ path: ["input_file"], reason: "invalid_value" }] },
    });
    expect(
      analysisCliErrorEnvelopeSchema.safeParse(invalidUtf8Json).success,
    ).toBe(true);

    const compareMissing = await compareProcessEvidenceFiles(
      join(root, "missing-left.json"),
      join(root, "missing-right.json"),
    );
    expect(compareMissing).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      details: {
        operation: "compare_process_captures",
        issues: [{ path: ["input_file"], reason: "invalid_value" }],
      },
    });
    expect(
      analysisCliErrorEnvelopeSchema.safeParse(compareMissing).success,
    ).toBe(true);

    expect(await captureProcessScenarioFile(invalid)).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      category: "invalid_input",
      message: "Analysis input is invalid. Check the arguments and try again.",
      retryable: false,
      remediation: {
        action: expect.stringContaining("Correct the listed fields"),
      },
      recovery: {
        kind: "inspect_input_contract",
        operation: "capture_process_scenario",
      },
      details: expect.objectContaining({
        operation: "capture_process_scenario",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["executable"] }),
        ]),
      }),
    });
  });
});

describe("process CLI file cleanup", () => {
  it("retries a transient input close refusal before validating the scenario", async () => {
    const root = await createTestTempDirectory(
      "rea-process-cli-cleanup-retry-",
    );
    const path = join(root, "scenario.json");
    await writeFile(path, "{}");
    let owner: OwnedFileHandle | undefined;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementationOnce(async function (this: OwnedFileHandle) {
        owner = this;
        throw new Error("transient close refusal");
      });
    try {
      expect(await captureProcessScenarioFile(path)).toMatchObject({
        code: "invalid_request",
      });
      expect(close).toHaveBeenCalledTimes(2);
      expect(owner?.handle.fd).toBe(-1);
    } finally {
      close.mockRestore();
      await owner?.close();
    }
  });

  it.each([
    { operation: "capture", cancelDuringClose: false },
    { operation: "capture", cancelDuringClose: true },
    { operation: "compare", cancelDuringClose: false },
    { operation: "compare", cancelDuringClose: true },
  ] as const)(
    "preserves the open-file owner when $operation close fails (cancelled: $cancelDuringClose)",
    async ({ operation, cancelDuringClose }) => {
      const root = await createTestTempDirectory("rea-process-cli-cleanup-");
      const path = join(root, "scenario.json");
      await writeFile(path, JSON.stringify({ executable: process.execPath }));
      const controller = new AbortController();
      const cleanupCause = new Error("injected file close failure");
      let owner: OwnedFileHandle | undefined;
      const close = vi
        .spyOn(OwnedFileHandle.prototype, "close")
        .mockImplementation(async function (this: OwnedFileHandle) {
          owner = this;
          if (cancelDuringClose) controller.abort();
          throw cleanupCause;
        });
      let failure: unknown;
      try {
        try {
          const signal = cancelDuringClose ? controller.signal : undefined;
          if (operation === "capture")
            await captureProcessScenarioFile(path, process.env, signal);
          else await compareProcessEvidenceFiles(path, path, undefined, signal);
        } catch (cause: unknown) {
          failure = cause;
        }
        expect(failure).toBeInstanceOf(ArtifactReaderFailure);
        if (!(failure instanceof ArtifactReaderFailure))
          throw new Error("Expected the retained file handle owner");
        expect(failure.cleanup).toMatchObject({
          reason: expect.stringContaining(cleanupCause.message),
          resources: [path],
        });
        expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
        expect(failure.cleanupLeases).toHaveLength(1);
        expect(close.mock.calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        close.mockRestore();
        if (failure instanceof ArtifactReaderFailure)
          for (const lease of failure.cleanupLeases ?? [])
            await lease.release();
        else await owner?.close();
        expect(owner?.handle.fd).toBe(-1);
      }
    },
  );
});

describe("process CLI UTF-8 input diagnostics", () => {
  it("names a leading byte-order mark instead of quoting it as a token", async () => {
    const path = join(
      await createTestTempDirectory("rea-process-cli-diagnostics-"),
      "scenario.json",
    );
    await writeFile(path, '\uFEFF{"executable":"/bin/echo"}');
    expect(await captureProcessScenarioFile(path)).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      category: "invalid_input",
      message: `Process input file is not valid UTF-8 JSON: ${path} (${JSON_BYTE_ORDER_MARK_MESSAGE}). Repair the file, then try again.`,
      details: { issues: [{ path: ["input_file"], reason: "invalid_value" }] },
    });
  });
});

const processCaptureEvidence = () =>
  createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: {},
    result: EMPTY_PROCESS_CAPTURE_EXAMPLE,
    confidence: "observed",
    authority: "controlled-replay",
    environment: {
      id: "fixture",
      platform: "fixture",
      architecture: "fixture",
      isolation: "process",
    },
  });

const stream = (json: string) => " ".repeat(8 * 1024 * 1024) + json;

const validTraceSpecification = () => ({
  events: [
    {
      id: "started",
      source: "lifecycle",
      exact: { state: "started" },
    },
    {
      id: "finished",
      source: "lifecycle",
      exact: { state: "finished" },
    },
  ],
  language: {
    kind: "partial_order",
    happens_before: [{ before: "started", after: "finished" }],
  },
});
