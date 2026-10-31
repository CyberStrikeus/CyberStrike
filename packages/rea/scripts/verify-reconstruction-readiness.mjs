import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { tsImport } from "tsx/esm/api";

import { requireMcpOutput } from "./lib/mcp-verifier-results.mjs";
import { parseEvidence } from "../dist/domain/evidence.js";
import { createEvidenceBundle } from "../dist/domain/evidenceBundle.js";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";

const [
  { RECONSTRUCTION_READINESS_EXAMPLE },
  { createReconstructionReadinessReport },
  { reconstructionReadinessReportSchema },
] = await Promise.all(
  [
    "reconstructionReadinessExample",
    "reconstructionReadiness",
    "reconstructionReadinessSchemas",
  ].map((name) =>
    tsImport(
      new URL(
        `../tests/conformance/readiness/report/${name}.ts`,
        import.meta.url,
      ).href,
      import.meta.url,
    ),
  ),
);

const execute = promisify(execFile);
const root = process.cwd();
const nativePath = resolve(root, "build/conformance/c");
const fixtureRoot = resolve(root, "tests/conformance/readiness");
const javascriptPath = join(fixtureRoot, "javascript-cli");
const electronPath = join(fixtureRoot, "electron");
const environment = {
  ...process.env,
};
await access(nativePath);
const nativeEvidence = await runCli(["inspect-artifact", nativePath, "--json"]);
const javascriptCliEvidence = await runCli([
  "analyze-javascript-application",
  javascriptPath,
  "--json",
]);
const electronCliEvidence = await runCli([
  "analyze-javascript-application",
  electronPath,
  "--json",
]);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["scripts/rea.mjs", "mcp"],
  cwd: root,
  env: environment,
  stderr: "pipe",
});
const client = new Client({
  name: "rea-readiness-verifier",
  version: "1",
  capabilities: { elicitation: {} },
});

let verificationReport;
await withVerifierCleanup(async () => {
  await client.connect(transport);
  const catalog = await client.listTools();
  const sessionTool = catalog.tools.find(
    (tool) => tool.name === "binary_session",
  );
  assert.ok(sessionTool, "The live server must advertise binary_session");
  const sessionReply = await client.callTool(
    { name: "binary_session", arguments: {} },
    { toolDefinition: sessionTool },
  );
  assert.notEqual(sessionReply.structuredContent, undefined);
  const sessionStatus = requireMcpOutput(sessionReply, "binary_session").result;
  const javascriptMcp = await analyzeMcp(client, javascriptPath);
  const electronMcp = await analyzeMcp(client, electronPath);
  assert.equal(
    javascriptMcp.evidence_id,
    javascriptCliEvidence.evidence_id,
    "CLI/MCP JavaScript analysis Evidence identity drifted",
  );
  assert.equal(
    electronMcp.evidence_id,
    electronCliEvidence.evidence_id,
    "CLI/MCP Electron analysis Evidence identity drifted",
  );

  verificationReport = {
    schema: "ReconstructionReadinessVerificationReport",
    schema_version: 1,
    status: "pass",
    observed_journeys: {
      evidence_kind: "observed",
      scope: "static-cli-mcp",
      status: "pass",
      server_identity: sessionStatus.server_identity,
      evidence_bundles: {
        cli: createEvidenceBundle([
          nativeEvidence,
          javascriptCliEvidence,
          electronCliEvidence,
        ]),
        mcp: createEvidenceBundle([javascriptMcp, electronMcp]),
      },
      journeys: [
        {
          journey_id: "native-artifact-cli",
          operation: "inspect-artifact",
          surfaces: ["cli"],
          status: "pass",
          evidence_ids: [nativeEvidence.evidence_id],
          checks: ["cli-completed", "evidence-authenticated"],
        },
        ...[
          ["javascript-static-cli-mcp", javascriptCliEvidence],
          ["electron-static-cli-mcp", electronCliEvidence],
        ].map(([journeyId, evidence]) => ({
          journey_id: journeyId,
          operation: "analyze-javascript-application",
          surfaces: ["cli", "mcp"],
          status: "pass",
          evidence_ids: [evidence.evidence_id],
          checks: [
            "cli-completed",
            "mcp-completed",
            "evidence-authenticated",
            "evidence-identity-parity",
          ],
        })),
      ],
      limitations: [
        "Native MCP parity was not exercised.",
        "Fixture application runtime behavior was not executed.",
        "Authority recovery, cancellation cleanup, behavioral comparison, and reconstruction closure were not exercised.",
      ],
    },
    evaluator_conformance: verifySyntheticEvaluator(),
  };
}, [() => client.close(), () => transport.close()]);

if (process.env.REA_READINESS_REPORT_PATH !== undefined)
  await writeFile(
    resolve(root, process.env.REA_READINESS_REPORT_PATH),
    `${JSON.stringify(verificationReport, null, 2)}\n`,
  );
process.stdout.write(
  `${JSON.stringify({
    schema: verificationReport.schema,
    schema_version: verificationReport.schema_version,
    status: verificationReport.status,
    observed_journeys: {
      status: verificationReport.observed_journeys.status,
      scope: verificationReport.observed_journeys.scope,
      journeys: verificationReport.observed_journeys.journeys,
      limitations: verificationReport.observed_journeys.limitations,
    },
    evaluator_conformance: {
      status: verificationReport.evaluator_conformance.status,
      evidence_kind: verificationReport.evaluator_conformance.evidence_kind,
      checks: verificationReport.evaluator_conformance.checks,
      report_digest:
        verificationReport.evaluator_conformance.baseline_report.report_digest,
    },
  })}\n`,
);

async function runCli(arguments_) {
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", ...arguments_],
    {
      cwd: root,
      env: environment,
      maxBuffer: 64 * 1_024 * 1_024,
    },
  );
  return parseEvidence(JSON.parse(stdout));
}

async function analyzeMcp(client_, inputPath) {
  const response = await client_.callTool({
    name: "analyze_javascript_application",
    arguments: { input_path: inputPath },
  });
  assert.notEqual(response.structuredContent, undefined);
  return parseEvidence(
    requireMcpOutput(response, "analyze_javascript_application"),
  );
}

function verifySyntheticEvaluator() {
  const input = structuredClone(RECONSTRUCTION_READINESS_EXAMPLE);
  const evaluate = (value) =>
    reconstructionReadinessReportSchema.parse(
      createReconstructionReadinessReport(value),
    );
  const baseline = evaluate(input);
  assert.equal(baseline.status, "pass");
  assert.deepEqual(evaluate(structuredClone(input)), baseline);

  const tampered = structuredClone(input);
  const record = tampered.evidence_bundle.records[0];
  assert.ok(record, "Synthetic conformance requires Evidence");
  record.operation += "_tampered";
  assert.throws(
    () => evaluate(tampered),
    /Evidence semantic identifier does not match its record/u,
  );

  const stale = structuredClone(input);
  stale.replay.expected_source_digest = baseline.source_digest;
  stale.identity.server_version += "-changed";
  const staleReport = evaluate(stale);
  assert.equal(staleReport.status, "fail");
  assert.ok(
    staleReport.findings.some(
      ({ code }) => code === "replay-source-digest-mismatch",
    ),
  );
  return {
    evidence_kind: "synthetic",
    status: "pass",
    checks: [
      "baseline-accepted",
      "deterministic-evaluation",
      "tampered-evidence-rejected",
      "stale-source-rejected",
    ].map((checkId) => ({ check_id: checkId, status: "pass" })),
    baseline_report: baseline,
  };
}
