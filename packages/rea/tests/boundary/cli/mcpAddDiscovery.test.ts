import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "mcp add discovery does not create or change Amp settings",
  async ({ processes }) => {
    const home = await createTestTempDirectory("rea-mcp-discovery-");
    const path = join(home, ".config", "amp", "settings.json");
    const run = (args: string[]) =>
      processes.run(process.execPath, [resolve("scripts/rea.mjs"), ...args], {
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
        },
        timeoutMs: 30_000,
      });

    const schema = await run([
      "mcp",
      "add",
      "--agent",
      "amp",
      "--schema",
      "--json",
    ]);
    expect(schema.exitCode).toBe(1);
    expect(JSON.parse(schema.stdout)).toMatchObject({
      code: "SCHEMA_UNAVAILABLE",
    });
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });

    for (const format of ["csv", "tsv"]) {
      const result = await run([
        "mcp",
        "add",
        "--agent",
        "amp",
        "--schema",
        "--format",
        format,
        "--filter-output",
        "rows",
        "--columns",
        "code",
      ]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
      });
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    }

    // A flag-shaped output value remains data; the CLI rejects the invalid
    // format before dispatching registration or treating it as discovery.
    const invalidFormat = await run([
      "mcp",
      "add",
      "--agent",
      "amp",
      "--format",
      "--schema",
    ]);
    expect(invalidFormat.exitCode).toBe(1);
    expect(invalidFormat.stdout).not.toContain("SCHEMA_UNAVAILABLE");
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });

    await mkdir(join(home, ".config", "amp"), { recursive: true });
    const original = '{"existing":true}\n';
    await writeFile(path, original);
    for (const flag of ["--schema", "--version", "--help"]) {
      const result = await run(["mcp", "add", "--agent", "amp", flag]);
      expect(result.stdout).not.toContain("Registered rea");
      expect(result.exitCode).toBe(flag === "--schema" ? 1 : 0);
      expect(await readFile(path, "utf8")).toBe(original);
    }
    const registration = await run(["mcp", "add", "--agent", "amp"]);
    expect(registration.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(path, "utf8"))["amp.mcpServers"].rea,
    ).toBeDefined();
  },
);
