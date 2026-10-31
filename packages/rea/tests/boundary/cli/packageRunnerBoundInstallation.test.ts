import {
  access,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import { expect } from "vitest";
import { z } from "zod";
import { npmInvocation } from "../../../scripts/lib/npm-invocation.mjs";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const registrationSchema = z.object({
  mcpServers: z.object({
    rea: z.object({ command: z.string(), args: z.array(z.string()) }),
  }),
});

cliTest.skipIf(process.platform === "win32")(
  "real offline npm setup binds an installation across project starts and cache restoration",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-real-npm-binding-");
    const home = join(root, "home"),
      trusted = join(root, "trusted"),
      project = join(root, "project");
    for (const path of [
      home,
      trusted,
      join(project, "node_modules", ".bin"),
      join(project, "node_modules", PRODUCT_IDENTITY.packageName),
    ])
      await mkdir(path, { recursive: true });
    const environment = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      npm_config_cache: join(root, "cache"),
      npm_config_prefix: join(root, "prefix"),
      npm_config_userconfig: join(root, "user.npmrc"),
      npm_config_globalconfig: join(root, "global.npmrc"),
      npm_config_update_notifier: "false",
    };
    const npm = npmInvocation(
      [
        "exec",
        "--offline",
        "--ignore-scripts",
        "--yes",
        `--package=file:${resolve(".")}`,
        "--",
        "rea",
        "setup",
        "--client",
        "omp",
        "--no-skill",
        "--yes",
        "--json",
      ],
      environment,
    );
    const setup = await processes.run(npm.command, npm.arguments, {
      cwd: trusted,
      env: environment,
      timeoutMs: 30_000,
    });
    expect(setup.exitCode, setup.stderr).toBe(0);
    const configPath = join(home, ".omp", "agent", "mcp.json");
    const original = await readFile(configPath, "utf8");
    const registration = registrationSchema.parse(JSON.parse(original))
      .mcpServers.rea;
    const alias = registration.args[0];
    expect(alias).toBeDefined();
    if (alias === undefined) throw new Error("Missing registered entrypoint");
    // Only remove an alias in this test's owned cache, never the source installation.
    expect(alias.startsWith(join(root, "cache") + "/")).toBe(true);
    expect(registration.args.slice(1)).toEqual(["mcp"]);
    const marker = join(root, "project-candidate-called");
    const candidate = join(
      project,
      "node_modules",
      PRODUCT_IDENTITY.packageName,
    );
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        name: "owned-registration-project",
        version: "1.0.0",
        dependencies: {
          [PRODUCT_IDENTITY.packageName]: PRODUCT_IDENTITY.packageVersion,
        },
      }),
    );
    await writeFile(
      join(candidate, "package.json"),
      JSON.stringify({
        name: PRODUCT_IDENTITY.packageName,
        version: PRODUCT_IDENTITY.packageVersion,
        bin: { rea: "candidate.cjs" },
      }),
    );
    await writeFile(
      join(candidate, "candidate.cjs"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected');\n`,
      { mode: 0o700 },
    );
    await symlink(
      `../${PRODUCT_IDENTITY.packageName}/candidate.cjs`,
      join(project, "node_modules", ".bin", "rea"),
    );
    await writeFile(join(project, ".npmrc"), "registry=http://127.0.0.1:9/\n");
    const clientEnvironment = {
      ...getDefaultEnvironment(),
      HOME: home,
      PATH: [
        join(project, "node_modules", ".bin"),
        process.env.PATH ?? "",
      ].join(delimiter),
    };
    const connect = async () => {
      const transport = new StdioClientTransport({
        ...registration,
        cwd: project,
        env: clientEnvironment,
        stderr: "pipe",
      });
      const client = new Client({
        name: "real-npm-registration",
        version: "1",
      });
      try {
        await client.connect(transport);
        expect(client.getServerVersion()?.version).toBe(
          PRODUCT_IDENTITY.packageVersion,
        );
        const status = await client.callTool({
          name: "binary_session",
          arguments: {},
        });
        expect(status.isError).not.toBe(true);
        expect(status.structuredContent).toMatchObject({
          result: { open: false },
        });
      } finally {
        await client.close();
        await transport.close();
      }
    };
    await connect();
    await rename(alias, `${alias}.removed`);
    try {
      const missing = await processes.run(
        registration.command,
        registration.args,
        { cwd: project, env: clientEnvironment, timeoutMs: 10_000 },
      );
      expect(missing.exitCode).not.toBe(0);
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rename(`${alias}.removed`, alias);
    }
    await connect();
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  },
  60_000,
);

cliTest.skipIf(process.platform === "win32")(
  "mcp add preserves a selected entrypoint with spaces and both quote characters",
  async ({ processes }) => {
    const home = await createTestTempDirectory("rea-amp-command-");
    const bin = join(home, `bin 'quoted' "double"`);
    await mkdir(bin);
    const alias = join(bin, "rea");
    await symlink(resolve("scripts/rea.mjs"), alias);
    const result = await processes.run(
      process.execPath,
      [alias, "mcp", "add", "--agent", "amp"],
      {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          PATH: [bin, process.env.PATH ?? ""].join(delimiter),
        },
        timeoutMs: 20_000,
      },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const settings = z
      .object({
        "amp.mcpServers": z.object({
          rea: z.object({ command: z.string(), args: z.array(z.string()) }),
        }),
      })
      .parse(
        JSON.parse(
          await readFile(join(home, ".config", "amp", "settings.json"), "utf8"),
        ),
      );
    expect(settings["amp.mcpServers"].rea.args).toEqual([alias, "mcp"]);
    const start = await processes.run(
      settings["amp.mcpServers"].rea.command,
      [alias, "--version"],
      { cwd: home, timeoutMs: 10_000 },
    );
    expect(start.exitCode, start.stderr).toBe(0);
    expect(start.stdout).toContain(PRODUCT_IDENTITY.packageVersion);
  },
);
