import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

const SERIAL = "listing-numbers-device";
const UNSAFE = "9007199254740993";
const OVERFLOW_DECIMAL = "9".repeat(400);
const OVERFLOW_HEX = `0x${"f".repeat(300)}`;
const COLUMNS = "USER PID PPID VSZ RSS WCHAN ADDR S NAME";
type Variant = "safe" | "mixed" | "capped";

const processLine = (
  name: string,
  pid: string | number,
  ppid: string | number,
  rss: string | number,
): string => `shell ${pid} ${ppid} 1 ${rss} wait 0 S ${name}  \t`;

const processRow = (
  name: string,
  pid: number,
  ppid: number | null,
  rss: number | null,
) => ({
  user: "shell",
  pid,
  ppid,
  rss,
  state: "S",
  // The final NAME column retains the exact suffix emitted by processLine.
  name: `${name}  \t`,
});

const processListing = (variant: Variant) => {
  const boundary = Number.MAX_SAFE_INTEGER;
  const cases = [
    {
      line: processLine("zero", 0, 0, 0),
      row: processRow("zero", 0, 0, 0),
      bad: false,
    },
    { line: processLine("unsafe-pid", UNSAFE, 0, 0), row: null, bad: true },
    {
      line: processLine("boundary", boundary, boundary, boundary),
      row: processRow("boundary", boundary, boundary, boundary),
      bad: false,
    },
    {
      line: processLine("overflow-pid", OVERFLOW_DECIMAL, 0, 0),
      row: null,
      bad: true,
    },
    {
      line: processLine("unsafe-ppid", 43, UNSAFE, 3),
      row: processRow("unsafe-ppid", 43, null, 3),
      bad: true,
    },
    {
      line: processLine("unsafe-rss", 44, 1, UNSAFE),
      row: processRow("unsafe-rss", 44, 1, null),
      bad: true,
    },
    {
      line: processLine(
        "overflow-both",
        45,
        OVERFLOW_DECIMAL,
        OVERFLOW_DECIMAL,
      ),
      row: processRow("overflow-both", 45, null, null),
      bad: true,
    },
    // Leading whitespace remains outside the existing process-row grammar.
    { line: " \tunexpected process row  \t", row: null, bad: true },
    {
      line: processLine("adjacent", 46, 1, 3),
      row: processRow("adjacent", 46, 1, 3),
      bad: false,
    },
  ];
  const selected = variant === "safe" ? cases.filter(({ bad }) => !bad) : cases;
  if (variant === "capped")
    for (let index = 0; index < 6; index++) {
      const name = `extra-${String(index)}`;
      selected.push({
        line: processLine(name, 100 + index, UNSAFE, OVERFLOW_DECIMAL),
        row: processRow(name, 100 + index, null, null),
        bad: true,
      });
    }
  return {
    stdout: [`${COLUMNS}  \t`, ...selected.map(({ line }) => line), ""].join(
      "\n",
    ),
    rows: {
      columns: COLUMNS,
      processes: selected.flatMap(({ row }) => (row === null ? [] : [row])),
    },
    unparsed: selected.filter(({ bad }) => bad).map(({ line }) => line),
  };
};

const featureListing = (variant: Variant) => {
  const cases = [
    {
      line: " \tfeature:without-version  \t",
      row: { name: "without-version", version: null },
      bad: false,
    },
    {
      line: ` \tfeature:unsafe-decimal=${UNSAFE}  \t`,
      row: { name: "unsafe-decimal", version: null },
      bad: true,
    },
    {
      line: "feature:decimal-zero=0",
      row: { name: "decimal-zero", version: 0 },
      bad: false,
    },
    {
      line: "feature:hex-zero=0x0",
      row: { name: "hex-zero", version: 0 },
      bad: false,
    },
    {
      line: "feature:unsafe-hex=0x20000000000001  \t",
      row: { name: "unsafe-hex", version: null },
      bad: true,
    },
    {
      line: "feature:decimal-boundary=9007199254740991",
      row: { name: "decimal-boundary", version: Number.MAX_SAFE_INTEGER },
      bad: false,
    },
    {
      line: `feature:overflow-decimal=${OVERFLOW_DECIMAL}  \t`,
      row: { name: "overflow-decimal", version: null },
      bad: true,
    },
    {
      line: "feature:hex-boundary=0x1fffffffffffff",
      row: { name: "hex-boundary", version: Number.MAX_SAFE_INTEGER },
      bad: false,
    },
    {
      line: ` \tfeature:overflow-hex=${OVERFLOW_HEX}  \t`,
      row: { name: "overflow-hex", version: null },
      bad: true,
    },
    {
      line: "feature:glEsVersion=0x30002",
      row: { name: "glEsVersion", version: 196610 },
      bad: false,
    },
    {
      line: "feature:adjacent=1",
      row: { name: "adjacent", version: 1 },
      bad: false,
    },
  ];
  const selected = variant === "safe" ? cases.filter(({ bad }) => !bad) : cases;
  if (variant === "capped")
    for (let index = 0; index < 8; index++) {
      const name = `extra-${String(index)}`;
      selected.push({
        line: ` \tfeature:${name}=${UNSAFE}  \t`,
        row: { name, version: null },
        bad: true,
      });
    }
  return {
    stdout: [...selected.map(({ line }) => line), ""].join("\n"),
    rows: { features: selected.map(({ row }) => row) },
    unparsed: selected.filter(({ bad }) => bad).map(({ line }) => line),
  };
};

cliTest.skipIf(process.platform === "win32")(
  "preserves safe ADB listing numbers and partial raw evidence through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-adb-listing-numbers-");
    const binary = join(root, "adb");
    const processes = join(root, "processes.txt");
    const features = join(root, "features.txt");
    await writeFile(
      binary,
      `#!${process.execPath}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === 'version') {
  console.log('Android Debug Bridge version 1.0.41\\nVersion 34.0.5-fixture\\nInstalled as ' + process.argv[1]);
  process.exit(0);
}
const outputs = new Map([
  [${JSON.stringify(`-s ${SERIAL} shell ps -A`)}, ${JSON.stringify(processes)}],
  [${JSON.stringify(`-s ${SERIAL} shell pm list features`)}, ${JSON.stringify(features)}],
]);
const path = outputs.get(args.join(' '));
if (path === undefined) process.exit(91);
process.stdout.write(require('node:fs').readFileSync(path));
`,
      { mode: 0o700 },
    );
    const environment = {
      HOME: root,
      USERPROFILE: root,
      REA_ADB_PATH: binary,
      REA_LOG_LEVEL: "silent",
    };
    const { call } = await connectLocalToolsMcp(environment);
    for (const variant of ["safe", "mixed", "capped"] as const) {
      for (const [operation, path, listing] of [
        ["list_adb_processes", processes, processListing(variant)],
        ["list_adb_features", features, featureListing(variant)],
      ] as const) {
        await writeFile(path, listing.stdout);
        const contract = toolContract(operation);
        const invocation = {
          arguments: [operation.replaceAll("_", "-"), SERIAL, "--json"],
          environment,
        };
        const output = await (variant === "safe"
          ? cli.run(invocation)
          : runFileCli(cli, invocation));
        expect(output.exitCode, output.stderr).toBe(0);
        const evidence = contract.outputSchema.parse(output.json);
        expect(evidence.parameters).toMatchObject({ serial: SERIAL });
        expect(evidence.normalized_result).toMatchObject({
          serial: SERIAL,
          ...listing.rows,
          unparsed_lines: listing.unparsed.slice(0, 10),
          coverage: variant === "safe" ? "complete" : "partial",
        });
        const truncation = evidence.limitations.filter((text) =>
          text.startsWith("unparsed_lines reports"),
        );
        expect(truncation).toEqual(
          variant === "capped"
            ? ["unparsed_lines reports the first 10 of 12 unrecognized lines"]
            : [],
        );
        const reply = await call(operation, { serial: SERIAL });
        expect(reply.isError).not.toBe(true);
        const structured = contract.outputSchema.parse(reply.structuredContent);
        expect(structured.normalized_result).toEqual(
          evidence.normalized_result,
        );
        expect(structured.limitations).toEqual(evidence.limitations);
      }
    }
  },
);
