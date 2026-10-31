import { readdir } from "node:fs/promises";

import { expect } from "vitest";

import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, createTestCli } from "../../support/cli/cliFixture.js";

cliTest(
  "reuses an owned CLI compile cache and preserves a caller-selected cache",
  async ({ cli, cliCompileCache }) => {
    const cached = await cli.run({ arguments: ["--version"] });
    expect(cached.exitCode).toBe(0);
    expect(cached.stdout).toContain(PRODUCT_IDENTITY.packageVersion);
    expect(await readdir(cliCompileCache)).not.toHaveLength(0);

    const selected = await createTestTempDirectory("rea-cli-selected-cache-");
    const overridden = await cli.run({
      arguments: ["--version"],
      environment: { NODE_COMPILE_CACHE: selected },
    });
    expect(overridden.exitCode).toBe(0);
    expect(overridden.stdout).toBe(cached.stdout);
    expect(await readdir(selected)).not.toHaveLength(0);
  },
);

cliTest(
  "collects requested child coverage without populating the fixture cache",
  async ({ processes }) => {
    const cache = await createTestTempDirectory("rea-cli-coverage-cache-");
    const coverage = await createTestTempDirectory("rea-cli-child-coverage-");
    const cli = createTestCli(processes, cache);
    const result = await cli.run({
      arguments: ["--version"],
      environment: { NODE_V8_COVERAGE: coverage },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(PRODUCT_IDENTITY.packageVersion);
    expect(await readdir(cache)).toEqual([]);
    expect(
      (await readdir(coverage)).some((path) => path.endsWith(".json")),
    ).toBe(true);
  },
);

cliTest("preserves a caller's cold CLI launch", async ({ processes }) => {
  const cache = await createTestTempDirectory("rea-cli-disabled-cache-");
  const cli = createTestCli(processes, cache);
  const result = await cli.run({
    arguments: ["--version"],
    environment: { NODE_DISABLE_COMPILE_CACHE: "1" },
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(PRODUCT_IDENTITY.packageVersion);
  expect(await readdir(cache)).toEqual([]);
});
