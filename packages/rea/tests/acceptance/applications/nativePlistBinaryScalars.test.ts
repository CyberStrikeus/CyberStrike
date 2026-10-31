import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildBinary } from "plist";
import { describe, expect } from "vitest";

import { inspectPlistSchema } from "../../../src/domain/native/nativeInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const patchReal = (bytes: Buffer, original: number, replacement: number) => {
  const marker = Buffer.alloc(9);
  marker[0] = 0x23;
  marker.writeDoubleBE(original, 1);
  const offset = bytes.indexOf(marker);
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(bytes.indexOf(marker, offset + marker.length)).toBe(-1);
  bytes.writeDoubleBE(replacement, offset + 1);
};

const makeBinaryPlist = () => {
  const bytes = Buffer.from(
    buildBinary({
      note: "a\u0001b",
      payload: Buffer.from([0, 1, 2]),
      fractional: new Date("2020-05-05T01:02:03.100Z"),
      whole: new Date("2020-05-05T01:02:03.000Z"),
      negative: 1.5,
      positive: 0.25,
      wide: 9007199254740992,
      // The writer shares this scalar with wide; patching its one source record
      // tests exact integers inside an ordinary binary dictionary, not a UID.
      wideDictionary: { CF$UID: 9007199254740992 },
      wide128: Buffer.alloc(16),
      plusInfinity: Number.POSITIVE_INFINITY,
      minusInfinity: Number.NEGATIVE_INFINITY,
      nan: Number.NaN,
    }),
  );
  patchReal(bytes, 1.5, -0);
  patchReal(bytes, 0.25, 0);

  const wideReal = Buffer.alloc(9);
  wideReal[0] = 0x23;
  wideReal.writeDoubleBE(9007199254740992, 1);
  const wideOffset = bytes.indexOf(wideReal);
  expect(wideOffset).toBeGreaterThanOrEqual(0);
  expect(bytes.indexOf(wideReal, wideOffset + wideReal.length)).toBe(-1);
  bytes[wideOffset] = 0x13;
  bytes.writeBigInt64BE(9007199254740993n, wideOffset + 1);

  const trailer = bytes.length - 32;
  const offsetWidth = bytes[trailer + 6] ?? 0;
  const objectCount = Number(bytes.readBigUInt64BE(trailer + 8));
  const offsetTable = Number(bytes.readBigUInt64BE(trailer + 24));
  let wide128Offset: number | undefined;
  for (let index = 0; index < objectCount; index += 1) {
    let offset = 0;
    const entry = offsetTable + index * offsetWidth;
    for (let byte = 0; byte < offsetWidth; byte += 1)
      offset = offset * 256 + (bytes[entry + byte] ?? 0);
    if (bytes[offset] === 0x4f) {
      expect(wide128Offset).toBeUndefined();
      wide128Offset = offset;
    }
  }
  expect(wide128Offset).toBeDefined();
  if (wide128Offset === undefined)
    throw new Error("plist fixture lost wide128");
  bytes[wide128Offset] = 0x14;
  bytes.writeBigUInt64BE(1n, wide128Offset + 1);
  bytes.writeBigUInt64BE(42n, wide128Offset + 9);
  return bytes;
};

describe.skipIf(process.platform !== "darwin")(
  "native binary plist scalar fidelity",
  () => {
    cliTest(
      "preserves binary plist scalars through compiled CLI and stdio MCP",
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-plist-binary-scalars-");
        const target = join(root, "target");
        const binaryPath = join(root, "selected-binary.plist");
        const xmlPath = join(root, "selected-xml.plist");
        const binaryBytes = makeBinaryPlist();
        const xmlBytes = Buffer.from(
          "<plist><dict><key>separators</key><string>a\u0085b\u2028c\u2029d</string><key>payload</key><data>AAEC</data></dict></plist>",
        );
        await Promise.all([
          writeFile(target, thinMach(0xfeedfacf, 0x0100000c)),
          writeFile(binaryPath, binaryBytes),
          writeFile(xmlPath, xmlBytes),
        ]);
        const environment = {
          HOME: root,
          USERPROFILE: root,
          REA_LOG_LEVEL: "silent",
          REA_ANALYSIS_PROVIDER: "auto",
        };

        const inspectCli = async (path: string) => {
          const output = await cli.run({
            arguments: ["inspect-plist", path, "--json"],
            environment,
          });
          expect(output.exitCode, output.stderr).toBe(0);
          return inspectPlistSchema.parse(
            parseEvidence(output.json).normalized_result,
          );
        };
        const binaryCliResult = await inspectCli(binaryPath);
        const xmlCliResult = await inspectCli(xmlPath);

        const { call } = await connectLocalToolsMcp(environment);
        const opened = await call("open_binary", { path: target });
        expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
        const inspectMcp = async (path: string) => {
          const response = await call("inspect_plist", { path });
          expect(response.isError, JSON.stringify(response)).not.toBe(true);
          return inspectPlistSchema.parse(
            parseEvidence(response.structuredContent).normalized_result,
          );
        };
        const binaryMcpResult = await inspectMcp(binaryPath);
        const xmlMcpResult = await inspectMcp(xmlPath);

        expect(binaryMcpResult).toEqual(binaryCliResult);
        expect(binaryCliResult).toMatchObject({
          format: "binary",
          source_path: binaryPath,
          value: {
            note: "a\u0001b",
            payload: { $plist_type: "data", base64: "AAEC" },
            fractional: {
              $plist_type: "date",
              iso8601: "2020-05-05T01:02:03.100Z",
            },
            whole: {
              $plist_type: "date",
              iso8601: "2020-05-05T01:02:03.000Z",
            },
            negative: { $plist_type: "real", value: "-0" },
            positive: 0,
            wide: { $plist_type: "integer", decimal: "9007199254740993" },
            wideDictionary: {
              CF$UID: { $plist_type: "integer", decimal: "9007199254740993" },
            },
            wide128: {
              $plist_type: "integer",
              decimal: "18446744073709551658",
            },
            plusInfinity: { $plist_type: "real", value: "+infinity" },
            minusInfinity: { $plist_type: "real", value: "-infinity" },
            nan: { $plist_type: "real", value: "nan" },
          },
          provenance: [{ tool: "file" }],
        });
        expect(binaryCliResult.limitations).toEqual(
          expect.arrayContaining([
            expect.stringContaining("1 negative-zero real value(s)"),
            expect.stringContaining("3 non-finite real value(s)"),
            expect.stringContaining("3 unambiguous integer value(s)"),
          ]),
        );
        expect(binaryCliResult.limitations).not.toContainEqual(
          expect.stringContaining("XML conversion"),
        );
        expect(xmlMcpResult).toEqual(xmlCliResult);
        expect(xmlCliResult).toMatchObject({
          format: "xml",
          source_path: xmlPath,
          value: {
            separators: "a\u0085b\u2028c\u2029d",
            payload: { $plist_type: "data", base64: "AAEC" },
          },
          provenance: [
            { tool: "file" },
            {
              tool: "plutil",
              command: ["/usr/bin/plutil", "-lint", "--", "$PLIST"],
            },
          ],
          limitations: [],
        });
        expect(Buffer.compare(await readFile(binaryPath), binaryBytes)).toBe(0);
        expect(Buffer.compare(await readFile(xmlPath), xmlBytes)).toBe(0);
      },
      60_000,
    );
  },
);
