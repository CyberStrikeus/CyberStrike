import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { expect, onTestFinished } from "vitest";

import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { systemUninstallHost } from "../../../src/application/Uninstall.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const cliLifecycle = (cli: TestCli, home: string, profile: string) => {
  const client = supportedClients(home, process.platform, {
    HERMES_HOME: profile,
  }).find(({ name }) => name === "hermes");
  if (client?.configPath !== join(profile, "config.yaml"))
    throw new Error("Hermes profile did not resolve to the test config");
  const run = (arguments_: readonly string[]) =>
    cli.run({
      arguments: arguments_,
      cwd: home,
      environment: { HOME: home, USERPROFILE: home, HERMES_HOME: profile },
      timeoutMs: 20_000,
    });
  const setup = [
    "setup",
    "--client",
    "hermes",
    "--skill=false",
    "--yes",
    "--json",
  ];
  const remove = async () => {
    const result = await run(["uninstall", "--json"]);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
  };
  return {
    configure: async () => {
      const result = await run(setup);
      expect(result.exitCode, JSON.stringify(result)).toBe(0);
      expect(result.json).toMatchObject({ status: "ready" });
    },
    verifyAndRepeat: async () => {
      const doctor = await run(["doctor", "--client", "hermes", "--json"]);
      expect(doctor.exitCode, JSON.stringify(doctor)).toBe(0);
      expect(doctor.json).toMatchObject({
        healthy: true,
        identity: { registrations: [{ client: "hermes", state: "aligned" }] },
      });
      const repeated = await run(setup);
      expect(repeated.exitCode, JSON.stringify(repeated)).toBe(0);
      expect(repeated.json).toMatchObject({
        plannedActions: [],
        appliedActions: [],
      });
    },
    remove,
    removeAgain: remove,
  };
};

const configurationLifecycle = (
  home: string,
  profile: string,
  config: string,
  command: readonly string[],
) => {
  const environment = { HERMES_HOME: profile };
  const client = supportedClients(home, process.platform, environment).find(
    ({ name }) => name === "hermes",
  );
  if (client === undefined || client.configPath !== config)
    throw new Error("Hermes profile did not resolve to the test config");
  const uninstallHost = systemUninstallHost(
    home,
    undefined,
    environment,
    process.platform,
  );
  onTestFinished(async () => {
    expect(await uninstallHost.close?.()).toBeUndefined();
  });
  return {
    configure: async () => {
      expect(
        await configureClientConfiguration(client, {}, command),
      ).toMatchObject({ status: "configured" });
    },
    verifyAndRepeat: async () => {
      expect(
        (
          await readClientRegistrationStatuses(home, undefined, {
            platform: process.platform,
            environment,
            selectedClientIds: ["hermes"],
          })
        ).find(({ client: name }) => name === "hermes"),
      ).toMatchObject({ state: "aligned", config_path: config });
      expect(await configureClientConfiguration(client, {}, command)).toEqual({
        status: "unchanged",
      });
    },
    remove: async () => {
      expect((await uninstallHost.removeClient(client)).status).toBe("removed");
    },
    removeAgain: async () => {
      expect((await uninstallHost.removeClient(client)).status).toBe("skipped");
    },
  };
};

type AnchorStyle = "entry" | "child" | "shadowed" | "key" | "external";

const anchoredConfiguration = (
  version: "1.1" | "1.2",
  style: AnchorStyle,
  server: {
    command: string;
    args: string[];
    env: { KEEP: string };
    enabled: boolean;
  },
) => {
  const directive = version === "1.2" ? "%YAML 1.2\n---\n" : "";
  const hasDefaults = style === "shadowed" || style === "external";
  const entry =
    `    command: ${JSON.stringify(server.command)}\n` +
    `    args: ${JSON.stringify(server.args)}\n` +
    "    enabled: false\n" +
    (hasDefaults
      ? "    env: *settings # Keep nested reference comment\n"
      : `    env: ${style === "child" ? "&settings " : ""}{KEEP: 'off'}\n`);
  const original =
    directive +
    "# Keep this user setting\nmodel: custom\n" +
    (hasDefaults ? "defaults: &settings {KEEP: 'off'}\n" : "") +
    `mcp_servers:\n  ${style === "key" ? "&server_name " : ""}rea:${style === "child" || style === "key" ? "" : " &server"}${style === "entry" ? " # Keep anchor definition comment" : ""}\n` +
    entry +
    (style === "child"
      ? "  other:\n    command: other-server\n    env: *settings # Shared environment\n"
      : style === "key"
        ? "  other: {command: other-server}\nobserver: *server_name # Registration name\n"
        : "  other: *server # Independent server\n") +
    (style === "shadowed"
      ? "later: &settings {KEEP: later}\nobserver: *server\n"
      : "");
  const other =
    style === "child"
      ? { command: "other-server", env: { KEEP: "off" } }
      : style === "key"
        ? { command: "other-server" }
        : server;
  return { original, other, hasDefaults };
};

for (const version of ["1.1", "1.2"] as const) {
  for (const style of [
    "entry",
    "child",
    "shadowed",
    "key",
    "external",
  ] as const) {
    const publicCli = style === "entry" || style === "shadowed";
    cliTest(
      `Hermes ${version} preserves ${style} anchor consumers through ${publicCli ? "CLI" : "configuration boundary"} setup and uninstall`,
      async ({ cli }) => {
        // Exercise both YAML versions through the CLI, including the shadowed
        // anchor case; the other styles retain the full registration lifecycle
        // at the production configuration and uninstall boundary.
        const home = await createTestTempDirectory(
          "rea-hermes-anchored-entry-",
        );
        const profile = join(home, "hermes");
        const config = join(profile, "config.yaml");
        const command = publicCli
          ? [process.execPath, resolve("scripts/rea.mjs"), "mcp"]
          : currentClientRegistrationCommand({ platform: process.platform });
        if (command[0] === undefined) throw new Error("Missing REA entrypoint");
        const server = {
          command: command[0],
          args: command.slice(1),
          env: { KEEP: "off" },
          enabled: false,
        };
        const { original, other, hasDefaults } = anchoredConfiguration(
          version,
          style,
          server,
        );
        await mkdir(profile);
        await writeFile(config, original);
        const lifecycle = publicCli
          ? cliLifecycle(cli, home, profile)
          : configurationLifecycle(home, profile, config, command);
        await lifecycle.configure();
        const configured = await readFile(config, "utf8");
        const configuredValues = parse(configured, { version });
        expect(configuredValues).toMatchObject({
          model: "custom",
          mcp_servers: { rea: { enabled: true, env: { KEEP: "off" } }, other },
          ...(style === "shadowed"
            ? { observer: server, later: { KEEP: "later" } }
            : {}),
          ...(style === "key" ? { observer: "rea" } : {}),
        });
        if (hasDefaults)
          expect(configuredValues.mcp_servers.other.env).toBe(
            configuredValues.defaults,
          );
        expect(configured).toContain("# Keep this user setting");
        if (style === "entry")
          expect(configured).toContain("# Keep anchor definition comment");
        expect(configured).toContain(
          style === "child"
            ? "# Shared environment"
            : style === "key"
              ? "# Registration name"
              : "# Independent server",
        );
        if (hasDefaults)
          expect(configured).toContain("# Keep nested reference comment");
        expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
        await lifecycle.verifyAndRepeat();
        expect(await readFile(config, "utf8")).toBe(configured);
        await lifecycle.remove();
        const removedValues = parse(await readFile(config, "utf8"), {
          version,
        });
        expect(removedValues).toEqual({
          model: "custom",
          mcp_servers: { other },
          ...(hasDefaults ? { defaults: { KEEP: "off" } } : {}),
          ...(style === "shadowed"
            ? {
                later: { KEEP: "later" },
                observer: server,
              }
            : {}),
          ...(style === "key" ? { observer: "rea" } : {}),
        });
        if (hasDefaults)
          expect(removedValues.mcp_servers.other.env).toBe(
            removedValues.defaults,
          );
        expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
        const remaining = await readFile(config, "utf8");
        if (style === "entry")
          expect(remaining).toContain("# Keep anchor definition comment");
        if (hasDefaults)
          expect(remaining).toContain("# Keep nested reference comment");
        await lifecycle.removeAgain();
        expect(await readFile(config, "utf8")).toBe(remaining);
      },
    );
  }
}
