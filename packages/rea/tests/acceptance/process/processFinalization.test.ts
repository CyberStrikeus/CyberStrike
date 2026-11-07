import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { partialProcessCaptureObservationSchema } from "../../../src/domain/process/processCapture.js";
import { observeProcessStartIdentity } from "../../../src/process/ProcessOwnershipObservation.js";
import {
  parseProcessCapture,
  type ProcessCapture,
} from "../../../src/domain/process/processCaptureParsing.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  CAPTURE_SKIP_REASON,
  itWithCaptureCapability as captureTest,
} from "../../boundary/process/processCaptureCapability.js";
import { expectSerializedUnverifiedHostCleanup } from "../../support/hostCleanup.js";

const finalizationFixture = fileURLToPath(
  new URL("../../fixtures/processFinalization.mjs", import.meta.url),
);
const cliCaptureTest = cliTest.skipIf(CAPTURE_SKIP_REASON);

type CaptureScenario = Record<string, unknown>;
type CaptureOutcome =
  | { readonly kind: "capture"; readonly capture: ProcessCapture }
  | { readonly kind: "partial"; readonly partial: unknown };

const captureScenario = (
  mode: "cooperative" | "ignoring" | "delayed-ignoring" | "descendant",
  root: string,
  additions: CaptureScenario = {},
  finalExitCode?: number,
): CaptureScenario => ({
  executable: process.execPath,
  arguments: [
    finalizationFixture,
    mode,
    root,
    ...(finalExitCode === undefined ? [] : [String(finalExitCode)]),
  ],
  working_directory: root,
  filesystem_observation_paths: [root],
  idle_timeout_ms: 10_000,
  ...additions,
});

const captureViaCli = async (
  cli: TestCli,
  root: string,
  scenario: CaptureScenario,
): Promise<CaptureOutcome> => {
  const scenarioPath = join(root, "scenario.json");
  await writeFile(scenarioPath, JSON.stringify(scenario));
  const result = await cli.run({
    arguments: ["capture-process", scenarioPath, "--format", "json"],
    environment: process.env,
  });
  expect(result.signal, result.stderr).toBeNull();
  const document = result.json;
  if (
    typeof document === "object" &&
    document !== null &&
    "code" in document &&
    document.code === "cleanup_incomplete"
  ) {
    expect(result.exitCode, result.stderr).toBe(1);
    return {
      kind: "partial",
      partial: expectSerializedUnverifiedHostCleanup({ error: document }),
    };
  }
  if (typeof document === "object" && document !== null && "code" in document)
    throw new Error(
      `CLI capture returned an unexpected error: ${JSON.stringify(document).slice(0, 1_000)}`,
    );
  expect(result.exitCode, result.stderr).toBe(0);
  return {
    kind: "capture",
    capture: parseProcessCapture(parseEvidence(document).normalized_result),
  };
};

const captureViaMcp = async (
  scenario: CaptureScenario,
): Promise<CaptureOutcome> => {
  const { call } = await connectLocalToolsMcp();
  const response = await call("capture_process_scenario", scenario);
  if (response.isError === true) {
    const parsed = parseMcpToolError(response);
    if (parsed.error.code === "cleanup_incomplete")
      return {
        kind: "partial",
        partial: expectSerializedUnverifiedHostCleanup(parsed),
      };
    throw new Error(
      `MCP capture returned an unexpected error: ${JSON.stringify(parsed).slice(0, 1_000)}`,
    );
  }
  return {
    kind: "capture",
    capture: parseProcessCapture(
      parseEvidence(
        toolContract("capture_process_scenario").outputSchema.parse(
          response.structuredContent,
        ),
      ).normalized_result,
    ),
  };
};

const waitFor = async (
  description: string,
  predicate: () => Promise<boolean>,
  deadlineMs = 7_500,
): Promise<void> => {
  const deadline = Date.now() + deadlineMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error(`timed out waiting for ${description}`);
    await delay(25);
  }
};

const fixturePid = async (root: string): Promise<number> => {
  let pid = Number.NaN;
  await waitFor("the finalization fixture PID", async () => {
    try {
      pid = Number.parseInt(await readFile(join(root, "pid.txt"), "utf8"), 10);
      return Number.isSafeInteger(pid) && pid > 0;
    } catch {
      return false;
    }
  });
  return pid;
};

const waitForFinalization = async (root: string): Promise<number> => {
  // The fixture writes the PID before it can receive SIGTERM, so once the
  // marker exists the PID file is complete.
  await waitFor("the finalization fixture to receive SIGTERM", async () => {
    try {
      await access(join(root, "sigterm-received"));
      return true;
    } catch {
      return false;
    }
  });
  return fixturePid(root);
};

const waitForProcessExit = async (pid: number): Promise<void> =>
  waitFor(`finalization fixture ${String(pid)} to exit`, async () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error: unknown) {
      return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ESRCH"
      );
    }
  });

const finalizationFromPartial = (partial: unknown) => {
  const parsed = partialProcessCaptureObservationSchema.parse(partial);
  if ("capture" in parsed) return parsed.capture.exit.finalization;
  return parsed.observations.exit.state === "available"
    ? parsed.observations.exit.value.finalization
    : undefined;
};

const completedCaptureFromOutcome = (outcome: CaptureOutcome) => {
  if (outcome.kind === "capture") return outcome.capture;
  const partial = partialProcessCaptureObservationSchema.parse(outcome.partial);
  expect(partial.execution_failure).toBeNull();
  if (!("capture" in partial))
    throw new Error("host cleanup uncertainty omitted the completed capture");
  return partial.capture;
};

const expectCooperativeFinalization = async (
  outcome: CaptureOutcome,
  root: string,
  expectedExitCode = 0,
): Promise<void> => {
  const capture = completedCaptureFromOutcome(outcome);
  expect(capture.exit.reason, "the deadline remains the exit reason").toBe(
    "timeout",
  );
  expect(capture.exit.code, "a deadline exit has no normal code").toBeNull();
  expect(
    capture.exit.finalization,
    "the cooperative target receives only SIGTERM",
  ).toMatchObject({
    requested_ms: 1_500,
    signals: [{ signal: "SIGTERM", delivery: "signaled" }],
  });
  expect(
    capture.exit.finalization?.signals,
    "cooperative finalization does not send SIGKILL",
  ).toHaveLength(1);
  expect(
    capture.exit.finalization?.elapsed_ms,
    "the cooperative target exits within its interval",
  ).toBeLessThan(1_500);
  expect(
    capture.exit.finalization?.exit_code,
    "the code the finalizer exited with is recorded",
  ).toBe(expectedExitCode);
  expect(
    capture.frames.map(({ data }) => data).join(""),
    "finalization output is captured",
  ).toContain("finalized");
  const reportBytes = await readFile(join(root, "final.json"));
  expect(JSON.parse(reportBytes.toString("utf8"))).toEqual({ phase: "final" });
  expect(
    capture.files_after.find(({ path }) => path.endsWith(":final.json"))
      ?.sha256,
    "the final filesystem snapshot hashes the final report",
  ).toBe(createHash("sha256").update(reportBytes).digest("hex"));
  expect(
    capture.manifest.scenario.finalization_ms,
    "the scenario commitment retains finalization_ms",
  ).toBe(1_500);
  expect(
    capture.manifest.comparison_contract.finalization_ms,
    "the comparison contract retains finalization_ms",
  ).toBe(1_500);
};

const expectIgnoringFinalization = (outcome: CaptureOutcome): void => {
  const capture = completedCaptureFromOutcome(outcome);
  expect(capture.exit.reason, "the deadline remains the exit reason").toBe(
    "timeout",
  );
  expect(capture.exit.signal, "the ignoring child ends on SIGKILL").toBe(9);
  expect(
    capture.exit.finalization?.signals,
    "SIGTERM is followed by exactly one SIGKILL",
  ).toMatchObject([
    { signal: "SIGTERM", delivery: "signaled" },
    { signal: "SIGKILL", delivery: "signaled" },
  ]);
  expect(
    capture.exit.finalization?.signals,
    "the ignoring child has exactly two finalization attempts",
  ).toHaveLength(2);
  expect(
    capture.exit.finalization?.signals[1]?.sent_at_ms,
    "SIGKILL waits for the requested interval",
  ).toBeGreaterThanOrEqual(1_500);
  expect(
    capture.exit.finalization?.elapsed_ms,
    "the elapsed finalization duration is observed",
  ).toEqual(expect.any(Number));
  expect(
    capture.exit.finalization?.exit_code,
    "an exit ended by SIGKILL records no code",
  ).toBeNull();
  expect(
    capture.files_after.find(({ path }) => path.endsWith("final.json")),
    "an ignoring child does not write a final report",
  ).toBeUndefined();
};

cliCaptureTest.for(["CLI", "MCP"] as const)(
  "captures a cooperative finalizer through the compiled %s workflow",
  { timeout: 20_000 },
  async (adapter, { cli }) => {
    const root = await createTestTempDirectory("rea-finalization-accept-");
    const scenario = captureScenario("cooperative", root, {
      timeout_ms: 1_500,
      finalization_ms: 1_500,
    });
    const outcome =
      adapter === "CLI"
        ? await captureViaCli(cli, root, scenario)
        : await captureViaMcp(scenario);
    await expectCooperativeFinalization(outcome, root);
  },
);

cliCaptureTest.for(["CLI", "MCP"] as const)(
  "records the non-zero exit code of a finalizer through the compiled %s workflow",
  { timeout: 20_000 },
  async (adapter, { cli }) => {
    const root = await createTestTempDirectory("rea-finalization-accept-");
    const scenario = captureScenario(
      "cooperative",
      root,
      { timeout_ms: 1_500, finalization_ms: 1_500 },
      3,
    );
    const outcome =
      adapter === "CLI"
        ? await captureViaCli(cli, root, scenario)
        : await captureViaMcp(scenario);
    await expectCooperativeFinalization(outcome, root, 3);
  },
);

cliCaptureTest.for(["CLI", "MCP"] as const)(
  "forces SIGKILL after the finalization interval through the compiled %s workflow",
  { timeout: 20_000 },
  async (adapter, { cli }) => {
    const root = await createTestTempDirectory("rea-finalization-accept-");
    const scenario = captureScenario("ignoring", root, {
      timeout_ms: 1_500,
      finalization_ms: 1_500,
    });
    const outcome =
      adapter === "CLI"
        ? await captureViaCli(cli, root, scenario)
        : await captureViaMcp(scenario);
    expectIgnoringFinalization(outcome);
  },
);

captureTest(
  "retains finalization facts with omitted digests and cleans the owned descendant",
  async () => {
    const root = await createTestTempDirectory("rea-finalization-descendant-");
    const childDirectory = join(root, "descendant");
    const outcome = await captureViaMcp(
      captureScenario("descendant", root, {
        timeout_ms: 1_500,
        finalization_ms: 1_500,
        settle_ms: 100,
        limits: { file_bytes: 1 },
      }),
    );
    const capture = completedCaptureFromOutcome(outcome);
    expect(capture.exit).toMatchObject({
      reason: "timeout",
      code: null,
      finalization: {
        exit_code: 0,
        signals: [{ signal: "SIGTERM", delivery: "signaled" }],
      },
    });
    expect(capture.exit.finalization?.signals).toHaveLength(1);
    expect(capture.settlement).toMatchObject({
      state: "alive_at_deadline",
      cleanup_outcome: "cleaned",
    });
    expect(capture.frames.map(({ data }) => data).join("")).toContain(
      "finalized",
    );
    const final = capture.files_after.find(({ path }) =>
      path.endsWith(":final.json"),
    );
    expect(final).toMatchObject({ type: "file", sha256: null });
    expect(capture.truncation_details.filesystem_after).toMatchObject({
      enumeration_truncated: false,
      hash_budget_bytes: 1,
      hash_omissions: expect.arrayContaining([
        expect.objectContaining({
          path: final?.path,
          reason: "file_bytes_budget",
        }),
      ]),
    });
    expect(
      JSON.parse(await readFile(join(root, "final.json"), "utf8")),
    ).toEqual({
      phase: "final",
    });
    await expect(
      access(join(childDirectory, "sigterm-received")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    const childPid = await fixturePid(childDirectory);
    await expect(
      observeProcessStartIdentity(childPid),
    ).resolves.toBeUndefined();
  },
  20_000,
);

cliCaptureTest.for(["CLI", "MCP"] as const)(
  "keeps the default identity through the compiled %s workflow without finalization_ms",
  { timeout: 20_000 },
  async (adapter, { cli }) => {
    const root = await createTestTempDirectory("rea-finalization-default-");
    const scenario = captureScenario("ignoring", root, { timeout_ms: 500 });
    const outcome =
      adapter === "CLI"
        ? await captureViaCli(cli, root, scenario)
        : await captureViaMcp(scenario);
    const capture = completedCaptureFromOutcome(outcome);
    expect(
      capture.exit,
      "default captures have no finalization evidence",
    ).not.toHaveProperty("finalization");
    expect(
      capture.manifest.scenario,
      "the committed scenario keeps its legacy identity",
    ).not.toHaveProperty("finalization_ms");
    expect(
      capture.manifest.comparison_contract,
      "the comparison contract keeps its legacy identity",
    ).not.toHaveProperty("finalization_ms");
  },
);

cliCaptureTest.for(["CLI", "MCP"] as const)(
  "rejects an unrepresentable combined capture budget through the compiled %s workflow",
  async (adapter, { cli }) => {
    const root = await createTestTempDirectory("rea-finalization-budget-");
    const scenario = captureScenario("cooperative", root, {
      timeout_ms: Number.MAX_SAFE_INTEGER,
      finalization_ms: 1,
      settle_ms: 0,
    });
    if (adapter === "CLI") {
      const scenarioPath = join(root, "scenario.json");
      await writeFile(scenarioPath, JSON.stringify(scenario));
      const response = await cli.run({
        arguments: ["capture-process", scenarioPath, "--format", "json"],
        environment: process.env,
      });
      expect(response.exitCode, response.stderr).toBe(1);
      expect(response.signal, response.stderr).toBeNull();
      expect(
        JSON.stringify(response.json),
        "CLI rejects the combined budget",
      ).toContain("timeout_ms + finalization_ms + settle_ms");
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("capture_process_scenario", scenario);
      expect(response.isError, "MCP rejects the combined budget").toBe(true);
      expect(
        JSON.stringify(response),
        "MCP explains the combined budget",
      ).toContain("timeout_ms + finalization_ms + settle_ms");
    }
    await expect(
      access(join(root, "periodic.json")),
      "invalid budgets are rejected before launching the fixture",
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

captureTest(
  "cancels the compiled CLI and MCP workflows during finalization without waiting for grace",
  async () => {
    const cliRoot = await createTestTempDirectory(
      "rea-finalization-cli-cancel-",
    );
    const cliScenarioPath = join(cliRoot, "scenario.json");
    // Match the other finalization cases' observation window. The old 300 ms
    // deadline could signal the fixture before it installed its handlers.
    await writeFile(
      cliScenarioPath,
      JSON.stringify(
        captureScenario("delayed-ignoring", cliRoot, {
          timeout_ms: 1_500,
          finalization_ms: 20_000,
        }),
      ),
    );
    const cli = spawn(
      process.execPath,
      [
        "scripts/rea.mjs",
        "capture-process",
        cliScenarioPath,
        "--format",
        "json",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    cli.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    cli.stderr.resume();
    const cliClosed = new Promise<{ readonly code: number | null }>(
      (resolve, reject) => {
        cli.once("error", reject);
        cli.once("close", (code) => resolve({ code }));
      },
    );
    onTestFinished(async () => {
      if (cli.exitCode === null && cli.signalCode === null) cli.kill("SIGKILL");
      await cliClosed;
    });
    const cliFixturePid = await waitForFinalization(cliRoot);
    const cliStarted = Date.now();
    cli.kill("SIGINT");
    const cliExit = await cliClosed;
    await waitForProcessExit(cliFixturePid);
    expect(cliExit.code, "SIGINT produces the CLI cancellation status").toBe(
      130,
    );
    expect(
      Date.now() - cliStarted,
      "CLI cancellation does not wait for the grace interval",
    ).toBeLessThan(8_000);
    const cliDocument: unknown = JSON.parse(stdout);
    if (
      typeof cliDocument === "object" &&
      cliDocument !== null &&
      "code" in cliDocument &&
      cliDocument.code === "cleanup_incomplete"
    ) {
      const partial = expectSerializedUnverifiedHostCleanup({
        error: cliDocument,
      });
      expect(
        finalizationFromPartial(partial),
        "CLI cleanup-flake partial observation records SIGKILL",
      ).toMatchObject({
        signals: [{ signal: "SIGTERM" }, { signal: "SIGKILL" }],
      });
    } else {
      expect(cliDocument, "CLI returns a typed cancelled result").toMatchObject(
        {
          code: "cancelled",
        },
      );
    }

    const mcpRoot = await createTestTempDirectory(
      "rea-finalization-mcp-cancel-",
    );
    const { client, call: callTool } = await connectLocalToolsMcp();
    const controller = new AbortController();
    let reportStarted: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const call = callTool(
      "capture_process_scenario",
      captureScenario("delayed-ignoring", mcpRoot, {
        timeout_ms: 1_500,
        finalization_ms: 20_000,
      }),
      { signal: controller.signal, onprogress: () => reportStarted?.() },
    );
    // Observe rejection immediately: a failed readiness wait must not leave a
    // pending request to reject unhandled when the fixture closes its client.
    // The original promise remains available for the cancellation assertion.
    const observedCall = call.catch(() => undefined);
    onTestFinished(async () => {
      controller.abort();
      await observedCall;
    });
    // Start the fixture's readiness wait after the server begins this capture;
    // SDK schema preparation before dispatch is not target startup time.
    await Promise.race([
      captureStarted,
      call.then(() => {
        throw new Error("MCP capture completed before reporting startup");
      }),
    ]);
    const mcpFixturePid = await waitForFinalization(mcpRoot);
    const mcpStarted = Date.now();
    controller.abort(new Error("cancel finalization acceptance fixture"));
    await expect(
      call,
      "MCP cancellation rejects the pending SDK request",
    ).rejects.toThrow("cancel finalization acceptance fixture");
    await waitForProcessExit(mcpFixturePid);
    await expect(
      client.listTools(undefined, { cacheMode: "refresh" }),
      "the server accepts a follow-up request after cancelling the capture",
    ).resolves.toMatchObject({ tools: expect.any(Array) });
    expect(
      Date.now() - mcpStarted,
      "MCP cancellation does not wait for the grace interval",
    ).toBeLessThan(8_000);
  },
  20_000,
);
