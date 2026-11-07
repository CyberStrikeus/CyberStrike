import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
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
  throw new Error("Usage: node scripts/verify-real-ghidra-6502.mjs");
if (process.env.GHIDRA_INSTALL_DIR === undefined)
  throw new Error(
    "Set GHIDRA_INSTALL_DIR to a bring-your-own Ghidra installation.",
  );
const exec = promisify(execFile);
const run = createVerifierRun();
const root = fileURLToPath(new URL("..", import.meta.url));
const ca65 = process.env.REA_CA65 ?? "ca65";
const ld65 = process.env.REA_LD65 ?? "ld65";
const toolchain = {};
for (const [name, command] of Object.entries({ ca65, ld65 })) {
  const version = await exec(command, ["--version"], { timeout: 10000 });
  toolchain[name] = (version.stdout + version.stderr).trim();
}
await mkdir(join(root, "build"), { recursive: true });
const workspace = await mkdtemp(join(root, "build", "rea-6502-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const path = join(workspace, "image.bin");
const object = join(workspace, "image.o");
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
const client = new Client({ name: "rea-real-6502-proof", version: "1" });
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-65536);
});
let report;
try {
  await exec(
    ca65,
    [join(root, "tests/conformance/ghidra/6502.s"), "-o", object],
    { timeout: 10000 },
  );
  await exec(
    ld65,
    ["-C", join(root, "tests/conformance/ghidra/6502.cfg"), "-o", path, object],
    { timeout: 10000 },
  );
  const bytes = await readFile(path);
  // Independently known opcodes and link addresses from the source fixture.
  assert.equal(bytes.toString("hex"), "a907201080c90ad003a92a60a9006018690360");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await client.connect(transport);
  const opened = await call("open_binary", {
    path,
    format: "raw-binary",
    architecture: "6502",
    entry_point: "0x008001",
    provider_id: "ghidra",
  });
  assert.equal(opened.architecture, "6502");
  assert.equal(opened.entry_point, "0x8001");
  const status = await call("binary_session");
  const image = evidence(await call("inspect_native_load_image"), sha256);
  assert.equal(
    image.normalized_result.status,
    "verified",
    JSON.stringify(image.normalized_result),
  );
  assert.equal(image.normalized_result.architecture, "6502");
  assert.equal(image.normalized_result.base_address, "0x8001");
  assert.equal(image.normalized_result.language_id, "6502:LE:16:default");
  assert.equal(image.normalized_result.compiler_spec_id, "default");
  assert.equal(image.normalized_result.file_bytes, bytes.length);
  const memory = evidence(
    await call("read_bytes", { address: "0x8001", length: bytes.length }),
    sha256,
  );
  assert.equal(memory.normalized_result.bytes_hex, bytes.toString("hex"));
  const procedures = evidence(await call("list_procedures"), sha256);
  for (const address of ["0x8001", "0x8010"])
    assert.ok(
      procedures.normalized_result.some(
        (procedure) => procedure.address === address,
      ),
    );
  const instruction = evidence(
    await call("inspect_native_instruction", { address: "0x8003" }),
    sha256,
  );
  assert.equal(instruction.normalized_result.mnemonic.toUpperCase(), "JSR");
  assert.ok(
    instruction.normalized_result.references.some(
      (reference) => reference.call && reference.target_address === "0x8010",
    ),
  );
  const pseudo = evidence(
    await call("procedure_pseudo_code", { procedure: "0x8010" }),
    sha256,
  );
  assert.match(pseudo.normalized_result, /\+\s*(?:3|0x3|'\\x03')/u);
  const filePseudo = evidence(
    await call("procedure_pseudo_code", { procedure: "file-offset:0xf" }),
    sha256,
  );
  assert.equal(filePseudo.normalized_result, pseudo.normalized_result);
  assert.ok(
    filePseudo.locations.some(
      (location) => location.kind === "file-offset" && location.offset === 15,
    ),
  );
  const rejected = await client.callTool({
    name: "open_binary",
    arguments: {
      path,
      format: "raw-binary",
      architecture: "6502",
      entry_point: "0xffff",
    },
  });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /6502 address width/u);
  const preserved = await call("binary_session");
  assert.equal(preserved.analysis_run.run_id, status.analysis_run.run_id);
  assert.equal(preserved.entry_point, "0x8001");
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
      "6502",
      "--entry-point",
      "0x8001",
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  const cli = parseEvidence(JSON.parse(stdout));
  assert.deepEqual(cli.normalized_result, image.normalized_result);
  assert.equal(cli.analysis_profile.digest, image.analysis_profile.digest);
  assert.equal(cli.subject.digest.sha256, sha256);
  const fileCli = await exec(
    process.execPath,
    [
      entrypoint,
      "decompile",
      path,
      "--file-offset=0xf",
      "--target-format",
      "raw-binary",
      "--architecture",
      "6502",
      "--entry-point",
      "0x8001",
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  const fileCliEvidence = parseEvidence(JSON.parse(fileCli.stdout));
  assert.equal(fileCliEvidence.normalized_result, filePseudo.normalized_result);
  assert.deepEqual(fileCliEvidence.locations, filePseudo.locations);
  assert.equal(fileCliEvidence.subject.digest.sha256, sha256);
  assert.deepEqual(await readFile(path), bytes);
  assert.deepEqual(await readdir(runtime), []);
  const lowMemory = [];
  // BinaryLoader maps file bytes before trying processor-defined blocks. Prove
  // that overlapping zero-page/stack definitions never overlay the selected image.
  for (const [entry, fullAddressSpace] of [
    [0xff, false],
    [0, true],
  ]) {
    const lowPath = join(workspace, `low-${entry}.bin`);
    await exec(
      ld65,
      [
        "-C",
        join(root, "tests/conformance/ghidra/6502.cfg"),
        "--start-addr",
        String(entry),
        "-o",
        lowPath,
        object,
      ],
      { timeout: 10000 },
    );
    const linked = await readFile(lowPath);
    const expectedCode = Buffer.from(
      "a907200000c90ad003a92a60a9006018690360",
      "hex",
    );
    expectedCode.writeUInt16LE(entry + 15, 3);
    assert.deepEqual(linked, expectedCode);
    const lowBytes = fullAddressSpace
      ? Buffer.concat([linked, Buffer.alloc(65536 - linked.length)])
      : linked;
    await writeFile(lowPath, lowBytes);
    const lowSha256 = createHash("sha256").update(lowBytes).digest("hex");
    const lowEntry = `0x${entry.toString(16)}`;
    const lowOpened = await call("open_binary", {
      path: lowPath,
      format: "raw-binary",
      architecture: "6502",
      entry_point: lowEntry,
      provider_id: "ghidra",
    });
    assert.equal(lowOpened.entry_point, lowEntry);
    const lowImage = evidence(
      await call("inspect_native_load_image"),
      lowSha256,
    );
    assert.equal(
      lowImage.normalized_result.status,
      "verified",
      JSON.stringify(lowImage.normalized_result),
    );
    assert.equal(lowImage.normalized_result.base_address, lowEntry);
    assert.equal(lowImage.normalized_result.file_bytes, lowBytes.length);
    const fileMappings =
      lowImage.normalized_result.observations.mappings.filter(
        (mapping) => mapping.source_file_index !== null,
      );
    assert.equal(fileMappings.length, 1);
    assert.equal(
      fileMappings[0].address_space,
      lowImage.normalized_result.observations.default_address_space,
    );
    assert.equal(fileMappings[0].overlay, false);
    assert.equal(fileMappings[0].start, lowEntry);
    assert.equal(fileMappings[0].length, lowBytes.length);
    const lowRead = evidence(
      await call("read_bytes", { address: lowEntry, length: linked.length }),
      lowSha256,
    );
    assert.equal(lowRead.normalized_result.bytes_hex, linked.toString("hex"));
    const lowCall = evidence(
      await call("inspect_native_instruction", {
        address: `0x${(entry + 2).toString(16)}`,
      }),
      lowSha256,
    );
    assert.equal(lowCall.normalized_result.mnemonic.toUpperCase(), "JSR");
    assert.ok(
      lowCall.normalized_result.references.some(
        (reference) =>
          reference.call &&
          reference.target_address === `0x${(entry + 15).toString(16)}`,
      ),
    );
    await call("close_binary");
    const lowCli = await exec(
      process.execPath,
      [
        entrypoint,
        "inspect-native-load-image",
        lowPath,
        "--target-format",
        "raw-binary",
        "--architecture",
        "6502",
        "--entry-point",
        lowEntry,
        "--provider",
        "ghidra",
        "--json",
      ],
      { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
    );
    const lowCliEvidence = evidence(JSON.parse(lowCli.stdout), lowSha256);
    assert.deepEqual(
      lowCliEvidence.normalized_result,
      lowImage.normalized_result,
    );
    assert.equal(
      lowCliEvidence.analysis_profile.digest,
      lowImage.analysis_profile.digest,
    );
    assert.deepEqual(await readFile(lowPath), lowBytes);
    assert.deepEqual(await readdir(runtime), []);
    lowMemory.push({
      entry: lowEntry,
      bytes: lowBytes.length,
      sha256: lowSha256,
    });
  }
  let windowsReparseAdmission = "not-applicable";
  if (process.platform === "win32") {
    const junction = join(workspace, "linked");
    await symlink(workspace, junction, "junction");
    try {
      const linkedPath = join(junction, "image.bin");
      // Reopening the same bytes through a junction must replace the direct session.
      await call("open_binary", {
        path,
        format: "raw-binary",
        architecture: "6502",
        entry_point: "0x8001",
        provider_id: "ghidra",
      });
      const directImage = evidence(
        await call("inspect_native_load_image"),
        sha256,
      );
      assert.equal(directImage.normalized_result.status, "verified");
      // Canonical file identity must not bypass admission of the new path.
      await call("open_binary", {
        path: linkedPath,
        format: "raw-binary",
        architecture: "6502",
        entry_point: "0x8001",
        provider_id: "ghidra",
      });
      // open_binary selects a lazy session; the first analysis admits the snapshot.
      const linkedImage = await client.callTool(
        { name: "inspect_native_load_image", arguments: {} },
        { timeout: 240000 },
      );
      assert.equal(linkedImage.isError, true);
      assert.match(
        JSON.stringify(linkedImage),
        /Reparse path component is unsupported/u,
      );
      await call("close_binary");
      const snapshotPath = join(workspace, "direct-snapshot.json");
      const cliArgs = (selectedPath) => [
        entrypoint,
        "analyze",
        selectedPath,
        "--target-format",
        "raw-binary",
        "--architecture",
        "6502",
        "--entry-point",
        "0x8001",
        "--provider",
        "ghidra",
        "--snapshot",
        snapshotPath,
        "--json",
      ];
      const saved = await exec(process.execPath, cliArgs(path), {
        env,
        timeout: 240000,
        maxBuffer: 16 * 1024 * 1024,
      });
      assert.equal(
        evidence(JSON.parse(saved.stdout), sha256).operation,
        "binary_overview",
      );
      const savedSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
      assert.ok(
        savedSnapshot.workflow_entries.some(
          ({ operation }) => operation === "binary_overview",
        ),
      );
      assert.deepEqual(await readdir(runtime), []);
      // Replaying a matching snapshot must still reach native path admission.
      await assert.rejects(
        exec(process.execPath, cliArgs(linkedPath), {
          env,
          timeout: 240000,
          maxBuffer: 16 * 1024 * 1024,
        }),
        (cause) => {
          assert.match(
            cause.stdout + cause.stderr,
            /Reparse path component is unsupported/u,
          );
          return true;
        },
      );
      assert.deepEqual(await readFile(path), bytes);
      assert.deepEqual(await readdir(runtime), []);
      windowsReparseAdmission = "cli-snapshot-mcp-rejected";
    } finally {
      await unlink(junction);
    }
  }
  report = {
    ok: true,
    mocked: false,
    lane: "ghidra-6502",
    host: process.platform,
    toolchain,
    provider: image.provider,
    target: {
      sha256,
      bytes: bytes.length,
      architecture: "6502",
      entry: "0x8001",
    },
    cli_mcp_load_image_parity: true,
    instructions_and_call_reference: true,
    decompilation: true,
    file_offset_decompilation_cli_mcp: true,
    invalid_mapping_preserves_session: true,
    low_memory_cli_mcp_parity: lowMemory,
    windows_reparse_admission: windowsReparseAdmission,
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
const verifierRun = await completeVerifierRun(run);
if (process.platform !== "win32") {
  assert.equal(verifierRun.process_lineage.status, "verified");
  assert.deepEqual(verifierRun.process_lineage.descendants, []);
}
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

function evidence(value, sha256) {
  const result = parseEvidence(value);
  assert.equal(result.subject.digest.sha256, sha256);
  assert.equal(result.subject.architecture, "6502");
  assert.equal(result.subject.format, "raw-binary");
  return result;
}
