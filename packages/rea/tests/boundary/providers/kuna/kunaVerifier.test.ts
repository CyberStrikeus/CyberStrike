import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it as test } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { fakeKunaCalls, writeFakeKuna } from "./fakeKuna.js";

const it = test.skipIf(process.platform === "win32");

it("accepts empty caller inventories but requires source-owned fixture literals", async () => {
  const root = await createTestTempDirectory("rea-kuna-verifier-empty-");
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict";
import { verifyKunaStrings } from ${JSON.stringify(pathToFileURL(resolve("scripts/lib/kuna-string-verifier.mjs")).href)};
const calls = [];
const options = {
  cacheRoot: ${JSON.stringify(root)}, nativeStrings: async () => [],
  call: async (name, input) => {
    calls.push({ name, input });
    return { value: [], ms: 0, bytes: 0, structured: {
      provider: { id: "kuna" }, evidence_id: "ev_empty",
      raw_result: { strings: { inventory_count: 0, selected_count: 0, xrefs: false, sha256: "a".repeat(64), bytes: 1 } },
    } };
  },
};
const checked = await verifyKunaStrings(options);
assert.equal(checked.inventory_count, 0);
assert.equal(checked.exact_address_ms, null);
assert.ok(calls.some(call => call.name === "list_strings"));
assert.ok(calls.some(call => call.name === "search_strings"));
assert.ok(calls.every(call => call.input?.address === undefined));
await assert.rejects(() => verifyKunaStrings({ ...options, expectedStrings: ["required fixture literal"] }), /Source-owned string fixture/);
`,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

it.each([
  { populated: false, names: "main", reason: "No caller-built targets" },
  { populated: true, names: "typo", reason: "No caller-built targets" },
  {
    populated: true,
    names: "main,typo",
    reason: "Requested functions were not found",
  },
])(
  "rejects an unverified caller matrix: $names, populated=$populated",
  async ({ populated, names, reason }) => {
    const root = await createTestTempDirectory("rea-kuna-verifier-selection-");
    const kuna = await writeFakeKuna(root);
    const targets = join(root, "targets");
    await mkdir(targets);
    if (populated) {
      const flavor = join(targets, "linux");
      await mkdir(flavor);
      await writeFile(join(flavor, "program"), "not analyzed");
      await writeFile(join(flavor, "program.stripped"), "not analyzed");
    }
    // Only symbol discovery is simulated; no provider workflow should start.
    const nm = join(root, "nm");
    await writeFile(
      nm,
      `#!${process.execPath}\nprocess.stdout.write("00001000 T main\\n");\n`,
      {
        mode: 0o755,
      },
    );
    const result = spawnSync(
      process.execPath,
      [
        "scripts/verify-real-kuna.mjs",
        "--targets",
        targets,
        "--functions",
        names,
        "--compare-ghidra",
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          REA_KUNA_COMMAND: kuna,
          REA_NM: nm,
          REA_CC: join(root, "compiler-must-not-run"),
          GHIDRA_INSTALL_DIR: join(root, "ghidra-must-not-run"),
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(reason);
    expect(result.stderr).not.toContain("compiler-must-not-run");
    expect((await fakeKunaCalls(kuna)).map(({ argv }) => argv)).toEqual([
      ["--version"],
    ]);
  },
);

it.each([
  {
    rejectClose: false,
    rejectRead: true,
    wrongXrefs: false,
    wrongStrings: false,
  },
  {
    rejectClose: true,
    rejectRead: false,
    wrongXrefs: false,
    wrongStrings: false,
  },
  {
    rejectClose: true,
    rejectRead: true,
    wrongXrefs: false,
    wrongStrings: false,
  },
  {
    rejectClose: false,
    rejectRead: false,
    wrongXrefs: true,
    wrongStrings: false,
  },
  {
    rejectClose: false,
    rejectRead: false,
    wrongXrefs: false,
    wrongStrings: true,
  },
])(
  "reports failure-path lineage (cleanup: $rejectClose, read: $rejectRead, wrong xrefs: $wrongXrefs, wrong strings: $wrongStrings)",
  async ({ rejectClose, rejectRead, wrongXrefs, wrongStrings }) => {
    const root = await createTestTempDirectory("rea-kuna-verifier-cleanup-");
    const kuna = await writeFakeKuna(root, {
      stringRows: [
        { address: 12288, text: "REA fixture prompt" },
        {
          address: 12320,
          text: "＿φ( °-°)/ REA unicode marker",
          encoding: "utf8",
        },
        { address: 12400, text: "REA wide marker", encoding: "utf16" },
      ],
      functions: [
        { name: "main", addr: "0x1000" },
        { name: "rea_checksum", addr: "0x1040" },
        { name: "rea_classify", addr: "0x1080" },
      ],
    });
    const nm = join(root, "nm");
    // The host compiler creates a real fixture, but provider output and symbol
    // discovery are simulated to isolate the verifier's cleanup contract.
    await writeFile(
      nm,
      `#!${process.execPath}\nprocess.stdout.write("00001000 T main\\n00001040 T rea_checksum\\n00001080 T rea_classify\\n");\n`,
      { mode: 0o755 },
    );
    const proxy = join(root, "proxy.mjs");
    const cacheRecord = join(root, "cache-path");
    await writeFile(
      proxy,
      `
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
const backend = spawn(process.execPath, [${JSON.stringify(resolve("scripts/rea.mjs"))}, "--mcp"], { stdio: ["pipe", "pipe", "ignore"] });
const exited = new Promise((resolve, reject) => { backend.once("error", reject); backend.once("exit", resolve); });
const methods = new Map();
const output = createInterface({ input: backend.stdout });
output.on("line", (line) => {
  const message = JSON.parse(line);
  if ((${wrongXrefs} && methods.get(message.id) === "xrefs" || ${wrongStrings} && methods.get(message.id) === "search_strings") && message.result?.structuredContent) {
    const corrupted = ${wrongStrings}
      ? message.result.structuredContent.normalized_result.map(row => ({ ...row, value: row.value + " [wrong string]" }))
      : ["0xdeadbeef"];
    message.result.structuredContent.normalized_result = corrupted;
    for (const block of message.result.content) if (block.type === "text") {
      const projection = JSON.parse(block.text);
      projection.normalized_result = corrupted;
      block.text = JSON.stringify(projection);
    }
  }
  process.stdout.write(JSON.stringify(message) + "\\n");
});
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const message = JSON.parse(line);
  const name = message.params?.name;
  if (name !== undefined) methods.set(message.id, name);
  if (name === "close_binary" && ${rejectClose}) {
    const marker = join(process.env.REA_KUNA_CACHE_DIR, "staging", "retained-marker");
    await mkdir(marker, { recursive: true });
    await writeFile(join(marker, "evidence"), "retained cleanup owner");
    await writeFile(${JSON.stringify(cacheRecord)}, process.env.REA_KUNA_CACHE_DIR);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "injected cleanup rejection" }] } }) + "\\n");
  } else if (name === "list_procedures" && ${rejectRead}) {
    // A verification failure with successful provider cleanup must still
    // produce lineage evidence; it need not retain an otherwise clean root.
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "injected verification failure" }] } }) + "\\n");
  } else backend.stdin.write(line + "\\n");
}
backend.stdin.end();
await exited;
`,
    );
    const reportPath = join(root, "report.json");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/verify-real-kuna.mjs",
        "--entrypoint",
        proxy,
        "--report",
        reportPath,
      ],
      {
        encoding: "utf8",
        timeout: 25_000,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          REA_KUNA_COMMAND: kuna,
          REA_NM: nm,
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report).toMatchObject({
      status: "failed",
      cleanup: rejectClose ? "incomplete" : "complete",
      verifier_run: {
        process_lineage: { status: "verified", descendants: [] },
      },
    });
    expect(JSON.stringify(report.failures)).toContain(
      rejectClose
        ? "injected cleanup rejection"
        : wrongXrefs
          ? "incoming references differ from exact-target native sites"
          : wrongStrings
            ? "String search differs from native scan"
            : "injected verification failure",
    );
    if (rejectRead)
      expect(JSON.stringify(report.failures)).toContain(
        "injected verification failure",
      );
    if (rejectClose && !rejectRead)
      expect(report.failures[0].causes).toHaveLength(1);
    if (rejectClose) {
      const cache = await readFile(cacheRecord, "utf8");
      expect(cache).toBe(join(report.retained_workspace, "cache"));
      try {
        expect(
          await readFile(
            join(cache, "staging", "retained-marker", "evidence"),
            "utf8",
          ),
        ).toBe("retained cleanup owner");
      } finally {
        // The test owns this injected file; production intentionally retains it.
        await rm(report.retained_workspace, { recursive: true, force: true });
      }
    } else expect(report.retained_workspace).toBeUndefined();
  },
);
