import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../dist/domain/evidence.js";
import { requireMcpOutput } from "./lib/mcp-verifier-results.mjs";

const execute = promisify(execFile);
const bin = process.env.REA_WABT_BIN_DIRECTORY;
if (!isAbsolute(bin ?? ""))
  throw new Error("Supply absolute REA_WABT_BIN_DIRECTORY with WABT 1.0.42");
const root = await mkdtemp(join(tmpdir(), "rea-wasm-interface-real-"));
const cli = resolve("scripts/rea.mjs");
const environment = { ...process.env };
const command = async (file, args) =>
  (
    await execute(file, args, {
      env: environment,
      cwd: root,
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;
const client = new Client({
  name: "wasm-interface-real-verifier",
  version: "1",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, "mcp"],
  env: environment,
  stderr: "pipe",
});
const source = (parameter) =>
  `(module (type (func (param ${parameter}) (result i64))) (import "env" "f" (func (type 0))) (table 1 3 funcref) (memory 1 2) (global (mut i64) (i64.const 0)) (tag (param i32)) (export "run\\22\\ef\\bb\\bf" (func 0)) (export "table" (table 0)) (export "memory" (memory 0)) (export "global" (global 0)) (export "tag" (tag 0)))`;
const assemble = async (name, wat) => {
  await writeFile(join(root, `${name}.wat`), wat);
  const path = join(root, `${name}.wasm`);
  await command(join(bin, "wat2wasm"), [
    "--enable-all",
    `${name}.wat`,
    "-o",
    path,
  ]);
  return path;
};
const inspect = async (path) => {
  const result = await client.callTool({
    name: "inspect_wasm_artifact",
    arguments: { path },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.notEqual(result.structuredContent, undefined);
  return parseEvidence(requireMcpOutput(result, "inspect_wasm_artifact"));
};
const compare = async (left, right, scope = "both") => {
  const input = {
    left: { kind: "retained-evidence", evidence_id: left.evidence_id },
    right: { kind: "retained-evidence", evidence_id: right.evidence_id },
    scope,
  };
  const reply = await client.callTool({
    name: "compare_wasm_interfaces",
    arguments: input,
  });
  assert.notEqual(reply.isError, true, JSON.stringify(reply));
  assert.notEqual(reply.structuredContent, undefined);
  const mcp = parseEvidence(requireMcpOutput(reply, "compare_wasm_interfaces"));
  const file = join(root, "comparison.json");
  await writeFile(file, JSON.stringify({ left, right, scope }));
  const local = parseEvidence(
    JSON.parse(
      await command(process.execPath, [
        cli,
        "compare-wasm-interfaces",
        file,
        "--json",
      ]),
    ),
  );
  assert.deepEqual(local, mcp);
  return mcp.normalized_result;
};
try {
  assert.equal(
    (await command(join(bin, "wat2wasm"), ["--version"])).trim(),
    "1.0.42",
  );
  await client.connect(transport);
  const path = await assemble("baseline", source("i32"));
  const original = await readFile(path);
  assert.equal(original[8], 1);
  assert.ok(original[9] < 128);
  // Section lengths allow padded u32 LEB128 encodings. Different original
  // byte identities must compare equal after validated type resolution.
  const equivalentPath = join(root, "equivalent.wasm");
  await writeFile(
    equivalentPath,
    Buffer.concat([
      original.subarray(0, 9),
      Buffer.from([original[9] | 128, 0]),
      original.subarray(10),
    ]),
  );
  const left = await inspect(path);
  const equivalent = await inspect(equivalentPath);
  assert.notEqual(left.subject.digest.sha256, equivalent.subject.digest.sha256);
  const same = await compare(left, equivalent);
  assert.deepEqual(same.summary, {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 6,
    unknown: 0,
  });
  const facts = left.normalized_result.interface.entries;
  assert.deepEqual(facts.find((e) => e.name === "memory").signature, {
    kind: "memory",
    page_size: "65536",
    address_type: "i32",
    minimum: "1",
    maximum: "2",
    shared: false,
  });
  assert.deepEqual(facts.find((e) => e.name === "tag").signature, {
    kind: "tag",
    params: ["i32"],
    results: [],
  });
  assert.deepEqual(facts.find((e) => e.name === 'run"\ufeff').signature, {
    kind: "func",
    params: ["i32"],
    results: ["i64"],
  });
  const changed = await inspect(await assemble("changed", source("i64")));
  assert.deepEqual((await compare(left, changed)).summary, {
    added: 0,
    removed: 0,
    changed: 2,
    unchanged: 4,
    unknown: 0,
  });
  const smallPage = await inspect(
    await assemble(
      "small-page",
      '(module (memory 1 2 (pagesize 1)) (export "memory" (memory 0)))',
    ),
  );
  const defaultPage = await inspect(
    await assemble(
      "default-page",
      '(module (memory 1 2) (export "memory" (memory 0)))',
    ),
  );
  assert.equal((await compare(defaultPage, smallPage)).summary.changed, 1);
  const empty = await inspect(await assemble("empty", "(module)"));
  assert.equal((await compare(left, empty)).summary.removed, 6);
  assert.equal((await compare(empty, left, "exports")).summary.added, 5);
  const duplicate = await inspect(
    await assemble(
      "duplicate",
      '(module (import "e" "same" (func (param i32))) (import "e" "same" (func (param i64))))',
    ),
  );
  const duplicates = await compare(duplicate, duplicate, "imports");
  assert.equal(duplicates.summary.unknown, 1);
  assert.equal(duplicates.changes[0].left.length, 2);
  const unsupported = await inspect(
    await assemble(
      "exnref",
      '(module (import "e" "abstract-ref" (global exnref)))',
    ),
  );
  assert.equal((await compare(unsupported, unsupported)).summary.unknown, 1);
  console.log(
    JSON.stringify(
      {
        verified: true,
        toolchain: "WABT 1.0.42",
        transport: "compiled CLI + stdio MCP",
        interface_fact_bytes: Buffer.byteLength(
          JSON.stringify(left.normalized_result.interface),
        ),
        comparison_result_bytes: Buffer.byteLength(JSON.stringify(same)),
        original_sha256: left.subject.digest.sha256,
        equivalent_sha256: equivalent.subject.digest.sha256,
        cases: [
          "equivalent padded LEB128",
          "function signature change",
          "all admitted kinds",
          "custom memory page-size change",
          "escaped/BOM name",
          "empty interface additions/removals",
          "scope",
          "duplicate imports",
          "unsupported exception reference",
        ],
        runtime_execution: "not-performed",
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}
