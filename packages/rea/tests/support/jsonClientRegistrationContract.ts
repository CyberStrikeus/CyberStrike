import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { currentClientRegistrationCommand } from "../../src/application/ClientRegistrationIdentity.js";
import { readClientRegistrationStatuses } from "../../src/application/ClientRegistrationStatus.js";
import { configureClientConfiguration } from "../../src/application/SetupClientConfiguration.js";
import { supportedClients } from "../../src/application/SupportedClients.js";
import { systemUninstallHost } from "../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

/** Run the JSON registration contract against each client's independently supplied location. */
export const jsonClientRegistrationContract = ({
  clientName,
  displayName,
  directory,
  filename,
  initialSettings,
  settingsWithoutServers,
}: {
  clientName: "qoder" | "workbuddy";
  displayName: string;
  directory: string;
  filename: string;
  initialSettings: Record<string, unknown>;
  settingsWithoutServers: Record<string, unknown>;
}): void => {
  const command = currentClientRegistrationCommand({
    platform: process.platform,
  });

  describe(`${displayName} JSON registration`, () => {
    const createClient = async () => {
      const home = await createTestTempDirectory(`rea-${clientName}-`);
      const client = supportedClients(home, process.platform, {}).find(
        ({ name }) => name === clientName,
      );
      if (client?.markerPath === undefined)
        throw new Error(`missing ${displayName} client`);
      expect(client.markerPath).toBe(join(home, directory));
      expect(client.configPath).toBe(join(home, directory, filename));
      await mkdir(client.markerPath, { recursive: true });
      return { home, client };
    };

    it("upserts rea into mcpServers while preserving unrelated settings", async () => {
      const { home, client } = await createClient();
      await writeFile(
        client.configPath,
        JSON.stringify({
          ...initialSettings,
          mcpServers: { other: { command: "other-server" } },
        }),
      );
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("configured");
      const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
      for (const [key, value] of Object.entries(initialSettings))
        expect(parsed[key]).toEqual(value);
      expect(parsed.mcpServers.other).toEqual({ command: "other-server" });
      expect(parsed.mcpServers.rea).toEqual({
        command: command[0],
        args: command.slice(1),
      });
      expect(await configureClientConfiguration(client, {}, command)).toEqual({
        status: "unchanged",
      });
      expect(
        (
          await readClientRegistrationStatuses(home, undefined, {
            platform: process.platform,
            environment: {},
          })
        ).find(({ client }) => client === clientName),
      ).toMatchObject({ state: "aligned", command });
    });

    it("creates the mcpServers table in existing settings without servers", async () => {
      const { client } = await createClient();
      await writeFile(
        client.configPath,
        JSON.stringify(settingsWithoutServers),
      );
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("configured");
      const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
      for (const [key, value] of Object.entries(settingsWithoutServers))
        expect(parsed[key]).toEqual(value);
      expect(parsed.mcpServers.rea).toEqual({
        command: command[0],
        args: command.slice(1),
      });
    });

    it("registers into an empty settings file", async () => {
      const { client } = await createClient();
      await writeFile(client.configPath, "");
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("configured");
      const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
      expect(parsed.mcpServers.rea).toEqual({
        command: command[0],
        args: command.slice(1),
      });
    });

    it("removes only the rea entry on uninstall", async () => {
      const { home, client } = await createClient();
      await writeFile(
        client.configPath,
        JSON.stringify({ mcpServers: { other: { command: "other-server" } } }),
      );
      await configureClientConfiguration(client, {}, command);
      expect(
        (await systemUninstallHost(home).removeClient(client)).status,
      ).toBe("removed");
      const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
      expect(parsed.mcpServers.other).toEqual({ command: "other-server" });
      expect(parsed.mcpServers.rea).toBeUndefined();
    });
  });
};
