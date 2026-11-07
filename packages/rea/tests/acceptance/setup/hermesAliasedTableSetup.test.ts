import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { expect } from "vitest";

import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const configuration = (
  version: "1.1" | "1.2",
  existing: boolean,
  aliased = true,
) => {
  const defaults =
    (version === "1.2" ? "%YAML 1.2\n---\n" : "") +
    "# Personal settings\nmodel: custom\nmask: 0x1F\n" +
    "server_defaults: &servers\n" +
    (existing
      ? "  rea: &server\n    command: npx\n    args: [ '-y', 'rea-agents@6.1.0', 'mcp' ]\n    env:\n      FLAG: 'on'\n  other: *server\n"
      : "  other: &server\n    command: other-server\n    args: [ 'on', '0600' ]\n");
  return {
    defaults,
    text:
      defaults +
      (aliased
        ? "mcp_servers: *servers # Selected table\n"
        : "mcp_servers:\n  other: *server\n") +
      "observer: *server\n",
  };
};

for (const version of ["1.1", "1.2"] as const) {
  cliTest(
    `Hermes YAML ${version} uninstall preserves an aliased table without REA`,
    async ({ cli }) => {
      const home = await createTestTempDirectory(
        "rea-hermes-absent-uninstall-",
      );
      const profile = join(home, "profile");
      const config = join(profile, "config.yaml");
      const original = configuration(version, false).text;
      await mkdir(profile);
      await writeFile(config, original);
      const removed = await cli.run({
        arguments: ["uninstall", "--json"],
        cwd: home,
        environment: {
          USERPROFILE: home,
          HERMES_HOME: profile,
          HOPPER_LAUNCHER_PATH: process.execPath,
        },
        timeoutMs: 20_000,
      });
      expect(removed.exitCode).toBe(0);
      expect(await readFile(config, "utf8")).toBe(original);
      await expect(access(`${config}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  for (const existing of [false, true]) {
    cliTest(
      `Hermes YAML ${version} ${existing ? "refreshes" : "adds"} REA in an aliased table without changing its source`,
      async ({ cli }) => {
        const home = await createTestTempDirectory("rea-hermes-table-alias-");
        const ghidra = join(home, "missing-ghidra");
        const java = join(home, "missing-java");
        const profile = join(home, "profile");
        const config = join(profile, "config.yaml");
        const original = configuration(version, existing);
        const before = parse(original.text, { version });
        await mkdir(profile);
        await writeFile(config, original.text);
        const run = (arguments_: readonly string[]) =>
          cli.run({
            arguments: arguments_,
            cwd: home,
            environment: {
              USERPROFILE: home,
              HERMES_HOME: profile,
              HOPPER_LAUNCHER_PATH: process.execPath,
              GHIDRA_INSTALL_DIR: ghidra,
              JAVA_HOME: java,
            },
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
        const applied = await run(setup);
        expect(applied.exitCode).toBe(0);
        expect(applied.json).toMatchObject({ status: "ready" });
        const configured = await readFile(config, "utf8");
        const parsed = parse(configured, { version });
        expect(parsed.server_defaults).toEqual(before.server_defaults);
        expect(parsed.observer).toEqual(before.observer);
        expect(parsed.mcp_servers.other).toEqual(before.mcp_servers.other);
        expect(parsed.mcp_servers.rea).toMatchObject({ enabled: true });
        if (existing)
          expect(parsed.mcp_servers.rea.env).toEqual({
            FLAG: "on",
            HOPPER_LAUNCHER_PATH: process.execPath,
            GHIDRA_INSTALL_DIR: ghidra,
            JAVA_HOME: java,
          });
        expect(configured.startsWith(original.defaults)).toBe(true);
        expect(configured).toContain("# Selected table");
        expect(configured.match(/&servers\b/gu)).toHaveLength(1);
        expect(configured.match(/&server\b/gu)).toHaveLength(1);
        expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(
          original.text,
        );
        const doctor = await run(["doctor", "--client", "hermes", "--json"]);
        expect(doctor.exitCode).toBe(0);
        expect(doctor.json).toMatchObject({
          healthy: true,
          identity: { registrations: [{ client: "hermes", state: "aligned" }] },
        });
        const repeat = await run(setup);
        expect(repeat.exitCode).toBe(0);
        expect(repeat.json).toMatchObject({
          status: "ready",
          plannedActions: [],
          appliedActions: [],
        });
        expect(await readFile(config, "utf8")).toBe(configured);
        const removed = await run(["uninstall", "--json"]);
        expect(removed.exitCode).toBe(0);
        const remaining = parse(await readFile(config, "utf8"), { version });
        expect(remaining.mcp_servers).toEqual({
          other: before.mcp_servers.other,
        });
        expect(remaining.server_defaults).toEqual(before.server_defaults);
        expect(remaining.observer).toEqual(before.observer);
      },
    );
  }
}

cliTest("Hermes still registers into an explicit table", async ({ cli }) => {
  const home = await createTestTempDirectory("rea-hermes-explicit-table-");
  const profile = join(home, "profile");
  const config = join(profile, "config.yaml");
  const original = configuration("1.1", false, false);
  await mkdir(profile);
  await writeFile(config, original.text);
  const applied = await cli.run({
    arguments: [
      "setup",
      "--client",
      "hermes",
      "--skill=false",
      "--yes",
      "--json",
    ],
    cwd: home,
    environment: {
      USERPROFILE: home,
      HERMES_HOME: profile,
      HOPPER_LAUNCHER_PATH: process.execPath,
    },
    timeoutMs: 20_000,
  });
  expect(applied.exitCode).toBe(0);
  expect(applied.json).toMatchObject({ status: "ready" });
  const parsed = parse(await readFile(config, "utf8"));
  expect(parsed.mcp_servers.other).toEqual(
    parse(original.text).mcp_servers.other,
  );
  expect(parsed.mcp_servers.rea).toMatchObject({ enabled: true });
  expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original.text);
});

for (const version of ["1.1", "1.2"] as const) {
  cliTest(
    `Hermes YAML ${version} preserves shadowed alias bindings`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-hermes-shadowed-anchor-");
      const profile = join(home, "profile");
      const config = join(profile, "config.yaml");
      const original =
        (version === "1.2" ? "%YAML 1.2\n---\n" : "") +
        "first: &server\n  command: original-server\n" +
        "server_defaults: &servers\n  other: *server\n" +
        "replacement: &server\n  command: replacement-server\n" +
        "mcp_servers: *servers\nobserver: *server\n";
      const before = parse(original, { version });
      await mkdir(profile);
      await writeFile(config, original);
      const applied = await cli.run({
        arguments: [
          "setup",
          "--client",
          "hermes",
          "--skill=false",
          "--yes",
          "--json",
        ],
        cwd: home,
        environment: {
          USERPROFILE: home,
          HERMES_HOME: profile,
          HOPPER_LAUNCHER_PATH: process.execPath,
        },
        timeoutMs: 20_000,
      });
      expect(applied.exitCode).toBe(0);
      const configured = parse(await readFile(config, "utf8"), { version });
      expect(configured.mcp_servers.other).toEqual(before.mcp_servers.other);
      expect(configured.server_defaults).toEqual(before.server_defaults);
      expect(configured.observer).toEqual(before.observer);
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    },
  );
}

cliTest(
  "Hermes uninstall detaches an aliased table before deleting REA",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-hermes-aliased-uninstall-");
    const profile = join(home, "profile");
    const config = join(profile, "config.yaml");
    await mkdir(profile);
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: {
          USERPROFILE: home,
          HERMES_HOME: profile,
          HOPPER_LAUNCHER_PATH: process.execPath,
        },
        timeoutMs: 20_000,
      });
    const [command, ...args] = currentClientRegistrationCommand({
      entrypointPath: resolve("scripts/rea.mjs"),
    });
    const entry = {
      command,
      args,
      env: { HOPPER_LAUNCHER_PATH: process.execPath },
      enabled: true,
    };
    const defaults = { rea: entry, other: { command: "other-server" } };
    const original =
      "server_defaults: &servers\n" +
      stringify(defaults)
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => `  ${line}\n`)
        .join("") +
      "mcp_servers: *servers\nobserver: *servers\n";
    await writeFile(config, original);
    await expect(access(`${config}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const doctor = await run(["doctor", "--client", "hermes", "--json"]);
    expect(doctor.exitCode, doctor.stdout).toBe(0);
    expect(doctor.json).toMatchObject({
      healthy: true,
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({
            client: "hermes",
            config_path: config,
            state: "aligned",
          }),
        ]),
      },
    });
    const removed = await run(["uninstall", "--json"]);
    expect(removed.exitCode).toBe(0);
    const remaining = parse(await readFile(config, "utf8"));
    expect(remaining.mcp_servers).toEqual({ other: defaults.other });
    expect(remaining.server_defaults).toEqual(defaults);
    expect(remaining.observer).toEqual(defaults);
    const configured = await readFile(config, "utf8");
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    expect((await run(["uninstall", "--json"])).exitCode).toBe(0);
    expect(await readFile(config, "utf8")).toBe(configured);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
  },
);

for (const original of [
  "mcp_servers: *missing\n",
  "server_defaults: &servers invalid\nmcp_servers: *servers\n",
]) {
  cliTest(
    `Hermes refuses an invalid aliased table: ${original.trim()}`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-hermes-invalid-alias-");
      const profile = join(home, "profile");
      const config = join(profile, "config.yaml");
      await mkdir(profile);
      await writeFile(config, original);
      const rejected = await cli.run({
        arguments: [
          "setup",
          "--client",
          "hermes",
          "--skill=false",
          "--yes",
          "--json",
        ],
        cwd: home,
        environment: {
          USERPROFILE: home,
          HERMES_HOME: profile,
          HOPPER_LAUNCHER_PATH: process.execPath,
        },
        timeoutMs: 20_000,
      });
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.json).toMatchObject({
        status: "needs_human",
        plannedActions: [],
        appliedActions: [],
      });
      expect(await readFile(config, "utf8")).toBe(original);
      await expect(access(`${config}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
}
