import { artifactMcpCall } from "../../../scripts/lib/artifact-e2e.mjs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "migrates an owned shebang registration and starts its generated MCP command without a runtime on PATH",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-registration-interpreter-");
    const profile = join(home, ".qwen");
    const config = join(profile, "settings.json");
    const entrypoint = resolve("scripts/rea.mjs");
    const restrictedPath = join(home, "path-without-runtime");
    await mkdir(restrictedPath);
    // Linux process ownership requires procps; no JavaScript runtime is exposed.
    if (process.platform === "linux")
      await symlink("/bin/ps", join(restrictedPath, "ps"));
    const retainedEnvironment = {
      PATH: restrictedPath,
      CALLER_SETTING: "keep exactly",
    };
    const unrelated = { command: "other-server", args: ["keep"] };
    const original = JSON.stringify({
      mcpServers: {
        rea: {
          command: entrypoint,
          args: ["mcp"],
          env: retainedEnvironment,
        },
        unrelated,
      },
    });
    await mkdir(profile);
    await writeFile(config, original);
    const environment = {
      HOME: home,
      USERPROFILE: home,
      QWEN_HOME: profile,
      PATH: restrictedPath,
      HOPPER_LAUNCHER_PATH: join(home, "missing-hopper"),
      GHIDRA_INSTALL_DIR: join(home, "missing-ghidra"),
      JAVA_HOME: join(home, "missing-java"),
    };
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: [...arguments_, "--json"],
        cwd: home,
        environment,
      });
    const doctor = await run([
      "doctor",
      "--client",
      "qwen_code",
      "--skill=false",
    ]);
    expect(doctor.exitCode, doctor.stdout).toBe(1);
    expect(doctor.json).toMatchObject({
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({ client: "qwen_code", state: "stale" }),
        ]),
      },
    });
    expect(await readFile(config, "utf8")).toBe(original);

    const setupArguments = [
      "setup",
      "--client",
      "qwen_code",
      "--skill=false",
      "--yes",
    ];
    const setup = await run(setupArguments);
    expect(setup.exitCode, setup.stdout).toBe(0);
    const configured = await readFile(config, "utf8");
    const document = z
      .object({
        mcpServers: z.object({
          rea: z.object({
            command: z.string(),
            args: z.array(z.string()),
            env: z.record(z.string(), z.string()),
          }),
          unrelated: z.unknown(),
        }),
      })
      .parse(JSON.parse(configured));
    const registration = document.mcpServers.rea;
    expect(registration).toMatchObject({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env: retainedEnvironment,
    });
    expect(document.mcpServers.unrelated).toEqual(unrelated);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);

    const transport = new StdioClientTransport({
      command: registration.command,
      args: registration.args,
      cwd: home,
      env: { ...environment, ...registration.env },
      stderr: "pipe",
    });
    const client = new Client({ name: "setup-interpreter", version: "1" });
    try {
      await client.connect(transport);
      expect(
        (await client.listTools()).tools.map(({ name }) => name),
      ).toContain("binary_session");
      const session = await artifactMcpCall(client, {
        name: "binary_session",
        arguments: {},
      });
      expect(session.isError).not.toBe(true);
      expect(session.structuredContent).toMatchObject({
        result: { open: false },
      });
    } finally {
      await client.close();
      await transport.close();
    }

    const repeated = await run(setupArguments);
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect(repeated.json).toMatchObject({
      plannedActions: [],
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(configured);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
  },
);

cliTest.skipIf(process.platform === "win32").for([
  ["rea", "rea-agents"],
  ["rea-agents", "rea"],
] as const)(
  "recognizes setup through %s when doctor and uninstall use %s",
  async ([registered, alternate], { processes }) => {
    const root = await createTestTempDirectory("rea-launcher-registration-");
    const home = join(root, "home");
    const config = join(home, ".cursor/mcp.json");
    await mkdir(join(home, ".cursor"), { recursive: true });
    const unrelated = { command: "other-server", args: [] };
    await writeFile(config, JSON.stringify({ mcpServers: { unrelated } }));
    for (const name of [registered, alternate])
      await symlink(resolve("scripts/rea.mjs"), join(root, name));
    const run = (alias: string, arguments_: readonly string[]) =>
      processes.run(process.execPath, [join(root, alias), ...arguments_], {
        cwd: home,
        env: {
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          PATH: process.env.PATH ?? "",
        },
        timeoutMs: 30_000,
      });

    const setup = await run(registered, [
      "setup",
      "--client",
      "cursor",
      "--skill=false",
      "--yes",
      "--json",
    ]);
    expect(setup.exitCode, setup.stderr).toBe(0);
    for (const alias of [registered, alternate]) {
      const doctor = await run(alias, [
        "doctor",
        "--client",
        "cursor",
        "--skill=false",
        "--json",
      ]);
      expect(doctor.exitCode, doctor.stdout).toBe(0);
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        scope_checks: expect.arrayContaining([
          expect.objectContaining({ name: "registration:cursor", ok: true }),
        ]),
      });
    }
    const uninstall = await run(alternate, ["uninstall", "--json"]);
    expect(uninstall.exitCode, uninstall.stderr).toBe(0);
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
      mcpServers: { unrelated },
    });
  },
);

cliTest.skipIf(process.platform === "win32").for([
  ["dangling", "direct"],
  ["dangling", "node"],
  ["cycle", "direct"],
  ["cycle", "node"],
] as const)(
  "retains %s launcher identity as unknown for a %s registration",
  async ([failure, form], { cli }) => {
    const home = await createTestTempDirectory("rea-unresolved-registration-");
    const directory = join(home, ".cursor");
    const config = join(directory, "mcp.json");
    await mkdir(directory);
    const launcher = join(home, "rea");
    if (failure === "dangling")
      await symlink(join(home, "removed-release.mjs"), launcher);
    else {
      await symlink(join(home, "other-alias"), launcher);
      await symlink(launcher, join(home, "other-alias"));
    }
    const command =
      form === "direct"
        ? [launcher, "mcp"]
        : [process.execPath, launcher, "mcp"];
    const original = JSON.stringify({
      mcpServers: {
        rea: { command: command[0], args: command.slice(1) },
        unrelated: { command: "other-server" },
      },
    });
    await writeFile(config, original);
    const environment = {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
    };
    const doctor = await cli.run({
      arguments: ["doctor", "--client", "cursor", "--skill=false", "--json"],
      cwd: home,
      environment,
    });
    expect(doctor.exitCode, doctor.stderr).toBe(1);
    expect(doctor.json).toMatchObject({
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({
            client: "cursor",
            state: "unknown",
            command,
            config_path: config,
            remediation: expect.stringMatching(/\S/u),
          }),
        ]),
      },
    });
    expect(await readFile(config, "utf8")).toBe(original);
    const uninstall = await cli.run({
      arguments: ["uninstall", "--json"],
      cwd: home,
      environment,
    });
    expect(uninstall.exitCode, uninstall.stderr).toBe(0);
    expect(await readFile(config, "utf8")).toBe(original);
  },
);

cliTest.skipIf(process.platform === "win32")(
  "uninstall preserves a different executable reached through symlink parent traversal",
  async ({ processes }) => {
    const root = await createTestTempDirectory(
      "rea-launcher-native-traversal-",
    );
    const home = join(root, "home");
    const config = join(home, ".cursor/mcp.json");
    await mkdir(join(home, ".cursor"), { recursive: true });
    const current = join(root, "rea");
    await symlink(resolve("scripts/rea.mjs"), current);
    const other = join(root, "other");
    await mkdir(join(other, "child"), { recursive: true });
    await writeFile(join(other, "rea"), "#!/bin/sh\nprintf foreign\n", {
      mode: 0o700,
    });
    await symlink(join(other, "child"), join(root, "link"));
    const candidate = `${root}/link/../rea`;
    expect(await readFile(candidate, "utf8")).toContain("printf foreign");
    const original = JSON.stringify({
      mcpServers: {
        rea: { command: candidate, args: ["mcp"] },
        unrelated: { command: "other-server" },
      },
    });
    await writeFile(config, original);
    const run = (arguments_: readonly string[]) =>
      processes.run(process.execPath, [current, ...arguments_], {
        cwd: home,
        env: {
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          PATH: process.env.PATH ?? "",
        },
        timeoutMs: 30_000,
      });
    const uninstall = await run(["uninstall", "--json"]);
    expect(uninstall.exitCode, uninstall.stderr).toBe(0);
    expect(await readFile(config, "utf8")).toBe(original);
    const doctor = await run([
      "doctor",
      "--client",
      "cursor",
      "--skill=false",
      "--json",
    ]);
    expect(doctor.exitCode, doctor.stderr).toBe(1);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({
            client: "cursor",
            command: [candidate, "mcp"],
            state: "unknown",
          }),
        ]),
      },
    });
  },
);
