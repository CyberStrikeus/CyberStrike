import { projectCliAnalysisResult } from "../../dist/cli/projectCliAnalysisResult.js";
import { parseConfig } from "../../dist/config/parseConfig.js";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  runDirectAnalysis,
  runProviderAnalysis,
} from "../../dist/application/DirectAnalysis.js";
import { BinarySession } from "../../dist/application/binary/BinarySession.js";
import { SessionProviderRouter } from "../../dist/application/binary/SessionProviderRouter.js";
import { AnalysisProviderRegistry } from "../../dist/application/binary/AnalysisProviderRegistry.js";
import { createAnalysisExecution } from "../../dist/application/AnalysisProvider.js";
import { AnalysisCancelledError } from "../../dist/domain/analysisErrorCore.js";
import { err, ok } from "../../dist/domain/result.js";

const [root, mode] = process.argv.slice(2);
if (!root || !["direct", "native", "managed"].includes(mode))
  throw new Error(
    "Expected a fixture root and a direct, native, or managed mode",
  );
const target = join(root, "target.hop");
await writeFile(target, "fixture");
const client = {
  async execute(operation, _arguments, options) {
    if (operation === "health")
      return ok(
        createAnalysisExecution(null, {
          id: "fixture",
          name: "Fixture",
          version: "1",
        }),
      );
    await writeFile(join(root, "executing"), "ready");
    await new Promise((resolve) => {
      if (options.signal.aborted) resolve();
      else options.signal.addEventListener("abort", resolve, { once: true });
    });
    return err(new AnalysisCancelledError(operation));
  },
  async close() {
    await writeFile(join(root, "cleanup-started"), "ready");
    while (true) {
      try {
        await access(join(root, "release-cleanup"));
        break;
      } catch (cause) {
        if (cause.code !== "ENOENT") throw cause;
      }
      await delay(5);
    }
    await writeFile(join(root, "cleanup-complete"), "complete");
    return ok(null);
  },
};
const identity = { id: "fixture", name: "Fixture", version: "1" };
const provider = {
  identity: () => identity,
  capabilities: () =>
    ["read_bytes", "procedure_address", "inspect_managed_artifact"].map(
      (operation) => ({
        provider: identity,
        operation,
        available: true,
        reason: null,
        effects: {
          mutatesArtifact: false,
          launchesProcess: false,
          mayShowUi: false,
          mayAccessNetwork: false,
          mayWriteFilesystem: false,
          changesPermissions: false,
          requiresRoot: false,
        },
        limitations: [],
      }),
    ),
  createClient: () => client,
};
const createSession = () =>
  new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), [
      provider,
    ]),
  );
const dependencies = {
  readConfiguration: () => parseConfig({}),
  createBinarySession: createSession,
  createManagedBinarySession: createSession,
};
const interruptListeners = process.listenerCount("SIGINT");
const terminateListeners = process.listenerCount("SIGTERM");
// The production provider owns sockets/process handles; keep this fixture alive
// while its replacement waits only on a signal.
const keepAlive = setInterval(() => {}, 1000);
const result =
  mode === "direct"
    ? await runDirectAnalysis(dependencies, target, "read_bytes", {
        address: "0x0",
        length: 1,
      }).then(projectCliAnalysisResult)
    : await runProviderAnalysis(
        dependencies,
        target,
        mode === "managed" ? "inspect_managed_artifact" : "procedure_address",
        mode === "managed" ? {} : { procedure: "fixture" },
      ).then(projectCliAnalysisResult);
clearInterval(keepAlive);
if (
  process.listenerCount("SIGINT") !== interruptListeners ||
  process.listenerCount("SIGTERM") !== terminateListeners
)
  throw new Error("Analysis leaked process cancellation listeners");
process.stdout.write(JSON.stringify(result));
