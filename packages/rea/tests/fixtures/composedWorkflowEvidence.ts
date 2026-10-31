import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { parseConfig } from "../../src/config/parseConfig.js";
import {
  createAnalysisExecution,
  type AnalysisProvider,
} from "../../src/application/AnalysisProvider.js";
import type { DirectAnalysisDependencies } from "../../src/application/DirectAnalysisDependencies.js";
import { createAnalysisProfile } from "../../src/domain/analysisProfile.js";
import type { Evidence } from "../../src/domain/evidence.js";
import { ok } from "../../src/domain/result.js";
import { createTestBinarySession } from "./binarySession.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

/** Real session/ledger with a deterministic provider that never launches a target. */
export const composedWorkflowFixture = async (
  options: {
    readonly profiled?: boolean;
    readonly live?: boolean;
    readonly spoofedEvidenceId?: string;
    readonly beforeSummary?: () => Promise<void>;
  } = {},
) => {
  const directory = await createTestTempDirectory("rea-workflow-links-");
  const path = join(directory, "fixture.hop");
  await writeFile(path, "synthetic analysis database");
  const identity = { id: "fixture", name: "Fixture", version: "1" };
  const profile = createAnalysisProfile(identity, { fixture: true });
  const summary = {
    document: "fixture",
    procedure_count: 12,
    string_count: 34,
  };
  const calls: string[] = [];
  let closedRecords: readonly Evidence[] = [];
  const provider: AnalysisProvider = {
    identity: () => identity,
    capabilities: () =>
      (["read_binary_inventory_summary", "address_name"] as const).map(
        (operation) => ({
          provider: identity,
          operation,
          available: true,
          reason: null,
          cachePolicy: options.live === true ? "live" : "snapshot",
          limitations: [],
          effects: {
            mutatesArtifact: false,
            launchesProcess: false,
            mayShowUi: false,
            mayAccessNetwork: false,
            mayWriteFilesystem: false,
            changesPermissions: false,
            requiresRoot: false,
          },
        }),
      ),
    ...(options.profiled === false
      ? {}
      : { resolveAnalysisProfile: async () => ok({ profile }) }),
    createClient: () => ({
      execute: async (operation) => {
        calls.push(operation);
        if (operation === "read_binary_inventory_summary")
          await options.beforeSummary?.();
        if (
          !["health", "address_name", "read_binary_inventory_summary"].includes(
            operation,
          )
        )
          throw new Error(`Unexpected operation: ${operation}`);
        const observation = createAnalysisExecution(
          operation === "health"
            ? null
            : operation === "address_name"
              ? "unrelated history"
              : summary,
          identity,
        );
        return ok({
          ...observation,
          ...(options.spoofedEvidenceId === undefined
            ? {}
            : { evidenceId: options.spoofedEvidenceId }),
        });
      },
      close: async () => {
        // DirectAnalysis clears the ledger only after this legitimate close.
        closedRecords = session.exportEvidenceBundle().records;
        return ok(null);
      },
    }),
  };
  const session = createTestBinarySession(provider);
  onTestFinished(async () => {
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  });
  const createSession = () => session;
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () => parseConfig({}),
    createBinarySession: createSession,
    createNativeDispatchBinarySession: createSession,
    createArtifactBinarySession: createSession,
    createNativeBinarySession: createSession,
    createManagedBinarySession: createSession,
  };
  const open = async () => {
    const opened = await session.open(path);
    if (!opened.ok) throw opened.error;
    return opened.value;
  };
  return {
    path,
    profile,
    summary,
    calls,
    session,
    dependencies,
    open,
    closedRecords: () => closedRecords,
  };
};
