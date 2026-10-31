import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "identifies rejected launch overrides without blaming or changing a client file",
  async ({ cli }) => {
    const home = await createTestTempDirectory(
      "rea-setup-override-diagnostic-",
    );
    const config = join(home, ".claude.json");
    const environment = {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
    };
    const run = (overrides: Record<string, string>) =>
      cli.run({
        arguments: [
          "setup",
          "--client",
          "claude_code",
          "--yes",
          "--skill=false",
          "--json",
        ],
        cwd: home,
        environment: { ...environment, ...overrides },
      });

    const absent = await run({ REA_ASAR_MAX_HEADER_BYTES: "0" });
    expect(absent.exitCode).toBe(1);
    expect(absent.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      appliedActions: [],
      remediation: expect.stringContaining("launch overrides"),
    });
    expect(absent.stdout).toContain("REA_ASAR_MAX_HEADER_BYTES");
    expect(absent.stdout).not.toContain(
      `Configuration ${config} has an invalid`,
    );
    await expect(access(config)).rejects.toMatchObject({ code: "ENOENT" });

    const original = JSON.stringify({
      mcpServers: {
        rea: { command: "rea", args: ["mcp"], env: { CALLER_KEY: "keep" } },
      },
    });
    await writeFile(config, original);
    const existing = await run({ REA_BRIDGE_MAX_REQUEST_BYTES: "1" });
    expect(existing.exitCode).toBe(1);
    expect(existing.json).toMatchObject({
      status: "needs_human",
      remediation: expect.stringContaining("launch overrides"),
    });
    expect(existing.stdout).toContain("REA_BRIDGE_MAX_REQUEST_BYTES");
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(access(`${config}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const invalidFile = JSON.stringify({
      mcpServers: {
        rea: {
          command: "rea",
          args: ["mcp"],
          env: { HOPPER_LOADER_ARGS_JSON: "not-json" },
        },
      },
    });
    await writeFile(config, invalidFile);
    const stored = await run({});
    expect(stored.exitCode).toBe(1);
    expect(stored.json).toMatchObject({
      status: "needs_human",
      remediation: expect.stringContaining(config),
    });
    expect(stored.stdout).toContain("HOPPER_LOADER_ARGS_JSON");
    expect(stored.stdout).not.toContain("not-json");
    expect(await readFile(config, "utf8")).toBe(invalidFile);
  },
);
