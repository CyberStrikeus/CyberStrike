#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import { ArtifactResourceScope } from "../dist/artifacts/ArtifactResourceScope.js";
import { readGhidraLanguageCatalog } from "../dist/ghidra/GhidraLanguageCatalog.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import { parseAnalysisSnapshot } from "../dist/domain/analysisSnapshot.js";
import { functionDossierSchema } from "../dist/domain/native/functionDossier.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { buildGameCubeDolFixture } from "../tests/conformance/ghidra/dol-fixture.mjs";
import {
  GEKKO_LANGUAGE,
  STOCK_LANGUAGE,
  assertDolAgainstElf,
  assertDolEntryProcedure,
  assertDolGap,
  assertDolGlobal,
  assertDolLoadImage,
  assertDolTail,
  inspectReadelfDolSource,
  parseDolHeaderIndependent,
} from "../tests/conformance/ghidra/dol-checks.mjs";
import { requireMcpOperationResult } from "./lib/mcp-verifier-results.mjs";
import {
  createVerifierRun,
  completeVerifierRun,
  assertVerifierCleanupComplete,
} from "./lib/verifier-run.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";

// Optional cross-target lane. No tool acquisition and no target execution.
if (process.argv.length !== 2)
  throw new Error("Usage: node scripts/verify-real-ghidra-dol.mjs");
if (!["linux", "darwin"].includes(process.platform))
  throw new Error(
    "GameCube DOL verification requires a supported Linux/macOS Ghidra host",
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
const workspace = await mkdtemp(join(tmpdir(), "rea-dol-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const baseEnv = {
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
  if (process.env[setting] !== undefined)
    baseEnv[setting] = process.env[setting];
}

/**
 * True when GhidraProvider would admit the language id as an override: the same
 * installation catalog reader it uses. User extensions are not in that catalog.
 */
async function languageInstalled(languageId) {
  const scope = new ArtifactResourceScope();
  try {
    const catalog = await readGhidraLanguageCatalog(
      installation.installDir,
      scope,
    );
    return catalog.some((definition) => definition.id === languageId);
  } finally {
    await scope.close();
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** One MCP session plus CLI check. `languageOverride` is set only for the Gekko pass. */
async function runPass({ fixture, languageOverride, label, layout }) {
  const env = { ...baseEnv };
  if (languageOverride !== undefined)
    env.REA_GHIDRA_LANGUAGE_ID = languageOverride;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "rea-real-dol-proof", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-65536);
  });
  const call = async (name, args = {}) => {
    const reply = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 180000,
    });
    return requireMcpOperationResult(reply, name);
  };
  const report = { label, language_override: languageOverride ?? null };
  try {
    await withVerifierCleanup(async () => {
      await client.connect(transport);
      const target = await call("open_binary", {
        path: fixture.path,
        provider_id: "ghidra",
        format: "gamecube-dol",
      });
      assert.equal(target.architecture, "powerpc");
      assert.equal(target.sha256, fixture.sha256);
      const status = await call("binary_session");
      assert.equal(status.open, true);
      assert.equal(status.format, "gamecube-dol");
      assert.equal(status.architecture, "powerpc");
      assert.equal(status.analysis_provider_binding?.provider?.id, "ghidra");
      const image = await call("inspect_native_load_image");
      const expectedLanguage = languageOverride ?? STOCK_LANGUAGE;
      assertDolLoadImage(image, {
        sha256: fixture.sha256,
        languageId: expectedLanguage,
      });
      report.language_id = image.language_id;
      report.compiler_spec_id = image.compiler_spec_id;
      report.attestation = image.status;
      const procedures = await call("list_procedures");
      const entry = assertDolEntryProcedure(procedures, layout.entry);
      report.entry = entry;
      if (languageOverride === undefined) {
        assert.ok(
          procedures.some((p) => BigInt(p.address) === layout.leaf),
          "Leaf function missing from real Ghidra inventory",
        );
        const callees = await call("procedure_callees", {
          procedure: entry.address,
        });
        assert.ok(
          callees.some((address) => BigInt(address) === layout.leaf),
          "Direct call to leaf not recovered",
        );
        const dossier = functionDossierSchema.parse(
          await call("analyze_function", {
            procedure: entry.address,
            detail: "complete",
          }),
        );
        assert.ok(
          dossier.pseudocode.includes("__start"),
          "Decompiled entry lacks __start",
        );
        const global = await call("read_bytes", {
          address: `0x${layout.global.toString(16)}`,
          length: 4,
        });
        assertDolGlobal(global.bytes_hex);
        const marker = await call("read_bytes", {
          address: `0x${layout.marker.toString(16)}`,
          length: 29,
        });
        assert.equal(
          marker.bytes_hex,
          Buffer.from("rea-ppc-source-owned-fixture\0").toString("hex"),
        );
        const tail = await call("read_bytes", {
          address: `0x${layout.tail.toString(16)}`,
          length: 4,
        });
        assertDolTail(tail.bytes_hex);
        const gap = await call("read_bytes", {
          address: `0x${layout.bssGap.toString(16)}`,
          length: 4,
        });
        report.bss_gap_read = {
          returned_bytes: gap.returned_bytes,
          bytes_hex: gap.bytes_hex,
        };
        assertDolGap(gap);
        await call("close_binary");
        report.checks = [
          "independent DOL header and ELF/readelf agreement",
          "section file bytes and BSS gap set",
          "MCP open_binary format gamecube-dol and load-image attestation",
          "__start at entry, direct call to leaf, decompile",
          "data, tail, marker and BSS-gap bytes",
        ];
        report.procedures = procedures.length;
      } else {
        await call("close_binary");
        report.checks = [
          "MCP open with override",
          "load-image attestation with overridden language",
        ];
      }
    }, [() => client.close(), () => transport.close()]);
  } catch (cause) {
    throw new Error(`GameCube DOL ${label} failed; MCP stderr: ${stderr}`, {
      cause,
    });
  }
  if (languageOverride === undefined) {
    // CLI path through the same stock lane, not a private injected provider.
    const cli = await execute(
      process.execPath,
      [
        entrypoint,
        "function",
        fixture.path,
        `0x${layout.entry.toString(16)}`,
        "--target-format",
        "gamecube-dol",
        "--provider",
        "ghidra",
        "--detail",
        "complete",
        "--json",
      ],
      { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
    );
    const evidence = parseEvidence(JSON.parse(cli.stdout));
    assert.equal(evidence.subject?.architecture, "powerpc");
    assert.equal(evidence.subject?.digest.sha256, fixture.sha256);
    const cliDossier = functionDossierSchema.parse(evidence.normalized_result);
    assert.equal(BigInt(cliDossier.procedure.address), layout.entry);
    assert.ok(cliDossier.pseudocode.includes("__start"));
    report.cli = {
      entry: cliDossier.procedure.address,
      subject_format: evidence.subject?.format ?? null,
    };
  }
  return report;
}

const reports = [];
let completed;
try {
  await withVerifierCleanup(async () => {
    const fixture = await buildGameCubeDolFixture(workspace);
    const elfBytes = await readFile(fixture.elf_path);
    const dolBytes = await readFile(fixture.path);
    const independentElf = await inspectReadelfDolSource(fixture.elf_path);
    const dol = parseDolHeaderIndependent(dolBytes);
    const shape = assertDolAgainstElf(
      dol,
      dolBytes,
      elfBytes,
      independentElf,
      fixture,
    );
    const resolved = await parseBinaryTarget(fixture.path, {
      formatHint: "gamecube-dol",
    });
    if (!resolved.ok) throw resolved.error;
    assert.equal(resolved.value.format, "gamecube-dol");
    assert.equal(resolved.value.sha256, fixture.sha256);
    // Addresses come from the independent readelf symbol table, not from constants.
    const symbols = independentElf.symbols;
    const layout = {
      entry: symbols.rea_ppc_entry,
      leaf: symbols.rea_ppc_leaf,
      global: symbols.rea_dol_global,
      marker: symbols.rea_ppc_marker,
      tail: symbols.rea_dol_tail,
      bssGap: BigInt(shape.gaps[0].start),
    };
    assert.equal(BigInt(resolved.value.entryPoint), layout.entry);
    reports.push({
      fixture: "stock",
      ...fixture,
      dol_shape: shape,
      readelf: independentElf.version,
    });
    reports.push(await runPass({ fixture, label: "stock language", layout }));
    if (await languageInstalled(GEKKO_LANGUAGE)) {
      reports.push(
        await runPass({
          fixture,
          languageOverride: GEKKO_LANGUAGE,
          label: "Gekko override",
          layout,
        }),
      );
    } else {
      console.log(
        `skipped: ${GEKKO_LANGUAGE} (not in the Ghidra installation catalog that REA admits); stock lane still verified`,
      );
    }
  }, [
    async () => {
      completed = await completeVerifierRun(run);
      assertVerifierCleanupComplete(completed.process_lineage);
    },
  ]);
} catch (cause) {
  throw new Error(
    `GameCube DOL verification failed; retained workspace: ${workspace}`,
    { cause },
  );
}
assert.ok(completed, "Verifier completion was not observed");
await rm(workspace, { recursive: true, force: true });
console.log(JSON.stringify({ ...completed, fixtures: reports }, null, 2));
