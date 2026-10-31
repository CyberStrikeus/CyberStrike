#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import {
  inspectMipsReadelf,
  expectedMipsElfProfile,
  inspectLegacyMipsReadelf,
  assertMipsLoadedImage,
  assertMipsProbe,
  assertMipsGlobal,
  assertMipsSoftFloatStorage,
  assertMipsCarvedTargetRefusal,
  carveMipsElfBeforeSectionTable,
} from "../tests/conformance/ghidra/mips-checks.mjs";
import { parseEvidence } from "../dist/domain/evidence.js";
import { parseAnalysisSnapshot } from "../dist/domain/analysisSnapshot.js";
import { functionDossierSchema } from "../dist/domain/native/functionDossier.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { buildMipsFixture } from "../tests/conformance/ghidra/mips-fixture.mjs";
import {
  buildPspFixture,
  assertPspLoadedImage,
  assertPspProbe,
} from "../tests/conformance/ghidra/psp-fixture.mjs";
import {
  requireMcpToolError,
  requireMcpOperationResult,
} from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

// Optional cross-target lane. No tool acquisition and no target execution.
const mode = process.argv[2];
const psp = mode === "--psp" || mode === "--psp-missing-extension";
const missingExtension = mode === "--psp-missing-extension";
if (process.argv.length > 3 || (mode !== undefined && !psp))
  throw new Error(
    "Usage: node scripts/verify-real-ghidra-mips.mjs [--psp|--psp-missing-extension]",
  );
const prefix = psp ? "rea_psp" : "rea_mips";
if (!["linux", "darwin"].includes(process.platform))
  throw new Error(
    "MIPS verification requires a supported Linux/macOS Ghidra host",
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
const workspace = await mkdtemp(join(tmpdir(), "rea-mips-proof-"));
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

/**
 * Typed float signatures must use soft-float o32 storage, and callers must see
 * the source constants through it rather than FPU inputs.
 */
async function verifySoftFloat(call, symbols, byteOrder) {
  const boundaries = {};
  for (const name of [
    "rea_mips_soft_pick",
    "rea_mips_soft_wide",
    "rea_mips_soft_mixed",
    "rea_mips_soft_struct",
  ]) {
    const api = await call("inspect_native_api", { procedure: symbols[name] });
    boundaries[name] = api.boundary;
  }
  assertMipsSoftFloatStorage(boundaries, byteOrder);
  const caller = functionDossierSchema.parse(
    await call("analyze_function", {
      procedure: symbols.rea_mips_soft_caller,
      detail: "complete",
    }),
  );
  // Includes the struct call and the indirect call through a typed pointer.
  assert.doesNotMatch(caller.pseudocode, /\bin_f\d+\b/u);
  for (const literal of [
    "1.5",
    "2.5",
    "3.25",
    "4.75",
    "5.5",
    "6.125",
    "7.5",
    "8.5",
    "9.5",
  ])
    assert.ok(
      caller.pseudocode.includes(literal),
      `Soft-float caller lost argument ${literal}`,
    );
  return { storage: boundaries };
}

const reports = [];
let primaryFailure;
try {
  if (!psp) {
    // Recordless legacy admission: ABI field 0, no ABI flags record, pinned
    // 32-bit language. Independent GNU readelf checks the header interpretation.
    for (const byteOrder of ["little", "big"]) {
      const fixture = await buildMipsFixture(workspace, byteOrder, "hard", {
        legacy: true,
      });
      const legacy = await inspectLegacyMipsReadelf(fixture.path, byteOrder);
      const resolved = await parseBinaryTarget(fixture.path);
      if (!resolved.ok) throw resolved.error;
      assert.equal(resolved.value.mips.flags, 0x50000001);
      assert.equal(resolved.value.mips.abiFlags, null);
      assert.deepEqual(
        resolved.value.mips.limitations ?? [],
        legacy.limitations,
        "REA legacy ABI-record absence interpretation disagrees with GNU readelf",
      );
      assert.equal(resolved.value.sha256, fixture.sha256);
      const snapshotPath = join(workspace, `${byteOrder}-legacy.snapshot.json`);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [entrypoint, "mcp"],
        env,
        stderr: "pipe",
      });
      const client = new Client({
        name: "rea-real-mips-legacy-proof",
        version: "1",
      });
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
        const selected = await call("open_binary", {
          path: fixture.path,
          provider_id: "ghidra",
        });
        assert.equal(selected.architecture, "mips");
        assert.equal(selected.sha256, fixture.sha256);
        const image = await call("inspect_native_load_image");
        assertMipsLoadedImage(image.observations, byteOrder, fixture.sha256);
        // The pinned import language is the checked one, not an auto-selection.
        assert.equal(
          image.observations.language_id,
          `MIPS:${byteOrder === "little" ? "LE" : "BE"}:32:default`,
        );
        const procedures = await call("list_procedures");
        const entry = procedures.find((p) => p.value === "rea_mips_entry");
        assert.ok(entry, "Entry function missing from legacy inventory");
        assert.equal(
          BigInt(entry.address),
          BigInt(legacy.symbols.rea_mips_entry),
        );
        const probe = await call("inspect_native_instruction", {
          address: legacy.symbols.rea_mips_probe,
        });
        const probeBranch = await call("inspect_native_instruction", {
          address: `0x${(BigInt(legacy.symbols.rea_mips_probe) + 4n).toString(16)}`,
        });
        assertMipsProbe(
          probe,
          probeBranch,
          byteOrder,
          legacy.symbols.rea_mips_probe,
        );
        const dossier = functionDossierSchema.parse(
          await call("analyze_function", {
            procedure: entry.address,
            detail: "complete",
          }),
        );
        assert.ok(dossier.pseudocode.trim().length > 0);
        const saved = await call("close_binary", {
          snapshot_path: snapshotPath,
        });
        assert.ok(saved.evidence_records > 0);
        const snapshot = parseAnalysisSnapshot(
          JSON.parse(await readFile(snapshotPath, "utf8")),
        );
        assert.equal(snapshot.target.architecture, "mips");
        const parameters = snapshot.binding.analysis_profile.parameters;
        assert.equal(
          parameters.language_id,
          `MIPS:${byteOrder === "little" ? "LE" : "BE"}:32:default`,
        );
        assert.equal(parameters.language_selection, "provider-pinned-v1");
        assert.equal(
          parameters.mips_support_lane,
          "elf32-exec-arch32-legacy-pinned-v1",
        );
        assert.equal(parameters.mips_abi_basis, "inferred-o32-assumption-v1");
        assert.ok(
          snapshot.evidence_bundle.records.some((record) =>
            parseEvidence(record).limitations.some((item) =>
              item.includes("analysis assumption"),
            ),
          ),
          "Legacy o32 assumption limitation missing from retained Evidence",
        );
        assert.ok(
          snapshot.evidence_bundle.records.some((record) =>
            parseEvidence(record).limitations.some((item) =>
              item.includes("Floating-point ABI semantics are unverified"),
            ),
          ),
          "Legacy floating-point uncertainty missing from retained Evidence",
        );
        await call("open_binary", {
          path: fixture.path,
          provider_id: "ghidra",
          snapshot_path: snapshotPath,
        });
        assert.deepEqual(await call("list_procedures"), procedures);
        await call("close_binary");
      } catch (cause) {
        throw new Error(
          `MIPS legacy ${byteOrder} verification failed; MCP stderr: ${stderr}`,
          { cause },
        );
      } finally {
        try {
          await client.close();
        } finally {
          await transport.close();
        }
      }
      reports.push({
        ...fixture,
        independent_reader: legacy,
        variant: "recordless-legacy-pinned",
        effective_language: `MIPS:${
          byteOrder === "little" ? "LE" : "BE"
        }:32:default`,
        procedures: "verified-through-snapshot",
        checks: [
          "recordless header admitted with inferred o32 assumption",
          "pinned 32-bit language checked after import",
          "legacy limitations retained in Evidence",
          "snapshot round-trip and profile parameters",
        ],
        status: "passed",
      });
    }
  }
  for (const [byteOrder, floatAbi] of psp
    ? [["little", "hard"]]
    : [
        ["little", "hard"],
        ["big", "hard"],
        ["little", "soft"],
        ["big", "soft"],
      ]) {
    const fixture = psp
      ? await buildPspFixture(workspace)
      : await buildMipsFixture(workspace, byteOrder, floatAbi);
    const independent = psp
      ? fixture
      : await inspectMipsReadelf(fixture.path, byteOrder, floatAbi);
    const resolved = await parseBinaryTarget(fixture.path);
    if (!resolved.ok) throw resolved.error;
    if (psp) {
      assert.equal(resolved.value.mips.flags, 0x10a23001);
      assert.deepEqual(
        resolved.value.mips,
        independent.mips,
        "REA PSP ELF/ABI interpretation disagrees with GNU readelf and raw ABI bytes",
      );
    } else {
      assert.deepEqual(
        resolved.value.mips,
        independent.mips,
        "REA ELF/ABI interpretation disagrees with GNU readelf",
      );
    }
    assert.equal(resolved.value.sha256, fixture.sha256);
    const snapshotPath = join(
      workspace,
      `${byteOrder}-${floatAbi}.snapshot.json`,
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env,
      stderr: "pipe",
    });
    const client = new Client({ name: "rea-real-mips-proof", version: "1" });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    const call = async (name, args = {}) => {
      const reply = await client.callTool(
        { name, arguments: args },
        { timeout: 180000 },
      );
      return requireMcpOperationResult(reply, name);
    };
    try {
      await client.connect(transport);
      if (missingExtension) {
        const rejected = await client.callTool(
          {
            name: "open_binary",
            arguments: { path: fixture.path, provider_id: "ghidra" },
          },
          { timeout: 60000 },
        );
        const error = requireMcpToolError(rejected);
        assert.match(JSON.stringify(error), /PSP_EXTENSION_UNAVAILABLE/u);
        let cliError;
        try {
          await execute(
            process.execPath,
            [
              entrypoint,
              "function",
              fixture.path,
              `${prefix}_entry`,
              "--provider",
              "ghidra",
              "--json",
            ],
            { env, timeout: 60000, maxBuffer: 1024 * 1024 },
          );
        } catch (cause) {
          cliError = cause;
        }
        assert.ok(
          cliError && Number.isInteger(cliError.code) && cliError.code !== 0,
          "Expected a typed public rejection, not a timeout or success",
        );
        assert.match(
          `${cliError.stdout}\n${cliError.stderr}`,
          /PSP_EXTENSION_UNAVAILABLE/u,
        );
        reports.push({
          path: fixture.path,
          status: "expected-missing-extension-refusal",
          cli_exit: cliError.code,
          mcp_error: error,
        });
        continue;
      }
      const target = await call("open_binary", {
        path: fixture.path,
        provider_id: "ghidra",
      });
      assert.equal(target.architecture, "mips");
      assert.equal(target.sha256, fixture.sha256);
      // ELF load-image verification is not the DOS comparison lane. Its retained
      // observations still expose the actual Ghidra language and loaded bytes.
      const image = await call("inspect_native_load_image");
      if (psp) assertPspLoadedImage(image.observations, fixture.sha256);
      else assertMipsLoadedImage(image.observations, byteOrder, fixture.sha256);
      const procedures = await call("list_procedures");
      const entry = procedures.find((p) => p.value === `${prefix}_entry`);
      const leaf = procedures.find((p) => p.value === `${prefix}_leaf`);
      assert.ok(entry, "Entry function missing from real Ghidra inventory");
      assert.ok(leaf, "Leaf function missing from real Ghidra inventory");
      assert.equal(
        BigInt(entry.address),
        BigInt(independent.symbols[`${prefix}_entry`]),
      );
      assert.equal(
        BigInt(leaf.address),
        BigInt(independent.symbols[`${prefix}_leaf`]),
      );
      const probe = independent.symbols[`${prefix}_probe`];
      assert.ok(
        procedures.some(
          (p) =>
            p.value === `${prefix}_probe` &&
            BigInt(p.address) === BigInt(probe),
        ),
      );
      const move = await call("inspect_native_instruction", { address: probe });
      const branch = await call("inspect_native_instruction", {
        address: `0x${(BigInt(probe) + 4n).toString(16)}`,
      });
      if (psp) assertPspProbe(move, branch);
      else assertMipsProbe(move, branch, byteOrder, probe);
      const global = await call("read_bytes", {
        address: independent.symbols[`${prefix}_global`],
        length: 4,
      });
      assert.equal(global.returned_bytes, 4);
      assertMipsGlobal(global.bytes_hex, byteOrder);
      const marker = await call("read_bytes", {
        address: independent.symbols[`${prefix}_marker`],
        length: Buffer.byteLength(
          psp
            ? "rea-psp-source-owned-fixture\0"
            : "rea-mips-source-owned-fixture\0",
        ),
      });
      assert.equal(
        marker.bytes_hex,
        Buffer.from(
          psp
            ? "rea-psp-source-owned-fixture\0"
            : "rea-mips-source-owned-fixture\0",
        ).toString("hex"),
      );
      const callees = await call("procedure_callees", {
        procedure: entry.address,
      });
      assert.ok(
        callees.includes(leaf.address),
        "Expected direct call not recovered",
      );
      const softFloat =
        floatAbi === "soft"
          ? await verifySoftFloat(call, independent.symbols, byteOrder)
          : undefined;
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
      assert.equal(snapshot.target.architecture, "mips");
      assert.deepEqual(
        snapshot.binding.analysis_profile.parameters.mips_elf,
        expectedMipsElfProfile(independent.mips),
        "Snapshot profile did not retain the independently inspected ELF/ABI declaration",
      );
      assert.equal(
        snapshot.binding.analysis_profile.parameters.mips_soft_float_storage,
        floatAbi === "soft" ? "o32-soft-float-prototype-v1" : undefined,
      );
      assert.equal(
        snapshot.evidence_bundle.records.some((record) =>
          /Soft-float prototype outcome: 4 functions and [1-9]\d* function-pointer definitions use __rea_soft_float\./u.test(
            JSON.stringify(record),
          ),
        ),
        floatAbi === "soft",
        "Soft-float prototype outcome missing from, or unexpected in, retained Evidence",
      );
      assert.ok(snapshot.evidence_bundle.records.length > 0);
      if (psp) {
        assert.equal(
          snapshot.binding.analysis_profile.parameters.language_id,
          "Allegrex:LE:32:default",
        );
        assert.match(
          snapshot.binding.analysis_profile.parameters.psp_extension.sha256,
          /^[a-f0-9]{64}$/u,
        );
        assert.ok(
          snapshot.evidence_bundle.records.some((record) =>
            JSON.stringify(record).includes("VFPU prefix"),
          ),
          "PSP limitations missing from retained Evidence",
        );
      }
      for (const evidence of snapshot.evidence_bundle.records)
        assert.equal(parseEvidence(evidence).subject?.architecture, "mips");
      await call("open_binary", {
        path: fixture.path,
        provider_id: "ghidra",
        snapshot_path: snapshotPath,
      });
      assert.deepEqual(await call("list_procedures"), procedures);
      await call("close_binary");

      if (psp) {
        const alternate = join(workspace, "alternate");
        await mkdir(alternate);
        const other = await buildPspFixture(alternate, 11);
        assert.notEqual(other.sha256, fixture.sha256);
        assert.equal(
          other.symbols.rea_psp_global,
          fixture.symbols.rea_psp_global,
          "Target-switch control must reuse the same global address",
        );
        for (const item of [fixture, other, fixture]) {
          const selected = await call("open_binary", {
            path: item.path,
            provider_id: "ghidra",
          });
          assert.equal(selected.sha256, item.sha256);
          const word = await call("read_bytes", {
            address: item.symbols.rea_psp_global,
            length: 4,
          });
          const expected = Buffer.alloc(4);
          expected.writeUInt32LE(item.global_value);
          assert.equal(word.bytes_hex, expected.toString("hex"));
          await call("close_binary");
        }
        const wrongSnapshot = await client.callTool(
          {
            name: "open_binary",
            arguments: {
              path: other.path,
              provider_id: "ghidra",
              snapshot_path: snapshotPath,
            },
          },
          { timeout: 180000 },
        );
        requireMcpToolError(wrongSnapshot);
        // A bad snapshot must not poison the next clean public session.
        await call("open_binary", {
          path: fixture.path,
          provider_id: "ghidra",
        });
        await call("close_binary");
      }

      // Same public operation through CLI, not a private injected provider.
      const cli = await execute(
        process.execPath,
        [
          entrypoint,
          "function",
          fixture.path,
          `${prefix}_entry`,
          "--provider",
          "ghidra",
          "--json",
        ],
        { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
      );
      const evidence = parseEvidence(JSON.parse(cli.stdout));
      assert.equal(evidence.subject?.architecture, "mips");
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
      // This upstream carved-firmware proof is specific to the generic MIPS fixture.
      // PSP keeps its independent Allegrex/A-B-A checks; carved PSP is not verified.
      let carved;
      if (!psp) {
        // The carved copy keeps every program header and payload but declares
        // a section table it did not capture. Both adapters refuse it when
        // opening the target; it is not analyzed as a smaller program.
        const carve = carveMipsElfBeforeSectionTable(sourceBytes, byteOrder);
        const carvedPath = join(
          workspace,
          `${byteOrder}-${floatAbi}-carved.elf`,
        );
        const carvedSha256 = createHash("sha256")
          .update(carve.bytes)
          .digest("hex");
        await writeFile(carvedPath, carve.bytes);
        // Target errors name the canonical path that was opened.
        const openedPath = await realpath(carvedPath);
        const carvedError = requireMcpToolError(
          await client.callTool(
            {
              name: "open_binary",
              arguments: { path: carvedPath, provider_id: "ghidra" },
            },
            { timeout: 60000 },
          ),
        );
        assertMipsCarvedTargetRefusal(carvedError, openedPath, carve.reason);
        let carvedCliError;
        try {
          await execute(
            process.execPath,
            [
              entrypoint,
              "function",
              carvedPath,
              independent.symbols.rea_mips_entry,
              "--provider",
              "ghidra",
              "--json",
            ],
            { env, timeout: 60000, maxBuffer: 1024 * 1024 },
          );
        } catch (cause) {
          carvedCliError = cause;
        }
        assert.ok(
          carvedCliError &&
            Number.isInteger(carvedCliError.code) &&
            carvedCliError.code !== 0,
          "Expected a target-opening refusal, not a timeout or success",
        );
        assertMipsCarvedTargetRefusal(
          JSON.parse(carvedCliError.stdout),
          openedPath,
          carve.reason,
        );
        assert.deepEqual(await readFile(carvedPath), carve.bytes);
        carved = {
          sha256: carvedSha256,
          source_bytes: carve.bytes.length,
          section_header_offset: carve.sectionOffset,
          status: "expected-target-refusal",
          reason: carve.reason,
          cli_exit: carvedCliError.code,
          mcp_error: carvedError,
        };
      }
      reports.push({
        ...fixture,
        independent_reader: independent,
        effective_language: image.observations.language_id,
        effective_compiler_spec: image.observations.compiler_spec_id,
        checks: [
          "independent ELF/ABI and symbols",
          "loaded Ghidra identity",
          "fixed instruction bytes and immediate",
          psp
            ? "Allegrex BITREV decoding and A-B-A target identity"
            : "conditional branch destination",
          "global word and marker bytes",
          "CLI/MCP and snapshot identity",
          ...(floatAbi === "soft"
            ? ["soft-float o32 parameter/return storage and caller constants"]
            : []),
        ],
        ...(softFloat === undefined ? {} : { soft_float: softFloat }),
        procedures: procedures.length,
        carved: carved ?? {
          status: "not_run",
          reason:
            "Carved-firmware verification covers generic MIPS fixtures; carved PSP coverage is not established.",
        },
        status: "passed",
      });
    } catch (cause) {
      throw new Error(
        `MIPS ${byteOrder} ${floatAbi}-float verification failed; MCP stderr: ${stderr}`,
        { cause },
      );
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
    `MIPS verification failed; retained workspace: ${workspace}`,
    {
      cause: primaryFailure,
    },
  );
await rm(workspace, { recursive: true, force: true });
console.log(JSON.stringify({ ...completed, fixtures: reports }, null, 2));
