import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

import {
  captureProcessScenarioFile,
  compareProcessEvidenceFiles,
} from "../../../src/application/process/ProcessCli.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { parseProcessCaptureEvidence } from "../../../src/application/process/ProcessEvidence.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { INVESTIGATION_EXAMPLES } from "../../../src/contracts/investigationExamples.js";
import { observeProcessStartIdentity } from "../../../src/process/ProcessOwnershipObservation.js";
import {
  analysisCliErrorEnvelopeSchema,
  analysisErrorProjectionSchema,
} from "../../../src/contracts/errorSchemas.js";

const execFileAsync = promisify(execFile);
const CLI_INTEGRATION_TIMEOUT_MS = 60_000;

const cleanupTargetSource = `
const fs = process.getBuiltinModule("node:fs");
const [marker, release] = process.argv.slice(2);
if (!marker || !release) throw new Error("Missing cleanup target paths");
fs.writeFileSync(marker, String(process.pid));
setTimeout(() => process.exit(2), ${CLI_INTEGRATION_TIMEOUT_MS}).unref();
const waiting = setInterval(() => {
  if (!fs.existsSync(release)) return;
  clearInterval(waiting);
}, 10);
`;

const writeUnavailableOwnershipCompiler = async (root: string) => {
  // Controlled protocol facts force the refusal independently of native
  // platform-binary visibility. No token ever authorizes a signal.
  const helper = `#!${process.execPath}
const arguments_ = process.argv.slice(2);
const identities = arguments_[0] === "--identities";
const pids = (identities ? arguments_.slice(1) : arguments_).map(Number);
console.log(JSON.stringify({ results: pids.map(pid => identities ? {
  pid, state: "readable", identity: "controlled-start-" + pid,
  lifecycle: "non-zombie",
  relation: { state: "observed", parent_pid: 1, process_group_id: pid },
} : {
  pid, state: "unavailable", reason: "platform_binary_environment_withheld",
}) }));
`;
  const compiler = join(root, "controlled-swiftc");
  await writeFile(
    compiler,
    `#!${process.execPath}
const fs = process.getBuiltinModule("node:fs");
const outputIndex = process.argv.indexOf("-o");
const output = process.argv[outputIndex + 1];
if (outputIndex < 0 || !output || output.startsWith("-"))
  throw new Error("Missing controlled helper output");
fs.writeFileSync(output, ${JSON.stringify(helper)});
fs.chmodSync(output, 0o755);
`,
    { mode: 0o755 },
  );
  return compiler;
};

describe("documented process CLI workflow", () => {
  cliTest(
    "feeds the documented JSON capture into the comparison CLI",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-process-cli-");
      const guide = await readFile(
        new URL("../../../docs/process-capture.md", import.meta.url),
        "utf8",
      );
      const recipe = /```sh\nrea capture-process ([^\n]+)\n```/u.exec(
        guide,
      )?.[1];
      if (recipe === undefined)
        throw new Error("Missing process capture recipe");
      const [argumentsText, output] = recipe.split(" > ");
      if (argumentsText === undefined || output === undefined)
        throw new Error("Missing process capture redirection");
      const args = argumentsText.split(/\s+/u);
      const input = args[0];
      if (input === undefined) throw new Error("Missing scenario path");
      await writeFile(
        join(root, input),
        JSON.stringify({
          executable: process.execPath,
          arguments: ["-e", "process.stdout.write('documented-capture')"],
        }),
      );
      const capture = await cli.run({
        arguments: ["capture-process", ...args],
        cwd: root,
      });
      expect(capture.exitCode, capture.stdout || capture.stderr).toBe(0);
      expect(capture.json).toMatchObject({
        operation: "capture_process_scenario",
      });
      await writeFile(join(root, output), capture.stdout);
      const comparison = await cli.run({
        arguments: ["compare-process-captures", output, output, "--json"],
        cwd: root,
      });
      expect(comparison.exitCode, comparison.stdout || comparison.stderr).toBe(
        0,
      );
      expect(comparison.json).toMatchObject({
        operation: "compare_process_captures",
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});

describe("process CLI cleanup errors", () => {
  cliTest.skipIf(process.platform !== "darwin")(
    "reports the retained capture root with a controlled unavailable ownership reader",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-process-cli-cleanup-");
      const compiler = await writeUnavailableOwnershipCompiler(root);
      const scenario = join(root, "scenario.json");
      const marker = join(root, "target.pid");
      const release = join(root, "release-target");
      const target = join(root, "cleanup-target.cjs");
      await writeFile(target, cleanupTargetSource);
      await writeFile(
        scenario,
        JSON.stringify({
          executable: process.execPath,
          arguments: [target, marker, release],
          timeout_ms: 500,
          idle_timeout_ms: 500,
          finalization_ms: 100,
        }),
      );
      try {
        // A retained PTY can keep its CLI process alive. Read the completed
        // compiled command result before releasing the child and joining exit.
        if (cli.sharedCliRun === undefined)
          throw new Error("Expected the compiled CLI command session");
        const result = await cli.sharedCliRun({
          arguments: ["capture-process", scenario, "--json"],
          environment: {
            TMPDIR: root,
            REA_DARWIN_SWIFTC_PATH: compiler,
            SDKROOT: root,
            REA_DARWIN_MODULE_CACHE_PATH: join(root, "modules"),
          },
        });
        const targetPid = Number(await readFile(marker, "utf8"));
        expect(Number.isSafeInteger(targetPid) && targetPid > 0).toBe(true);
        expect(process.kill(targetPid, 0), "the target remains alive").toBe(
          true,
        );
        expect(result.exitCode, result.stdout || result.stderr).toBe(1);
        const retained = (await readdir(root)).filter((name) =>
          /^rea-process-(?!token-)/u.test(name),
        );
        expect(retained).toHaveLength(1);
        const retainedRoot = retained[0];
        if (retainedRoot === undefined)
          throw new Error("Missing retained root");
        expect(result.json).toMatchObject({
          code: "cleanup_incomplete",
          message: expect.stringContaining(
            "platform_binary_environment_withheld",
          ),
          details: {
            resources: ["owned_process_group", join(root, retainedRoot)],
            cleanup_report: {
              temporary_root: { state: "unverified" },
            },
          },
        });
      } finally {
        // Release even when the CLI or an assertion fails. A target starting
        // after this point also sees the release and exits without a signal.
        await writeFile(release, "release");
        const targetPid = await readFile(marker, "utf8").then(
          (value) => Number(value),
          (cause: unknown) => {
            if (
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "ENOENT"
            )
              return undefined;
            throw cause;
          },
        );
        if (targetPid !== undefined) {
          expect(Number.isSafeInteger(targetPid) && targetPid > 0).toBe(true);
          await expect
            .poll(() => observeProcessStartIdentity(targetPid), {
              timeout: 7_000,
              interval: 25,
            })
            .toBeUndefined();
        }
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});

describe("process CLI errors", () => {
  cliTest(
    "returns canonical JSON errors for missing and malformed process files",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-process-cli-errors-");
      const malformed = join(root, "malformed.json");
      await writeFile(malformed, "not-json");
      const cases = [
        ["capture-process", join(root, "missing.json"), "--json"],
        ["capture-process", malformed, "--json"],
        [
          "compare-process-captures",
          join(root, "missing-left.json"),
          join(root, "missing-right.json"),
          "--json",
        ],
      ] as const;

      for (const arguments_ of cases) {
        const result = await cli.run({
          arguments: arguments_,
          cwd: root,
        });
        expect(result.exitCode).toBe(1);
        expect(
          analysisCliErrorEnvelopeSchema.safeParse(result.json).success,
        ).toBe(true);
        expect(result.json).toMatchObject({
          code: "invalid_request",
          category: "invalid_input",
          retryable: false,
          details: {
            operation: expect.stringMatching(
              /^(capture_process_scenario|compare_process_captures)$/u,
            ),
            issues: [
              expect.objectContaining({
                path: ["input_file"],
                reason: "invalid_value",
              }),
            ],
          },
        });
      }

      const full = await cli.run({
        arguments: [
          "capture-process",
          join(root, "missing.json"),
          "--json",
          "--full-output",
        ],
        cwd: root,
      });
      expect(full.exitCode).toBe(1);
      expect(full.json).toMatchObject({ ok: false });
      if (typeof full.json !== "object" || full.json === null)
        throw new Error("Expected a full-output CLI error document");
      const fullError = Reflect.get(full.json, "error");
      expect(analysisErrorProjectionSchema.safeParse(fullError).success).toBe(
        true,
      );
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  it(
    "exits unsuccessfully without writing failure-shaped evidence",
    async () => {
      await expect(
        execFileAsync(
          process.execPath,
          ["scripts/rea.mjs", "capture-process", "/missing/scenario.json"],
          { cwd: process.cwd() },
        ),
      ).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringContaining("category: invalid_input"),
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  it("rejects NUL arguments before process launch", async () => {
    const root = await createTestTempDirectory("rea-process-cli-");
    const scenario = join(root, "nul-argument.json");
    await writeFile(
      scenario,
      JSON.stringify({ executable: process.execPath, arguments: ["\0"] }),
    );

    expect(await captureProcessScenarioFile(scenario)).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "capture_process_scenario",
        issues: [
          {
            path: ["arguments", 0],
            reason: "invalid_format",
            expected: "regex",
            message:
              "Values passed to operating-system APIs cannot contain NUL",
          },
        ],
      },
    });
  });
});

describe("process CLI environment key diagnostics", () => {
  it("reports the reserved process environment key constraint", async () => {
    const root = await createTestTempDirectory("rea-process-cli-");
    const scenario = join(root, "reserved-environment.json");
    await writeFile(
      scenario,
      JSON.stringify({
        executable: process.execPath,
        environment: { REA_PROCESS_RUN_ID: "caller-value" },
      }),
    );

    expect(await captureProcessScenarioFile(scenario)).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "capture_process_scenario",
        issues: [
          {
            path: ["environment", "REA_PROCESS_RUN_ID"],
            reason: "invalid_format",
            expected: "regex",
            message: "REA_PROCESS_RUN_ID is reserved by the process adapter",
          },
        ],
      },
    });
  });
});

describe("process CLI evidence validation", () => {
  it("captures the minimal executable-and-arguments scenario", async () => {
    const root = await createTestTempDirectory("rea-process-cli-");
    const scenario = join(root, "scenario.json");
    await writeFile(
      scenario,
      JSON.stringify({
        executable: process.execPath,
        arguments: ["-e", "process.stdout.write('minimal-capture')"],
      }),
    );
    const evidence = await captureProcessScenarioFile(scenario);
    expect(evidence).toMatchObject({
      predicate_type: "rea.process-capture",
      operation: "capture_process_scenario",
    });
    const parsed = parseProcessCaptureEvidence(evidence);
    if (!parsed.ok)
      throw new Error(`Invalid capture evidence: ${parsed.error.kind}`);
    expect(
      parsed.value.capture.frames.map(({ data }) => data).join(""),
    ).toContain("minimal-capture");
  });

  it("rejects unrelated capture evidence", async () => {
    const root = await createTestTempDirectory("rea-process-cli-");
    const invalidCapture = join(root, "invalid-capture.json");
    const unrelated = join(root, "unrelated.json");
    await writeFile(
      invalidCapture,
      JSON.stringify(
        createEvidence(undefined, PROCESS_PROVIDER, {
          predicateType: "rea.process-capture/other",
          operation: "capture_process_scenario",
          parameters: {},
          result: {},
        }),
      ),
    );
    await writeFile(
      unrelated,
      JSON.stringify(
        createEvidence(undefined, PROCESS_PROVIDER, {
          predicateType: "unrelated/v1",
          operation: "other",
          parameters: {},
          result: {},
        }),
      ),
    );

    expect(
      await compareProcessEvidenceFiles(invalidCapture, invalidCapture),
    ).toMatchObject({
      error: "Process command failed",
      category: "invalid_input",
    });
    const failure = await compareProcessEvidenceFiles(unrelated, unrelated);
    expect(analysisCliErrorEnvelopeSchema.safeParse(failure).success).toBe(
      true,
    );
    expect(failure).toMatchObject({
      error: "Process command failed",
      code: "invalid_request",
      retryable: false,
      category: "invalid_input",
      message:
        "Capture evidence is not from the current process-capture workflow. Create new capture evidence, then try again.",
      details: {
        operation: "compare_process_captures",
        issues: [{ path: ["left"], reason: "invalid_value" }],
      },
    });
  });

  it("classifies malformed capture evidence as invalid input", async () => {
    const root = await createTestTempDirectory("rea-process-cli-");
    const malformed = join(root, "malformed-evidence.json");
    await writeFile(malformed, "{}");

    expect(
      await compareProcessEvidenceFiles(malformed, malformed),
    ).toMatchObject({
      error: "Process command failed",
      category: "invalid_input",
      code: "invalid_request",
      details: {
        operation: "compare_process_captures",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ["parameters"],
            reason: "missing_argument",
          }),
        ]),
      },
    });
  });
});

it(
  "reports the JSON depth constraint through the compiled comparison CLI",
  async () => {
    const root = await createTestTempDirectory("rea-process-cli-");
    const left = join(root, "left.json");
    const right = join(root, "right.json");
    const input = INVESTIGATION_EXAMPLES.compare_process_captures.input;
    await writeFile(left, JSON.stringify(input.left));
    await writeFile(right, JSON.stringify(input.right));
    const cli = fileURLToPath(
      new URL("../../../scripts/rea.mjs", import.meta.url),
    );
    const cliArguments = [
      cli,
      "compare-process-captures",
      left,
      right,
      "--json",
    ];
    const baseline = await execFileAsync(process.execPath, cliArguments);
    expect(JSON.parse(baseline.stdout)).toMatchObject({
      operation: "compare_process_captures",
    });
    const nested = '{"nested":'.repeat(10_000) + "1" + "}".repeat(10_000);
    await writeFile(
      left,
      JSON.stringify({
        ...input.left,
        parameters: { attack: "depth-placeholder" },
      }).replace('"depth-placeholder"', nested),
    );
    await expect(
      execFileAsync(process.execPath, cliArguments),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("maximum nesting depth"),
    });
  },
  CLI_INTEGRATION_TIMEOUT_MS,
);
