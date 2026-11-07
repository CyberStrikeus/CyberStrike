import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { inspectSolidityMetadata } from "../dist/evm/SolidityMetadata.js";

const compilerModule = process.env.REA_VERIFY_SOLC_MODULE;
if (!isAbsolute(compilerModule ?? ""))
  throw new Error(
    "Select an absolute caller-installed solc 0.8.30 module with REA_VERIFY_SOLC_MODULE.",
  );
const solc = (await import(pathToFileURL(compilerModule).href)).default;
assert.equal(solc.version(), "0.8.30+commit.73712a01.Emscripten.clang");
const source = await readFile(
  new URL("./fixtures/evm-interface.sol", import.meta.url),
  "utf8",
);
const cases = [
  { name: "unoptimized", optimizer: false, viaIR: false, metadata: {} },
  { name: "viaIR", optimizer: true, viaIR: true, metadata: {} },
  {
    name: "without-content-hash",
    optimizer: false,
    viaIR: false,
    metadata: { bytecodeHash: "none" },
  },
  {
    name: "without-CBOR",
    optimizer: false,
    viaIR: false,
    metadata: { appendCBOR: false },
  },
];
const reports = [];
for (const fixture of cases) {
  const compiled = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "fixture.sol": { content: source } },
        settings: {
          optimizer: { enabled: fixture.optimizer },
          viaIR: fixture.viaIR,
          metadata: fixture.metadata,
          outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } },
        },
      }),
    ),
  );
  assert.ok(
    !(compiled.errors ?? []).some((error) => error.severity === "error"),
    JSON.stringify(compiled.errors),
  );
  const bytes = Buffer.from(
    compiled.contracts["fixture.sol"].InterfaceFixture.evm.deployedBytecode
      .object,
    "hex",
  );
  const cpu = process.cpuUsage();
  const started = performance.now();
  const parsed = inspectSolidityMetadata(bytes);
  const firstMs = performance.now() - started;
  const firstCpu = process.cpuUsage(cpu);
  if (fixture.metadata.appendCBOR === false)
    assert.equal(parsed.status, "unavailable");
  else {
    assert.equal(parsed.status, "decoded");
    assert.deepEqual(parsed.compiler_version, {
      representation: "release-bytes",
      value: "0.8.30",
    });
    assert.equal(parsed.bytecode_offset + parsed.cbor_bytes + 2, bytes.length);
    if (fixture.metadata.bytecodeHash === "none")
      assert.deepEqual(
        parsed.entries.map(({ key }) => key),
        [{ kind: "text", value: "solc" }],
      );
  }
  const warmResults = new Array(100);
  const warmStart = performance.now();
  for (let index = 0; index < warmResults.length; index++)
    warmResults[index] = inspectSolidityMetadata(bytes);
  const warmMs = performance.now() - warmStart;
  for (const result of warmResults) assert.deepEqual(result, parsed);
  reports.push({
    fixture: fixture.name,
    bytes: bytes.length,
    status: parsed.status,
    first_decode_ms: firstMs,
    first_decode_cpu_us: firstCpu,
    warm_100_decode_ms: warmMs,
  });
}
console.log(
  JSON.stringify({
    ok: true,
    compiler_version: solc.version(),
    contract_execution: "not-performed",
    cases: reports,
    process_peak_rss_kib: process.resourceUsage().maxRSS,
    measurements:
      "In-process decode timings; peak RSS includes the compiler. End-to-end Linux provider/CLI costs and agent tokens were not measured.",
  }),
);
