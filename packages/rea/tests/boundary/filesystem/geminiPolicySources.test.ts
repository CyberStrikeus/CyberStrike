import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

import { readConfigurationFile } from "../../../src/application/ClientConfigurationFiles.js";
import { readClientPolicyBlock } from "../../../src/application/GeminiClientSettings.js";
import type { SetupClient } from "../../../src/application/SupportedClients.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const fixture = async () => {
  const home = await createTestTempDirectory("rea-gemini-policy-sources-");
  const configPath = join(home, ".gemini", "settings.json");
  await mkdir(dirname(configPath), { recursive: true });
  const client: SetupClient = {
    name: "gemini_cli",
    configPath,
    format: "json",
    geminiSettings: {
      defaultsPath: join(home, "defaults.json"),
      systemPath: join(home, "system.json"),
      workspaceDirectory: home,
      trustedFoldersPath: join(home, "trust.json"),
      platform: process.platform,
    },
  };
  return { client, configPath, systemPath: join(home, "system.json") };
};

it("keeps observed user absence until the caller reads a new configuration", async () => {
  const { client, configPath } = await fixture();
  const absent = await readConfigurationFile(configPath, "json");
  expect(absent).toEqual({ ok: true, value: undefined });
  if (!absent.ok) throw absent.error;

  await writeFile(configPath, JSON.stringify({ mcp: { excluded: ["rea"] } }));
  expect(await readClientPolicyBlock(client, absent.value)).toEqual({
    ok: true,
    value: undefined,
  });

  const current = await readConfigurationFile(configPath, "json");
  if (!current.ok) throw current.error;
  expect(await readClientPolicyBlock(client, current.value)).toMatchObject({
    ok: true,
    value: expect.stringContaining("mcp.excluded"),
  });
});

it("preserves the parsed user policy when its source disappears", async () => {
  const { client, configPath } = await fixture();
  await writeFile(configPath, JSON.stringify({ mcp: { excluded: ["rea"] } }));
  const observed = await readConfigurationFile(configPath, "json");
  if (!observed.ok) throw observed.error;
  await rm(configPath);

  expect(await readClientPolicyBlock(client, observed.value)).toMatchObject({
    ok: true,
    value: expect.stringContaining(configPath),
  });
});

it("still reads independent system policy when the user file was absent", async () => {
  const { client, configPath, systemPath } = await fixture();
  const absent = await readConfigurationFile(configPath, "json");
  if (!absent.ok) throw absent.error;
  await writeFile(systemPath, JSON.stringify({ mcp: { excluded: ["rea"] } }));

  expect(await readClientPolicyBlock(client, absent.value)).toMatchObject({
    ok: true,
    value: expect.stringContaining(systemPath),
  });
  await writeFile(systemPath, "{ invalid settings");
  expect(await readClientPolicyBlock(client, absent.value)).toMatchObject({
    ok: false,
    error: { kind: "malformed", path: systemPath },
  });
});
