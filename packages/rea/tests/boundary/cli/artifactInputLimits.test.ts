import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

for (const { command, limit, recovery } of [
  {
    command: "inspect-go-binary",
    limit: 256 * 1024 * 1024,
    recovery: "input byte allowance",
  },
  {
    command: "inspect-rust-binary",
    limit: 256 * 1024 * 1024,
    recovery: "within the fixed Rust input allowance",
  },
  {
    command: "inspect-il2cpp-metadata",
    limit: 256 * 1024 * 1024,
    recovery: "within the fixed IL2CPP input allowance",
  },
  {
    command: "inspect-wasm-artifact",
    limit: 8 * 1024 * 1024,
    recovery: "input byte allowance",
  },
]) {
  cliTest.skipIf(process.platform === "win32")(
    `${command} identifies fixed input-size refusal and recovery`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-artifact-input-limit-");
      const selected = join(root, "oversized.bin");
      const handle = await open(selected, "wx");
      try {
        await handle.truncate(limit + 1);
      } finally {
        await handle.close();
      }
      const tools = join(root, "tools");
      await mkdir(tools);
      for (const tool of ["wasm-validate", "wasm-objdump", "wasm2wat"])
        await writeFile(
          join(tools, tool),
          `#!/bin/sh
if [ "$1" = --version ]; then printf '1.0.42\\n'; exit 0; fi
printf 'Unexpected analysis command\\n' >&2
exit 1
`,
          { mode: 0o700 },
        );
      const output = await cli.run({
        arguments: [command, selected, "--json"],
        environment: { REA_WABT_BIN_DIRECTORY: tools },
      });
      expect(output.exitCode).toBe(1);
      const refusal = z
        .object({
          code: z.literal("resource_constraint"),
          category: z.literal("resource_constraint"),
          retryable: z.literal(false),
          details: z.object({
            resource: z.literal("file-size"),
            reported_limits: z.object({
              maximum_input_bytes: z.literal(limit),
            }),
          }),
          remediation: z.object({ action: z.string() }),
        })
        .parse(output.json);
      // Raising the evidence-reply allowance cannot admit an oversized input.
      expect(refusal.remediation.action).toContain(recovery);
      expect(refusal.remediation.action).not.toMatch(
        /allowance for the evidence reply/u,
      );
    },
  );
}
