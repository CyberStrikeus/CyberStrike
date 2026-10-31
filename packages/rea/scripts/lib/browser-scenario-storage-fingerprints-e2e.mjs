import assert from "node:assert/strict";
import { requireMcpEvidenceBundle } from "./mcp-verifier-results.mjs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { parseEvidence } from "../../dist/domain/evidence.js";
import { artifactCliEvidence, artifactMcpCall } from "./artifact-e2e.mjs";
import {
  runScenarioCli,
  scenarioProfiles,
} from "./browser-scenario-verifier.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

const secretVariable = "REA_BROWSER_FINGERPRINT_VERIFIER_SECRET";
const secret = "rea-storage-fingerprint-private";
const utf8Digest = (value) => createHash("sha256").update(value).digest("hex");
const literal = (value) => ({ source: "literal", value });
const secretReference = { source: "secret", secret_id: "storage_secret" };

const scenarioFor = (executable, origin, value) => {
  const entries = [
    { name: "value", value: literal(value) },
    { name: "ordinary", value: literal("ordinary-value") },
    { name: "secret", value: secretReference },
  ];
  return {
    browser: { mode: "launch", executable_path: executable },
    start_url: { url: `${origin}/scenario-environment` },
    actions: [
      { step_id: "settle", action: "wait_for_timeout", duration_ms: 1 },
    ],
    storage: {
      // The shared site's favicon response also sets this same cookie.
      cookies: [
        ["rea-root-cookie", literal("root-fixture")],
        ["ordinary", literal("ordinary-value")],
        ["secret", secretReference],
      ].map(([name, value]) => ({
        name,
        value,
        destination: { url: origin },
        http_only: false,
        secure: false,
        same_site: "Lax",
      })),
      local_storage: [{ origin, entries }],
      session_storage: [{ origin, entries }],
    },
    secrets: [
      { secret_id: "storage_secret", environment_variable: secretVariable },
    ],
    capture: { after_each_step: ["storage"], at_end: ["storage"], events: [] },
  };
};

const assertCapture = (evidence) => {
  const capture = evidence.normalized_result;
  assert.equal(capture.browser.cleanup, "terminated-owned-process");
  assert.equal(capture.completeness.equality_eligible, true);
  assert.ok(!JSON.stringify(evidence).includes(secret));
  assert.ok(!JSON.stringify(evidence).includes(utf8Digest(secret)));
  for (const step of capture.steps) {
    assert.equal(step.artifacts.storage.state, "captured");
    const storage = step.artifacts.storage.value;
    assert.equal(storage.fingerprint_version, 2);
    for (const entries of [
      storage.cookies,
      storage.local_storage,
      storage.session_storage,
    ]) {
      const byName = new Map(entries.map((entry) => [entry.name, entry]));
      assert.equal(
        byName.get("ordinary")?.value_sha256,
        utf8Digest("ordinary-value"),
      );
      assert.equal(byName.get("secret")?.value_state, "redacted-secret");
      assert.equal(byName.get("secret")?.value_sha256, null);
    }
  }
};

const assertComparison = (evidence, expected) => {
  const result = evidence.normalized_result;
  assert.equal(result.overall_status, expected);
  for (const step of result.steps) {
    assert.equal(step.status, expected);
    assert.deepEqual(
      step.artifact_diffs.map(({ artifact, status }) => ({ artifact, status })),
      expected === "unchanged"
        ? []
        : [{ artifact: "storage", status: expected }],
    );
  }
};

const verifyValues = async (capture, compare) => {
  const captures = [];
  // The fourth capture is independent, not a self-comparison equality control.
  for (const value of ["\ud800", "\ud801", "\ufffd", "\ud800"]) {
    const evidence = await capture(value);
    assertCapture(evidence);
    captures.push(evidence);
  }
  for (const [index, expected] of [
    [1, "changed"],
    [2, "changed"],
    [3, "unchanged"],
  ])
    assertComparison(
      await compare(
        captures[0].normalized_result,
        captures[index].normalized_result,
      ),
      expected,
    );
  // Version-less imported snapshots must never receive new-scheme trust.
  const current = captures[0].normalized_result;
  const legacy = structuredClone(current);
  for (const step of legacy.steps)
    delete step.artifacts.storage.value.fingerprint_version;
  for (const [before, after] of [
    [legacy, legacy],
    [legacy, current],
    [current, legacy],
  ])
    assertComparison(await compare(before, after), "unknown");
  return captures;
};

/** Real owned Chromium, public CLI and schema-validated stdio MCP storage identity. */
export async function verifyScenarioStorageFingerprints(executable, origin) {
  const previousSecret = process.env[secretVariable];
  const profilesBefore = await scenarioProfiles();
  process.env[secretVariable] = secret;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../rea.mjs", import.meta.url)), "mcp"],
    env: process.env,
    stderr: "pipe",
  });
  const client = new Client({
    name: "browser-storage-fingerprints-e2e",
    version: "1",
  });
  return withVerifierCleanup(async () => {
    const cli = await verifyValues(
      (value) => runScenarioCli(scenarioFor(executable, origin, value)),
      (before, after) =>
        artifactCliEvidence("compare-web-captures", JSON.stringify(before), [
          JSON.stringify(after),
        ]),
    );
    await client.connect(transport);
    const call = async (name, arguments_) => {
      const result = await artifactMcpCall(client, {
        name,
        arguments: arguments_,
      });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.structuredContent;
    };
    const mcp = await verifyValues(
      async (value) =>
        parseEvidence(
          await call(
            "capture_browser_scenario",
            scenarioFor(executable, origin, value),
          ),
        ),
      async (before, after) =>
        parseEvidence(
          await call("compare_web_captures", {
            before_scenario: before,
            after_scenario: after,
          }),
        ),
    );
    for (const [index, evidence] of cli.entries())
      assert.deepEqual(
        evidence.normalized_result.steps.map((step) => step.artifacts.storage),
        mcp[index].normalized_result.steps.map(
          (step) => step.artifacts.storage,
        ),
      );
    const bundleReply = await artifactMcpCall(client, {
      name: "get_evidence_bundle",
      arguments: {},
    });
    assert.ok(
      bundleReply.structuredContent,
      "MCP omitted structured Evidence bundle",
    );
    const bundle = requireMcpEvidenceBundle(bundleReply);
    for (const evidence of mcp) {
      const record = bundle.records.find(
        ({ evidence_id }) => evidence_id === evidence.evidence_id,
      );
      assert.deepEqual(record, evidence);
    }
    await client.ping();
    return {
      mocked: false,
      cli: true,
      stdio_mcp: true,
      independent_captures: 8,
      changed_code_units: true,
      unchanged_control: true,
      ordinary_utf8_preserved: true,
      declared_secrets_redacted: true,
      retained_evidence: true,
      versionless_captures_unknown: true,
    };
  }, [
    () => {
      if (previousSecret === undefined) delete process.env[secretVariable];
      else process.env[secretVariable] = previousSecret;
    },
    () => client.close(),
    () => transport.close(),
    async () =>
      assert.ok(
        [...(await scenarioProfiles())].every((profile) =>
          profilesBefore.has(profile),
        ),
      ),
  ]);
}
