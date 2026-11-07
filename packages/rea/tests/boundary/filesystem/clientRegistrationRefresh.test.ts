import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { parseClientConfiguration } from "../../../src/application/ClientConfigurationDocument.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([90, 120])(
  "preserves caller-selected Grok startup timeout %s when refreshing its launcher",
  async (timeout) => {
    const directory = await createTestTempDirectory("rea-grok-refresh-");
    const configPath = join(directory, "config.toml");
    const source = `[mcp_servers.rea]\ncommand = "npx"\nargs = ["-y", "rea-agents@6.1.0", "mcp"]\nstartup_timeout_sec = ${timeout}\ncustom_policy = "caller"\n\n[mcp_servers.rea.env]\nPATH = "/caller/bin:/usr/bin"\nCUSTOM = "preserved"\n`;
    await writeFile(configPath, source);
    const client = { name: "grok_build", configPath, format: "grok" } as const;
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toMatchObject({ status: "configured" });
    const refreshed = await readFile(configPath, "utf8");
    expect(
      parseClientConfiguration(refreshed, "grok").servers.rea,
    ).toMatchObject({
      command: "rea",
      args: ["mcp"],
      startup_timeout_sec: timeout,
      custom_policy: "caller",
      env: { PATH: "/caller/bin:/usr/bin", CUSTOM: "preserved" },
    });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(source);
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toEqual({ status: "unchanged" });
    expect(await readFile(configPath, "utf8")).toBe(refreshed);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(source);
  },
);
