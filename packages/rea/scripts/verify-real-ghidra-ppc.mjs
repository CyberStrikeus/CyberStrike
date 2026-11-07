#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import {
  inspectPowerPcReadelf,
  assertPowerPcLoadedImage,
  assertPowerPcProbe,
  assertPowerPcGlobal,
} from "../tests/conformance/ghidra/ppc-checks.mjs";
import { parseEvidence } from "../dist/domain/evidence.js";
import { parseAnalysisSnapshot } from "../dist/domain/analysisSnapshot.js";
import { functionDossierSchema } from "../dist/domain/native/functionDossier.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { buildPowerPcFixture } from "../tests/conformance/ghidra/ppc-fixture.mjs";
import { requireMcpOperationResult } from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

// Optional cross-target lane. No tool acquisition and no target execution.
if (process.argv.length !== 2)
  throw new Error("Usage: node scripts/verify-real-ghidra-ppc.mjs");
if (!["linux", "darwin"].includes(process.platform))
  throw new Error(
    "PowerPC verification requires a supported Linux/macOS Ghidra host",
  );
if (process.env.GHIDRA_INSTALL_DIR === undefined)
  throw new Error("Missing prerequisite: caller-supplied GHIDRA_INSTALL_DIR");
const installation = await inspectVerifierGhidraInstallation({
  environment: process.env,
  installDir: process.env.GHIDRA_INSTALL_DIR,
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { javaHome: process.env.JAVA_HOME }),
});
if (installation.status !== "available")
  throw new Error(
    `Ghidra prerequisite unavailable: ${JSON.stringify(installation)}`,
  );
const execute = promisify(execFile);
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const run = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-ppc-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: runtime,
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "ghidra",
  REA_PROCESS_RUN_ID: run.run_id,
  GHIDRA_INSTALL_DIR: installation.installDir,
  JAVA_HOME: installation.javaHome,
  HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
};
for (const setting of ["GHIDRA_HEADLESS_MAXMEM", "GHIDRA_MAXMEM"]) {
  if (process.env[setting] !== undefined) env[setting] = process.env[setting];
}
const reports = [];
let primaryFailure;
try {
  {
    const fixture = await buildPowerPcFixture(workspace);
    const independent = await inspectPowerPcReadelf(fixture.path);
    const resolved = await parseBinaryTarget(fixture.path);
    if (!resolved.ok) throw resolved.error;
    assert.deepEqual(
      resolved.value.powerpc,
      independent.powerpc,
      "REA ELF interpretation disagrees with GNU readelf",
    );
    assert.equal(resolved.value.sha256, fixture.sha256);
    const snapshotPath = join(workspace, "ppc.snapshot.json");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env,
      stderr: "pipe",
    });
    const client = new Client({ name: "rea-real-ppc-proof", version: "1" });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    const call = async (name, args = {}) => {
      const reply = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: 180000 },
      );
      return requireMcpOperationResult(reply, name);
    };
    try {
      await client.connect(transport);
      const target = await call("open_binary", {
        path: fixture.path,
        provider_id: "ghidra",
      });
      assert.equal(target.architecture, "powerpc");
      assert.equal(target.sha256, fixture.sha256);
      // ELF load-image verification is not the DOS comparison lane. Its retained
      // observations still expose the actual Ghidra language and loaded bytes;
      // the plain loader would have chosen e500 for this header.
      const image = await call("inspect_native_load_image");
      assertPowerPcLoadedImage(image.observations, fixture.sha256);
      const procedures = await call("list_procedures");
      const entry = procedures.find((p) => p.value === "rea_ppc_entry");
      const leaf = procedures.find((p) => p.value === "rea_ppc_leaf");
      assert.ok(entry, "Entry function missing from real Ghidra inventory");
      assert.ok(leaf, "Leaf function missing from real Ghidra inventory");
      assert.equal(
        BigInt(entry.address),
        BigInt(independent.symbols.rea_ppc_entry),
      );
      assert.equal(
        BigInt(leaf.address),
        BigInt(independent.symbols.rea_ppc_leaf),
      );
      const probe = independent.symbols.rea_ppc_probe;
      assert.ok(
        procedures.some(
          (p) =>
            p.value === "rea_ppc_probe" && BigInt(p.address) === BigInt(probe),
        ),
      );
      const move = await call("inspect_native_instruction", { address: probe });
      const branch = await call("inspect_native_instruction", {
        address: `0x${(BigInt(probe) + 8n).toString(16)}`,
      });
      assertPowerPcProbe(move, branch, probe);
      const global = await call("read_bytes", {
        address: independent.symbols.rea_ppc_global,
        length: 4,
      });
      assert.equal(global.returned_bytes, 4);
      assertPowerPcGlobal(global.bytes_hex);
      const marker = await call("read_bytes", {
        address: independent.symbols.rea_ppc_marker,
        length: 29,
      });
      assert.equal(
        marker.bytes_hex,
        Buffer.from("rea-ppc-source-owned-fixture\0").toString("hex"),
      );
      const callees = await call("procedure_callees", {
        procedure: entry.address,
      });
      assert.ok(
        callees.includes(leaf.address),
        "Expected direct call not recovered",
      );
      const assembly = await call("procedure_assembly", {
        procedure: entry.address,
      });
      assert.ok(assembly.trim().length > 0);
      const dossier = functionDossierSchema.parse(
        await call("analyze_function", {
          procedure: entry.address,
          detail: "complete",
        }),
      );
      assert.ok(dossier.pseudocode.trim().length > 0);
      const mapping = await call("address_to_file_offset", {
        address: entry.address,
      });
      const memory = await call("read_bytes", {
        address: entry.address,
        length: 16,
      });
      const sourceBytes = await readFile(fixture.path);
      assert.equal(memory.returned_bytes, 16);
      assert.equal(
        memory.bytes_hex,
        sourceBytes
          .subarray(mapping.file_offset, mapping.file_offset + 16)
          .toString("hex"),
      );
      const saved = await call("close_binary", {
        snapshot_path: snapshotPath,
      });
      assert.ok(saved.evidence_records > 0);
      const snapshot = parseAnalysisSnapshot(
        JSON.parse(await readFile(snapshotPath, "utf8")),
      );
      assert.equal(snapshot.target.architecture, "powerpc");
      assert.equal(
        snapshot.binding.analysis_profile.parameters.language_id,
        "PowerPC:BE:32:default",
      );
      assert.ok(snapshot.evidence_bundle.records.length > 0);
      for (const evidence of snapshot.evidence_bundle.records)
        assert.equal(parseEvidence(evidence).subject?.architecture, "powerpc");
      await call("open_binary", {
        path: fixture.path,
        provider_id: "ghidra",
        snapshot_path: snapshotPath,
      });
      assert.deepEqual(await call("list_procedures"), procedures);
      await call("close_binary");

      // Same public operation through CLI, not a private injected provider.
      const cli = await execute(
        process.execPath,
        [
          entrypoint,
          "function",
          fixture.path,
          "rea_ppc_entry",
          "--provider",
          "ghidra",
          "--json",
        ],
        { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
      );
      const evidence = parseEvidence(JSON.parse(cli.stdout));
      assert.equal(evidence.subject?.architecture, "powerpc");
      assert.equal(evidence.subject?.digest.sha256, fixture.sha256);
      const cliDossier = functionDossierSchema.parse(
        evidence.normalized_result,
      );
      assert.equal(cliDossier.procedure.address, dossier.procedure.address);
      assert.ok(cliDossier.pseudocode.trim().length > 0);
      assert.equal(
        createHash("sha256")
          .update(await readFile(fixture.path))
          .digest("hex"),
        fixture.sha256,
        "Analysis modified the source executable",
      );
      reports.push({
        ...fixture,
        independent_reader: independent,
        effective_language: image.observations.language_id,
        effective_compiler_spec: image.observations.compiler_spec_id,
        checks: [
          "independent ELF header and symbols",
          "loaded Ghidra identity and bound language",
          "fixed instruction bytes and immediate",
          "conditional branch destination",
          "global word and marker bytes",
          "CLI/MCP and snapshot identity",
        ],
        procedures: procedures.length,
        status: "passed",
      });
    } catch (cause) {
      throw new Error(`PowerPC verification failed; MCP stderr: ${stderr}`, {
        cause,
      });
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
  }
} catch (cause) {
  primaryFailure = cause;
}
const completed = await completeVerifierRun(run);
if (
  completed.process_lineage.status !== "verified" ||
  completed.process_lineage.descendants.length !== 0
)
  throw new Error(
    `Cleanup unverified; retained diagnostic workspace: ${workspace}`,
    { cause: primaryFailure },
  );
if (primaryFailure !== undefined)
  throw new Error(
    `PowerPC verification failed; retained workspace: ${workspace}`,
    {
      cause: primaryFailure,
    },
  );
await rm(workspace, { recursive: true, force: true });
console.log(JSON.stringify({ ...completed, fixtures: reports }, null, 2));
