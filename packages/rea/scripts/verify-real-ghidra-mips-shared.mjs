#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import { parseAnalysisSnapshot } from "../dist/domain/analysisSnapshot.js";
import { buildMips16SharedFixture } from "../tests/conformance/ghidra/mips16-shared-fixture.mjs";
import {
  requireMcpOperationResult,
  requireMcpToolError,
} from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

if (
  process.env.GHIDRA_INSTALL_DIR === undefined ||
  !["linux", "darwin"].includes(process.platform)
)
  throw new Error(
    "This optional lane requires BYO Ghidra on Linux/macOS and GNU MIPS cross-binutils.",
  );
const execute = promisify(execFile);
const run = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-mips-shared-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
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
};
const reports = [];
let failure;
try {
  for (const byteOrder of ["big", "little"]) {
    for (const variant of [
      "declared",
      "recordless",
      "symbol-relative",
      "section-relocations",
    ]) {
      const fixture = await buildMips16SharedFixture(
        workspace,
        byteOrder,
        variant,
      );
      const resolved = await parseBinaryTarget(fixture.path);
      if (!resolved.ok) throw resolved.error;
      assert.equal(resolved.value.sha256, fixture.sha256);
      assert.equal(resolved.value.architecture, "mips");
      if (variant === "section-relocations") {
        assert.equal(resolved.value.mips.sharedLoad.status, "unavailable");
        assert.match(
          resolved.value.mips.sharedLoad.reason,
          /section relocation declarations/u,
        );
      } else {
        assert.equal(resolved.value.mips.sharedLoad.status, "complete");
        assert.deepEqual(
          resolved.value.mips.sharedLoad.relocationTypes,
          [0, 3],
        );
        assert.equal(
          resolved.value.mips.sharedLoad.symbolRelativeCount,
          variant === "symbol-relative" ? 1 : 0,
        );
      }
      if (variant === "recordless")
        assert.equal(resolved.value.mips.abiFlags, null);
      else {
        assert.equal(resolved.value.mips.abiFlags.fpAbi, 5);
        assert.equal(resolved.value.mips.abiFlags.ases, 0x400);
      }
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["scripts/rea.mjs", "mcp"],
        cwd: process.cwd(),
        env,
        stderr: "pipe",
      });
      const client = new Client({
        name: "rea-mips16-shared-conformance",
        version: "1",
      });
      let stderr = "";
      transport.stderr?.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-262144);
      });
      let calls = 0;
      const reply = async (name, args = {}) => {
        const response = await client.callTool(
          { name, arguments: args },
          { timeout: 180000 },
        );
        await writeFile(
          join(workspace, `${byteOrder}-${variant}-${++calls}-${name}.json`),
          JSON.stringify(response, null, 2),
        );
        return response;
      };
      const call = async (name, args) =>
        requireMcpOperationResult(await reply(name, args), name);
      const original = await readFile(fixture.path);
      try {
        await client.connect(transport);
        await client.listTools();
        if (
          variant === "symbol-relative" ||
          variant === "section-relocations"
        ) {
          const refusal = requireMcpToolError(
            await reply("open_binary", {
              path: fixture.path,
              provider_id: "ghidra",
            }),
          );
          assert.equal(refusal.category, "unsupported_provider");
          assert.match(
            JSON.stringify(refusal),
            variant === "symbol-relative"
              ? /Symbol-bearing R_MIPS_REL32/u
              : /section relocation declarations/u,
          );
          assert.deepEqual(await readFile(fixture.path), original);
          await client.ping();
          reports.push({ ...fixture, status: "refused", ping: true });
          continue;
        }
        await call("open_binary", {
          path: fixture.path,
          provider_id: "ghidra",
        });
        const loadedReply = await reply("inspect_native_load_image");
        const loaded = requireMcpOperationResult(
          loadedReply,
          "inspect_native_load_image",
        );
        const evidence = parseEvidence(
          JSON.parse(
            loadedReply.content.find((item) => item.type === "text").text,
          ),
        );
        const language = `MIPS:${byteOrder === "little" ? "LE" : "BE"}:32:default`;
        assert.equal(loaded.observations.language_id, language);
        assert.equal(loaded.observations.compiler_spec_id, "default");
        assert(
          loaded.observations.source_files.some(
            (file) => file.original_sha256 === fixture.sha256,
          ),
        );
        assert(
          evidence.limitations.some((item) =>
            item.includes("External GOT bindings"),
          ),
        );
        if (variant === "recordless")
          assert(
            evidence.limitations.some((item) =>
              item.includes("does not establish the floating-point ABI"),
            ),
          );
        const base = BigInt(loaded.observations.image_base);
        const address = (source, clearTag = false) =>
          `0x${(base + (clearTag ? BigInt(source) & ~1n : BigInt(source))).toString(16)}`;
        const compressed = address(fixture.symbols.rea_mips16_probe, true);
        const standard = address(fixture.symbols.rea_mips32_probe);
        const procedures = await call("list_procedures");
        assert(
          procedures.some(
            (item) =>
              item.address === compressed && item.value === "rea_mips16_probe",
          ),
        );
        assert(
          procedures.some(
            (item) =>
              item.address === standard && item.value === "rea_mips32_probe",
          ),
        );
        let firstInstruction;
        const expected =
          byteOrder === "little"
            ? ["5a6a", "8eea", "074a", "a0e8"]
            : ["6a5a", "ea8e", "4a07", "e8a0"];
        for (let i = 0; i < 4; i += 1) {
          const instruction = await call("inspect_native_instruction", {
            address: `0x${(BigInt(compressed) + BigInt(2 * i)).toString(16)}`,
          });
          assert.equal(instruction.status, "decoded");
          assert.equal(instruction.mode, "default");
          assert.equal(instruction.length, 2);
          assert.equal(instruction.bytes, expected[i]);
          assert.deepEqual(instruction.decoder_context, [
            {
              register: "ISA_MODE",
              value: "1",
              source: "ghidra-program-context",
            },
          ]);
          if (i === 0) firstInstruction = instruction;
        }
        const standardInstruction = await call("inspect_native_instruction", {
          address: standard,
        });
        assert.equal(standardInstruction.length, 4);
        assert.equal(
          standardInstruction.bytes,
          byteOrder === "little" ? "03008224" : "24820003",
        );
        assert.equal(
          standardInstruction.decoder_context[0].register,
          "ISA_MODE",
        );
        assert(
          [null, "0"].includes(standardInstruction.decoder_context[0].value),
        );
        const pointer = await call("read_bytes", {
          address: address(fixture.symbols.rea_mips16_pointer),
          length: 4,
        });
        const pointerBytes = Buffer.from(pointer.bytes_hex, "hex");
        const pointerValue =
          byteOrder === "little"
            ? pointerBytes.readUInt32LE(0)
            : pointerBytes.readUInt32BE(0);
        assert.equal(
          BigInt(pointerValue),
          base + BigInt(fixture.symbols.rea_mips16_probe),
        );
        const dossier = await call("analyze_function", {
          procedure: compressed,
          detail: "complete",
        });
        assert.match(dossier.pseudocode, /\^\s*0x5a/u);
        assert.match(dossier.pseudocode, /\+\s*(?:7|0x7)\b/u);
        const standardDossier = await call("analyze_function", {
          procedure: standard,
          detail: "complete",
        });
        assert.match(standardDossier.pseudocode, /\+\s*(?:3|0x3)\b/u);
        const snapshotPath = join(
          workspace,
          `${byteOrder}-${variant}.snapshot.json`,
        );
        await call("close_binary", { snapshot_path: snapshotPath });
        const snapshot = parseAnalysisSnapshot(
          JSON.parse(await readFile(snapshotPath, "utf8")),
        );
        assert.equal(
          snapshot.binding.analysis_profile.parameters.language_selection,
          "provider-pinned-v1",
        );
        assert.equal(
          snapshot.binding.analysis_profile.parameters.language_id,
          language,
        );
        await call("open_binary", {
          path: fixture.path,
          provider_id: "ghidra",
          snapshot_path: snapshotPath,
        });
        assert.deepEqual(
          await call("inspect_native_instruction", { address: compressed }),
          firstInstruction,
        );
        await call("close_binary");
        await client.ping();
        const cli = await execute(
          process.execPath,
          [
            "scripts/rea.mjs",
            "inspect-native-instruction",
            fixture.path,
            compressed,
            "--provider",
            "ghidra",
            "--format",
            "json",
          ],
          { env, timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
        );
        assert.deepEqual(
          parseEvidence(JSON.parse(cli.stdout)).normalized_result,
          firstInstruction,
        );
        assert.deepEqual(await readFile(fixture.path), original);
        reports.push({
          ...fixture,
          status: "passed",
          language_id: language,
          mixed_mode: true,
          standard_decoder_context: standardInstruction.decoder_context,
          pointer_tag_preserved: true,
          snapshot_context_preserved: true,
          cli_mcp_parity: true,
          source_unchanged: true,
          ping: true,
        });
      } finally {
        await client.close();
        await transport.close();
        await writeFile(
          join(workspace, `${byteOrder}-${variant}.stderr`),
          stderr,
        );
      }
    }
  }
} catch (cause) {
  failure = cause;
}
const completed = await completeVerifierRun(run);
if (
  completed.process_lineage.status !== "verified" ||
  completed.process_lineage.descendants.length !== 0
)
  throw new Error(`Cleanup unverified; retained workspace: ${workspace}`, {
    cause: failure,
  });
if (failure !== undefined)
  throw new Error(
    `MIPS16 shared verification failed; retained workspace: ${workspace}`,
    { cause: failure },
  );
await rm(workspace, { recursive: true, force: true });
console.log(JSON.stringify({ ...completed, fixtures: reports }, null, 2));
