import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCli } from "../../../src/cli.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("validates selected and existing JEB endpoints without losing caller selection", async () => {
  const home = await createTestTempDirectory("rea-setup-jeb-selection-");
  const path = join(home, ".cursor/mcp.json");
  await mkdir(join(home, ".cursor"));
  const oldEndpoint = "http://127.0.0.1:8425/mcp";
  const invalidEndpoint = "https://example.com/mcp";
  const selectedEndpoint = "http://127.0.0.1:8426/mcp/";
  const registration = (endpoint: string) =>
    JSON.stringify({
      mcpServers: {
        rea: {
          command: "rea",
          args: ["mcp"],
          env: { REA_JEB_MCP_URL: endpoint },
        },
      },
    });
  const original = registration(oldEndpoint);
  await writeFile(path, original);
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    REA_JEB_MCP_URL: invalidEndpoint,
    HOPPER_LAUNCHER_PATH: join(home, "missing"),
  };
  const setup = async () => {
    let stdout = "";
    await createCli(env).serve(
      ["setup", "--client", "cursor", "--skill=false", "--yes", "--json"],
      {
        env,
        stdout: (chunk) => {
          stdout += chunk;
        },
        exit: () => undefined,
      },
    );
    return JSON.parse(stdout) as { status: string; remediation?: string };
  };

  const refused = await setup();
  expect(refused.status).toBe("needs_human");
  expect(refused.remediation).toContain("REA_JEB_MCP_URL");
  expect(await readFile(path, "utf8")).toBe(original);
  expect(parseConfig(env).ok).toBe(true);

  delete env.REA_JEB_MCP_URL;
  const invalidExisting = registration(invalidEndpoint);
  await writeFile(path, invalidExisting);
  expect((await setup()).status).toBe("needs_human");
  expect(await readFile(path, "utf8")).toBe(invalidExisting);

  env.REA_JEB_MCP_URL = selectedEndpoint;
  const repaired = await setup();
  expect(repaired.status, JSON.stringify(repaired)).toBe("ready");
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.mcpServers.rea.env.REA_JEB_MCP_URL).toBe(selectedEndpoint);
});
