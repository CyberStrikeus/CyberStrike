#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  requireMcpOperationResult,
  requireMcpOutput,
} from "./lib/mcp-verifier-results.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  buildSwitchSource,
  switchSymbolOracle,
  assertCompiledSwitchOracle,
} from "../tests/conformance/ghidra/switch-fixture.mjs";
import {
  assertSwitchBoundary,
  assertSwitchOracleControls,
} from "./verify-real-ghidra-switch-assertions.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { verifySwitchEvidenceControls } from "./verify-real-ghidra-switch-controls.mjs";

// Narrow compiler-shape lane; no cross compiler or game artifact prerequisites.
const { values } = parseArgs({
  options: {
    "compiler-oracle-only": { type: "boolean", default: false },
    entrypoint: { type: "string" },
  },
});
const compilerOnly = values["compiler-oracle-only"];
const entrypoint =
  values.entrypoint === undefined
    ? fileURLToPath(new URL("./rea.mjs", import.meta.url))
    : resolve(values.entrypoint);
assert.ok(
  process.platform === "linux" && process.arch === "x64",
  "Ghidra switch compiler lane requires Linux x64; macOS/Windows and cross targets use their separate provider lanes.",
);
const exec = promisify(execFile);
const commands = {
  gcc: process.env.REA_GCC ?? "gcc",
  clang: process.env.REA_CLANG ?? "clang",
  nm: process.env.REA_NM ?? "nm",
  objdump: process.env.REA_OBJDUMP ?? "objdump",
  strip: process.env.REA_STRIP ?? "strip",
};
const versions = {};
for (const [role, command] of Object.entries(commands)) {
  try {
    const { stdout } = await exec(command, ["--version"]);
    versions[role] = stdout.split("\n")[0];
  } catch (cause) {
    throw new Error(
      `Ghidra switch compiler lane prerequisite missing: ${role} '${command}'`,
      { cause },
    );
  }
}
let installation;
if (!compilerOnly) {
  const { inspectVerifierGhidraInstallation } =
    await import("./lib/ghidra-installation-inspection.mjs");
  assert.ok(
    process.env.GHIDRA_INSTALL_DIR,
    "Ghidra switch lane prerequisite missing: GHIDRA_INSTALL_DIR (bring your own)",
  );
  installation = await inspectVerifierGhidraInstallation({
    environment: process.env,
    installDir: process.env.GHIDRA_INSTALL_DIR,
    ...(process.env.JAVA_HOME === undefined
      ? {}
      : { javaHome: process.env.JAVA_HOME }),
  });
  assert.equal(installation.status, "available", JSON.stringify(installation));
}
const run = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-switch-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const source = join(workspace, "switch.c");
await writeFile(source, buildSwitchSource());
const flags = ["-O2", "-g", "-fno-pie", "-no-pie"];
const results = [];
let productionControls = null;
try {
  for (const compiler of ["gcc", "clang"]) {
    const original = join(workspace, `${compiler}-optimized`);
    await exec(commands[compiler], [...flags, source, "-o", original]);
    const bytes = await readFile(original);
    const { stdout: symbols } = await exec(commands.nm, ["-n", original]);
    const { stdout: disassembly } = await exec(commands.objdump, [
      "-d",
      original,
    ]);
    const fixtures = assertCompiledSwitchOracle(
      bytes,
      switchSymbolOracle(symbols),
      disassembly,
    );
    const oracleFaultControls = assertSwitchOracleControls(fixtures);
    if (!compilerOnly && productionControls === null) {
      productionControls = await verifySwitchEvidenceControls({
        installation,
        entrypoint,
        target: original,
        workspace,
        runId: run.run_id,
      });
      assert.equal(
        digest(await readFile(original)),
        digest(bytes),
        "Guard changed compiler-oracled input",
      );
    }
    const stripped = join(workspace, `${compiler}-stripped`);
    await copyFile(original, stripped);
    await exec(commands.strip, ["--strip-all", stripped]);
    // Byte/physical target oracle survives removal of the names that REA could use.
    assertCompiledSwitchOracle(await readFile(stripped), fixtures, disassembly);
    for (const [variant, path] of [
      ["optimized", original],
      ["stripped", stripped],
    ]) {
      const sha256 = digest(await readFile(path));
      const observation = compilerOnly
        ? null
        : await verifyTarget(path, sha256, fixtures, variant);
      assert.equal(
        digest(await readFile(path)),
        sha256,
        "REA analysis changed original compiled fixture",
      );
      results.push({
        compiler,
        variant,
        oracle_fault_controls: oracleFaultControls,
        sha256,
        compiler_oracle: fixtures.map(
          ({
            name,
            address,
            dispatch_address,
            table_address,
            slots,
            default_address,
          }) => ({
            name,
            address,
            dispatch_address,
            table_address,
            slots,
            default_address,
          }),
        ),
        observation,
      });
    }
  }
} finally {
  try {
    assert.deepEqual(
      (await readdir(runtime)).filter((name) => name.startsWith("rea-ghidra-")),
      [],
      "Owned Ghidra runtime survived close",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
const lifecycle = await completeVerifierRun(run);
if (lifecycle.process_lineage.status === "verified")
  assert.deepEqual(lifecycle.process_lineage.descendants, []);
process.stdout.write(
  `${JSON.stringify({ lane: "linux-x64-compiler-switch", compiler_only: compilerOnly, entrypoint, versions, compiler_flags: flags, verifier_run: lifecycle, production_controls: productionControls, results, limitations: ["Exact compiler oracle admits absolute 8-byte native x86-64 ELF tables and fails explicitly when a compiler changes lowering.", "Compiled binaries are analyzed read-only; target programs are never executed.", "Comparison-only control proves absence of a fabricated table and preservation of provider limitations, not recovery of C source.", "Detached Ghidra object controls exercise actual bridge methods through reflection; they do not claim naturally compiled ambiguous dispatches.", "CLI/MCP comparison covers switch observations, excluding process-specific Evidence IDs."], cleanup: "complete" })}\n`,
);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function verifyTarget(path, sha256, fixtures, variant) {
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
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "rea-real-switch-proof", version: "1" });
  let opened = false;
  let stderr = "";
  const observations = [];
  try {
    await client.connect(transport);
    transport.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    const target = await call(client, "open_binary", {
      path,
      provider_id: "ghidra",
    });
    opened = true;
    assert.equal(target.sha256, sha256);
    assert.equal(target.architecture, "x86_64");
    assert.equal(target.format, "elf");
    const procedures = await call(client, "list_procedures");
    for (const fixture of fixtures) {
      const observationFixture = {
        ...fixture,
        allow_unsigned_32_labels:
          variant === "stripped" && fixture.name === "negative",
      };
      const procedure = procedures.find(
        ({ address }) => address === fixture.address,
      );
      assert.ok(
        procedure,
        `Source-owned function at ${fixture.address} not discovered in optimized/stripped fixture`,
      );
      const observed = await toolResult(client, "inspect_native_api", {
        procedure: procedure.address,
      });
      assertWorkflowIdentity(observed, sha256);
      assert.equal(
        observed.normalized_result.procedure.address,
        procedure.address,
      );
      const summary = assertSwitchBoundary(
        observed.normalized_result.boundary,
        observationFixture,
      );
      assert.deepEqual(
        [...observed.normalized_result.residual_unknowns].sort(),
        expectedResidualUnknowns(
          observed.normalized_result.boundary,
          fixture,
        ).sort(),
        "Residual unknowns must preserve unresolved ABI types and exactly the expected switch uncertainty",
      );
      const cli = await cliSwitchEvidence(
        entrypoint,
        path,
        procedure.address,
        env,
      );
      assertWorkflowIdentity(cli, sha256);
      assert.equal(cli.normalized_result.procedure.address, procedure.address);
      assertSwitchBoundary(cli.normalized_result.boundary, observationFixture);
      assert.deepEqual(
        cli.normalized_result.boundary.jump_tables,
        observed.normalized_result.boundary.jump_tables,
        "CLI/MCP switch mappings/defaults/data-source evidence differ",
      );
      assert.deepEqual(
        cli.normalized_result.residual_unknowns,
        observed.normalized_result.residual_unknowns,
      );
      observations.push({
        name: fixture.name,
        ...summary,
        cli_mcp_equal: true,
        limitations: observed.normalized_result.boundary.limitations,
        residual_unknowns: observed.normalized_result.residual_unknowns,
        jump_tables: observed.normalized_result.boundary.jump_tables,
      });
    }
    return { observations, stderr };
  } finally {
    try {
      if (opened) await call(client, "close_binary");
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
  }
}
function assertWorkflowIdentity(evidence, sha256) {
  assert.equal(evidence.subject.digest.sha256, sha256);
  assert.equal(evidence.operation, "inspect_native_api");
  assert.equal(evidence.provider.id, "rea-workflow");
  assert.equal(evidence.analysis_profile.provider.id, "rea-workflow");
  assert.equal(
    evidence.analysis_profile.parameters.upstream_analysis_profile.parameters
      .language_id,
    "auto-from-header",
  );
}

function expectedResidualUnknowns(boundary, fixture) {
  const unknowns = [boundary.return_type, ...boundary.parameters]
    .filter(({ confidence }) => confidence === "low")
    .map(
      ({ role, data_type: type }) =>
        `Can the inferred ${role} type ${type} be confirmed with imported metadata or an ABI probe?`,
    );
  if (fixture.unsafe_integer)
    unknowns.push(
      `Which source-level case values correspond to every target dispatched at ${boundary.jump_tables[0].dispatch_address}?`,
    );
  return [...new Set(unknowns)];
}
async function toolResult(client, name, arguments_ = {}) {
  const result = await client.callTool(
    { name, arguments: arguments_ },
    { timeout: 240000 },
  );
  assert.ok(result.structuredContent, `${name} omitted structured result`);
  return requireMcpOutput(result, name);
}
async function call(client, name, arguments_ = {}) {
  const result = await client.callTool(
    { name, arguments: arguments_ },
    { timeout: 240000 },
  );
  return requireMcpOperationResult(result, name);
}

async function cliSwitchEvidence(entrypoint, path, procedure, env) {
  const { stdout } = await exec(
    process.execPath,
    [
      entrypoint,
      "inspect-native-api",
      path,
      procedure,
      "--provider",
      "ghidra",
      "--json",
    ],
    { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
