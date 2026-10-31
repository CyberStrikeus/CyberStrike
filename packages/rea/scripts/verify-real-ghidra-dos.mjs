#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  requireMcpOperationResult,
  requireMcpOutput,
} from "./lib/mcp-verifier-results.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../dist/domain/evidence.js";
import { functionDossierSchema } from "../dist/domain/native/functionDossier.js";
import { functionBodySchema } from "../dist/domain/native/functionBody.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { buildDosMzFixture } from "../tests/conformance/ghidra/dos-mz-fixture.mjs";
import {
  assertVerifierCleanupComplete,
  createVerifierRun,
  completeVerifierRun,
} from "./lib/verifier-run.mjs";
import { verifyGhidraAddressBoundaries } from "./lib/real-ghidra-address-boundaries.mjs";

// This lane intentionally has no game paths, binary seeds or compiler dependency.
if (process.argv.length !== 2)
  throw new Error("Usage: node scripts/verify-real-ghidra-dos.mjs");
if (!["linux", "darwin"].includes(process.platform))
  throw new Error(
    "verify:ghidra:dos supports Linux/macOS hosts only; Windows P0 is PE x86-64 only.",
  );
if (process.env.GHIDRA_INSTALL_DIR === undefined)
  throw new Error(
    "verify:ghidra:dos prerequisite missing: GHIDRA_INSTALL_DIR (bring your own Ghidra).",
  );
const installation = await inspectVerifierGhidraInstallation({
  environment: process.env,
  installDir: process.env.GHIDRA_INSTALL_DIR,
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { javaHome: process.env.JAVA_HOME }),
});
if (installation.status !== "available")
  throw new Error(
    `verify:ghidra:dos prerequisite unavailable: ${JSON.stringify(installation)}`,
  );
const captureDirectory = process.env.REA_DOS_PROOF_CAPTURE_DIR;
if (captureDirectory !== undefined) {
  assert.ok(
    isAbsolute(captureDirectory),
    "REA_DOS_PROOF_CAPTURE_DIR must be absolute",
  );
  await mkdir(captureDirectory, { recursive: true, mode: 0o700 });
}
const run = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-dos-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const fixture = buildDosMzFixture();
const targetPath = join(workspace, "fixture.exe");
await writeFile(targetPath, fixture.bytes, { mode: 0o600 });
const sha256 = digest(fixture.bytes);
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: runtime,
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "ghidra",
  REA_PROCESS_RUN_ID: run.run_id,
  HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
  GHIDRA_INSTALL_DIR: process.env.GHIDRA_INSTALL_DIR,
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { JAVA_HOME: process.env.JAVA_HOME }),
};
const address = (offset) =>
  `0x${(fixture.load_segment * 16 + offset).toString(16)}`;
const expected = {
  entry: address(fixture.entry_offset),
  near: address(fixture.near_offset),
  far: address(fixture.far_offset),
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "rea-real-dos-proof", version: "1" });
let opened = false;
let stderr = "";
let report;
try {
  await client.connect(transport);
  transport.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-65536);
  });
  const target = await call("open_binary", {
    path: targetPath,
    provider_id: "ghidra",
  });
  opened = true;
  assert.equal(target.format, "dos-mz");
  assert.equal(target.kind, "executable");
  assert.equal(target.architecture, "x86");
  assert.equal(target.sha256, sha256);
  const image = await call("inspect_native_load_image");
  assert.equal(
    image.status,
    "verified",
    JSON.stringify(image.checks?.filter((check) => !check.matched)),
  );
  assert.equal(image.target_sha256, sha256);
  assert.equal(image.header_bytes, fixture.header_bytes);
  assert.equal(image.module_bytes, fixture.module_bytes);
  assert.equal(image.entry.linear_address, expected.entry);
  assert.ok(image.checks.every((check) => check.matched));
  const cliImage = await cliEvidence("inspect-native-load-image");
  // Snapshot filenames are session-specific. Every measured byte/range/check is stable.
  const stableImage = (value) => ({
    ...value,
    observations: {
      ...value.observations,
      source_files: value.observations.source_files.map(
        ({ name: _name, ...file }) => file,
      ),
    },
  });
  assert.deepEqual(stableImage(cliImage.normalized_result), stableImage(image));
  const mapped = await call("address_to_file_offset", {
    address: expected.entry,
  });
  assert.equal(mapped.file_offset, fixture.header_bytes);
  const headerMapping = await call("address_to_file_offset", {
    address: "HEADER:0x0",
  });
  assert.equal(headerMapping.file_offset, 0);
  const fileRelocation = await call("address_to_file_offset", {
    address: address(fixture.relocation_offset),
  });
  assert.equal(
    fileRelocation.file_offset,
    fixture.header_bytes + fixture.relocation_offset,
  );
  const memoryRelocation = await call("read_bytes", {
    address: address(fixture.relocation_offset),
    length: 2,
  });
  assert.equal(memoryRelocation.bytes_hex, "0410");
  assert.equal(memoryRelocation.complete, true);
  assert.deepEqual(
    (
      await cliEvidence("read-bytes", address(fixture.relocation_offset), [
        "--length",
        "2",
      ])
    ).normalized_result,
    memoryRelocation,
  );
  assert.deepEqual(
    (await cliEvidence("address-to-file-offset", expected.entry))
      .normalized_result,
    mapped,
  );
  const tail = await call("read_bytes", {
    address: address(fixture.module_bytes - 2),
    length: 8,
  });
  assert.equal(tail.returned_bytes, 2);
  assert.equal(tail.complete, false);
  const unmapped = await call("read_bytes", { address: "0x80000", length: 8 });
  assert.equal(unmapped.returned_bytes, 0);
  assert.equal(unmapped.complete, false);
  const noSource = await client.callTool({
    name: "address_to_file_offset",
    arguments: { address: "0x80000" },
  });
  assert.equal(noSource.isError, true);
  const procedures = await call("list_procedures");
  assert.ok(
    Array.isArray(procedures),
    "Public procedure inventory is not an array",
  );
  const identities = Object.fromEntries(
    Object.entries(expected).map(([key, value]) => {
      const item = procedures.find((candidate) => candidate.address === value);
      assert.ok(
        item,
        `Source-owned ${key} procedure ${value} was not discovered from MZ entry/call flow`,
      );
      return [key, item];
    }),
  );
  const session = await call("binary_session");
  const profile = session.analysis_provider_binding?.analysis_profile;
  assert.ok(profile, "Public session omitted committed profile");
  assertProfile(profile);
  assert.equal(session.sha256, sha256);
  assert.equal(session.open, true);
  const facts = {};
  for (const [key, identity] of Object.entries(identities)) {
    const procedure = identity.address; // Use returned addresses, never symbol-name heuristics.
    assert.match(procedure, /^0x[0-9a-f]+$/u);
    const resolved = await call("procedure_address", { procedure });
    assert.equal(resolved, procedure, "Flat address round-trip drifted");
    const info = await call("procedure_info", { procedure });
    const dossierResult = await evidenceCall("analyze_function", {
      procedure,
      detail: "complete",
    });
    const dossier = functionDossierSchema.parse(
      dossierResult.normalized_result,
    );
    assertBody(info.body, procedure);
    assertBody(dossier.procedure.body, procedure);
    assert.equal(info.entrypoint, procedure);
    assert.equal(info.length, info.body.total_bytes);
    assert.deepEqual(dossier.procedure.body, info.body);
    const containingQueries = [procedure, info.body.ranges.at(-1).end];
    for (const query of containingQueries) {
      const containing = await call("resolve_containing_procedure", {
        address: query,
      });
      assert.equal(containing.found, true);
      assert.equal(containing.query_address, query);
      assert.equal(containing.procedure.address, procedure);
      assert.deepEqual(containing.procedure.body, info.body);
    }
    if (key === "entry") {
      const gap = await call("resolve_containing_procedure", {
        address: address(0x10),
      });
      assert.equal(
        gap.found,
        false,
        "Gap inside enclosing span was treated as function body",
      );
      assert.equal(gap.reason, "not_in_procedure");
    }

    assert.ok(
      dossier.pseudocode.trim().length > 0,
      "Real DOS decompilation returned empty pseudocode",
    );
    assert.equal(dossier.procedure.address, procedure);
    const window = await call("read_function_instructions", { procedure });
    assert.deepEqual(window.procedure.body, info.body);
    assert.ok(window.instructions.length > 0);
    if (key === "entry") {
      assert.deepEqual(info.body.ranges, [
        { start: procedure, end: address(fixture.entry_first_bytes - 1) },
        {
          start: address(fixture.entry_tail_offset),
          end: address(
            fixture.entry_tail_offset + fixture.entry_tail_bytes - 1,
          ),
        },
      ]);
      assert.equal(
        info.body.total_bytes,
        fixture.entry_first_bytes + fixture.entry_tail_bytes,
      );
      assert.equal(
        info.body.span_bytes,
        fixture.entry_tail_offset + fixture.entry_tail_bytes,
      );
      assert.equal(info.body.non_contiguous, true);
    } else {
      const size =
        key === "near" ? fixture.near_body_bytes : fixture.far_body_bytes;
      assert.deepEqual(info.body.ranges, [
        {
          start: procedure,
          end: address(
            (key === "near" ? fixture.near_offset : fixture.far_offset) +
              size -
              1,
          ),
        },
      ]);
      assert.equal(info.body.total_bytes, size);
      assert.equal(info.body.span_bytes, size);
    }
    const cli = await cliEvidence("function", procedure);
    if (captureDirectory !== undefined) {
      await writeFile(
        join(captureDirectory, `public-fixture-${key}-cli.json`),
        `${JSON.stringify(cli, null, 2)}\n`,
        { mode: 0o600 },
      );
      await writeFile(
        join(captureDirectory, `public-fixture-${key}-mcp.json`),
        `${JSON.stringify(dossierResult, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
    const cliDossier = functionDossierSchema.parse(cli.normalized_result);
    assert.deepEqual(
      stableDossierObservations(cliDossier),
      stableDossierObservations(dossier),
      "CLI/MCP stable DOS dossier observations differ",
    );
    facts[key] = {
      address: procedure,
      body: info.body,
      instruction_count: window.instructions.length,
      pseudocode_nonempty: true,
      pseudocode: dossier.pseudocode,
      cli_mcp_observations_equal: true,
      containing_procedure_body_equal: true,
      limitations: dossier.limitations,
    };
  }
  const move = await call("inspect_native_instruction", {
    address: identities.entry.address,
  });
  assert.equal(move.status, "decoded");
  assert.equal(move.length, 3);
  assert.equal(hexBytes(move.bytes), "b83412");
  assert.match(move.mnemonic, /^MOV$/iu);
  assert.ok(
    move.operands
      .flatMap((operand) => operand.components)
      .some(
        (part) =>
          part.kind === "register" &&
          /^AX$/iu.test(part.text) &&
          part.bit_width === 16,
      ),
    "DOS entry was not decoded as 16-bit AX",
  );
  const nearMemory = await call("inspect_native_instruction", {
    address: identities.near.address,
  });
  assert.equal(nearMemory.status, "decoded");
  assert.equal(nearMemory.length, 2);
  assert.equal(hexBytes(nearMemory.bytes), "fe00");
  assert.match(nearMemory.mnemonic, /^INC$/iu);
  const nearCall = await call("inspect_native_instruction", {
    address: address(fixture.near_call_offset),
  });
  const farCall = await call("inspect_native_instruction", {
    address: address(fixture.far_call_offset),
  });
  assert.equal(hexBytes(nearCall.bytes), "e81a00");
  // Source far segment 0004 is relocated by the independently fixed 1000 load segment.
  assert.equal(hexBytes(farCall.bytes), "9a00000410");
  for (const [key, instruction] of [
    ["near", nearCall],
    ["far", farCall],
  ]) {
    assert.equal(instruction.flow.kind, "call");
    assert.ok(
      instruction.flow.direct_destinations.includes(identities[key].address),
    );
    const targets = await call("resolve_native_call_targets", {
      address: instruction.address,
    });
    assert.equal(targets.status, "direct");
    assert.ok(
      targets.targets.some(
        (target) => target.address === identities[key].address,
      ),
    );
  }
  const invalid = await client.callTool({
    name: "procedure_info",
    arguments: { procedure: "0xffffffffffffffff" },
  });
  assert.equal(invalid.isError, true, "Unmapped address did not fail");
  await verifyGhidraAddressBoundaries(
    client,
    identities.entry.address,
    cliEvidence,
  );
  const cliWindow = await cliEvidence("instructions", identities.entry.address);
  assert.deepEqual(
    cliWindow.normalized_result,
    await call("read_function_instructions", {
      procedure: identities.entry.address,
    }),
  );
  assert.equal(
    digest(await readFile(targetPath)),
    sha256,
    "Analysis changed original bytes",
  );
  await call("close_binary");
  opened = false;
  assert.equal((await call("binary_session")).open, false);
  report = {
    ok: true,
    mocked: false,
    lane: "ghidra-dos",
    host: process.platform,
    provider: { id: "ghidra", version: installation.providerVersion },
    target: {
      format: "dos-mz",
      architecture: "x86",
      sha256,
      bytes: fixture.bytes.length,
    },
    profile: {
      digest: profile.digest,
      loader: profile.parameters.loader,
      language_id: profile.parameters.language_id,
      compiler_spec_id: profile.parameters.compiler_spec_id,
      load_segment: profile.parameters.load_segment,
    },
    transport: { cli: true, stdio_mcp: true },
    load_image: {
      status: image.status,
      checks: image.checks.length,
      mappings: image.observations.mappings.length,
      relocations: image.observations.relocations.length,
      cli_mcp_parity: true,
    },
    memory_evidence: {
      relocated_word_hex: memoryRelocation.bytes_hex,
      entry_file_offset: mapped.file_offset,
      header_file_offset: headerMapping.file_offset,
      partial_read_bytes: tail.returned_bytes,
      unmapped_read_bytes: unmapped.returned_bytes,
      unmapped_file_offset_rejected: true,
      cli_mcp_parity: true,
    },
    functions: facts,
    instruction_oracles: {
      entry_bytes: hexBytes(move.bytes),
      near_memory_bytes: hexBytes(nearMemory.bytes),
      near_call_bytes: hexBytes(nearCall.bytes),
      relocated_far_call_bytes: hexBytes(farCall.bytes),
      near_target: expected.near,
      far_target: expected.far,
    },
    invalid_address_rejected: true,
    address_truncation_rejected: true,
    original_unchanged: true,
    limitations: [
      "Read-only import/decompilation evidence, not DOS runtime execution or whole-program semantic equivalence.",
      "The complete body is Ghidra's observed AddressSet, not independently proven historical compiler ownership.",
      "Language/compiler identity is bound by the production authenticated bridge handshake; profile loader is the declared import policy.",
      "Native high-pcode flow is excluded from cross-runtime parity: LOAD/STORE address-space selector constants are process-specific in current Ghidra output. Both dossiers are still strictly parsed.",
      "Windows P0 remains unsupported for DOS MZ.",
    ],
  };
} catch (error) {
  if (stderr.trim())
    process.stderr.write(`DOS verifier MCP diagnostics:\n${stderr}\n`);
  throw error;
} finally {
  try {
    if (opened) {
      try {
        await call("close_binary");
      } catch (error) {
        process.stderr.write(`DOS cleanup close failed: ${String(error)}\n`);
      }
    }
    try {
      await client.close();
    } finally {
      await transport.close();
    }
    assert.equal(
      digest(await readFile(targetPath)),
      sha256,
      "Original changed during cleanup",
    );
    const leftovers = (await readdir(runtime)).filter((name) =>
      name.startsWith("rea-ghidra-"),
    );
    assert.deepEqual(leftovers, [], "Owned Ghidra runtime survived close");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
assert.ok(report, "No DOS proof report was produced");
const verifierRun = await completeVerifierRun(run);
assertVerifierCleanupComplete(verifierRun.process_lineage);
process.stdout.write(
  `${JSON.stringify({ verifier_run: verifierRun, ...report, cleanup: "complete" })}\n`,
);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function hexBytes(bytes) {
  assert.equal(typeof bytes, "string");
  return bytes.replace(/\s/gu, "").toLowerCase();
}
function assertProfile(profile) {
  assert.equal(
    profile.parameters.load_image_evidence,
    "independent-mz-mapping-relocations-v2",
  );
  assert.equal(
    profile.parameters.function_body_evidence,
    "complete-inclusive-ranges-v1",
  );
  assert.equal(profile.provider.id, "ghidra");
  assert.equal(profile.parameters.target_format, "dos-mz");
  assert.equal(profile.parameters.import_mode, "ephemeral-source-immutable");
  assert.equal(
    profile.parameters.annotation_policy,
    "atomic-function-entry-metadata-v1",
  );
  assert.equal(profile.parameters.loader, "MzLoader");
  assert.equal(profile.parameters.language_id, "x86:LE:16:Real Mode");
  assert.equal(profile.parameters.compiler_spec_id, "default");
  assert.equal(profile.parameters.load_segment, "0x1000");
}
function assertBody(input, entry) {
  const body = functionBodySchema.parse(input);
  assert.equal(body.available, true);
  assert.equal(body.provenance, "ghidra-function-body-address-set");
  assert.equal(body.contains_entry, true);
  let total = 0n;
  let previousEnd = null;
  for (const range of body.ranges) {
    assert.match(range.start, /^0x[0-9a-f]+$/u);
    assert.match(range.end, /^0x[0-9a-f]+$/u);
    const start = BigInt(range.start),
      end = BigInt(range.end);
    assert.ok(start <= end);
    if (previousEnd !== null) assert.ok(start > previousEnd + 1n);
    previousEnd = end;
    total += end - start + 1n;
  }
  assert.ok(
    body.ranges.some(
      (range) =>
        BigInt(range.start) <= BigInt(entry) &&
        BigInt(entry) <= BigInt(range.end),
    ),
  );
  assert.equal(BigInt(body.total_bytes), total);
  assert.equal(body.non_contiguous, body.ranges.length > 1);
  assert.equal(
    BigInt(body.span_bytes),
    BigInt(body.ranges.at(-1).end) - BigInt(body.ranges[0].start) + 1n,
  );
}
async function call(name, arguments_ = {}) {
  const result = await client.callTool(
    { name, arguments: arguments_ },
    { timeout: 240000 },
  );
  assert.ok(result.structuredContent, `${name} omitted structured result`);
  return requireMcpOperationResult(result, name);
}
async function evidenceCall(name, arguments_) {
  const result = await client.callTool(
    { name, arguments: arguments_ },
    { timeout: 240000 },
  );
  const evidence = parseEvidence(requireMcpOutput(result, name));
  assert.equal(evidence.subject.digest.sha256, sha256);
  assert.equal(evidence.provider.id, "ghidra");
  assertProfile(evidence.analysis_profile);
  return evidence;
}
async function cliEvidence(command, procedure, options = []) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      entrypoint,
      command,
      targetPath,
      ...(procedure === undefined ? [] : [procedure]),
      ...options,
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  assert.equal(evidence.subject.digest.sha256, sha256);
  assert.equal(evidence.provider.id, "ghidra");
  assertProfile(evidence.analysis_profile);
  assert.equal(digest(await readFile(targetPath)), sha256);
  return evidence;
}

// Preserve all body/instruction/decompilation/reference observations; raw high-pcode
// address-space selector tokens are process-specific and are not a semantic oracle.
function stableDossierObservations(dossier) {
  const { native_value_flow: flow, ...observations } = dossier;
  assert.ok(flow, "Dossier omitted native value-flow availability");
  return observations;
}
