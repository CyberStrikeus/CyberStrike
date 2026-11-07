import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Cli } from "incur";
import pino from "pino";
import { expect, it } from "vitest";

import {
  createAnalysisExecution,
  type AnalysisProvider,
} from "../../../src/application/AnalysisProvider.js";
import { runDirectAnalysis } from "../../../src/application/DirectAnalysis.js";
import type { DirectAnalysisDependencies } from "../../../src/application/DirectAnalysisDependencies.js";
import {
  valueTraceDiamond,
  valueTraceProvider,
} from "../../../src/application/native/NativeValueTrace.fixture.js";
import { registerCoreNativeCommands } from "../../../src/cli/coreNativeCommands.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { nativeValueTraceSchema } from "../../../src/domain/native/nativeValueTrace.js";
import { ok } from "../../../src/domain/result.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const effects = {
  mutatesArtifact: false,
  launchesProcess: false,
  mayShowUi: false,
  mayAccessNetwork: false,
  mayWriteFilesystem: false,
  changesPermissions: false,
  requiresRoot: false,
};

/** One-shot CLI analysis over the shared trace with a simulated provider. */
const traceCli = async () => {
  const graph = valueTraceDiamond({ sessionSubject: true });
  const directory = await createTestTempDirectory("rea-value-trace-cli-");
  const path = join(directory, "fixture.hop");
  await writeFile(path, "synthetic analysis database");
  const provider: AnalysisProvider = {
    identity: () => valueTraceProvider,
    capabilities: () =>
      (["analyze_function", "resolve_native_call_targets"] as const).map(
        (operation) => ({
          provider: valueTraceProvider,
          operation,
          available: true,
          reason: null,
          cachePolicy: "live",
          limitations: [],
          effects,
        }),
      ),
    resolveAnalysisProfile: async () =>
      ok({
        profile: createAnalysisProfile(valueTraceProvider, { fixture: true }),
      }),
    createClient: () => ({
      execute: async (operation, parameters, options) =>
        operation === "health"
          ? ok(createAnalysisExecution(null, valueTraceProvider))
          : graph.port.execute(operation, parameters, options),
      close: async () => ok(null),
    }),
  };
  const createSession = () => createTestBinarySession(provider);
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig({}),
    createBinarySession: createSession,
    createNativeDispatchBinarySession: createSession,
    createArtifactBinarySession: createSession,
    createNativeBinarySession: createSession,
    createManagedBinarySession: createSession,
  };
  const cli = Cli.create("rea-value-trace-cli-test", { sync: false });
  registerCoreNativeCommands(
    cli,
    pino({ enabled: false }),
    (target, tool, arguments_, options) =>
      runDirectAnalysis(dependencies, target, tool, arguments_, options),
  );
  return async (options: readonly string[]) => {
    let stdout = "";
    await cli.serve(
      ["trace-native-values", path, "0x1000", "--max-depth", "1", ...options],
      {
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        exit: () => undefined,
      },
    );
    return nativeValueTraceSchema.parse(
      parseEvidence(JSON.parse(stdout)).normalized_result,
    );
  };
};

it("reports the CLI last page and its observed node budget separately", async () => {
  const trace = await traceCli();
  expect(
    await trace(["--offset", "10", "--limit", "3", "--json"]),
  ).toMatchObject({
    nodes: [{ id: "0x3000/parameter:0" }],
    total_nodes: 11,
    next_offset: null,
    page_truncated: true,
    traversal: { status: "complete" },
    truncated: true,
    unknowns: [],
  });
  const capped = await trace([
    "--max-nodes",
    "9",
    "--offset",
    "8",
    "--limit",
    "3",
    "--json",
  ]);
  expect(capped).toMatchObject({
    nodes: [{ id: "0x3000/op-1" }],
    total_nodes: 9,
    next_offset: null,
    page_truncated: true,
    traversal: { status: "truncated", reasons: ["max_nodes"] },
    truncated: true,
  });
  expect(capped.unknowns).toContainEqual({
    procedure: "0x3000",
    address: null,
    reason: "Node budget reached",
  });
});
