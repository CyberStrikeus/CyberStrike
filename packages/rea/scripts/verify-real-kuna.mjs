#!/usr/bin/env node
// Real Kuna provider lane. Requires a caller-supplied kuna (REA_KUNA_COMMAND)
// and a host C compiler; REA installs neither. The default run builds a
// source-owned fixture, with symbols and stripped, and verifies the public MCP
// workflow: cold single-function pseudocode, the project export, warm reuse
// from a fresh server, and cleanup. `--targets DIR --functions a,b` adds
// caller-built binaries (DIR/<flavor>/<name> plus <name>.stripped).
// `--compare-ghidra` runs the same functions through a bring-your-own Ghidra
// and reports latency, CPU, memory, output size and simple quality signals.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { inspectKunaInstallation } from "../dist/kuna/KunaInstallation.js";
import { ArtifactResourceScope } from "../dist/artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../dist/artifacts/AnalysisCleanupLease.js";
import { requireMcpOperationResult } from "./lib/mcp-verifier-results.mjs";
import { verifyKunaReferences } from "./lib/kuna-reference-verifier.mjs";
import {
  nativeKunaStrings,
  verifyKunaStrings,
} from "./lib/kuna-string-verifier.mjs";
import { nativeKunaIncomingSites } from "./lib/kuna-native-reference-verifier.mjs";
import {
  assertVerifierCleanupComplete,
  completeVerifierRun,
  createVerifierRun,
} from "./lib/verifier-run.mjs";

const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    targets: { type: "string" },
    functions: { type: "string" },
    "compare-ghidra": { type: "boolean", default: false },
    report: { type: "string" },
    entrypoint: { type: "string" },
  },
});
const entrypoint =
  values.entrypoint === undefined
    ? fileURLToPath(new URL("./rea.mjs", import.meta.url))
    : resolve(values.entrypoint);
const kuna = process.env.REA_KUNA_COMMAND;
assert.ok(
  kuna !== undefined && kuna.startsWith("/"),
  "Kuna lane prerequisite missing: REA_KUNA_COMMAND must name a caller-supplied kuna by absolute path (bring your own)",
);
if (values["compare-ghidra"]) {
  // The comparison runs on caller-built targets only; the fixture has none.
  assert.ok(
    values.targets !== undefined && values.functions !== undefined,
    "--compare-ghidra compares caller-built targets: pass --targets DIR --functions a,b as well",
  );
  assert.ok(
    process.env.GHIDRA_INSTALL_DIR,
    "Ghidra comparison prerequisite missing: GHIDRA_INSTALL_DIR (bring your own Ghidra 12.1.4 and JDK 21)",
  );
}
const run = createVerifierRun();
const inspectionResources = new ArtifactResourceScope();
const resourceScope = {
  retain: (owner, resource) =>
    inspectionResources.retain({
      kind: "lease",
      resource,
      lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
    }),
  run: (operation) => inspectionResources.run(operation),
};
const workspace = await mkdtemp(join(tmpdir(), "rea-kuna-lane-"));
const cacheRoot = join(workspace, "cache");
// A server retains its workspace until both provider and transport cleanup
// have positively completed, even if later lineage observation is empty.
const pendingServers = new Set();
// Unproven native-oracle stops retain their supervisors and this workspace.
const retainedNative = new Set();
let kunaVersion;

const FIXTURE_SOURCE = String.raw`
#include <stdio.h>
#include <stdlib.h>
static const char rea_kuna_utf8[] __attribute__((used)) = "＿φ( °-°)/ REA unicode marker";
/* The leading NUL unit ends any UTF-16 run that bytes before this array would
   start: the UTF-8 marker's last byte and NUL decode as the unit 'r', so on
   layouts where it precedes this array Kuna reports "rREA wide marker". */
static const unsigned short rea_kuna_wide[] __attribute__((used)) = {
  0,'R','E','A',' ','w','i','d','e',' ','m','a','r','k','e','r',0
};
#include <string.h>
__attribute__((noinline)) unsigned rea_checksum(const unsigned char *p, size_t n) {
  unsigned h = 2166136261u;
  for (size_t i = 0; i < n; i++) h = (h ^ p[i]) * 16777619u;
  return h;
}
__attribute__((noinline)) int rea_classify(int c) {
  switch (c) {
  case 'a': return 1; case 'e': return 2; case 'i': return 3;
  case 'o': return 4; case 'u': return 5; default: return c > 'z' ? -1 : 0;
  }
}
int main(int argc, char **argv) {
  if (argc < 2) return 2;
  printf("%u %d\n", rea_checksum((const unsigned char *)argv[1], strlen(argv[1])),
         rea_classify(argv[1][0]));
  return 0;
}
`;

/** Resolve function entry addresses from a symbol-bearing build. */
const symbolAddresses = async (binary, names) => {
  const { stdout } = await exec(process.env.REA_NM ?? "nm", [binary]);
  const found = new Map();
  for (const line of stdout.split("\n")) {
    const [address, type, symbol] = line.trim().split(/\s+/u);
    if (symbol === undefined || !/^[tT]$/u.test(type ?? "")) continue;
    const plain = symbol.startsWith("_") ? symbol.slice(1) : symbol;
    for (const name of names)
      if ((symbol === name || plain === name) && !found.has(name))
        found.set(name, `0x${BigInt(`0x${address}`).toString(16)}`);
  }
  return found;
};

/** Sum the resident memory and CPU time of a process and its descendants. */
const sampleTree = async (root) => {
  const { stdout } = await exec("ps", ["-A", "-o", "pid=,ppid=,rss=,time="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .map(([pid, ppid, rss, time]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      rssKiB: Number(rss),
      cpuSeconds: (time ?? "0:0")
        .split(/[:-]/u)
        .map(Number)
        .reduce((total, part) => total * 60 + part, 0),
    }));
  const members = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows)
      if (!members.has(row.pid) && members.has(row.ppid)) {
        members.add(row.pid);
        grew = true;
      }
  }
  const tree = rows.filter(({ pid }) => members.has(pid));
  return {
    rssKiB: tree.reduce((total, row) => total + row.rssKiB, 0),
    cpu: new Map(tree.map((row) => [row.pid, row.cpuSeconds])),
  };
};

/** One MCP server with a selected provider, sampled while it runs. */
const openServer = async (provider) => {
  const owner = Symbol(provider.id);
  pendingServers.add(owner);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "--mcp"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? workspace,
      REA_LOG_LEVEL: "silent",
      REA_PROCESS_RUN_ID: run.run_id,
      REA_KUNA_COMMAND: kuna,
      REA_KUNA_CACHE_DIR: cacheRoot,
      ...(process.env.GHIDRA_INSTALL_DIR === undefined
        ? {}
        : { GHIDRA_INSTALL_DIR: process.env.GHIDRA_INSTALL_DIR }),
      ...(process.env.JAVA_HOME === undefined
        ? {}
        : { JAVA_HOME: process.env.JAVA_HOME }),
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "rea-real-kuna", version: "1" });
  let peakKiB = 0;
  const cpu = new Map();
  const sampleOnce = async () => {
    const pid = transport.pid;
    if (pid === null) return;
    const observed = await sampleTree(pid).catch(() => undefined);
    if (observed === undefined) return;
    peakKiB = Math.max(peakKiB, observed.rssKiB);
    for (const [member, seconds] of observed.cpu)
      cpu.set(member, Math.max(cpu.get(member) ?? 0, seconds));
  };
  let sampling;
  const sample = () => {
    sampling ??= sampleOnce().finally(() => {
      sampling = undefined;
    });
    return sampling;
  };
  let timer;
  const call = async (name, arguments_ = {}) => {
    const started = performance.now();
    const result = await client.callTool(
      { name, arguments: arguments_ },
      { timeout: 3_600_000 },
    );
    const ms = Math.round(performance.now() - started);
    const bytes = Buffer.byteLength(JSON.stringify(result));
    return {
      ms,
      bytes,
      value: requireMcpOperationResult(result, name),
      structured: result.structuredContent,
    };
  };
  const close = async (priorFailure) => {
    clearInterval(timer);
    await sample();
    const failures = priorFailure === undefined ? [] : [priorFailure];
    // Attempt each cleanup independently. Disposing a transport is not proof
    // that close_binary released retained provider processes or files.
    for (const cleanup of [
      () => call("close_binary"),
      () => client.close(),
      () => transport.close(),
    ])
      try {
        await cleanup();
      } catch (cause) {
        failures.push(cause);
      }
    // A prior verification error must survive successful cleanup. Only the
    // cleanup failures retain this server's files.
    if (failures.length > (priorFailure === undefined ? 0 : 1))
      throw new AggregateError(
        failures,
        "MCP server cleanup was not confirmed",
      );
    pendingServers.delete(owner);
    if (priorFailure !== undefined) throw priorFailure;
    return {
      peak_rss_mib: Math.round(peakKiB / 1024),
      cpu_seconds: [...cpu.values()].reduce((total, value) => total + value, 0),
    };
  };
  try {
    await client.connect(transport);
    timer = setInterval(() => void sample(), 200);
    await call("open_binary", {
      path: provider.path,
      provider_id: provider.id,
    });
  } catch (cause) {
    // A rejected connection/target still owns its transport and workspace.
    await close(cause);
  }
  return { call, close };
};

/** Count structuring and diagnostic markers in provider pseudocode. */
const quality = (text) => ({
  bytes: text === null ? 0 : Buffer.byteLength(text),
  gotos: text === null ? 0 : (text.match(/\bgoto\b/gu) ?? []).length,
  warnings:
    text === null ? 0 : (text.match(/WARNING|\/\/ warn:/gu) ?? []).length,
});

/** Verify Kuna on one binary and measure its cold and warm answers. */
const verifyKuna = async (
  path,
  functions,
  expectedCaller,
  expectedStrings = [],
) => {
  const sha256 = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  const cold = await openServer({ path, id: "kuna" });
  const answers = [];
  let coldFailure;
  try {
    answers.push({
      strings: await verifyKunaStrings({
        call: cold.call,
        cacheRoot,
        expectedStrings,
        nativeStrings: () =>
          nativeKunaStrings({
            executable: kuna,
            cacheRoot,
            workspace,
            binary: path,
            retain: (owner) => retainedNative.add(owner),
            resourceScope,
          }),
      }),
    });
    const listed = await cold.call("list_procedures");
    for (const [name, address] of functions) {
      assert.ok(
        listed.value.some((entry) => entry.address === address),
        `${name} at ${address} is missing from Kuna's procedure list for ${path}`,
      );
      const references = await verifyKunaReferences({
        call: cold.call,
        cacheRoot,
        name,
        address,
        expectedCaller,
        nativeIncoming: (targetAddress) =>
          nativeKunaIncomingSites({
            executable: kuna,
            cacheRoot,
            workspace,
            binary: path,
            address: targetAddress,
            retain: (outcome) => retainedNative.add(outcome),
            resourceScope,
          }),
      });
      const pseudocode = await cold.call("procedure_pseudo_code", {
        procedure: address,
      });
      assert.equal(pseudocode.structured.subject.digest.sha256, sha256);
      assert.equal(pseudocode.structured.provider.id, "kuna");
      const source = pseudocode.structured.raw_result?.source?.kind;
      // A fast export can finish before the first request reaches the
      // decompile path; both sources are valid answers. The single-function
      // fallback itself is covered by the provider's boundary tests.
      assert.ok(
        source === "single-function" || source === "project-export",
        `Unexpected pseudocode source ${String(source)}`,
      );
      const assembly = await cold.call("procedure_assembly", {
        procedure: address,
      });
      assert.equal(
        assembly.structured.raw_result.source.kind,
        "project-export",
      );
      assert.match(assembly.value, new RegExp(`:  ; ${address}\\n`, "u"));
      const exported = await cold.call("procedure_pseudo_code", {
        procedure: address,
      });
      const recorded = exported.structured.raw_result.source;
      assert.equal(recorded.kind, "project-export");
      const block = (await readFile(join(recorded.directory, recorded.file)))
        .subarray(
          recorded.byte_offset,
          recorded.byte_offset + recorded.byte_length,
        )
        .toString("utf8");
      assert.ok(
        exported.value === null || block.includes(exported.value),
        "Served pseudocode differs from the recorded export span",
      );
      const dossier = await cold.call("analyze_function", {
        procedure: address,
        detail: "complete",
      });
      assert.deepEqual(
        dossier.structured.relationship_coverage,
        references.relationship_coverage,
        "Function dossier lost the directional call coverage",
      );
      const combined = dossier.structured.raw_result.source;
      assert.equal(combined.kind, "project-export");
      assert.deepEqual(
        combined.files.map(({ facet }) => facet),
        ["pseudocode", "assembly"],
      );
      for (const file of combined.files) {
        const bytes = await readFile(join(combined.directory, file.file));
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          file.file_sha256,
        );
        const span = bytes
          .subarray(file.byte_offset, file.byte_offset + file.byte_length)
          .toString("utf8");
        const facet = dossier.value[file.facet];
        assert.ok(
          span.includes(Array.isArray(facet) ? facet.join("\n") : facet),
        );
      }
      answers.push({
        name,
        address,
        cold_source: source,
        cold_ms: pseudocode.ms,
        export_wait_ms: assembly.ms,
        warm_same_session_ms: exported.ms,
        response_bytes: exported.bytes,
        dossier_response_bytes: dossier.bytes,
        ...quality(exported.value),
        references,
      });
    }
  } catch (cause) {
    coldFailure = cause;
  } finally {
    answers.push({ cold_server: await cold.close(coldFailure) });
  }
  const staging = await readdir(join(cacheRoot, "staging"));
  assert.deepEqual(staging, [], "Kuna staging survived a completed export");
  // A fresh server reuses the export immediately.
  const warm = await openServer({ path, id: "kuna" });
  let warmFailure;
  try {
    for (const answer of answers)
      if (answer.address !== undefined) {
        const reread = await warm.call("procedure_pseudo_code", {
          procedure: answer.address,
        });
        assert.equal(
          reread.structured.raw_result.source.kind,
          "project-export",
        );
        answer.warm_fresh_server_ms = reread.ms;
      }
  } catch (cause) {
    warmFailure = cause;
  } finally {
    answers.push({ warm_server: await warm.close(warmFailure) });
  }
  return answers;
};

/** Measure Ghidra on the same functions through the same public workflow. */
const measureGhidra = async (path, functions) => {
  const server = await openServer({ path, id: "ghidra" });
  const answers = [];
  let failure;
  try {
    for (const [name, address] of functions) {
      const cold = await server.call("procedure_pseudo_code", {
        procedure: address,
      });
      const warm = await server.call("procedure_pseudo_code", {
        procedure: address,
      });
      answers.push({
        name,
        address,
        first_call_ms: cold.ms,
        repeat_ms: warm.ms,
        response_bytes: cold.bytes,
        ...quality(cold.value),
      });
    }
  } catch (cause) {
    failure = cause;
  } finally {
    answers.push({ server: await server.close(failure) });
  }
  return answers;
};

/** Symbol-bearing caller binaries with the requested functions, beside their stripped copies. */
const targetPairs = async (root, names) => {
  const pairs = [];
  for (const flavor of (await readdir(root)).sort()) {
    const directory = join(root, flavor);
    if (!(await stat(directory)).isDirectory()) continue;
    for (const file of (await readdir(directory)).sort()) {
      if (file.endsWith(".stripped")) continue;
      const symbols = await symbolAddresses(join(directory, file), names);
      if (symbols.size > 0) pairs.push({ flavor, directory, file, symbols });
    }
  }
  return pairs;
};

/** Verify Kuna, and optionally measure Ghidra, on one binary of a pair. */
const verifyVariant = async ({ flavor, directory, symbols }, variant) => {
  const path = join(directory, variant);
  const entry = { binary: `${flavor}/${variant}` };
  entry.kuna = await verifyKuna(path, [...symbols]);
  if (values["compare-ghidra"])
    entry.ghidra = await measureGhidra(path, [...symbols]);
  process.stderr.write(`verified ${entry.binary}\n`);
  return entry;
};

const results = [];
const failures = [];
let inspectionResourcesClean = true;
try {
  const installation = await inspectKunaInstallation(
    { REA_KUNA_COMMAND: kuna, REA_KUNA_CACHE_DIR: cacheRoot },
    { resourceScope },
  );
  assert.ok(
    installation.ok,
    installation.ok ? undefined : installation.error.reason,
  );
  kunaVersion = `kuna ${installation.value.version}`;
  let callerPairs = [];
  if (values.targets !== undefined) {
    const names = (values.functions ?? "").split(",").filter(Boolean);
    assert.ok(names.length > 0, "--targets requires --functions");
    callerPairs = await targetPairs(values.targets, names);
    assert.ok(
      callerPairs.length > 0,
      `No caller-built targets contain the requested functions in ${values.targets}`,
    );
    const found = new Set(
      callerPairs.flatMap(({ symbols }) => [...symbols.keys()]),
    );
    const missing = names.filter((name) => !found.has(name));
    assert.deepEqual(
      missing,
      [],
      "Requested functions were not found in any caller-built target",
    );
  }

  // Source-owned fixture: always built and verified.
  const fixtureDir = join(workspace, "fixture");
  await mkdir(fixtureDir);
  const source = join(fixtureDir, "fixture.c");
  await writeFile(source, FIXTURE_SOURCE);
  const built = join(fixtureDir, "rea-kuna-fixture");
  await exec(process.env.REA_CC ?? "cc", ["-O2", "-o", built, source]);
  const stripped = `${built}.stripped`;
  await writeFile(stripped, await readFile(built));
  await exec(process.env.REA_STRIP ?? "strip", [stripped]);
  const fixtureFunctions = await symbolAddresses(built, [
    "rea_checksum",
    "rea_classify",
    "main",
  ]);
  assert.equal(fixtureFunctions.size, 3, "Fixture symbols were not found");
  const fixtureMain = fixtureFunctions.get("main");
  fixtureFunctions.delete("main");
  for (const binary of [built, stripped])
    results.push({
      binary: binary.slice(workspace.length + 1),
      kuna: await verifyKuna(binary, [...fixtureFunctions], fixtureMain, [
        "＿φ( °-°)/ REA unicode marker",
        "REA wide marker",
      ]),
    });

  // Caller-built matrix.
  for (const pair of callerPairs)
    for (const variant of [pair.file, `${pair.file}.stripped`])
      results.push(await verifyVariant(pair, variant));
} catch (cause) {
  failures.push(cause);
}
// Failure paths need the same process evidence as successful verification.
for (const retained of [...retainedNative]) {
  try {
    const stopped = await retained.owner?.stop();
    if (stopped !== undefined && stopped.status !== "incomplete")
      retainedNative.delete(retained);
  } catch (cause) {
    failures.push(cause);
  }
}
try {
  await inspectionResources.close();
} catch (cause) {
  inspectionResourcesClean = false;
  failures.push(cause);
}
const lifecycle = await completeVerifierRun(run);
let cleanupComplete =
  pendingServers.size === 0 &&
  retainedNative.size === 0 &&
  inspectionResourcesClean;
try {
  assertVerifierCleanupComplete(lifecycle.process_lineage);
} catch (cause) {
  cleanupComplete = false;
  failures.push(cause);
}
if (cleanupComplete)
  try {
    await rm(workspace, { recursive: true, force: true });
  } catch (cause) {
    cleanupComplete = false;
    failures.push(cause);
  }
const describeFailure = (cause) => ({
  message: cause instanceof Error ? cause.message : String(cause),
  ...(cause instanceof AggregateError
    ? { causes: cause.errors.map(describeFailure) }
    : {}),
});
const report = {
  lane: "kuna",
  status: failures.length === 0 ? "passed" : "failed",
  kuna_version: kunaVersion,
  platform: `${process.platform}/${process.arch}`,
  verifier_run: lifecycle,
  results,
  limitations: [
    "Targets are analyzed statically; they are never executed.",
    "Memory is the sampled peak resident set of the MCP server process tree; CPU is its sampled cumulative time. A short-lived peak between 200 ms samples is not observed.",
    "Quality signals count gotos and warning markers only; they are not a correctness judgement and not a DecBench reproduction.",
    "Response bytes are UTF-8 serialization sizes. Model token usage, tool schema costs and agent task completion were not measured.",
  ],
  cleanup: cleanupComplete ? "complete" : "incomplete",
  ...(cleanupComplete ? {} : { retained_workspace: workspace }),
  ...(failures.length === 0 ? {} : { failures: failures.map(describeFailure) }),
};
if (values.report !== undefined)
  await writeFile(values.report, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
if (failures.length > 0)
  throw new AggregateError(
    failures,
    "Kuna verification failed; see the report for cleanup evidence",
  );
