import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { apkSignatureResultSchema } from "../../src/domain/apkSignature/apkSignatureReport.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { zip64Tail } from "../fixtures/apkSignature/zip64Tail.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../support/cli/cliFixture.js";

const inspectBoth = async (cli: TestCli, path: string) => {
  const output = await cli.sharedCliRun!({
    arguments: [
      "inspect-apk-signature",
      path,
      "--detail",
      "complete",
      "--json",
    ],
  });
  const call = await cli.sharedMcpCall!();
  const response = await call("inspect_apk_signature", {
    path,
    detail: "complete",
  });
  return { output, response };
};

const expectUnsignedZip64 = async (
  cli: TestCli,
  path: string,
  bytes: Uint8Array,
) => {
  await writeFile(path, bytes);
  const { output, response } = await inspectBoth(cli, path);
  expect(output.exitCode, output.stderr).toBe(0);
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  for (const value of [output.json, response.structuredContent]) {
    const evidence = parseEvidence(value);
    expect(evidence.subject).toMatchObject({
      local_path: path,
      digest: { sha256 },
    });
    expect(
      apkSignatureResultSchema.parse(evidence.normalized_result),
    ).toMatchObject({
      artifact: { path, bytes: bytes.length, sha256 },
      schemes: {
        v1: { present: false },
        v2: { present: false },
        v3: { present: false },
        "v3.1": { present: false },
      },
      runtime_execution: "not-performed",
    });
  }
  expect(Buffer.compare(await readFile(path), Buffer.from(bytes))).toBe(0);
};

const expectRefusal = async (
  cli: TestCli,
  path: string,
  bytes: Uint8Array,
  expected: Record<string, unknown>,
) => {
  await writeFile(path, bytes);
  const { output, response } = await inspectBoth(cli, path);
  expect(output.exitCode, output.stderr).toBe(1);
  const cliError = analysisErrorProjectionSchema.parse(output.json);
  expect(cliError).toMatchObject(expected);
  const mcpError = parseMcpToolError(response).error;
  expect(mcpError).toMatchObject(expected);
  expect(mcpError.message).toBe(cliError.message);
  expect(Buffer.compare(await readFile(path), Buffer.from(bytes))).toBe(0);
};

cliTest(
  "classifies damaged Zip64 framing as input errors through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-zip64-framing-");
    const path = join(root, "selected.apk");
    const fixture = await zip64Tail();
    const { recordOffset, locatorOffset, eocdOffset } = fixture;
    await expectUnsignedZip64(cli, path, fixture.bytes);
    const cases = [
      {
        at: locatorOffset,
        value: 0x07064b51,
        diagnosticOffset: eocdOffset,
        detail: "missing Zip64 EOCD locator",
      },
      {
        at: recordOffset,
        value: 0x06064b51,
        diagnosticOffset: recordOffset,
        detail: "invalid Zip64 EOCD signature",
      },
      {
        at: locatorOffset + 8,
        value: recordOffset + 1,
        diagnosticOffset: locatorOffset + 8,
        detail: "Zip64 EOCD record extends beyond its locator",
      },
      {
        at: locatorOffset + 16,
        value: 0,
        diagnosticOffset: locatorOffset + 16,
        detail: "Zip64 locator declares zero disks",
      },
      {
        at: locatorOffset + 4,
        value: 1,
        diagnosticOffset: locatorOffset + 4,
        detail: "Zip64 EOCD disk is outside the declared disk count",
      },
    ];
    for (const scenario of cases) {
      const bytes = Uint8Array.from(fixture.bytes);
      new DataView(bytes.buffer).setUint32(scenario.at, scenario.value, true);
      await expectRefusal(cli, path, bytes, {
        code: "invalid_request",
        category: "invalid_input",
        retryable: false,
        recovery: {
          kind: "inspect_input_contract",
          operation: "inspect_apk_signature",
        },
        details: {
          issues: [
            {
              path: ["path"],
              reason: "invalid_value",
              message: `Damaged ZIP/APK at byte ${String(scenario.diagnosticOffset)}: ${scenario.detail}.`,
            },
          ],
        },
      });
    }
    // Restore the exact original bytes at the same caller-selected path.
    await expectUnsignedZip64(cli, path, fixture.bytes);
  },
);

cliTest(
  "keeps Zip64 representation limits and non-ZIP targets distinct from damaged input",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-zip64-unsupported-");
    const path = join(root, "selected.apk");
    const fixture = await zip64Tail();
    for (const at of [
      fixture.locatorOffset + 8,
      fixture.recordOffset + 32,
      fixture.recordOffset + 40,
      fixture.recordOffset + 48,
    ]) {
      const bytes = Uint8Array.from(fixture.bytes);
      new DataView(bytes.buffer).setBigUint64(at, 1n << 53n, true);
      await expectRefusal(cli, path, bytes, {
        code: "unsupported_target",
        category: "unsupported_target",
        message: expect.stringContaining("safe range"),
        details: { path },
      });
    }
    const split = Uint8Array.from(fixture.bytes);
    const view = new DataView(split.buffer);
    view.setUint32(fixture.locatorOffset + 4, 1, true);
    view.setUint32(fixture.locatorOffset + 16, 2, true);
    view.setBigUint64(fixture.locatorOffset + 8, 1000000n, true);
    // Only locator metadata is authored here; this is not a real split-archive oracle.
    await expectRefusal(cli, path, split, {
      code: "unsupported_target",
      category: "unsupported_target",
      message: expect.stringContaining("multi-disk Zip64"),
      details: { path },
    });
    await expectRefusal(
      cli,
      path,
      new TextEncoder().encode("not a ZIP archive at all"),
      {
        code: "unsupported_target",
        category: "unsupported_target",
        message: expect.stringContaining("not a ZIP/APK"),
        details: { path },
      },
    );
  },
);
