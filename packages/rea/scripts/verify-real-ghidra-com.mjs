#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  requireMcpLifecycleResult,
  requireMcpOutput,
} from "./lib/mcp-verifier-results.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import { functionDossierSchema } from "../dist/domain/native/functionDossier.js";
import { nativeInstructionSchema } from "../dist/domain/native/nativeInstruction.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { buildDosComFixture } from "../tests/conformance/ghidra/dos-com-fixture.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { verifyGhidraAddressBoundaries } from "./lib/real-ghidra-address-boundaries.mjs";

// This lane intentionally has no game paths, binary seeds or compiler dependency.
if (process.argv.length !== 2)
  throw new Error("Usage: node scripts/verify-real-ghidra-com.mjs");
if (!["linux", "darwin"].includes(process.platform))
  throw new Error(
    "verify:ghidra:com supports Linux/macOS hosts only; Windows P0 is PE x86-64 only.",
  );
if (process.env.GHIDRA_INSTALL_DIR === undefined)
  throw new Error(
    "verify:ghidra:com prerequisite missing: GHIDRA_INSTALL_DIR (bring your own Ghidra).",
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
    `verify:ghidra:com prerequisite unavailable: ${JSON.stringify(installation)}`,
  );
const captureDirectory = process.env.REA_COM_PROOF_CAPTURE_DIR;
if (captureDirectory !== undefined) {
  assert.ok(
    isAbsolute(captureDirectory),
    "REA_COM_PROOF_CAPTURE_DIR must be absolute",
  );
  await mkdir(captureDirectory, { recursive: true, mode: 0o700 });
}
const packageRoot = process.env.REA_COM_PROOF_PACKAGE_ROOT;
if (packageRoot !== undefined && !isAbsolute(packageRoot))
  throw new Error("REA_COM_PROOF_PACKAGE_ROOT must be absolute");
const entrypoint =
  packageRoot === undefined
    ? fileURLToPath(new URL("./rea.mjs", import.meta.url))
    : join(packageRoot, "scripts", "rea.mjs");
const run = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-com-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const fixture = buildDosComFixture();
const targetPath = join(workspace, "fixture.com");
await writeFile(targetPath, fixture.bytes, { mode: 0o600 });
const sha256 = digest(fixture.bytes);
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

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "rea-real-com-proof", version: "1" });
let opened = false;
let stderr = "";
let report;
transport.stderr?.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-65536);
});
try {
  await client.connect(transport);

  const untyped = await client.callTool({
    name: "open_binary",
    arguments: { path: targetPath, provider_id: "ghidra" },
  });
  assert.equal(
    untyped.isError,
    true,
    "Headerless bytes were guessed as COM without explicit interpretation",
  );
  const target = await call("open_binary", {
    path: targetPath,
    provider_id: "ghidra",
    format: "dos-com",
  });
  opened = true;
  assert.equal(target.format, "dos-com");
  assert.equal(target.architecture, "x86");
  assert.equal(target.sha256, sha256);
  const image = await call("inspect_native_load_image");
  assert.equal(
    image.status,
    "verified",
    JSON.stringify(image.checks?.filter((c) => !c.matched)),
  );
  assert.equal(image.format, "dos-com");
  assert.equal(image.header_bytes, 0);
  assert.equal(image.module_bytes, fixture.bytes.length);
  assert.equal(image.entry.linear_address, fixture.entry);
  assert.equal(image.entry.offset, 256);
  assert.equal(image.observations.entry_context[0].registers.length, 4);
  const memory = await call("read_bytes", {
    address: fixture.entry,
    length: fixture.bytes.length,
  });
  assert.equal(memory.bytes_hex, fixture.bytes.toString("hex"));
  assert.equal(memory.complete, true);
  const mapping = await call("address_to_file_offset", {
    address: fixture.near,
  });
  assert.equal(mapping.file_offset, 32);
  const psp = await call("read_bytes", { address: "0x10000", length: 16 });
  assert.equal(psp.returned_bytes, 0);
  assert.equal(psp.complete, false);
  const tail = await call("read_bytes", { address: "0x1013e", length: 8 });
  assert.equal(tail.returned_bytes, 2);
  assert.equal(tail.complete, false);
  const procedures = await call("list_procedures");
  assert.ok(procedures.some((p) => p.address === fixture.entry));
  assert.ok(procedures.some((p) => p.address === fixture.near));
  const dossier = functionDossierSchema.parse(
    await call("analyze_function", {
      procedure: fixture.entry,
      detail: "complete",
    }),
  );
  assert.ok(dossier.pseudocode.trim().length > 0);
  assert.equal(dossier.procedure.body.available, true);
  const instruction = await call("inspect_native_instruction", {
    address: fixture.entry,
  });
  assert.equal(
    instruction.bytes.replaceAll(" ", "").toLowerCase(),
    fixture.entry_hex,
  );
  // This NOP follows the entry's terminating INT 20h and is not reached by
  // either function. It remains valid instruction bytes outside the listing.
  const unlistedAddress = "0x1013f";
  const unlistedBytes = await call("read_bytes", {
    address: unlistedAddress,
    length: 1,
  });
  assert.equal(unlistedBytes.bytes_hex, "90");
  const unlistedResponse = await client.callTool({
    name: "inspect_native_instruction",
    arguments: { address: unlistedAddress },
  });
  const unlistedEvidence = parseEvidence(
    requireMcpOutput(unlistedResponse, "inspect_native_instruction"),
  );
  const unlisted = unlistedEvidence.normalized_result;
  assert.equal(unlisted.status, "not-in-listing");
  assert.equal(unlisted.bytes, null);
  assert.ok(
    unlisted.limitations.some((item) =>
      item.includes("did not attempt a decode"),
    ),
  );
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_native_instruction",
  );
  assert.ok(advertised?.outputSchema);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  assert.equal(ajv.validateSchema(advertised.outputSchema), true);
  assert.equal(
    ajv.validate(advertised.outputSchema, unlistedResponse.structuredContent),
    true,
    JSON.stringify(ajv.errors),
  );
  assert.ok(
    nativeInstructionSchema.safeParse({ ...unlisted, status: "undecodable" })
      .success,
  );
  assert.equal(
    (await call("resolve_native_call_targets", { address: unlistedAddress }))
      .status,
    "unavailable",
  );
  assert.deepEqual(
    (await cli("inspect-native-instruction", unlistedAddress))
      .normalized_result,
    unlisted,
  );
  const cliImage = await cli("inspect-native-load-image");
  const stable = (x) => ({
    ...x,
    observations: {
      ...x.observations,
      source_files: x.observations.source_files.map(
        ({ name: _name, ...file }) => file,
      ),
    },
  });
  assert.deepEqual(stable(cliImage.normalized_result), stable(image));
  assert.deepEqual(
    (
      await cli("read-bytes", fixture.entry, [
        "--length",
        String(fixture.bytes.length),
      ])
    ).normalized_result,
    memory,
  );
  assert.deepEqual(
    (await cli("address-to-file-offset", fixture.near)).normalized_result,
    mapping,
  );
  const changes = {
    procedure: fixture.entry,
    name: "rea_entry",
    comment: "Regular\nUnicode 註記",
    inline_comment: "Inline finding",
  };
  // Prime provider inventories and the session snapshot before edits.
  await call("list_names");
  const updated = await call("annotate_native_function", changes);
  assert.equal(updated.annotations.name, changes.name);
  assert.equal(updated.annotations.comment, changes.comment);
  assert.equal(updated.annotations.inline_comment, changes.inline_comment);
  assert.equal(updated.dossier.procedure.name, changes.name);
  assert.ok(updated.dossier.pseudocode.includes(changes.name));
  assert.equal(
    await call("procedure_address", { procedure: changes.name }),
    fixture.entry,
  );
  assert.equal(
    await call("address_name", { address: fixture.entry }),
    changes.name,
  );
  assert.ok(
    (await call("list_procedures")).some((p) => p.value === changes.name),
  );
  assert.ok((await call("list_names")).some((p) => p.value === changes.name));
  assert.equal(
    (
      await call("analyze_function", {
        procedure: fixture.entry,
        detail: "complete",
      })
    ).procedure.name,
    changes.name,
  );
  const rejected = await client.callTool({
    name: "annotate_native_function",
    arguments: {
      procedure: fixture.entry,
      comment: "MUST ROLL BACK",
      name: "invalid name\n",
    },
  });
  assert.equal(
    rejected.isError,
    true,
    "Ghidra accepted an invalid function name",
  );
  const retained = await call("annotate_native_function", {
    procedure: fixture.entry,
    name: changes.name,
  });
  assert.equal(
    retained.annotations.comment,
    changes.comment,
    "Failed edit leaked its earlier comment write",
  );
  assert.equal(retained.annotations.inline_comment, changes.inline_comment);
  assert.equal(retained.dossier.procedure.name, changes.name);
  await verifyGhidraAddressBoundaries(client, fixture.entry, cli);
  const cleared = await call("annotate_native_function", {
    procedure: fixture.entry,
    comment: "",
    inline_comment: "",
  });
  assert.equal(cleared.annotations.comment, null);
  assert.equal(cleared.annotations.inline_comment, null);
  assert.ok(!cleared.dossier.comments.some((c) => c.address === fixture.entry));
  assert.equal(
    (
      await call("read_bytes", {
        address: fixture.entry,
        length: fixture.bytes.length,
      })
    ).bytes_hex,
    fixture.bytes.toString("hex"),
  );
  assert.equal((await call("inspect_native_load_image")).status, "verified");
  const cliAnnotated = await cli("annotate-native-function", fixture.entry, [
    "--name",
    changes.name,
    "--comment",
    changes.comment,
    "--inline-comment",
    changes.inline_comment,
  ]);
  assert.deepEqual(cliAnnotated.normalized_result, updated);
  if (captureDirectory !== undefined)
    await writeFile(
      join(captureDirectory, "image.json"),
      JSON.stringify(image, null, 2),
      { mode: 0o600 },
    );
  await call("close_binary");
  opened = false;
  assert.equal(digest(await readFile(targetPath)), sha256);
  report = {
    ok: true,
    mocked: false,
    lane: "ghidra-com",
    packaged_artifact: packageRoot !== undefined,
    host: process.platform,
    provider: { id: "ghidra", version: installation.providerVersion },
    target: { format: "dos-com", sha256, bytes: fixture.bytes.length },
    load_image: {
      status: image.status,
      checks: image.checks.length,
      entry: fixture.entry,
      entry_context: image.observations.entry_context,
    },
    transport: { cli: true, stdio_mcp: true },
    memory_evidence: {
      complete_file_read: true,
      source_offset: 32,
      psp_unmapped: true,
      partial_read_bytes: 2,
    },
    functions: { entry: true, near: true, pseudocode_nonempty: true },
    annotations: {
      atomic_rollback: true,
      fresh_inventories: true,
      fresh_decompiler: true,
      clear_comments: true,
      cli_mcp_parity: true,
    },
    original_unchanged: true,
    address_truncation_rejected: true,
    limitations: image.limitations,
  };
} catch (error) {
  if (stderr.trim()) process.stderr.write(stderr);
  throw error;
} finally {
  if (opened)
    await call("close_binary").catch((error) =>
      process.stderr.write(String(error)),
    );
  await client.close();
  await transport.close();
  await rm(workspace, { recursive: true, force: true });
}
assert.ok(report);
const verifierRun = await completeVerifierRun(run);
assert.equal(verifierRun.process_lineage.status, "verified");
assert.deepEqual(verifierRun.process_lineage.descendants, []);
process.stdout.write(
  JSON.stringify({
    verifier_run: verifierRun,
    ...report,
    cleanup: "complete",
  }) + "\n",
);
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function call(name, args = {}) {
  const value = await client.callTool(
    { name, arguments: args },
    { timeout: 240000 },
  );
  if (["open_binary", "close_binary"].includes(name))
    return requireMcpLifecycleResult(value, name);
  const evidence = parseEvidence(requireMcpOutput(value, name));
  assert.equal(evidence.subject.digest.sha256, sha256);
  return evidence.normalized_result;
}
async function cli(command, address, options = []) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      entrypoint,
      command,
      targetPath,
      ...(address === undefined ? [] : [address]),
      ...options,
      "--target-format",
      "dos-com",
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  assert.equal(evidence.subject.digest.sha256, sha256);
  assert.equal(evidence.subject.format, "dos-com");
  assert.equal(evidence.analysis_profile.parameters.loader, "BinaryLoader");
  assert.equal(
    evidence.analysis_profile.parameters.language_id,
    "x86:LE:16:Real Mode",
  );
  assert.equal(evidence.analysis_profile.parameters.entry_offset, "0x100");
  assert.equal(digest(await readFile(targetPath)), sha256);
  return evidence;
}
