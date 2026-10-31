import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  PE_LOAD_CONFIG_FIXTURE,
  peLoadConfigImage,
} from "../../src/native/pe/PeLoadConfig.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { cliTest } from "../support/cli/cliFixture.js";

for (const bits of [32, 64] as const) {
  cliTest(
    `rejects non-MZ PE${String(bits)} load config across CLI and MCP`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-pe-config-signature-");
      const call = await cli.sharedMcpCall!();
      for (const [name, prefix] of [
        ["zz", Buffer.from("ZZ")],
        ["high-bit", Buffer.from([0xcd, 0xda])],
      ] as const) {
        const bytes = peLoadConfigImage({ bits });
        prefix.copy(bytes);
        const path = join(root, `${name}.exe`);
        await writeFile(path, bytes);
        const result = await cli.run({
          arguments: ["inspect-pe-load-config", path, "--json"],
        });
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject({
          code: "invalid_request",
          details: { operation: "inspect_pe_load_config" },
        });
        const response = await call("inspect_pe_load_config", { path });
        expect(response.isError).toBe(true);
        expect(parseMcpToolError(response)).toEqual({ error: result.json });
        expect((await readFile(path)).equals(bytes)).toBe(true);
      }
      const path = join(root, "valid.exe");
      const bytes = peLoadConfigImage({ bits });
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-pe-load-config", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const response = await call("inspect_pe_load_config", { path });
      expect(response.isError).not.toBe(true);
      for (const value of [result.json, response.structuredContent]) {
        const report = toolContract(
          "inspect_pe_load_config",
        ).outputSchema.parse(value).normalized_result;
        expect(report.bits).toBe(bits);
        expect(report.tls?.callbacks).toHaveLength(3);
        expect(report.load_config?.guard_flags?.raw).toBe(0x500);
      }
      expect((await readFile(path)).equals(bytes)).toBe(true);
    },
  );

  cliTest(`reads PE${bits} TLS callbacks through the CLI`, async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-config-cli-");
    await writeFile(join(root, "app.exe"), peLoadConfigImage({ bits }));
    const result = await cli.run({
      arguments: ["inspect-pe-load-config", "app.exe", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_pe_load_config").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.bits).toBe(bits);
    expect(evidence.normalized_result.tls?.callbacks).toHaveLength(3);
    expect(evidence.normalized_result.load_config).toMatchObject({
      dynamic_value_reloc_table_offset:
        PE_LOAD_CONFIG_FIXTURE.dynamicRelocOffset,
      dynamic_value_reloc_table_section:
        PE_LOAD_CONFIG_FIXTURE.dynamicRelocSection,
    });
    expect(evidence.subject?.local_path).toBe(join(root, "app.exe"));
  });
}
cliTest("fails closed at the callback limit", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-pe-config-budget-");
  const path = join(root, "app.exe");
  await writeFile(path, peLoadConfigImage());
  const result = await cli.run({
    arguments: [
      "inspect-pe-load-config",
      path,
      "--max-callbacks",
      "1",
      "--json",
    ],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "resource_constraint",
    retryable: false,
    details: { reported_limits: { limit: "callbacks", maximum: 1 } },
    remediation: {
      action: expect.stringContaining("Raise max_callbacks above 1"),
    },
  });
  const retried = await cli.run({
    arguments: [
      "inspect-pe-load-config",
      path,
      "--max-callbacks",
      "3",
      "--json",
    ],
  });
  expect(retried.exitCode, retried.stderr).toBe(0);
  const report = toolContract("inspect_pe_load_config").outputSchema.parse(
    retried.json,
  ).normalized_result;
  expect(report.tls?.callbacks).toHaveLength(3);
});
