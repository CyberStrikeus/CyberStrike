#!/usr/bin/env node

import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  constants,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "../dist/server/createServer.js";

const execFileAsync = promisify(execFile);
const cli = resolve("scripts/rea.mjs");
const runCli = async (...arguments_) => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cli, ...arguments_, "--format", "json"],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    },
  );
  return JSON.parse(stdout);
};

const projectRoot = await mkdtemp(join(tmpdir(), "rea-cutter-smoke-"));
const projectPath = join(projectRoot, "smoke.rzdb");
const rizinQuote = (value) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const unavailableAnalysis = {
  execute: async () => {
    throw new Error(
      "The Cutter verification does not call unrelated analysis tools.",
    );
  },
};
const expectedPlatform = {
  Linux: "linux",
  macOS: "darwin",
  Windows: "win32",
}[process.env.EXPECTED_PLATFORM];
if (expectedPlatform !== undefined)
  assert.equal(
    process.platform,
    expectedPlatform,
    "Cutter runner did not match its declared platform.",
  );
try {
  const discovery = await runCli("list-cutter-sessions");
  assert.equal(
    discovery.discovery_status,
    "sessions_found",
    "Open upstream Cutter with the REA plugin before running this smoke test.",
  );
  assert.ok(discovery.sessions.length > 0);
  const session = discovery.sessions[0];
  assert.ok(session);
  assert.ok(
    session.cutter_version,
    "The upstream Cutter API did not report its version.",
  );
  if (process.env.REA_CUTTER_EXPECTED_VERSION !== undefined)
    assert.ok(
      session.cutter_version.includes(process.env.REA_CUTTER_EXPECTED_VERSION),
      "The live Cutter version did not match the configured version.",
    );
  assert.ok(
    session.current_file,
    "Open a disposable local binary in Cutter before running this smoke test.",
  );
  const artifactPath = session.current_file;
  const artifactDigest = createHash("sha256")
    .update(await readFile(artifactPath))
    .digest("hex");

  const inspection = await runCli(
    "cutter-command",
    session.session_id,
    String(session.document_generation),
    "ij",
    "--json-output",
  );
  assert.equal(inspection.predicate_type, "rea.cutter.command-observation");
  assert.ok(
    Object.hasOwn(inspection, "raw_result"),
    "Cutter ij result was not retained as Evidence.",
  );
  assert.equal(typeof inspection.raw_result.bin?.arch, "string");

  const mcpServer = createServer(
    { kind: "fixed", analysis: unavailableAnalysis },
    {
      providerEnvironment: process.env,
    },
  );
  const mcpClient = new Client({
    name: "rea-cutter-upstream-smoke",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    const mcpDiscovery = await mcpClient.callTool({
      name: "list_cutter_sessions",
      arguments: {},
    });
    assert.notEqual(mcpDiscovery.isError, true);
    assert.equal(
      mcpDiscovery.structuredContent.discovery_status,
      "sessions_found",
    );
    const mcpInspection = await mcpClient.callTool({
      name: "cutter_command",
      arguments: {
        session_id: session.session_id,
        expected_generation: session.document_generation,
        command: "ij",
        json: true,
      },
    });
    assert.notEqual(mcpInspection.isError, true);
    assert.deepEqual(
      mcpInspection.structuredContent.normalized_result,
      inspection.normalized_result,
      "Cutter CLI and MCP returned different analysis results.",
    );
  } finally {
    await mcpClient.close();
    await mcpServer.close();
  }

  const annotation = `rea-smoke-${randomUUID()}`;
  await runCli(
    "cutter-command",
    session.session_id,
    String(session.document_generation),
    `CC ${annotation} @ entry0`,
  );
  await runCli(
    "cutter-command",
    session.session_id,
    String(session.document_generation),
    `Ps ${rizinQuote(projectPath)}`,
  );
  await access(projectPath, constants.R_OK | constants.W_OK);
  await runCli(
    "cutter-command",
    session.session_id,
    String(session.document_generation),
    "CC- @ entry0",
  );
  const removed = await runCli(
    "cutter-command",
    session.session_id,
    String(session.document_generation),
    "CC. @ entry0",
  );
  assert.ok(
    !String(removed.raw_result).includes(annotation),
    "The in-memory annotation was not removed before project reopening.",
  );
  await runCli(
    "cutter-command",
    session.session_id,
    String(session.document_generation),
    `Po ${rizinQuote(projectPath)}`,
  );
  const recovered = await runCli(
    "cutter-command",
    session.session_id,
    String(session.document_generation),
    "CC. @ entry0",
  );
  assert.equal(recovered.predicate_type, "rea.cutter.command-observation");
  assert.ok(
    String(recovered.raw_result).includes(annotation),
    "The saved project did not preserve the analysis comment after reopening.",
  );
  const finalArtifactDigest = createHash("sha256")
    .update(await readFile(artifactPath))
    .digest("hex");
  assert.equal(
    finalArtifactDigest,
    artifactDigest,
    "Cutter project edits changed the executable bytes.",
  );

  const report = {
    ok: true,
    platform: process.platform,
    cutter_version: session.cutter_version,
    document_generation: session.document_generation,
    cli_mcp_evidence_parity: true,
    annotation_saved_and_reopened: true,
    executable_digest_unchanged: true,
  };
  await writeFile("cutter-smoke.json", `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}
