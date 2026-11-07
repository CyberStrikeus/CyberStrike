import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  firstProcedureAddress,
  requireAddressArray,
  requireFunctionDossier,
  requirePseudocode,
} from "./lib/real-hopper-assertions.mjs";
import { HOPPER_PROVIDER_IDENTITY } from "../dist/hopper/HopperProviderCapabilities.js";
import { HOPPER_TARGET_LEASE_DIRECTORY } from "../dist/process/HopperLease.js";
import { REA_WORKFLOW_PROVIDER } from "../dist/domain/investigationProviders.js";
import { loadRealHopperFixtureTargets } from "./lib/real-hopper-fixture.mjs";
import { verifyHopperStringObjects } from "./lib/real-hopper-search.mjs";
import {
  requireBridgeDiagnostic,
  requireBridgeProgress,
  requireCurrentDocument,
  requireSafeDiagnostics,
  requireTruthfulMemoryRegions,
  verifyRealHopperFixture,
} from "./lib/real-hopper-semantic.mjs";
import {
  mcpTextValue,
  requireEvidenceProvider,
  requireMcpOperationResult,
  requireMcpLifecycleResult,
  requireMcpEvidenceResult,
  sortVerifierNames,
  requireWorkflowEvidenceProvider,
} from "./lib/mcp-verifier-results.mjs";
import {
  verifyHopperTerminalInstructions,
  verifyHopperFunctionBasics,
} from "./lib/real-hopper-function-basics.mjs";
import { openAndVerifyLargeFixture } from "./lib/real-hopper-exhaustive-search.mjs";
import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";
import { requireHopperSelection } from "./lib/real-hopper-selection.mjs";
import { verifyHopperInventories } from "./lib/real-hopper-inventory.mjs";
import {
  verifyHopperBoundaryContracts,
  verifyHopperLifecycleAndCli,
} from "./lib/real-hopper-boundaries.mjs";
import { startUnrelatedHopperSentinel } from "./lib/unrelated-hopper-sentinel.mjs";
import { snapshotHopperRuntime } from "./lib/real-hopper-cleanup.mjs";
import { verifyLinuxHopperOwnerExit } from "./lib/real-hopper-owner-exit.mjs";
const execFileAsync = promisify(execFile);
const verifierRun = createVerifierRun();
const timeout = 180_000;
const parseServerArgs = (encoded) => {
  const parsed = JSON.parse(encoded);
  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string")
  )
    throw new Error("REA_VERIFY_SERVER_ARGS_JSON must encode string arguments");
  return parsed;
};

const runtimeParent = process.platform === "darwin" ? "/tmp" : tmpdir();
const sessionsBefore = await snapshotHopperRuntime(
  runtimeParent,
  HOPPER_TARGET_LEASE_DIRECTORY,
);
const ownedProcessIds = new Set();
const textValue = mcpTextValue;

const requireOverview = (value, operation) => {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.document !== "string" ||
    value.document.length === 0 ||
    !Number.isInteger(value.procedure_count) ||
    value.procedure_count < 1 ||
    !Number.isInteger(value.segment_count) ||
    value.segment_count < 1 ||
    !Array.isArray(value.segments)
  ) {
    throw new Error(`${operation} returned no analyzed binary overview`);
  }
  return value;
};

const verifyRelationships = async (client, options, procedure) => {
  const related = {};
  for (const operation of ["procedure_callers", "procedure_callees"]) {
    related[operation] = requireAddressArray(
      requireMcpEvidenceResult(
        await client.callTool(
          { name: operation, arguments: { procedure } },
          options,
        ),
        operation,
      ),
      operation,
    );
  }
  related.xrefs = requireAddressArray(
    requireMcpEvidenceResult(
      await client.callTool(
        { name: "xrefs", arguments: { address: procedure } },
        options,
      ),
      "xrefs",
    ),
    "xrefs",
  );
  return related;
};

const verifyByteAccess = async (client, options, firstAddress) => {
  const byteRead = requireMcpEvidenceResult(
    await client.callTool(
      { name: "read_bytes", arguments: { address: firstAddress, length: 16 } },
      options,
    ),
    "read_bytes",
  );
  if (
    byteRead?.address !== firstAddress ||
    byteRead.requested_bytes !== 16 ||
    byteRead.returned_bytes !== 16 ||
    byteRead.complete !== true ||
    !/^[a-f0-9]{32}$/u.test(byteRead.bytes_hex)
  ) {
    throw new Error("read_bytes returned an invalid bounded byte window");
  }
  const mappedOffset = requireMcpEvidenceResult(
    await client.callTool(
      {
        name: "address_to_file_offset",
        arguments: { address: firstAddress },
      },
      options,
    ),
    "address_to_file_offset",
  );
  if (
    mappedOffset?.address !== firstAddress ||
    !Number.isSafeInteger(mappedOffset.file_offset) ||
    mappedOffset.file_offset < 0
  ) {
    throw new Error("address_to_file_offset returned an invalid mapping");
  }
  return {
    byteReadCount: byteRead.returned_bytes,
    mappedFileOffset: mappedOffset.file_offset,
  };
};

const verifyCurrentTarget = async (client, options) => {
  const procedures = requireMcpEvidenceResult(
    await client.callTool({ name: "list_procedures", arguments: {} }, options),
    "list_procedures",
  );
  const firstAddress = firstProcedureAddress(procedures);
  const byteAccess = await verifyByteAccess(client, options, firstAddress);
  const basics = await verifyHopperFunctionBasics(
    client,
    options,
    firstAddress,
  );
  const relationships = await verifyRelationships(
    client,
    options,
    firstAddress,
  );
  const boundedResult = requireMcpEvidenceResult(
    await client.callTool(
      {
        name: "batch_decompile",
        arguments: { addresses: [firstAddress] },
      },
      options,
    ),
    "batch_decompile",
  );
  if (
    boundedResult === null ||
    typeof boundedResult !== "object" ||
    Array.isArray(boundedResult) ||
    boundedResult.total !== 1 ||
    boundedResult.succeeded !== 1 ||
    boundedResult.failed !== 0 ||
    !Array.isArray(boundedResult.items) ||
    boundedResult.items.length !== 1 ||
    boundedResult.items[0]?.address !== firstAddress ||
    boundedResult.items[0]?.status !== "ok"
  ) {
    throw new Error("batch_decompile returned an invalid result");
  }
  const boundedPseudocode = requirePseudocode(
    boundedResult.items[0].pseudocode,
    "batch_decompile",
  );
  const dossier = requireFunctionDossier(
    requireMcpEvidenceResult(
      await client.callTool(
        {
          name: "analyze_function",
          arguments: { procedure: firstAddress, detail: "complete" },
        },
        options,
      ),
      "analyze_function",
    ),
    firstAddress,
  );
  return {
    procedure: dossier.procedure,
    procedureCount: procedures.length,
    boundedPseudocodeChars: boundedPseudocode.length,
    analyzedPseudocodeChars: [...dossier.pseudocode].length,
    callerCount: relationships.procedure_callers.length,
    calleeCount: relationships.procedure_callees.length,
    xrefCount: relationships.xrefs.length,
    outgoingReferenceCount: basics.outgoingReferenceCount,
    instructionWindowCount: basics.instructionWindowCount,
    ...byteAccess,
  };
};

const fixtureManifestPath =
  process.env.REA_HOPPER_CONFORMANCE_MANIFEST_PATH ??
  "build/conformance/manifest.json";
const fixtureTargets = await loadRealHopperFixtureTargets(fixtureManifestPath);
const targetA = fixtureTargets.primary.path;
const targetB = fixtureTargets.secondary.path;
const largeTarget = fixtureTargets.large.path;
const targetHashA = fixtureTargets.primary.sha256;
const targetHashB = fixtureTargets.secondary.sha256;
const serverEnvironment = { ...process.env };
serverEnvironment.REA_ANALYSIS_PROVIDER = "auto";
delete serverEnvironment.HOPPER_TARGET_PATH;
delete serverEnvironment.HOPPER_SECOND_TARGET_PATH;
delete serverEnvironment.REA_VERIFY_SERVER_COMMAND;
delete serverEnvironment.REA_VERIFY_SERVER_ARGS_JSON;

const serverCommand = process.env.REA_VERIFY_SERVER_COMMAND ?? process.execPath;
const serverArgs = parseServerArgs(
  process.env.REA_VERIFY_SERVER_ARGS_JSON ?? '["dist/main.js"]',
);

const transport = new StdioClientTransport({
  command: serverCommand,
  args: serverArgs,
  cwd: process.cwd(),
  env: serverEnvironment,
  stderr: "pipe",
});
let stderrBytes = 0;
const stderrChunks = [];
transport.stderr?.on("data", (chunk) => {
  stderrBytes += chunk.length;
  stderrChunks.push(chunk.toString("utf8"));
});
const client = new Client({ name: "real-hopper-verifier", version: "1.0.0" });
const unrelatedHopper = await startUnrelatedHopperSentinel();
let unrelatedHopperSurvived = false;
let summary;

try {
  await client.connect(transport);
  if (transport.pid === null)
    throw new Error("The verifier did not capture its MCP process identity");
  ownedProcessIds.add(transport.pid);
  const progressUpdates = [];
  const options = {
    timeout,
    onprogress: (update) => progressUpdates.push(update),
  };
  const fullSessionStatus = () =>
    client.callTool({ name: "binary_session", arguments: {} }, options);
  const initialSession = await fullSessionStatus();
  const initialStatus = requireMcpLifecycleResult(
    initialSession,
    "binary_session",
  );
  const listed = await client.listTools();
  const availableTools = initialStatus.tool_availability;
  if (!Array.isArray(availableTools))
    throw new Error("The real session omitted tool availability");
  const expectedNames = sortVerifierNames(
    availableTools.map(({ name }) => name),
  );
  const actualNames = sortVerifierNames(listed.tools.map(({ name }) => name));
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    const expected = new Set(expectedNames);
    const actual = new Set(actualNames);
    throw new Error(
      `The real server tool catalog diverged from session capability inventory (untracked tools: ${actualNames.filter((name) => !expected.has(name)).join(", ") || "none"}; missing catalog tools: ${expectedNames.filter((name) => !actual.has(name)).join(", ") || "none"})`,
    );
  }

  if (initialStatus.open !== false)
    throw new Error("The verifier did not start without a target");
  requireHopperSelection(initialStatus, {
    targetSupport: "unknown",
    selected: false,
  });
  const opened = await client.callTool(
    { name: "open_binary", arguments: { path: targetA } },
    options,
  );
  if (opened.isError === true) throw new Error(textValue(opened));
  const firstStatus = requireMcpLifecycleResult(
    await fullSessionStatus(),
    "binary_session",
  );
  const providerBinding = requireHopperSelection(firstStatus, {
    targetSupport: "supported",
    selected: true,
  });
  const documents = await client.callTool(
    { name: "list_documents", arguments: {} },
    options,
  );
  requireMcpEvidenceResult(documents, "list_documents");
  requireBridgeProgress(progressUpdates);
  const rejectedProcedure = await client.callTool(
    {
      name: "procedure_info",
      arguments: { procedure: "__rea_missing_procedure__" },
    },
    options,
  );
  if (rejectedProcedure.isError !== true)
    throw new Error("The real Hopper bridge accepted an unknown procedure");
  const overview = await client.callTool(
    { name: "binary_overview", arguments: {} },
    options,
  );
  requireMcpEvidenceResult(overview, "binary_overview");
  const inventoryCounts = await verifyHopperInventories(client, options);
  requireEvidenceProvider(
    documents,
    "list_documents",
    HOPPER_PROVIDER_IDENTITY.id,
  );
  requireWorkflowEvidenceProvider(overview, "binary_overview", {
    workflowProviderId: REA_WORKFLOW_PROVIDER.id,
    upstreamProviderId: HOPPER_PROVIDER_IDENTITY.id,
  });
  const segments = await client.callTool(
    { name: "list_segments", arguments: {} },
    options,
  );
  requireTruthfulMemoryRegions(
    requireMcpEvidenceResult(segments, "list_segments"),
  );
  const firstDocuments = requireMcpEvidenceResult(documents, "list_documents");
  if (
    !Array.isArray(firstDocuments) ||
    firstDocuments.length === 0 ||
    typeof firstDocuments[0] !== "string"
  )
    throw new Error("list_documents returned no real Hopper document");
  const currentDocument = await requireCurrentDocument(
    client,
    options,
    firstDocuments,
    requireMcpEvidenceResult,
  );
  const firstOverview = requireOverview(
    requireMcpEvidenceResult(overview, "binary_overview"),
    "binary_overview",
  );
  if (firstOverview.document !== currentDocument)
    throw new Error(
      "binary_overview did not identify the selected Hopper document",
    );
  const firstAnalysis = await verifyCurrentTarget(client, options);
  const fixtureAnalysis = await verifyRealHopperFixture({
    client,
    options,
    document: currentDocument,
    oracle: fixtureTargets.oracle,
    normalizedResult: requireMcpEvidenceResult,
  });
  const boundaryContracts = await verifyHopperBoundaryContracts(
    client,
    options,
    fixtureAnalysis.procedures.entry,
    targetA,
  );
  const switched = await client.callTool(
    { name: "open_binary", arguments: { path: targetB } },
    options,
  );
  if (switched.isError === true) throw new Error(textValue(switched));
  const secondSession = requireMcpLifecycleResult(
    await fullSessionStatus(),
    "binary_session",
  );
  if (secondSession.path !== targetB)
    throw new Error("The real session did not switch to target B");
  requireHopperSelection(secondSession, {
    targetSupport: "supported",
    selected: true,
  });
  const secondOverview = await client.callTool(
    { name: "binary_overview", arguments: {} },
    options,
  );
  const verifiedSecondOverview = requireOverview(
    requireMcpEvidenceResult(secondOverview, "binary_overview"),
    "binary_overview after target switch",
  );
  const secondAnalysis = await verifyCurrentTarget(client, options);
  const documentsAfterTargetSwitch = requireMcpEvidenceResult(
    await client.callTool({ name: "list_documents", arguments: {} }, options),
    "list_documents",
  );
  const secondDocument = await requireCurrentDocument(
    client,
    options,
    documentsAfterTargetSwitch,
    requireMcpEvidenceResult,
  );
  if (verifiedSecondOverview.document !== secondDocument)
    throw new Error(
      "binary_overview retained another document after target switch",
    );
  const expectedDocumentsAfterTargetSwitch = firstDocuments.length;
  if (
    !Array.isArray(documentsAfterTargetSwitch) ||
    documentsAfterTargetSwitch.length !== expectedDocumentsAfterTargetSwitch
  )
    throw new Error(
      "Target switching did not replace the previous Hopper document",
    );
  const reopenedTarget = await client.callTool(
    { name: "open_binary", arguments: { path: targetB } },
    options,
  );
  if (reopenedTarget.isError === true)
    throw new Error(textValue(reopenedTarget));
  const documentsAfterReopen = requireMcpEvidenceResult(
    await client.callTool({ name: "list_documents", arguments: {} }, options),
    "list_documents",
  );
  if (
    !Array.isArray(documentsAfterReopen) ||
    documentsAfterReopen.length !== documentsAfterTargetSwitch.length
  )
    throw new Error(
      "Reopening the same target created a duplicate Hopper document",
    );
  const largeInventory = await openAndVerifyLargeFixture({
    client,
    options,
    normalizedResult: requireMcpEvidenceResult,
    path: largeTarget,
    expectedCount: fixtureTargets.largeOracle.symbolCount,
    symbolPrefix: fixtureTargets.largeOracle.symbolPrefix,
    stringPrefix: fixtureTargets.largeOracle.stringPrefix,
  });

  const processList = await execFileAsync("ps", ["-ax", "-o", "command="]);
  const bundledMcpRunning = processList.stdout
    .split("\n")
    .some((line) => line.trim().endsWith("/HopperMCPServer"));
  if (bundledMcpRunning) {
    throw new Error(
      "Hopper's bundled MCP server was running during verification",
    );
  }
  const closed = await client.callTool(
    { name: "close_binary", arguments: {} },
    options,
  );
  if (closed.isError === true) throw new Error(textValue(closed));
  let unicodeStrings = null;
  let terminalInstructions = null;
  if (fixtureTargets.unicode !== undefined) {
    const call = async (name, args = {}) =>
      requireMcpOperationResult(
        await client.callTool({ name, arguments: args }, options),
        name,
      );
    await call("open_binary", { path: fixtureTargets.unicode.path });
    terminalInstructions = await verifyHopperTerminalInstructions(call);
    unicodeStrings = await verifyHopperStringObjects(call, [
      { value: "REA_UTF16_é_😀", encoding: "utf-16-le" },
      { value: 'REA_UTF16_ESCAPED_é_"\\line\nend\t\r', encoding: "utf-16-le" },
      { value: "\nREA_UTF16_LEADING_é", encoding: "utf-16-le" },
    ]);
    await call("close_binary");
  }
  const lifecycleAndCli = await verifyHopperLifecycleAndCli(client, options, {
    primary: targetA,
    secondary: targetB,
    ...(fixtureTargets.unicode === undefined
      ? {}
      : { unicode: fixtureTargets.unicode.path }),
    ownedProcessIds,
  });
  const closedSession = requireMcpLifecycleResult(
    await fullSessionStatus(),
    "binary_session",
  );
  if (closedSession.open !== false)
    throw new Error("The real session remained open after close_binary");
  const diagnosticCount = requireSafeDiagnostics(
    stderrChunks,
    [
      "procedure_info",
      "batch_decompile",
      ...boundaryContracts.rejectedOperations,
    ],
    ["HopperRemoteError", "HopperCancelledError", "AnalysisCancelledError"],
  );
  requireBridgeDiagnostic(stderrChunks);

  summary = {
    toolCount: actualNames.length,
    documentCount: firstDocuments.length,
    overview: firstOverview,
    segmentCount: firstOverview.segment_count,
    analyses: [firstAnalysis, secondAnalysis],
    fixtureAnalysis,
    unicodeStrings,
    terminalInstructions,
    boundaryContracts,
    lifecycleAndCli,
    inventoryCounts,
    largeInventory,
    fixtureManifest: fixtureTargets.manifestPath,
    bundledMcpRunning,
    stderrBytes,
    diagnosticCount,
    bridgeProgressUpdates: progressUpdates.length,
    dynamicSession: true,
    providerBinding,
    targets: [targetA, targetB, largeTarget],
    targetHashes: [targetHashA, targetHashB, fixtureTargets.large.sha256],
    switched: true,
    secondOverview: verifiedSecondOverview,
    documentCountAfterTargetSwitch: documentsAfterTargetSwitch.length,
    documentCountAfterSameTargetReopen: documentsAfterReopen.length,
  };
} finally {
  const keepAlive = setInterval(() => undefined, 100);
  try {
    await client.close();
    await transport.close();
  } finally {
    clearInterval(keepAlive);
    unrelatedHopperSurvived = await unrelatedHopper.verifyAndClose();
  }
}

await new Promise((resolve) => setTimeout(resolve, 500));
const sessionsAfter = [
  ...(await snapshotHopperRuntime(
    runtimeParent,
    HOPPER_TARGET_LEASE_DIRECTORY,
    ownedProcessIds,
  )),
]
  .filter((path) => !sessionsBefore.has(path))
  .sort();
if (sessionsAfter.length > 0) {
  await writeVerificationReport({
    ...summary,
    unrelatedHopperSurvived,
    cleanShutdown: false,
    retainedRuntimePaths: sessionsAfter,
  });
  throw new Error(
    `The MCP runtime retained Hopper resources: ${sessionsAfter.join(", ")}`,
  );
}
if (summary === undefined)
  throw new Error("Real-Hopper verification did not produce a summary");
if (process.platform === "linux")
  summary.ownerExit = await verifyLinuxHopperOwnerExit({
    primary: targetA,
    secondary: targetB,
    serverCommand,
    serverArgs,
    environment: serverEnvironment,
  });
const completedVerifierRun = await completeVerifierRun(verifierRun);
if (
  completedVerifierRun.process_lineage.status !== "verified" ||
  completedVerifierRun.process_lineage.descendants.length !== 0
)
  throw new Error(
    "The verifier's process lineage did not prove owned child cleanup",
  );
await writeVerificationReport({
  verifier_run: completedVerifierRun,
  ...summary,
  unrelatedHopperSurvived,
  cleanShutdown: true,
});

async function writeVerificationReport(report) {
  await new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, (cause) => {
      if (cause) reject(cause);
      else resolve();
    });
  });
}
