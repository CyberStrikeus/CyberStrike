import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { toolContract } from "../dist/contracts/toolContracts.js";
import { ArtifactResourceScope } from "../dist/artifacts/ArtifactResourceScope.js";
import { requireMcpOutput } from "./lib/mcp-verifier-results.mjs";
import {
  closeVerifierResources,
  withVerifierCleanup,
} from "./lib/verifier-cleanup.mjs";
import { hashVerifierFile } from "./lib/verifier-file-resources.mjs";

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(
    "Usage: npm run verify:flutter -- --apk PATH [--plain-apk PATH] [--expectations JSON]\n" +
      "Checks real APK parsing through compiled CLI and stdio MCP. Optional\n" +
      "expectations bind exact engine labels, URI counts and snapshot hash to an APK digest.\n",
  );
  process.exit(0);
}
if (options.apk === null) {
  process.stderr.write("No Flutter APK was provided; pass --apk PATH.\n");
  process.exit(2);
}
const expectations =
  options.expectations === null
    ? null
    : JSON.parse(await readFile(options.expectations, "utf8"));
// This is a shared test parent, not a leased provider-owned Windows runtime.
const root = await mkdtemp(join(tmpdir(), "rea-flutter-verifier-"));
const resources = new ArtifactResourceScope();
const entrypoint = resolve("scripts/rea.mjs");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
Object.assign(environment, {
  TMPDIR: root,
  TMP: root,
  TEMP: root,
});
const client = new Client({ name: "flutter-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
const execute = promisify(execFile);
await withVerifierCleanup(
  async () => {
    await client.connect(transport);
    const apk = resolve(options.apk);
    const identity = await hashVerifierFile(apk, resources);
    const identified = await run("identify_flutter_build", { path: apk });
    assert.deepEqual(identified.target, { path: apk, ...identity });
    assert.equal(identified.flutter_detected, true);
    assert.equal(identified.coverage, "complete");
    const abis = identified.abis.filter((abi) => abi.libapp.present);
    assert.ok(abis.length > 0);
    const hashes = new Set();
    for (const abi of abis) {
      assert.equal(abi.libapp.elf_header_valid, true);
      assert.equal(abi.libapp.snapshot_hash_sources, 2);
      assert.ok(abi.libapp.snapshot_hash);
      hashes.add(abi.libapp.snapshot_hash);
      assert.equal(abi.libflutter.present, true);
      assert.match(abi.libflutter.build_id ?? "", /^(?:[0-9a-f]{2}){4,64}$/u);
      assert.deepEqual(abi.libflutter.build_id_candidates, [
        abi.libflutter.build_id,
      ]);
    }
    assert.equal(hashes.size, 1, "Every ABI must agree on the snapshot hash");
    if (expectations !== null) {
      assert.equal(identity.sha256, expectations.target_sha256);
      assert.deepEqual([...hashes], [expectations.snapshot_hash]);
      assert.deepEqual(
        abis.map((abi) => abi.abi).sort(),
        Object.keys(expectations.engines).sort(),
      );
      for (const abi of abis) {
        assert.deepEqual(
          {
            dart_version: abi.libflutter.dart_version,
            toolchain_lines: abi.libflutter.toolchain_lines,
          },
          expectations.engines[abi.abi],
        );
        assert.equal(abi.libflutter.dart_version_capped, false);
        assert.equal(abi.libflutter.toolchain_capped, false);
      }
      process.stdout.write(
        "[ok] Exact per-ABI engine labels match digest-bound expectations\n",
      );
    } else {
      process.stdout.write(
        "[unverified] Exact engine labels and their absence need --expectations JSON\n",
      );
    }
    // The same checks apply to the default selection and each remaining ABI.
    const preferred = await run("inspect_dart_aot", { path: apk });
    for (const abi of abis) {
      const aot =
        abi.abi === preferred.abi
          ? preferred
          : await run("inspect_dart_aot", { path: apk, abi: abi.abi });
      assert.equal(aot.abi, abi.abi);
      assert.equal(
        aot.libapp.coverage,
        "complete",
        `Snapshot decoding must be complete on ${abi.abi}`,
      );
      assert.equal(aot.coverage, aot.string_pool.coverage);
      if (aot.coverage !== "complete") {
        process.stdout.write(
          `[unverified] ${abi.abi}: full string-pool projection (returned pool is bounded and partial)\n`,
        );
      }
      assert.deepEqual(aot.target, identified.target);
      assert.equal(aot.libapp.sha256, abi.libapp.sha256);
      assert.equal(aot.libapp.bytes, abi.libapp.bytes);
      assert.equal(aot.libapp.snapshot_hash_sources, 2);
      assert.equal(aot.libapp.snapshot_hash, abi.libapp.snapshot_hash);
      assert.deepEqual(
        aot.libapp.sections.map((section) => section.name).sort(),
        [
          "_kDartVmSnapshotData",
          "_kDartVmSnapshotInstructions",
          "_kDartIsolateSnapshotData",
          "_kDartIsolateSnapshotInstructions",
        ].sort(),
      );
      for (const section of aot.libapp.sections) {
        assert.ok(section.offset + section.size <= aot.libapp.bytes);
        if (!section.name.endsWith("Data")) continue;
        assert.equal(section.magic_valid, true);
        assert.equal(
          section.kind,
          3,
          "This verifier requires an AOT app snapshot",
        );
        assert.ok(
          section.header_length >= 48 &&
            section.header_length + 4 <= section.size,
          `Snapshot extent must fit ${section.name} on ${abi.abi}`,
        );
      }
      assert.ok(aot.string_pool.package_uri_count_at_least > 0);
      assert.ok(aot.string_pool.dart_uri_count_at_least > 0);
      if (expectations?.string_pools !== undefined) {
        const expected = expectations.string_pools[abi.abi];
        assert.ok(
          expected,
          `Pinned string-pool counts are required on ${abi.abi}`,
        );
        assert.equal(
          aot.string_pool.package_uri_count_at_least,
          expected.package_uri_count_at_least,
        );
        assert.equal(
          aot.string_pool.dart_uri_count_at_least,
          expected.dart_uri_count_at_least,
        );
        process.stdout.write(
          `[ok] ${abi.abi}: exact pinned package and Dart URI counts\n`,
        );
      } else {
        process.stdout.write(
          `[unverified] ${abi.abi}: exact string-pool counts need --expectations JSON\n`,
        );
      }
      process.stdout.write(
        `[ok] ${abi.abi}: four symbols, bounded AOT headers, agreeing hashes and string pool\n`,
      );
    }
    if (options.plainApk !== null) {
      const plain = resolve(options.plainApk);
      const negative = await run("identify_flutter_build", { path: plain });
      assert.deepEqual(negative.target, {
        path: plain,
        ...(await hashVerifierFile(plain, resources)),
      });
      assert.equal(negative.flutter_detected, false);
      assert.equal(negative.coverage, "complete");
    }
    assert.deepEqual(
      await hashVerifierFile(apk, resources),
      identity,
      "Verification must preserve its input",
    );
  },
  // Server shutdown retries retained provider cleanup and settles before success.
  [
    async () => {
      await closeVerifierResources([
        () => client.close(),
        () => transport.close(),
        () => resources.close(),
      ]);
      assert.deepEqual(
        await readdir(root),
        [],
        `Provider snapshots remain under ${root}`,
      );
      await rm(root, { recursive: true, force: true });
    },
  ],
);
process.stdout.write(
  "all asserted Flutter CLI/MCP checks passed; unverified facets are reported above\n",
);

async function run(operation, input) {
  const contract = toolContract(operation);
  const args = [
    entrypoint,
    operation.replaceAll("_", "-"),
    input.path,
    "--json",
  ];
  if (input.abi !== undefined) args.push("--abi", input.abi);
  const { stdout } = await execute(process.execPath, args, {
    env: environment,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const cli = contract.outputSchema.parse(JSON.parse(stdout));
  const response = await client.callTool(
    { name: operation, arguments: input },
    { timeout: 60_000 },
  );
  const mcp = requireMcpOutput(response, operation, contract);
  assert.deepEqual(cli.normalized_result, mcp.normalized_result);
  assert.deepEqual(cli.subject, mcp.subject);
  assert.equal(cli.subject.local_path, input.path);
  assert.equal(cli.subject.digest.sha256, cli.normalized_result.target.sha256);
  assert.deepEqual(cli.limitations, mcp.limitations);
  process.stdout.write(
    `[ok] ${operation}${input.abi === undefined ? "" : ` ${input.abi}`}: CLI/MCP Evidence parity\n`,
  );
  return cli.normalized_result;
}

function parseArguments(argv) {
  const parsed = { help: false, apk: null, plainApk: null, expectations: null };
  const names = {
    "--apk": "apk",
    "--plain-apk": "plainApk",
    "--expectations": "expectations",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (
      Object.hasOwn(names, argument) &&
      typeof argv[index + 1] === "string" &&
      !argv[index + 1].startsWith("--")
    ) {
      parsed[names[argument]] = argv[++index];
    } else throw new Error(`Unknown argument or missing value: ${argument}`);
  }
  return parsed;
}
