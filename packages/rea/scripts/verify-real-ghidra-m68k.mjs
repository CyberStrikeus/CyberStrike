import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../dist/domain/evidence.js";
import {
  requireMcpOperationResult,
  requireMcpOutput,
} from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

if (process.argv.length !== 2)
  throw new Error("Usage: node scripts/verify-real-ghidra-m68k.mjs");
// Windows Ghidra P0 admits raw 6502 only; m68k has no Windows lane.
if (!["linux", "darwin"].includes(process.platform))
  throw new Error(
    "m68k raw-binary verification requires a Linux or macOS Ghidra host.",
  );
if (process.env.GHIDRA_INSTALL_DIR === undefined)
  throw new Error(
    "Set GHIDRA_INSTALL_DIR to a bring-your-own Ghidra installation.",
  );
const exec = promisify(execFile);
const run = createVerifierRun();
const root = fileURLToPath(new URL("..", import.meta.url));
// Source-owned big-endian 68000 image, loaded at 0x1000:
//   0x1000 7007      moveq   #7,d0
//   0x1002 610e      bsr.b   add_three (0x1012)
//   0x1004 0c40000a  cmpi.w  #10,d0
//   0x1008 6604      bne.b   mismatch (0x100e)
//   0x100a 702a      moveq   #42,d0
//   0x100c 4e75      rts
//   0x100e 7000      mismatch: moveq #0,d0
//   0x1010 4e75      rts
//   0x1012 5680      add_three: addq.l #3,d0
//   0x1014 4e75      rts
const bytes = Buffer.from(
  "7007610e0c40000a6604702a4e7570004e7556804e75",
  "hex",
);
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256,
  "7679358409efee4c5c2465f9a47158c4d49e0415ba12b3170898440db7ea0bc9",
);
await mkdir(join(root, "build"), { recursive: true });
const workspace = await mkdtemp(join(root, "build", "rea-m68k-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const path = join(workspace, "image.bin");
await writeFile(path, bytes);
const entrypoint = join(root, "scripts", "rea.mjs");
const env = {
  ...process.env,
  TMPDIR: runtime,
  TMP: runtime,
  TEMP: runtime,
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "ghidra",
  REA_PROCESS_RUN_ID: run.run_id,
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "rea-real-m68k-proof", version: "1" });
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-65536);
});
let report;
try {
  await client.connect(transport);
  const opened = await call("open_binary", {
    path,
    format: "raw-binary",
    architecture: "m68k",
    entry_point: "0x1000",
    provider_id: "ghidra",
  });
  assert.equal(opened.architecture, "m68k");
  assert.equal(opened.entry_point, "0x1000");
  const status = await call("binary_session");
  const image = evidence(await call("inspect_native_load_image"));
  assert.equal(
    image.normalized_result.status,
    "verified",
    JSON.stringify(image.normalized_result),
  );
  assert.equal(image.normalized_result.architecture, "m68k");
  assert.equal(image.normalized_result.base_address, "0x1000");
  assert.equal(image.normalized_result.language_id, "68000:BE:32:default");
  assert.equal(image.normalized_result.compiler_spec_id, "default");
  assert.equal(image.normalized_result.file_bytes, bytes.length);
  assert.equal(image.analysis_profile.parameters.loader, "BinaryLoader");
  assert.equal(
    image.analysis_profile.parameters.language_id,
    "68000:BE:32:default",
  );
  assert.equal(image.analysis_profile.parameters.compiler_spec_id, "default");
  assert.equal(image.analysis_profile.parameters.entry_point, "0x1000");
  const memory = evidence(
    await call("read_bytes", { address: "0x1000", length: bytes.length }),
  );
  assert.equal(memory.normalized_result.bytes_hex, bytes.toString("hex"));
  const procedures = evidence(await call("list_procedures"));
  assert.deepEqual(
    procedures.normalized_result.map((procedure) => procedure.address).sort(),
    ["0x1000", "0x1012"],
  );
  const instruction = evidence(
    await call("inspect_native_instruction", { address: "0x1002" }),
  );
  assert.equal(instruction.normalized_result.mnemonic, "bsr.b");
  assert.equal(instruction.normalized_result.flow.kind, "call");
  assert.deepEqual(instruction.normalized_result.flow.direct_destinations, [
    "0x1012",
  ]);
  assert.ok(
    instruction.normalized_result.references.some(
      (reference) =>
        reference.call &&
        reference.type === "UNCONDITIONAL_CALL" &&
        reference.target_address === "0x1012",
    ),
  );
  const pseudo = evidence(
    await call("procedure_pseudo_code", { procedure: "0x1012" }),
  );
  assert.match(pseudo.normalized_result, /\+\s*(?:3|0x3)\b/u);
  const caller = evidence(
    await call("procedure_pseudo_code", { procedure: "0x1000" }),
  );
  assert.match(caller.normalized_result, /==\s*(?:10|0xa)\b/iu);
  assert.match(caller.normalized_result, /return\s+(?:42|0x2a)\s*;/iu);
  assert.match(caller.normalized_result, /return\s+0\s*;/u);
  const filePseudo = evidence(
    await call("procedure_pseudo_code", { procedure: "file-offset:0x12" }),
  );
  assert.equal(filePseudo.normalized_result, pseudo.normalized_result);
  assert.ok(
    filePseudo.locations.some(
      (location) => location.kind === "file-offset" && location.offset === 18,
    ),
  );
  // Rejected selections must not replace the live session.
  for (const [entryPoint, reason] of [
    ["0x1001", /raw-binary m68k entry_point 0x1001 must be 2-byte aligned/u],
    [
      "0xfffffff0",
      /raw-binary mapping from 0xfffffff0 must fit in the m68k address width/u,
    ],
  ]) {
    const rejected = await client.callTool({
      name: "open_binary",
      arguments: {
        path,
        format: "raw-binary",
        architecture: "m68k",
        entry_point: entryPoint,
      },
    });
    assert.equal(rejected.isError, true);
    assert.match(JSON.stringify(rejected.content), reason);
    const preserved = await call("binary_session");
    assert.equal(preserved.analysis_run.run_id, status.analysis_run.run_id);
    assert.equal(preserved.entry_point, "0x1000");
  }
  await call("close_binary");
  await client.ping();
  const { stdout } = await exec(
    process.execPath,
    [
      entrypoint,
      "inspect-native-load-image",
      path,
      "--target-format",
      "raw-binary",
      "--architecture",
      "m68k",
      "--entry-point",
      "0x1000",
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  const cli = evidence(JSON.parse(stdout));
  assert.deepEqual(cli.normalized_result, image.normalized_result);
  assert.equal(cli.analysis_profile.digest, image.analysis_profile.digest);
  const fileCli = await exec(
    process.execPath,
    [
      entrypoint,
      "decompile",
      path,
      "--file-offset=0x12",
      "--target-format",
      "raw-binary",
      "--architecture",
      "m68k",
      "--entry-point",
      "0x1000",
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  const fileCliEvidence = evidence(JSON.parse(fileCli.stdout));
  assert.equal(fileCliEvidence.normalized_result, filePseudo.normalized_result);
  assert.deepEqual(fileCliEvidence.locations, filePseudo.locations);
  assert.deepEqual(await readFile(path), bytes);
  // Ghidra projects end with their sessions; on macOS the server keeps its
  // process-token helper under TMPDIR until shutdown, checked after close.
  assert.deepEqual(
    (await readdir(runtime)).filter((name) => name.startsWith("rea-ghidra-")),
    [],
    "Owned Ghidra runtime survived close",
  );
  report = {
    ok: true,
    mocked: false,
    lane: "ghidra-m68k",
    host: process.platform,
    provider: image.provider,
    target: {
      sha256,
      bytes: bytes.length,
      architecture: "m68k",
      entry: "0x1000",
    },
    cli_mcp_load_image_parity: true,
    instructions_and_call_reference: true,
    decompilation: true,
    file_offset_decompilation_cli_mcp: true,
    misaligned_entry_preserves_session: true,
    invalid_mapping_preserves_session: true,
    source_unchanged: true,
    runtime_cleanup: "complete",
  };
} catch (cause) {
  if (stderr) process.stderr.write(stderr);
  throw cause;
} finally {
  try {
    await client.close();
  } finally {
    await transport.close();
  }
}
assert.deepEqual(
  await readdir(runtime),
  [],
  `Runtime resources survived server shutdown; retained workspace: ${workspace}`,
);
const verifierRun = await completeVerifierRun(run);
assert.equal(verifierRun.process_lineage.status, "verified");
assert.deepEqual(verifierRun.process_lineage.descendants, []);
// Keep the workspace for diagnosis unless verification and cleanup both pass.
await rm(workspace, { recursive: true, force: true });
process.stdout.write(
  JSON.stringify({ verifier_run: verifierRun, ...report }) + "\n",
);

async function call(name, args = {}) {
  const result = await client.callTool(
    { name, arguments: args },
    { timeout: 240000 },
  );
  if (["open_binary", "binary_session", "close_binary"].includes(name))
    return requireMcpOperationResult(result, name);
  return requireMcpOutput(result, name);
}

function evidence(value) {
  const result = parseEvidence(value);
  assert.equal(result.subject.digest.sha256, sha256);
  assert.equal(result.subject.architecture, "m68k");
  assert.equal(result.subject.format, "raw-binary");
  return result;
}
