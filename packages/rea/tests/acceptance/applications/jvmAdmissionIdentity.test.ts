import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { javaClassFile } from "../../fixtures/javaClassFile.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "refuses JVM CPU lookalikes consistently across the admission prefix through CLI and stdio MCP",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-jvm-admission-");
    const { call } = await connectLocalToolsMcp();
    for (const constantBytes of [4000, 9000]) {
      const path = join(directory, `class-${constantBytes}.class`);
      const bytes = javaClassFile(constantBytes, true);
      await writeFile(path, bytes);
      const refusal = {
        code: "target_unavailable",
        category: "unsupported_target",
        details: { reason: "unsupported binary format" },
      };

      const analyzed = await cli.run({
        arguments: ["analyze", path, "--format", "json"],
      });
      expect(analyzed.exitCode, analyzed.stderr).toBe(1);
      expect(analyzed.json).toMatchObject(refusal);
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);

      const opened = await call("open_binary", { path });
      expect(opened.isError, JSON.stringify(opened)).toBe(true);
      expect(parseMcpToolError(opened).error).toMatchObject(refusal);
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    }
  },
);
