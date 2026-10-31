#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  requireMcpLifecycleResult,
  requireMcpOutput,
} from "./lib/mcp-verifier-results.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../dist/domain/evidence.js";
import { nativeDataTypeSchema } from "../dist/domain/native/nativeDataType.js";
import { nativeLoadImageSchema } from "../dist/domain/native/nativeLoadImage.js";

const mode = process.argv[2] ?? "symbols";
if (
  ![
    "symbols",
    "stripped",
    "ordinary",
    "unsupported",
    "malformed",
    "ambiguous",
    "loader-failure",
    "default-native",
  ].includes(mode) ||
  process.argv.length > 3
)
  throw new Error(
    "Usage: verify-real-ghidra-nativeaot.mjs [symbols|stripped|ordinary|unsupported|malformed|ambiguous|loader-failure|default-native]",
  );
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error(
    "verify:ghidra:nativeaot requires a Linux x64 host; Windows host mutation is not supported.",
  );
for (const key of ["loader-failure", "default-native"].includes(mode)
  ? ["GHIDRA_INSTALL_DIR"]
  : ["GHIDRA_INSTALL_DIR", "REA_GHIDRA_NATIVEAOT_JAR"])
  if (!process.env[key] || !isAbsolute(process.env[key]))
    throw new Error(
      `verify:ghidra:nativeaot prerequisite missing: absolute ${key}`,
    );
const fixtureRoot = resolve(
  process.env.REA_NATIVEAOT_PROOF_FIXTURE_ROOT ??
    "_reference/nativeaot-integration/generated/linux-x64",
);
const oracle = JSON.parse(
  await readFile(join(fixtureRoot, "oracle.json"), "utf8"),
);
const symbolTarget = join(
  fixtureRoot,
  "symbols",
  oracle.runtime === "win-x64" ? "NativeAotFixture.exe" : "NativeAotFixture",
);
const target =
  mode === "stripped"
    ? join(fixtureRoot, "stripped", basename(symbolTarget))
    : [
          "ordinary",
          "unsupported",
          "malformed",
          "ambiguous",
          "loader-failure",
          "default-native",
        ].includes(mode)
      ? join(
          fixtureRoot,
          ["loader-failure", "default-native"].includes(mode)
            ? "ordinary"
            : mode,
        )
      : symbolTarget;
const bytes = await readFile(target);
const sha256 = hash(bytes);
const workspace = await mkdtemp(join(tmpdir(), "rea-nativeaot-proof-"));
const runtime = join(workspace, "runtime");
await mkdir(runtime);
const packageRoot = process.env.REA_NATIVEAOT_PROOF_PACKAGE_ROOT;
if (packageRoot !== undefined && !isAbsolute(packageRoot))
  throw new Error("REA_NATIVEAOT_PROOF_PACKAGE_ROOT must be absolute");
const entrypoint =
  packageRoot === undefined
    ? fileURLToPath(new URL("./rea.mjs", import.meta.url))
    : join(packageRoot, "scripts/rea.mjs");
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: runtime,
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "ghidra",
  GHIDRA_INSTALL_DIR: process.env.GHIDRA_INSTALL_DIR,
  REA_GHIDRA_NATIVEAOT_JAR: process.env.REA_GHIDRA_NATIVEAOT_JAR,
  GHIDRA_HEADLESS_MAXMEM: process.env.GHIDRA_HEADLESS_MAXMEM ?? "768M",
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { JAVA_HOME: process.env.JAVA_HOME }),
};
if (mode === "default-native") delete env.REA_GHIDRA_NATIVEAOT_JAR;
// Source-built linkage failure exercises the actual JVM loader boundary, not
// a simulated producer report. Its class/JAR exist only in the owned workspace.
if (mode === "loader-failure")
  env.REA_GHIDRA_NATIVEAOT_JAR = join(workspace, "bad-extension.jar");
async function prepareLoaderFailure() {
  const source = join(workspace, "NativeAotExtension.java");
  const classes = join(workspace, "classes");
  await mkdir(classes);
  await writeFile(
    source,
    `package rea.extensions.nativeaot;
public final class NativeAotExtension {
  static { fail(); }
  private static void fail() { throw new IllegalStateException("REA_INITIALIZER_FIXTURE"); }
  public NativeAotExtension() {}
}
`,
  );
  const command = (name) =>
    process.env.JAVA_HOME === undefined
      ? name
      : join(process.env.JAVA_HOME, "bin", name);
  await promisify(execFile)(
    command("javac"),
    ["-J-Xmx512m", "-J-XX:ActiveProcessorCount=1", "-d", classes, source],
    { timeout: 60000 },
  );
  await promisify(execFile)(
    command("jar"),
    ["--create", "--file", env.REA_GHIDRA_NATIVEAOT_JAR, "-C", classes, "."],
    { timeout: 60000 },
  );
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "rea-nativeaot-proof", version: "1" });
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-65536);
});
let opened = false;
let report;
try {
  if (mode === "loader-failure") await prepareLoaderFailure();
  await client.connect(transport);
  const response = await client.callTool(
    { name: "open_binary", arguments: { path: target, provider_id: "ghidra" } },
    { timeout: 360000 },
  );
  if (
    ["unsupported", "malformed", "ambiguous", "loader-failure"].includes(mode)
  ) {
    // MCP open binds a lazy session; the first inspection starts import.
    let failure = response;
    if (failure.isError !== true) {
      opened = true;
      failure = await client.callTool(
        { name: "inspect_native_load_image", arguments: {} },
        { timeout: 360000 },
      );
    }
    assert.equal(failure.isError, true, JSON.stringify(failure));
    const diagnostic = JSON.stringify(failure);
    assert.match(
      diagnostic,
      mode === "unsupported"
        ? /Unsupported NativeAOT RTR format/
        : mode === "malformed"
          ? /Reversed NativeAOT section/
          : mode === "loader-failure"
            ? /ExceptionInInitializerError.*REA_INITIALIZER_FIXTURE/
            : /Ambiguous NativeAOT directory candidates/,
    );
    report = { mode, target, sha256, typed_failure: failure };
  } else if (mode === "default-native") {
    assert.notEqual(response.isError, true, JSON.stringify(response));
    opened = true;
    const image = nativeLoadImageSchema.parse(
      await call("inspect_native_load_image"),
    );
    assert.equal(image.observations.metadata_recovery, undefined);
    report = { mode, target, sha256, image };
  } else {
    assert.notEqual(response.isError, true, JSON.stringify(response));
    opened = true;
    const image = nativeLoadImageSchema.parse(
      await call("inspect_native_load_image"),
    );
    const summary = image.observations.metadata_recovery?.[0];
    assert.ok(
      summary,
      "Loaded-image inspection omitted inline runtime-format discovery",
    );
    assert.equal(summary.format, "dotnet-nativeaot");
    assert.equal(
      summary.analysis_artifact_sha256,
      hash(await readFile(env.REA_GHIDRA_NATIVEAOT_JAR)),
    );
    if (mode === "ordinary") {
      assert.equal(summary.status, "not_applicable");
      assert.equal(summary.method_tables, 0);
      assert.deepEqual(summary.types, []);
      report = { mode, target, sha256, summary };
    } else {
      assert.ok(["complete", "partial"].includes(summary.status));
      assert.equal(summary.format_major, 9);
      assert.equal(summary.format_minor, 1);
      assert.equal(summary.types.length, summary.method_tables);
      assert.ok(summary.method_tables > 0);
      assert.equal(
        summary.discovery,
        mode === "stripped" || oracle.runtime === "win-x64"
          ? "signature-heuristic"
          : "symbol",
      );
      assert.equal(summary.derived_memory.file_offset, null);
      assert.ok(summary.coverage.frozen_objects_annotated > 0);
      // Independent compiler/linker symbols identify fixture classes. Recovered
      // Class_address names are never treated as the original source identities.
      const symbols = await readFile(join(fixtureRoot, "symbols.txt"), "utf8");
      const bias =
        oracle.runtime === "linux-x64"
          ? BigInt(image.observations.image_base)
          : 0n;
      const addressOf = (name) => {
        const line = symbols
          .split(/\r?\n/u)
          .find((line) => line.split(/\s+/u).includes(name));
        assert.ok(line, `Independent symbol missing: ${name}`);
        const match =
          oracle.runtime === "linux-x64"
            ? line.match(/^([a-f0-9]+)\s/iu)
            : line.match(/\s([a-f0-9]{16})\s/iu);
        assert.ok(match, `Unrecognized independent symbol line: ${line}`);
        return `0x${(BigInt(`0x${match[1]}`) + bias).toString(16)}`;
      };
      const fixtureSymbols =
        oracle.symbols ??
        (oracle.runtime === "win-x64"
          ? {
              base: "??_7NativeAotFixture_BaseProbe@@6B@",
              derived: "??_7NativeAotFixture_DerivedProbe@@6B@",
              interface: "??_7NativeAotFixture_IProbe@@6B@",
              compute: "NativeAotFixture_DerivedProbe__Compute",
              dispatch: "NativeAotFixture_Program__Dispatch",
            }
          : {
              base: "_ZTV26NativeAotFixture_BaseProbe",
              derived: "_ZTV29NativeAotFixture_DerivedProbe",
              interface: "_ZTV23NativeAotFixture_IProbe",
              compute: "NativeAotFixture_DerivedProbe__Compute",
              dispatch: "NativeAotFixture_Program__Dispatch",
            });
      const lookup = (address) => {
        const identity = summary.types.find((type) => type.address === address);
        assert.ok(identity?.type, `Recovered identity missing at ${address}`);
        return identity.type;
      };
      const derivedAddress = addressOf(fixtureSymbols.derived);
      const baseAddress = addressOf(fixtureSymbols.base);
      const interfaceAddress = addressOf(fixtureSymbols.interface);
      const derived = nativeDataTypeSchema.parse(
        await call("inspect_native_data_type", {
          type: lookup(derivedAddress),
        }),
      );
      const metadata = derived.metadata_recovery;
      assert.ok(metadata);
      assert.equal(metadata.original_name, null);
      assert.equal(metadata.name_origin, "generated");
      assert.equal(metadata.method_table_address, derivedAddress);
      assert.equal(metadata.related_type.address, baseAddress);
      assert.ok(
        metadata.interfaces.some((type) => type.address === interfaceAddress),
      );
      assert.ok(
        metadata.virtual_slots.some(
          (slot) => slot.target_address === addressOf(fixtureSymbols.compute),
        ),
      );
      const compute = await call("analyze_function", {
        procedure: addressOf(fixtureSymbols.compute),
        detail: "complete",
      });
      assert.ok(compute.pseudocode.trim());
      assert.doesNotMatch(
        compute.pseudocode,
        /\b__thiscall\b/u,
        "Upstream x64 calling-convention rewrite leaked into recovered pseudocode",
      );
      assert.match(compute.pseudocode, /(?:0xb|\b11\b|<<)/u);
      const dispatch = await call("analyze_function", {
        procedure: addressOf(fixtureSymbols.dispatch),
        detail: "complete",
      });
      assert.ok(dispatch.pseudocode.trim());
      for (const literal of oracle.expected_strings)
        assert.ok(
          (await call("search_strings", { pattern: literal })).length > 0,
          `Frozen string missing: ${literal}`,
        );
      const observed = await call("read_bytes", {
        address: metadata.virtual_slots[0].slot_address,
        length: 8,
      });
      assert.equal(observed.complete, true);
      assert.equal(
        `0x${Buffer.from(observed.bytes_hex, "hex").readBigUInt64LE().toString(16)}`,
        metadata.virtual_slots[0].target_address,
      );
      report = { mode, target, sha256, summary, derived, compute, dispatch };
      await call("close_binary");
      opened = false;
      // One representative CLI boundary, selected explicitly to avoid repeated
      // full NativeAOT auto-analysis during each focused iteration.
      if (process.env.REA_NATIVEAOT_PROOF_CLI === "1") {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            entrypoint,
            "inspect-native-data-type",
            target,
            "--type",
            lookup(derivedAddress),
            "--provider",
            "ghidra",
            "--json",
          ],
          { env, timeout: 360000, maxBuffer: 16 * 1024 * 1024 },
        );
        const evidence = parseEvidence(JSON.parse(stdout));
        assert.equal(evidence.subject.digest.sha256, sha256);
        assert.deepEqual(
          evidence.normalized_result.metadata_recovery,
          metadata,
        );
        report.cli_metadata = evidence.normalized_result.metadata_recovery;
      }
    }
  }
  assert.equal(
    hash(await readFile(target)),
    sha256,
    "Input executable changed",
  );
  if (opened) {
    await call("close_binary");
    opened = false;
  }
  await client.close();
  assert.deepEqual(
    await readdir(runtime),
    [],
    "Owned runtime/project/extension files leaked after close",
  );
  const capture = process.env.REA_NATIVEAOT_PROOF_CAPTURE_DIR;
  if (capture !== undefined) {
    assert.ok(isAbsolute(capture));
    await mkdir(capture, { recursive: true });
    await writeFile(
      join(capture, `${oracle.runtime}-${mode}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  console.log(
    `PASS real Ghidra NativeAOT ${oracle.runtime}/${mode}: MCP metadata, source identity and owned cleanup${report?.compute ? ", independent type/slot oracle and pseudocode" : ""}${report?.cli_metadata ? ", equivalent CLI" : ""}`,
  );
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  if (opened)
    await client
      .callTool({ name: "close_binary", arguments: {} })
      .catch(() => {});
  await client.close().catch(() => {});
  await rm(workspace, { recursive: true, force: true });
}
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function call(name, args = {}) {
  const response = await client.callTool(
    { name, arguments: args },
    { timeout: 360000 },
  );
  if (name === "close_binary") return requireMcpLifecycleResult(response, name);
  const evidence = parseEvidence(requireMcpOutput(response, name));
  assert.equal(evidence.subject.digest.sha256, sha256);
  return evidence.normalized_result;
}
