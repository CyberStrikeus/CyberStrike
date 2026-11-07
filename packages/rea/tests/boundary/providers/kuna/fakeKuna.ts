import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One function the fake exports; `error` renders Kuna's failed-function header. */
export interface FakeKunaFunction {
  readonly name: string;
  readonly addr: string;
  readonly error?: string;
}

export interface FakeKunaString {
  readonly address: number;
  readonly text: string;
  readonly encoding?: "ascii" | "utf8" | "utf16";
  readonly terminated?: boolean;
}

/** Scripted behavior of the fake `kuna` executable for one test. */
export interface FakeKunaBehavior {
  /** Text printed by `--version`; `exit` fails the probe instead. */
  readonly version?:
    | { readonly stdout: string; readonly gate?: string }
    | { readonly exit: number }
    | { readonly ignoreTerm: true };
  readonly inventory?: "ok" | "not-json" | "hang";
  readonly inventoryImports?: boolean;
  readonly project?:
    | "ok"
    | "exit-failure"
    | "hang"
    | "miscounted"
    | "silent"
    | "block-manifest"
    /** Writes more than REA's 8 MiB export output buffer before its summary. */
    | "noisy";
  readonly functions?: readonly FakeKunaFunction[];
  /** Extra `.asm` bytes, for capacity tests. */
  readonly asmPadding?: number;
  /** Extra C comment bytes inside each exported body, for buffered-read capacity. */
  readonly cPadding?: number;
  readonly decompile?: "ok" | "hang";
  /** Milliseconds one `decompile --addr` run takes before printing. */
  readonly decompileDelayMs?: number;
  /** Extra comment bytes in each `decompile --addr` text, for retention budgets. */
  readonly decompilePadding?: number;
  /** Milliseconds `functions --json` takes before printing. */
  readonly inventoryDelayMs?: number;
  /** Milliseconds the export takes before writing its files. */
  readonly delayMs?: number;
  /** `noisy` writes more diagnostics than REA buffers (8 MiB) before the graph. */
  readonly graph?:
    | "ok"
    | "hang"
    | "not-json"
    | "miscounted"
    | "with-bodies"
    | "noisy";
  readonly graphIndirectCalls?: boolean;
  /** Bytes of an extra root member in the graph JSON. */
  readonly graphPadding?: number;
  readonly xrefs?: "ok" | "hang" | "not-json";
  readonly referenceDelayMs?: number;
  readonly referencePadding?: number;
  /** `invalid-then-hang` writes a contradictory first row, then never finishes. */
  readonly strings?:
    | "ok"
    | "hang"
    | "not-json"
    | "miscounted"
    | "exit-failure"
    | "invalid-then-hang";
  readonly stringRows?: readonly FakeKunaString[];
  readonly stringDelayMs?: number;
  /** Bytes of an extra root member in the string JSON. */
  readonly stringPadding?: number;
  /** Bytes written to stderr before the string JSON. */
  readonly stringStderrBytes?: number;
}

/**
 * The fake reads its behavior from `<script>.json` and appends one line per
 * invocation to `<script>.calls`. REA gives Kuna children no PATH, so the
 * shebang names this Node binary directly. Output formats follow Kuna 1.833:
 * `functions --json` and the `// Function:` headers of `render_c`.
 */
const SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const behavior = JSON.parse(fs.readFileSync(__filename + ".json", "utf8"));
fs.appendFileSync(__filename + ".calls", JSON.stringify({ pid: process.pid, at: Date.now(), argv: process.argv.slice(2), home: process.env.HOME, xdg: process.env.XDG_CACHE_HOME, path: process.env.PATH ?? null }) + "\n");
const args = process.argv.slice(2);
const functions = behavior.functions ?? [{ name: "main", addr: "0x1000" }, { name: "helper", addr: "0x1040" }];
const hang = () => setInterval(() => {}, 1000);
if (args[0] === "--version") {
  const version = behavior.version ?? { stdout: "kuna 1.833\n" };
  if ("exit" in version) { process.stderr.write("version probe failed\n"); process.exit(version.exit); }
  if ("ignoreTerm" in version) { process.on("SIGTERM", () => {}); hang(); }
  else if (version.gate) {
    const waiting = setInterval(() => {
      if (!fs.existsSync(version.gate)) return;
      clearInterval(waiting);
      process.stdout.write(version.stdout);
    }, 10);
  } else process.stdout.write(version.stdout);
} else if (args[0] === "functions") {
  const mode = behavior.inventory ?? "ok";
  if (mode === "hang") hang();
  else if (mode === "not-json") process.stdout.write("functions: 2\n");
  else {
    const listed = [...functions, ...(behavior.inventoryImports === false ? [] : [{ name: "puts", addr: "0x2000" }])].map((fn) => ({ name: fn.name, address: parseInt(fn.addr, 16), address_hex: fn.addr, aliases: [], object_location: null, size: fn.name === "puts" ? 0 : 16 }));
    setTimeout(() => process.stdout.write(JSON.stringify({ binary: args[1], count: listed.length, total: listed.length, error: null, functions: listed }, null, 2) + "\n"), behavior.inventoryDelayMs ?? 0);
  }
} else if (args[0] === "strings") {
  if (behavior.strings === "exit-failure") { process.stderr.write("fixture string scan failed\n"); process.exit(7); }
  else if (behavior.strings === "hang") hang();
  else if (behavior.strings === "not-json") process.stdout.write("not string JSON");
  else if (behavior.strings === "invalid-then-hang") { process.stdout.write('{"binary":' + JSON.stringify(args[1]) + ',"strings":[{"address":12288,"address_hex":"0x3001"}'); hang(); }
  else {
    if (behavior.stringStderrBytes) process.stderr.write(Buffer.alloc(behavior.stringStderrBytes, 0x78));
    if (!args.includes("--no-xrefs") || args[args.indexOf("--encoding") + 1] !== "all") throw new Error("strings must skip reference analysis and include all supported encodings");
    const rows = (behavior.stringRows ?? [{ address: 12288, text: "REA fixture prompt" }, { address: 12320, text: "Δelta", encoding: "utf8", terminated: false }]).map((item) => ({ address: item.address, address_hex: "0x" + item.address.toString(16), text: item.text, length: [...item.text].length, byte_length: Buffer.byteLength(item.text, item.encoding === "utf16" ? "utf16le" : "utf8") + (item.terminated === false ? 0 : item.encoding === "utf16" ? 2 : 1), nul_terminated: item.terminated !== false, encoding: item.encoding ?? "ascii", section: ".rodata", xrefs_count: 0, functions: [] }));
    const document = { binary: args[1], encoding: "all", min_length: 5, filter: null, section: null, termination: "any", scanned: "sections", xrefs: false, count: rows.length + (behavior.strings === "miscounted" ? 1 : 0), strings: rows, padding: "x".repeat(behavior.stringPadding ?? 0) };
    setTimeout(() => process.stdout.write(JSON.stringify(document)), behavior.stringDelayMs ?? 0);
  }
} else if (args[0] === "decompile-graph") {
  if (behavior.graph === "hang") hang();
  else if (behavior.graph === "not-json") process.stdout.write("not graph JSON");
  else {
    if (behavior.graph === "noisy") process.stderr.write(Buffer.alloc(9 * 1024 * 1024, 0x78));
    if (args[args.indexOf("--functions") + 1] !== "") throw new Error("graph must request no bodies");
    const nodes = [...functions, { name: "puts", addr: "0x2000" }].map((fn) => ({ address: parseInt(fn.addr, 16), name: fn.name, kind: "normal", hasIndirectCalls: behavior.graphIndirectCalls !== false && fn === functions[0], forwardsTo: null, codeC: behavior.graph === "with-bodies" ? "unrequested code" : null, assembly: null, error: null }));
    const edges = [];
    if (functions[1]) edges.push({ callerAddress: nodes[0].address, calleeAddress: nodes[1].address, kind: "call", calleeOrder: 0 });
    if (functions[2]) edges.push({ callerAddress: nodes[0].address, calleeAddress: nodes[2].address, kind: functions[2].error ? "jump" : "call", calleeOrder: 1 });
    if (functions[1]?.name === "parse") edges.push({ callerAddress: nodes[1].address, calleeAddress: 8192, kind: "call", calleeOrder: 0 });
    setTimeout(() => process.stdout.write(JSON.stringify({ schemaVersion: 4, binary: { sourcePath: args[1], functionCount: nodes.length + (behavior.graph === "miscounted" ? 1 : 0), edgeCount: edges.length }, functions: nodes, edges, padding: "x".repeat(behavior.graphPadding ?? 0) })), behavior.referenceDelayMs ?? 0);
  }
} else if (args[0] === "xrefs") {
  if (behavior.xrefs === "hang") hang();
  else if (behavior.xrefs === "not-json") process.stdout.write("not xref JSON");
  else {
    const target = args[args.indexOf("--to") + 1];
    const identity = (name, value) => ({ name, address: value, address_hex: "0x" + value.toString(16) });
    const aliases = target === "0x2000" ? [identity("puts.slot", 12288)] : [];
    const row = (from, to, kind) => ({ address: from, address_hex: "0x" + from.toString(16), from_address: from, from_address_hex: "0x" + from.toString(16), to_address: to, to_address_hex: "0x" + to.toString(16), kind, from_function: identity("main", 4096), to_function: null, instruction: "fixture reference" + "x".repeat(behavior.referencePadding ?? 0) });
    const rows = [row(4100, parseInt(target, 16), "call")];
    if (aliases.length) rows.push(row(4164, 12288, "call"));
    setTimeout(() => process.stdout.write(JSON.stringify({ binary: args[1], direction: "to", count: rows.length, target: { ...identity(null, parseInt(target, 16)), aliases }, xrefs: rows })), behavior.referenceDelayMs ?? 0);
  }
} else if (args[0] === "decompile-project") {
  const input = args[1];
  const output = args[args.indexOf("-o") + 1];
  const stem = path.basename(input);
  const mode = behavior.project ?? "ok";
  if (mode === "hang") hang();
  else if (mode === "exit-failure") { process.stderr.write("error: not in recognized object file format\n"); process.exit(1); }
  else setTimeout(() => {
    fs.mkdirSync(output, { recursive: true });
    let c = '#include "' + stem + '.h"\n\n';
    functions.forEach((fn, index) => {
      c += fn.error === undefined
        ? "// Function: " + fn.name + " @ " + fn.addr + "\nint " + fn.name + "(void)\n{\n  return " + index + ";\n" + (behavior.cPadding ? "  /*" + "x".repeat(behavior.cPadding) + "*/\n" : "") + "}\n\n"
        : "// Function: " + fn.name + " @ " + fn.addr + "  (error: " + fn.error + ")\n\n";
    });
    fs.writeFileSync(path.join(output, stem + ".c"), c);
    fs.writeFileSync(path.join(output, stem + ".h"), "#pragma once\n");
    let asm = "; kuna decompile-project — " + stem + "\n\n; --- code section 0x1000..0x2000 ---\n\n";
    functions.forEach((fn) => { asm += fn.name + ":  ; " + fn.addr + "\n  " + fn.addr.slice(2).padStart(8, "0") + ": c3     RET\n\n"; });
    asm += "; --- data ---\n\ndat_3000:  ; 0x3000 = dat_3000\n  00003000: 00\n\ng_table:  ; 0x3010\n  00003010: 01\n" + "x".repeat(behavior.asmPadding ?? 0);
    fs.writeFileSync(path.join(output, stem + ".asm"), asm);
    fs.writeFileSync(path.join(output, "README.md"), "# " + stem + "\n");
    // Occupy the manifest path so REA's publication write fails.
    if (mode === "block-manifest") fs.mkdirSync(path.join(output, "..", "manifest.json"));
    const failed = functions.filter((fn) => fn.error !== undefined).length;
    const reported = mode === "miscounted" ? functions.length + 1 : functions.length - failed;
    if (mode === "noisy") process.stdout.write(Buffer.alloc(9 * 1024 * 1024, 0x20));
    if (mode !== "silent") process.stdout.write("wrote " + output + ": " + stem + ".c (" + c.length + " bytes); functions: " + reported + " ok, " + failed + " failed\n");
  }, behavior.delayMs ?? 0);
} else if (args[0] === "decompile") {
  // decompile <input> <0xaddr> --addr: the single-function path.
  const fn = functions.find((candidate) => candidate.addr === args[2]);
  if (behavior.decompile === "hang") hang();
  else if (fn === undefined) { process.stderr.write("error: no function at " + args[2] + "\n"); process.exit(1); }
  else setTimeout(() => {
    const padding = behavior.decompilePadding === undefined ? "" : "/*" + "x".repeat(behavior.decompilePadding) + "*/\n";
    process.stdout.write("int " + fn.name + "(void) // single-function\n" + padding + "{\n  return 0;\n}\n");
    fs.appendFileSync(__filename + ".exits", JSON.stringify({ pid: process.pid, at: Date.now() }) + "\n");
  }, behavior.decompileDelayMs ?? 0);
} else {
  process.stderr.write("unexpected command\n");
  process.exit(2);
}
`;

/** Write a fake `kuna` into a directory and return its path. */
export const writeFakeKuna = async (
  directory: string,
  behavior: FakeKunaBehavior = {},
): Promise<string> => {
  const path = join(directory, "kuna");
  await writeFile(path, `#!${process.execPath}\n${SCRIPT}`, { mode: 0o755 });
  await writeFile(`${path}.json`, JSON.stringify(behavior));
  return path;
};

/** Replace the scripted behavior of an existing fake. */
export const setFakeKunaBehavior = (
  path: string,
  behavior: FakeKunaBehavior,
): Promise<void> => writeFile(`${path}.json`, JSON.stringify(behavior));

/** Invocations the fake recorded, oldest first. */
export const fakeKunaCalls = async (
  path: string,
): Promise<
  readonly {
    readonly pid: number;
    /** Epoch milliseconds when the invocation started. */
    readonly at: number;
    readonly argv: readonly string[];
    readonly home: string;
    readonly xdg: string;
    readonly path: string | null;
  }[]
> => {
  const text = await readFile(`${path}.calls`, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as never);
};

/** When each completed single-function run finished, by process id. */
export const fakeKunaExits = async (
  path: string,
): Promise<ReadonlyMap<number, number>> => {
  const text = await readFile(`${path}.exits`, "utf8").catch(() => "");
  return new Map(
    text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const { pid, at } = JSON.parse(line) as { pid: number; at: number };
        return [pid, at];
      }),
  );
};
