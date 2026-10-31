import { parseEvidence } from "../../../src/domain/evidence.js";
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createTestCli, type CliResult } from "../../support/cli/cliFixture.js";
import { createTestProcessRegistry } from "../../support/process/processFixture.js";

import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";
import { writeElectronBoundaryFixture } from "../../fixtures/electronBoundaryApplication.js";
import {
  SOURCE,
  applicationFixture,
  analyzeFixture,
  electronRuntimeEvidence,
} from "../../fixtures/javascriptRuntimeReconciliation.js";
import { JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE } from "../../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";

const cliProcesses = createTestProcessRegistry();
const cli = createTestCli(cliProcesses);
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;
const browsers: FakeCdpBrowser[] = [];
const temporary: string[] = [];

afterEach(async () => {
  await closeVerifierResources([
    () => cliProcesses.shutdown(),
    ...browsers.map((browser) => async () => {
      await browser.close();
      browsers.splice(browsers.indexOf(browser), 1);
    }),
    ...temporary.map((path) => async () => {
      await rm(path, { recursive: true, force: true });
      temporary.splice(temporary.indexOf(path), 1);
    }),
  ]);
});

it(
  "returns the same endpoint-scoped Electron Evidence contracts",
  async () => {
    const root = await createTestTempDirectory("rea-electron-cli-");
    temporary.push(root);
    await writeFile(join(root, "index.html"), "<script src='app.js'></script>");
    await writeFile(join(root, "app.js"), "export const app = true;");
    const browser = await startFakeCdpBrowser({
      electronFileUrl: `${pathToFileURL(join(root, "index.html")).href}?next=%2Fsettings#%5Csettings`,
      commandEvents: ({ method }) =>
        method === "Debugger.enable"
          ? [
              {
                method: "Debugger.scriptParsed",
                sessionId: "session-1",
                params: {
                  scriptId: "partial-script",
                  url: pathToFileURL(join(root, "app.js")).href,
                  executionContextId: 1,
                },
              },
            ]
          : undefined,
    });
    browsers.push(browser);
    const environment = { ...process.env };
    const listed = parseEvidence(
      await runCli(
        ["list-electron-targets", browser.endpoint, "--json"],
        environment,
      ),
    );
    expect(listed).toMatchObject({
      operation: "list_electron_targets",
      environment: {
        id: expect.any(String),
        platform: "unknown",
        architecture: "unknown",
        isolation: "none",
      },
      limitations: expect.arrayContaining([
        "Browser host platform and architecture were not observed.",
      ]),
      normalized_result: {
        targets: [{ target_id: "electron-page" }],
      },
    });
    const inspected = await runCli(
      [
        "inspect-electron-page",
        browser.endpoint,
        "electron-page",
        "--observation-ms",
        "0",
        "--json",
      ],
      environment,
    );
    expect(inspected).toMatchObject({
      operation: "inspect_electron_page",
      environment: listed.environment,
      provider: { id: "rea-cdp-electron" },
      normalized_result: {
        target: { file_path: join(root, "index.html") },
        scripts: {
          items: [{ cdp_hash: null, length: null, is_module: null }],
        },
      },
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "reports rejected Electron CLI arguments with structured issue details",
  async () => {
    const invalidTargetList = await runCliResult(
      ["list-electron-targets", "not a url", "--json"],
      process.env,
    );
    expect(invalidTargetList.signal).toBeNull();
    expect(invalidTargetList.exitCode).toBe(1);
    expect(invalidTargetList.json).toMatchObject({
      error: "Electron analysis failed",
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "list_electron_targets",
        issues: [
          {
            path: ["cdp_endpoint"],
            reason: "invalid_value",
          },
        ],
      },
    });

    const invalidPageInspect = await runCliResult(
      ["inspect-electron-page", "http://127.0.0.1:9222", "", "--json"],
      process.env,
    );
    expect(invalidPageInspect.signal).toBeNull();
    expect(invalidPageInspect.exitCode).toBe(1);
    expect(invalidPageInspect.json).toMatchObject({
      error: "Electron analysis failed",
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "inspect_electron_page",
        issues: [
          {
            path: ["target_id"],
            reason: "out_of_range",
            minimum: 1,
          },
        ],
      },
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

// On Windows child.kill("SIGINT") terminates the process without a console signal.
it.skipIf(process.platform === "win32")(
  "forwards SIGINT through Electron page inspection and completes target cleanup",
  async () => {
    const root = await createTestTempDirectory("rea-electron-cli-cancel-");
    temporary.push(root);
    const page = join(root, "index.html");
    await writeFile(page, "<main>fixture</main>");
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(page).href,
    });
    browsers.push(browser);

    const child = spawn(
      process.execPath,
      [
        "scripts/rea.mjs",
        "inspect-electron-page",
        browser.endpoint,
        "electron-page",
        "--observation-ms",
        "60000",
        "--json",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const hardStop = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      await vi.waitFor(
        () => {
          expect(
            browser.commands.some(({ method }) => method === "Runtime.enable"),
          ).toBe(true);
        },
        { timeout: 5_000 },
      );
      child.kill("SIGINT");

      const result = await closed;
      expect(result, stderr).toEqual({ code: 130, signal: null });
      expect(JSON.parse(stdout)).toMatchObject({
        code: "cancelled",
        category: "cancelled",
        details: { operation: "inspect_electron_page" },
      });
      const methods = browser.commands.map(({ method }) => method);
      expect(methods).toContain("Target.detachFromTarget");
      expect(methods).not.toContain("Target.closeTarget");
      expect(methods).not.toContain("Browser.close");
      await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
      expect((await fetch(`${browser.endpoint}/json/version`)).ok).toBe(true);
    } finally {
      clearTimeout(hardStop);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await closed;
      }
    }
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

it(
  "returns the static JavaScript application Evidence contract",
  async () => {
    const root = await createTestTempDirectory("rea-electron-static-cli-");
    temporary.push(root);
    await writeElectronBoundaryFixture(root);
    const environment = {
      ...process.env,
    };

    const analyzed = await runCli(
      ["analyze-javascript-application", root, "--json"],
      environment,
    );

    expect(analyzed).toMatchObject({
      operation: "analyze_javascript_application",
      provider: { id: "rea-javascript-application" },
      normalized_result: {
        input_path: root,
        summary: {
          browser_windows: 3,
          context_bridge_apis: 2,
          ipc: {
            paired_renderer_transmissions: 0,
            ambiguous_renderer_transmissions: 7,
            unpaired_literal_renderer_transmissions: 0,
          },
        },
      },
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
describe("Electron CLI artifact behavior", () => {
  it(
    "keeps artifact format separate from structured output format",
    async () => {
      const root = await createTestTempDirectory("rea-electron-format-cli-");
      temporary.push(root);
      await writeElectronBoundaryFixture(root);
      const environment = {
        ...process.env,
      };

      const analyzed = await runCli(
        [
          "--format",
          "json",
          "analyze-javascript-application",
          root,
          "--artifact-format",
          "directory",
        ],
        environment,
      );

      expect(analyzed).toMatchObject({
        operation: "analyze_javascript_application",
        normalized_result: { input_path: root, format: "directory" },
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "routes generic directory analysis to static JavaScript",
    async () => {
      const root = await createTestTempDirectory("rea-electron-routed-cli-");
      temporary.push(root);
      await writeElectronBoundaryFixture(root);
      const environment = {
        ...process.env,
      };

      const analyzed = await runCli(["analyze", root, "--json"], environment);

      expect(analyzed).toMatchObject({
        operation: "analyze_javascript_application",
        provider: { id: "rea-javascript-application" },
        normalized_result: {
          input_path: root,
          format: "directory",
          summary: {
            ipc: {
              paired_renderer_transmissions: 0,
              ambiguous_renderer_transmissions: 7,
              unpaired_literal_renderer_transmissions: 0,
            },
          },
        },
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

describe("Electron CLI runtime reconciliation input", () => {
  it(
    "labels schema-invalid reconciliation input without naming Electron",
    async () => {
      const rejected = await runCli(
        ["reconcile-javascript-runtime", "{}", "--json"],
        process.env,
        1,
      );
      expect(rejected).toMatchObject({
        error: "Application workflow failed",
        code: "invalid_request",
        category: "invalid_input",
        details: { operation: "reconcile_javascript_runtime" },
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

describe("Electron CLI runtime reconciliation", () => {
  it(
    "reads a file and returns the derived static/runtime reconciliation contract",
    async () => {
      const root = await createTestTempDirectory("rea-runtime-cli-");
      const inputPath = join(root, "reconciliation.json");
      temporary.push(root);
      await writeFile(
        inputPath,
        JSON.stringify(JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE),
      );
      const reconciled = await runCli(
        ["reconcile-javascript-runtime", inputPath, "--json"],
        process.env,
      );

      expect(reconciled).toMatchObject({
        operation: "reconcile_javascript_runtime",
        provider: { id: "rea-javascript-runtime-reconciliation" },
        normalized_result: {
          summary: { runtime_scripts: 1, matched: 1 },
          source_map_authority: { used_for_primary_matching: false },
        },
      });
      const missingPath = join(root, "missing.json");
      const missing = await runCli(
        ["reconcile-javascript-runtime", missingPath, "--json"],
        process.env,
        1,
      );
      expect(missing).toMatchObject({
        input_path: missingPath,
        input_reason: "read-failed",
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "keeps ambiguous runtime candidates unknown while unrelated scoped assets remain absent",
    async () => {
      const application = await applicationFixture();
      const assets = await createTestTempDirectory("rea-runtime-cli-assets-");
      const runtime = await createTestTempDirectory("rea-runtime-cli-live-");
      const inputPath = join(assets, "reconciliation.json");
      temporary.push(application, assets, runtime);
      await Promise.all([
        writeFile(join(assets, "app.js"), SOURCE),
        writeFile(join(assets, "absent.js"), "export const absent = true;\n"),
        writeFile(join(runtime, "app.js"), SOURCE),
      ]);
      const rootMapping = [{ kind: "file-root", root: runtime }] as const;
      const input = {
        static_layers: [
          {
            role: "application",
            analysis: await analyzeFixture(application),
            runtime_mappings: rootMapping,
          },
          {
            role: "assets",
            analysis: await analyzeFixture(assets),
            runtime_mappings: rootMapping,
          },
        ],
        runtime_observations: [
          electronRuntimeEvidence(runtime, SOURCE, { includeWorker: false }),
        ],
      };
      await writeFile(inputPath, JSON.stringify(input));
      const reconciled = await runCli(
        ["reconcile-javascript-runtime", inputPath, "--json"],
        process.env,
      );

      const normalized =
        isRecord(reconciled) && isRecord(reconciled.normalized_result)
          ? reconciled.normalized_result
          : undefined;
      const reconciliations = normalized?.reconciliations;
      const loadStates = normalized?.static_load_states;
      if (!Array.isArray(reconciliations) || !Array.isArray(loadStates))
        throw new Error("Missing runtime reconciliation output");
      const ambiguous = reconciliations.find(
        (item) =>
          isRecord(item) &&
          item.status === "ambiguous" &&
          item.entity_kind === "script",
      );
      if (
        !isRecord(ambiguous) ||
        !Array.isArray(ambiguous.candidate_static_nodes)
      )
        throw new Error("Missing ambiguous runtime script");
      const candidateIds = ambiguous.candidate_static_nodes.flatMap((item) =>
        isRecord(item) && typeof item.static_node_id === "string"
          ? [item.static_node_id]
          : [],
      );
      expect(candidateIds).toHaveLength(2);
      const candidateStates = loadStates.filter(
        (item) =>
          isRecord(item) &&
          typeof item.static_node_id === "string" &&
          candidateIds.includes(item.static_node_id),
      );
      expect(candidateStates).toHaveLength(2);
      expect(
        candidateStates.every(
          (item) =>
            isRecord(item) &&
            item.status === "unknown" &&
            item.reason === "ambiguous-runtime-candidate",
        ),
      ).toBe(true);
      expect(loadStates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "not-observed-in-capture",
            reason: "not-observed-in-bounded-capture",
          }),
        ]),
      );

      const singleLayerPath = join(application, "single-reconciliation.json");
      await writeFile(
        singleLayerPath,
        JSON.stringify({
          static_layers: [input.static_layers[0]],
          runtime_observations: input.runtime_observations,
        }),
      );
      const uniquelyMatched = await runCli(
        ["reconcile-javascript-runtime", singleLayerPath, "--json"],
        process.env,
      );
      expect(uniquelyMatched).toMatchObject({
        normalized_result: {
          static_load_states: expect.arrayContaining([
            expect.objectContaining({
              status: "loaded",
              reason: "runtime-script-correspondence",
            }),
          ]),
        },
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const runCliResult = async (
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<CliResult> =>
  cli.run({ arguments: arguments_, cwd: process.cwd(), environment });

const runCli = async (
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  expectedExitCode: 0 | 1 = 0,
): Promise<unknown> => {
  const result = await runCliResult(arguments_, environment);
  expect(result.signal, result.stderr || result.stdout).toBeNull();
  expect(result.exitCode, result.stderr || result.stdout).toBe(
    expectedExitCode,
  );
  expect(result.json, result.stderr || result.stdout).toBeDefined();
  return result.json;
};
