import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { firmwareResultSchemas } from "../../../dist/domain/firmware/firmwareAnalysis.js";
import { parseEvidence } from "../../../dist/domain/evidence.js";
import { ArtifactResourceScope } from "../../../dist/artifacts/ArtifactResourceScope.js";
import { hashVerifierFile } from "../../lib/verifier-file-resources.mjs";
import {
  closeVerifierResources,
  withVerifierCleanup,
} from "../../lib/verifier-cleanup.mjs";

const execFileAsync = promisify(execFile);
const { join, resolve, dirname } = nodePath;

const CALL_TIMEOUT_MS = 150_000;
const CONNECT_TIMEOUT_MS = 30_000;
const SEVENZIP_TIMEOUT_MS = 10_000;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ENTRYPOINT = resolve(
  process.env.REA_FIRMWARE_TEST_ENTRYPOINT ??
    join(REPO_ROOT, "scripts/rea.mjs"),
);
const FIXTURE_ROOT = resolve(
  process.env.REA_FIRMWARE_FIXTURE_ROOT ??
    join(REPO_ROOT, "_reference/firmware-integration/generated"),
);

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

async function checkPrerequisites() {
  if (process.platform !== "linux") {
    throw new Error(
      "verify:firmware requires Linux; other hosts are not verified",
    );
  }

  for (const name of ["REA_BINWALK_COMMAND", "REA_UNBLOB_COMMAND"]) {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(
        `verify:firmware requires ${name}; see docs/firmware-analysis.md`,
      );
    }
    await fs.access(value);
  }

  try {
    await execFileAsync("7z", ["i"], { timeout: SEVENZIP_TIMEOUT_MS });
  } catch (cause) {
    throw new Error(
      "verify:firmware prerequisite unavailable: Unblob's gzip/USTAR fixture extraction requires 7z on PATH",
      { cause },
    );
  }

  try {
    await fs.access(join(FIXTURE_ROOT, "oracle.json"));
  } catch (cause) {
    throw new Error(
      "verify:firmware requires generated fixtures; run npm run fixtures:firmware",
      { cause },
    );
  }
}

await checkPrerequisites();

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const oracle = JSON.parse(
  await fs.readFile(join(FIXTURE_ROOT, "oracle.json"), "utf8"),
);
const firmwarePath = join(FIXTURE_ROOT, "firmware.bin");
const fileResources = new ArtifactResourceScope();

const workDir = await fs.mkdtemp(join(tmpdir(), "rea-real-firmware-"));
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined),
);
const mcpClient = new Client({
  name: "rea-real-firmware-verifier",
  version: "1",
});

// ---------------------------------------------------------------------------
// Invocation helpers
// ---------------------------------------------------------------------------

async function runCli(args, env = baseEnv) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [ENTRYPOINT, ...args, "--format", "json"],
    {
      env,
      cwd: REPO_ROOT,
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: MAX_STDOUT_BYTES,
    },
  );
  return parseEvidence(JSON.parse(stdout));
}

async function callTool(name, args) {
  const result = await mcpClient.callTool(
    { name, arguments: args },
    { timeout: CALL_TIMEOUT_MS },
  );
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.structuredContent !== undefined);
  return result.structuredContent;
}

// ---------------------------------------------------------------------------
// Result verifiers
// ---------------------------------------------------------------------------

function verifyRegions(evidence) {
  assert.equal(evidence.subject.digest.sha256, oracle.sha256);

  const parsed = firmwareResultSchemas.inspect_firmware_regions.parse(
    evidence.normalized_result,
  );

  const gzipRegion = parsed.regions.find(
    (r) => r.signature === "gzip" && r.offset === oracle.offset,
  );
  assert.ok(
    gzipRegion !== undefined,
    "Binwalk must find the independently generated gzip offset",
  );
  assert.equal(gzipRegion.reported_size, oracle.length);
  assert.equal(gzipRegion.size_basis, "provider_reported_validation_unknown");

  // Strip provider-specific ids so CLI and MCP results compare equal.
  return parsed.regions.map((region) => {
    const { provider_id: _ignored, ...rest } = region;
    return rest;
  });
}

async function verifyFiles(evidence) {
  const parsed = firmwareResultSchemas.extract_firmware.parse(
    evidence.normalized_result,
  );

  assert.ok(parsed.chunks.some((c) => c.handler === "gzip"));

  for (const [suffix, expected] of Object.entries(oracle.files)) {
    const entry = parsed.files.find((f) =>
      f.relative_path.endsWith(`/${suffix}`),
    );
    assert.ok(entry !== undefined, `Missing extracted ${suffix}`);
    assert.equal(entry.sha256, expected.sha256);
    assert.equal(entry.size, expected.size);
    assert.equal(
      (await hashVerifierFile(entry.path, fileResources)).sha256,
      expected.sha256,
    );
    assert.equal(entry.original_file_range, null);
    assert.equal(entry.runtime_address, null);
  }

  return parsed;
}

const toContentIdentity = (parsed) =>
  parsed.files.map(({ relative_path, sha256, size }) => ({
    relative_path,
    sha256,
    size,
  }));

// ---------------------------------------------------------------------------
// Verification stages
// ---------------------------------------------------------------------------

async function stageCli() {
  const regionsEvidence = await runCli([
    "inspect-firmware-regions",
    firmwarePath,
  ]);
  const regions = verifyRegions(regionsEvidence);

  const extractEvidence = await runCli([
    "extract-firmware",
    firmwarePath,
    join(workDir, "cli-output"),
  ]);
  const files = await verifyFiles(extractEvidence);

  assert.equal(files.coverage, "partial");
  assert.ok(
    files.chunks.some(
      (c) =>
        c.handler === null && c.range.offset === 0 && c.range.length === 64,
    ),
  );

  assert.ok(
    files.extraction_gaps.some(
      (gap) =>
        gap.kind === "unknown-chunk-handler" &&
        gap.range !== null &&
        gap.range.offset === 0 &&
        gap.range.length === 64,
    ),
    "The unknown chunk must carry its explicit recovery row",
  );
  return { regions, files };
}

async function connectMcp() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRYPOINT, "mcp"],
    cwd: REPO_ROOT,
    env: baseEnv,
    stderr: "pipe",
  });
  await mcpClient.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
}

async function stageMcp(cli) {
  const regionsRaw = await callTool("inspect_firmware_regions", {
    path: firmwarePath,
  });
  assert.deepEqual(verifyRegions(parseEvidence(regionsRaw)), cli.regions);

  const extractRaw = await callTool("extract_firmware", {
    path: firmwarePath,
    output_directory: join(workDir, "mcp-output"),
  });
  const mcpFiles = await verifyFiles(parseEvidence(extractRaw));
  assert.deepEqual(toContentIdentity(mcpFiles), toContentIdentity(cli.files));

  const rangedRaw = await callTool("extract_firmware", {
    path: firmwarePath,
    output_directory: join(workDir, "selected-output"),
    range: { offset: oracle.offset, length: oracle.length },
  });
  const ranged = await verifyFiles(parseEvidence(rangedRaw));
  assert.equal(ranged.selection.offset, oracle.offset);
  assert.equal(ranged.selection.length, oracle.length);

  const depthRaw = await callTool("extract_firmware", {
    path: firmwarePath,
    output_directory: join(workDir, "depth-output"),
    max_depth: 1,
  });
  const depthParsed = firmwareResultSchemas.extract_firmware.parse(
    depthRaw.normalized_result,
  );
  assert.equal(depthParsed.coverage, "partial");
  assert.ok(depthParsed.depth_limited_paths.length > 0);
  assert.ok(
    depthParsed.extraction_gaps.some(
      (gap) =>
        gap.kind === "depth-limited" &&
        gap.dependencies.length === 0 &&
        depthParsed.extraction_continuations.some(
          ({ id, instruction }) =>
            id === gap.continuation_id &&
            instruction.includes("max_depth") &&
            instruction.includes("fresh output_directory"),
        ),
    ),
    "Depth-limited paths must carry the explicit depth continuation",
  );

  console.log(
    "PASS real Binwalk/Unblob: CLI, MCP, independent offsets/digests, range extraction, unknown chunks and depth limits",
  );

  return mcpFiles;
}

async function stageExt4() {
  const ext4Path = join(FIXTURE_ROOT, "ext4.bin");
  await fs.access(ext4Path);

  const raw = await callTool("extract_firmware", {
    path: ext4Path,
    output_directory: join(workDir, "ext4-output"),
  });
  const parsed = firmwareResultSchemas.extract_firmware.parse(
    raw.normalized_result,
  );
  assert.ok(parsed.chunks.some((c) => c.handler === "extfs"));
  assert.equal(parsed.coverage, "complete");

  for (const [suffix, expected] of Object.entries(oracle.files)) {
    const match = parsed.files.find((f) =>
      f.relative_path.endsWith(`/${suffix}`),
    );
    assert.equal(match?.sha256, expected.sha256);
  }
  console.log("PASS real ext4 extraction with debugfs; no mounts");

  // Keep the process-ownership utility available but hide every extractor.
  const emptyBin = join(workDir, "without-extractors");
  await fs.access("/bin/ps");
  await fs.mkdir(emptyBin);
  await fs.symlink("/bin/ps", join(emptyBin, "ps"));

  const degraded = await runCli(
    ["extract-firmware", ext4Path, join(workDir, "missing-extractor-output")],
    { ...baseEnv, PATH: emptyBin },
  );
  const degradedParsed = firmwareResultSchemas.extract_firmware.parse(
    degraded.normalized_result,
  );
  assert.equal(degradedParsed.coverage, "partial");
  assert.ok(JSON.stringify(degradedParsed.diagnostics).includes("debugfs"));
  assert.ok(
    degradedParsed.extraction_gaps.some(
      (gap) =>
        gap.kind === "missing-extractor-dependency" &&
        gap.dependencies.includes("debugfs") &&
        gap.handler === "extfs",
    ),
    "The missing extractor must be named in its explicit recovery row",
  );
  console.log(
    "PASS real missing-extractor diagnostics and recovery row retained despite Unblob exit 1",
  );
}

async function stageGhidra(mcpFiles) {
  if (process.env.GHIDRA_INSTALL_DIR === undefined) {
    throw new Error(
      "Firmware Ghidra handoff requires GHIDRA_INSTALL_DIR and Java; see docs/ghidra.md",
    );
  }

  const probe = mcpFiles.files.find((f) =>
    f.relative_path.endsWith("/usr/bin/probe"),
  );
  assert.ok(probe !== undefined);

  await callTool("open_binary", { path: probe.path, provider_id: "ghidra" });

  const dossierRaw = await callTool("analyze_function", {
    procedure: "firmware_probe",
    detail: "complete",
  });
  const dossier = parseEvidence(dossierRaw);
  assert.equal(
    dossier.subject.digest.sha256,
    oracle.files["usr/bin/probe"].sha256,
  );

  const pseudoRaw = await callTool("procedure_pseudo_code", {
    procedure: "firmware_probe",
  });
  assert.equal(parseEvidence(pseudoRaw).provider.id, "ghidra");
  assert.ok(
    JSON.stringify(dossier.normalized_result).includes("firmware_probe"),
  );

  await callTool("close_binary", {});
  console.log(
    "PASS real Ghidra handoff of the selected extracted host ELF, bound to its digest",
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

await withVerifierCleanup(async () => {
  assert.equal(
    (await hashVerifierFile(firmwarePath, fileResources)).sha256,
    oracle.sha256,
  );
  const cli = await stageCli();
  await connectMcp();
  const mcpFiles = await stageMcp(cli);

  if (process.env.REA_FIRMWARE_VERIFY_EXT4 === "1") await stageExt4();
  if (process.env.REA_FIRMWARE_VERIFY_GHIDRA === "1")
    await stageGhidra(mcpFiles);

  assert.equal(
    (await hashVerifierFile(firmwarePath, fileResources)).sha256,
    oracle.sha256,
    "Original firmware bytes must remain unchanged",
  );
}, [
  async () => {
    await closeVerifierResources([
      () => mcpClient.close(),
      () => fileResources.close(),
    ]);
    await fs.rm(workDir, { recursive: true, force: true });
  },
]);
