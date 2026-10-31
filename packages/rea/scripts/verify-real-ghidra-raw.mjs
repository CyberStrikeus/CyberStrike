import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { parseEvidence } from "../dist/domain/evidence.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import {
  requireMcpLifecycleResult,
  requireMcpOutput,
} from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

if (process.argv.length !== 2)
  throw new Error("Usage: node scripts/verify-real-ghidra-raw.mjs");
if (!["linux", "darwin"].includes(process.platform))
  throw new Error(
    "Raw-binary verification requires a Linux or macOS Ghidra host.",
  );
if (process.env.GHIDRA_INSTALL_DIR === undefined)
  throw new Error(
    "Set GHIDRA_INSTALL_DIR to a bring-your-own Ghidra installation.",
  );
const installation = await inspectVerifierGhidraInstallation({
  environment: process.env,
  installDir: process.env.GHIDRA_INSTALL_DIR,
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { javaHome: process.env.JAVA_HOME }),
});
assert.equal(installation.status, "available", JSON.stringify(installation));

const run = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-raw-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const bytes = Buffer.from("1eff2fe1", "hex"); // ARM little-endian bx lr.
const sha256 = createHash("sha256").update(bytes).digest("hex");
const path = join(workspace, "image.bin");
await writeFile(path, bytes);
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: runtime,
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "ghidra",
  REA_PROCESS_RUN_ID: run.run_id,
  GHIDRA_INSTALL_DIR: process.env.GHIDRA_INSTALL_DIR,
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { JAVA_HOME: process.env.JAVA_HOME }),
  ...(process.env.GHIDRA_HEADLESS_MAXMEM === undefined
    ? {}
    : { GHIDRA_HEADLESS_MAXMEM: process.env.GHIDRA_HEADLESS_MAXMEM }),
  ...(process.env.REA_GHIDRA_DISABLED_ANALYZERS === undefined
    ? {}
    : {
        REA_GHIDRA_DISABLED_ANALYZERS:
          process.env.REA_GHIDRA_DISABLED_ANALYZERS,
      }),
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "rea-real-raw-proof", version: "1" });
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-65536);
});
let report;
try {
  await client.connect(transport);
  const profiles = [];
  const sessions = [];
  for (const entryPoint of ["0x08000000", "0x8000000", "0x09000000"]) {
    // Omit provider_id to exercise reuse of the current provider route.
    const opened = await call("open_binary", {
      path,
      format: "raw-binary",
      architecture: "arm",
      entry_point: entryPoint,
    });
    const entry = `0x${BigInt(entryPoint).toString(16)}`;
    assert.equal(opened.entry_point, entry);
    const image = await call("inspect_native_load_image");
    assert.equal(
      image.normalized_result.status,
      "verified",
      JSON.stringify(image),
    );
    assert.equal(image.normalized_result.base_address, entry);
    assert.equal(image.normalized_result.entry.address, entry);
    assert.equal(
      image.normalized_result.observations.language_id,
      "ARM:LE:32:v7",
    );
    assert.ok(
      image.normalized_result.observations.entry_points.includes(entry),
    );
    assert.equal(image.analysis_profile.parameters.entry_point, entry);
    profiles.push(image.analysis_profile.digest);
    const status = await call("binary_session");
    assert.equal(status.entry_point, entry);
    sessions.push(status.analysis_run.run_id);
    const memory = await call("read_bytes", {
      address: entry,
      length: bytes.length,
    });
    assert.equal(memory.normalized_result.bytes_hex, bytes.toString("hex"));
    const signature = await call("search_bytes", {
      pattern: "1e ?? 2f e1",
      limit: 1000,
    });
    assert.equal(signature.normalized_result.complete, true);
    assert.equal(signature.normalized_result.next_cursor, null);
    assert.equal(signature.normalized_result.searched.bytes, bytes.length);
    assert.deepEqual(
      signature.normalized_result.matches.map((match) => match.address),
      [entry],
    );
    assert.equal(signature.normalized_result.matches[0].file_offset, 0);
    assert.equal(
      signature.normalized_result.matches[0].procedure.address,
      entry,
    );
    const procedures = await call("list_procedures");
    assert.ok(
      procedures.normalized_result.some(
        (procedure) => procedure.address === entry,
      ),
    );
    const instruction = await call("inspect_native_instruction", {
      address: entry,
    });
    assert.equal(instruction.normalized_result.address, entry);
    assert.ok(Array.isArray(instruction.normalized_result.decoder_context));
    const tmodeContext = instruction.normalized_result.decoder_context.find(
      (ctx) => ctx.register === "TMode",
    );
    assert.ok(tmodeContext !== undefined);
    assert.equal(tmodeContext.source, "ghidra-program-context");
    assert.ok([null, "0", "1"].includes(tmodeContext.value));
  }
  assert.equal(profiles[0], profiles[1]);
  assert.notEqual(profiles[1], profiles[2]);
  assert.equal(sessions[0], sessions[1]);
  assert.notEqual(sessions[1], sessions[2]);
  const rejected = await client.callTool({
    name: "open_binary",
    arguments: {
      path,
      format: "raw-binary",
      architecture: "arm64",
      entry_point: "0x8000001",
    },
  });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /must be 4-byte aligned/);
  const unchanged = await call("binary_session");
  assert.equal(unchanged.analysis_run.run_id, sessions[2]);
  assert.equal(unchanged.entry_point, "0x9000000");
  await call("close_binary");

  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      entrypoint,
      "inspect-native-load-image",
      path,
      "--target-format",
      "raw-binary",
      "--architecture",
      "arm",
      "--entry-point",
      "0x08000000",
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  const cli = parseEvidence(JSON.parse(stdout));
  assert.equal(cli.subject.digest.sha256, sha256);
  assert.equal(cli.normalized_result.status, "verified");
  assert.equal(cli.normalized_result.base_address, "0x8000000");
  assert.equal(cli.analysis_profile.digest, profiles[0]);
  assert.deepEqual(await readFile(path), bytes);
  const x86Targets = [];
  for (const architecture of ["x86", "x86_64"]) {
    const x86Bytes = Buffer.from("b82a000000c3", "hex"); // mov eax, 42; ret.
    const x86Sha256 = createHash("sha256").update(x86Bytes).digest("hex");
    const x86Path = join(workspace, `${architecture}.bin`);
    await writeFile(x86Path, x86Bytes);
    await call("open_binary", {
      path: x86Path,
      format: "raw-binary",
      architecture,
      entry_point: "0x1000",
    });
    const image = await call("inspect_native_load_image", {}, x86Sha256);
    assert.equal(
      image.normalized_result.status,
      "verified",
      JSON.stringify(image),
    );
    assert.equal(image.normalized_result.base_address, "0x1000");
    assert.equal(image.normalized_result.observations.compiler_spec_id, "gcc");
    assert.equal(image.analysis_profile.parameters.compiler_spec_id, "gcc");
    const memory = await call(
      "read_bytes",
      { address: "0x1000", length: x86Bytes.length },
      x86Sha256,
    );
    assert.equal(memory.normalized_result.bytes_hex, x86Bytes.toString("hex"));
    const pseudo = await call(
      "procedure_pseudo_code",
      { procedure: "0x1000" },
      x86Sha256,
    );
    assert.match(pseudo.normalized_result, /\b(?:42|0x2a)\b/iu);
    await call("close_binary");
    assert.deepEqual(await readFile(x86Path), x86Bytes);
    x86Targets.push({
      architecture,
      sha256: x86Sha256,
      compiler_spec_id: "gcc",
      return_42: true,
    });
  }
  const repeatedPath = join(workspace, "signatures.bin");
  const repeatedBytes = Buffer.from("b82a000000c3".repeat(1005), "hex");
  const repeatedSha256 = createHash("sha256")
    .update(repeatedBytes)
    .digest("hex");
  await writeFile(repeatedPath, repeatedBytes);
  await call("open_binary", {
    path: repeatedPath,
    format: "raw-binary",
    architecture: "x86_64",
    entry_point: "0x1000",
  });
  // Import/analysis is complete before timing the first uncached search.
  await call("read_bytes", { address: "0x1000", length: 6 }, repeatedSha256);
  const started = performance.now();
  const page = await call(
    "search_bytes",
    { pattern: "b8 ?? 00 00 00 c3", limit: 1000 },
    repeatedSha256,
  );
  const searchElapsedMs = performance.now() - started;
  assert.equal(page.normalized_result.matches.length, 1000);
  assert.equal(page.normalized_result.complete, false);
  const rest = await call(
    "search_bytes",
    {
      pattern: "b8 ?? 00 00 00 c3",
      limit: 1000,
      cursor: page.normalized_result.next_cursor,
    },
    repeatedSha256,
  );
  assert.equal(rest.normalized_result.matches.length, 5);
  assert.equal(
    rest.normalized_result.matches[0].address,
    `0x${(0x1000 + 6000).toString(16)}`,
  );
  assert.equal(rest.normalized_result.complete, true);
  const masked = await call(
    "search_bytes",
    { pattern: "bf", mask: "f0", start: "0x1000", end: "0x1005" },
    repeatedSha256,
  );
  assert.deepEqual(
    masked.normalized_result.matches.map((match) => match.address),
    ["0x1000"],
  );
  const overlapping = await call(
    "search_bytes",
    { pattern: "00 00", start: "0x1000", end: "0x1005" },
    repeatedSha256,
  );
  assert.deepEqual(
    overlapping.normalized_result.matches.map((match) => match.address),
    ["0x1002", "0x1003"],
  );
  const wrongCursor = await client.callTool({
    name: "search_bytes",
    arguments: { pattern: "c3", cursor: page.normalized_result.next_cursor },
  });
  assert.equal(wrongCursor.isError, true);
  await call("close_binary");
  assert.deepEqual(await readFile(repeatedPath), repeatedBytes);
  report = {
    ok: true,
    mocked: false,
    lane: "ghidra-raw",
    host: process.platform,
    provider: { id: "ghidra", version: installation.providerVersion },
    target: {
      format: "raw-binary",
      architecture: "arm",
      sha256,
      bytes: bytes.length,
    },
    transport: { cli: true, stdio_mcp: true },
    canonical_entry_reuses_session: true,
    changed_entry_replaces_session: true,
    lifecycle_entry_preserved: true,
    invalid_entry_preserves_active_session: true,
    load_images_verified: true,
    original_unchanged: true,
    x86_targets: x86Targets,
    byte_search: {
      matches: 1005,
      page_size: 1000,
      first_search_elapsed_ms: searchElapsedMs,
      timing_scope: "MCP request after import; first uncached search",
      token_usage: "unmeasured",
      process_family_cpu_time: "unmeasured",
      peak_process_family_memory: "unmeasured",
    },
  };
} catch (error) {
  if (stderr.trim()) process.stderr.write(stderr);
  throw error;
} finally {
  await client.close();
  await transport.close();
  await rm(workspace, { recursive: true, force: true });
}
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

async function call(name, args = {}, targetSha256 = sha256) {
  const result = await client.callTool(
    { name, arguments: args },
    { timeout: 240000 },
  );
  if (["open_binary", "close_binary", "binary_session"].includes(name))
    return requireMcpLifecycleResult(result, name);
  const evidence = parseEvidence(requireMcpOutput(result, name));
  assert.equal(evidence.subject.digest.sha256, targetSha256);
  assert.equal(evidence.subject.format, "raw-binary");
  return evidence;
}
