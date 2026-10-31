import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect } from "vitest";
import { z } from "zod";

import { COMPACT_INPUT_SCHEMA_BUDGET_BYTES } from "../../../src/config/mcpInputSchemaProfile.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

for (const [setting, profile] of [
  ["REA_MCP_INPUT_SCHEMA_PROFILE", ""],
  ["REA_MCP_INPUT_SCHEMA_PROFILE", "bogus"],
  ["REA_MCP_OUTPUT_SCHEMA_PROFILE", ""],
  ["REA_MCP_OUTPUT_SCHEMA_PROFILE", "bogus"],
] as const)
  cliTest(
    `setup and doctor refuse an invalid retained ${setting} value ${JSON.stringify(profile)}`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-pi-invalid-profile-cli-");
      const agent = join(home, ".pi", "agent");
      const config = join(agent, "mcp.json");
      const original = JSON.stringify({
        mcpServers: {
          rea: {
            type: "stdio",
            command: "rea",
            args: ["mcp"],
            env: { [setting]: profile },
          },
        },
      });
      await mkdir(agent, { recursive: true });
      await writeFile(config, original);
      const environment = {
        HOME: home,
        USERPROFILE: home,
        HOPPER_LAUNCHER_PATH: join(home, "unconfigured-hopper"),
      };
      const setup = await cli.run({
        arguments: [
          "setup",
          "--client",
          "pi",
          "--skill=false",
          "--yes",
          "--json",
        ],
        cwd: home,
        environment,
      });
      expect(setup.exitCode).toBe(1);
      expect(setup.json).toMatchObject({
        status: "needs_human",
        plannedActions: [],
        appliedActions: [],
        remediation: expect.stringContaining(setting),
      });
      const doctor = await cli.run({
        arguments: ["doctor", "--client", "pi", "--json"],
        cwd: home,
        environment,
      });
      expect(doctor.exitCode).toBe(1);
      expect(doctor.json).toMatchObject({
        healthy: false,
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({ client: "pi", state: "invalid" }),
          ]),
        },
      });
      expect(await readFile(config, "utf8")).toBe(original);
      await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

cliTest(
  "setup preserves a configured compact catalog through CLI migration and MCP startup",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-pi-environment-cli-");
    const agent = join(home, ".pi", "agent");
    const config = join(agent, "mcp.json");
    const custom = {
      REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
      REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
      REA_LOG_LEVEL: "silent",
    };
    const original = JSON.stringify({
      mcpServers: {
        rea: {
          type: "stdio",
          command: "npx",
          args: ["-y", "rea-agents@1.0.0", "mcp"],
          env: custom,
        },
      },
    });
    await mkdir(agent, { recursive: true });
    await writeFile(config, original);
    const environment = {
      HOME: home,
      USERPROFILE: home,
      HOPPER_LAUNCHER_PATH: join(home, "unconfigured-hopper"),
    };
    const arguments_ = [
      "setup",
      "--client",
      "pi",
      "--skill=false",
      "--yes",
      "--json",
    ];
    const planned = await cli.run({
      arguments: [...arguments_, "--dry-run"],
      cwd: home,
      environment,
    });
    expect(planned.exitCode).toBe(0);
    expect(planned.json).toMatchObject({
      plannedActions: [
        expect.objectContaining({
          id: "configure_client:pi",
          detail: expect.stringContaining(
            "Existing server environment overrides are retained",
          ),
        }),
      ],
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(original);
    const applied = await cli.run({
      arguments: arguments_,
      cwd: home,
      environment,
      timeoutMs: 20_000,
    });
    expect(applied.exitCode).toBe(0);
    expect(applied.json).toMatchObject({
      status: "ready",
      clients: { pi: { status: "configured" } },
    });
    const configured = await readFile(config, "utf8");
    const registration = z
      .object({
        mcpServers: z.object({
          rea: z.object({
            command: z.string(),
            args: z.array(z.string()),
            env: z.record(z.string(), z.string()).optional(),
          }),
        }),
      })
      .parse(JSON.parse(configured)).mcpServers.rea;
    const transport = new StdioClientTransport({
      command: registration.command,
      args: registration.args,
      cwd: home,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        ...environment,
        ...registration.env,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "setup-environment", version: "1" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(
        tools
          .filter(
            ({ inputSchema }) =>
              Buffer.byteLength(JSON.stringify(inputSchema), "utf8") >
              COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
          )
          .map(({ name }) => name),
      ).toEqual([]);
      expect(await client.ping()).toEqual({});
    } finally {
      await client.close();
      await transport.close();
    }
    expect(registration.env).toMatchObject(custom);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    const repeated = await cli.run({
      arguments: arguments_,
      cwd: home,
      environment,
      timeoutMs: 20_000,
    });
    expect(repeated.exitCode).toBe(0);
    expect(repeated.json).toMatchObject({
      plannedActions: [],
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(configured);
  },
);

cliTest(
  "Pi public CLI plans, requires approval, applies, diagnoses, repeats, and uninstalls only owned content",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-pi-cli-");
    const agent = join(home, "custom-agent");
    const config = join(agent, "mcp.json");
    const skill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const original =
      '{ "mcpServers": { "other": { "command": "other-server" } }, "autoEnableCodemode": false }\n';
    await mkdir(agent);
    await writeFile(config, original);
    const cliPath = resolve("scripts/rea.mjs");
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          HOPPER_LAUNCHER_PATH: join(home, "unconfigured-hopper"),
          PI_CODING_AGENT_DIR: "custom-agent",
          OMP_PROFILE: "work",
          PI_PROFILE: "legacy",
          PI_CONFIG_DIR: ".omp-other",
        },
        timeoutMs: 20_000,
      });

    const planned = await run([
      "setup",
      "--client",
      "pi",
      "--dry-run",
      "--json",
    ]);
    expect(planned.exitCode).toBe(0);
    expect(planned.json).toMatchObject({
      status: "planned",
      plannedActions: [
        {
          id: "configure_client:pi",
          label: "Pi",
          target: join("custom-agent", "mcp.json"),
          operation: "update",
        },
        { id: "install_skill" },
      ],
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(skill)).rejects.toMatchObject({ code: "ENOENT" });

    const unapproved = await run(["setup", "--client", "pi", "--json"]);
    expect(unapproved.json).toMatchObject({
      status: "needs_confirmation",
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(original);

    const applied = await run(["setup", "--client", "pi", "--yes", "--json"]);
    expect(applied.exitCode).toBe(0);
    expect(applied.json).toMatchObject({
      status: "ready",
      clients: { pi: { status: "configured" } },
      appliedActions: ["configured_pi", "installed_skill"],
    });
    const configured = await readFile(config, "utf8");
    expect(JSON.parse(configured)).toMatchObject({
      mcpServers: {
        other: { command: "other-server" },
        rea: {
          type: "stdio",
          command: process.execPath,
          args: [cliPath, "mcp"],
        },
      },
      autoEnableCodemode: false,
    });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(skill, "utf8")).toContain(
      "reverse-engineer-anything",
    );

    const doctor = await run(["doctor", "--client", "pi", "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json).toMatchObject({
      healthy: true,
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({ client: "pi", state: "aligned" }),
        ]),
      },
    });

    const repeat = await run(["setup", "--client", "pi", "--yes", "--json"]);
    expect(repeat.exitCode).toBe(0);
    expect(repeat.json).toMatchObject({
      status: "ready",
      plannedActions: [],
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(configured);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);

    // Uninstall is global; there is no --client or --yes on this CLI surface.
    const help = await run(["uninstall", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--purge-data");
    const removed = await run(["uninstall", "--json"]);
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual(
      JSON.parse(original),
    );
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    await expect(readFile(skill)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

cliTest(
  "Pi public CLI creates missing strict-JSON configuration and never repairs a malformed file",
  async ({ cli }) => {
    const created = await createTestTempDirectory("rea-pi-cli-strict-");
    const agent = join(created, "custom-agent");
    const config = join(agent, "mcp.json");
    await mkdir(agent);
    const runIn = (home: string) => (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          HOPPER_LAUNCHER_PATH: join(home, "unconfigured-hopper"),
          PI_CODING_AGENT_DIR: "custom-agent",
        },
        timeoutMs: 20_000,
      });
    const run = runIn(created);
    const setup = await run(["setup", "--client", "pi", "--yes", "--json"]);
    expect(setup.exitCode).toBe(0);
    expect(setup.json).toMatchObject({
      status: "ready",
      clients: { pi: { status: "configured" } },
    });
    const text = await readFile(config, "utf8");
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toMatchObject({
      mcpServers: { rea: { type: "stdio" } },
    });
    const doctor = await run(["doctor", "--client", "pi", "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json).toMatchObject({
      healthy: true,
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({ client: "pi", state: "aligned" }),
        ]),
      },
    });
    await run(["uninstall", "--json"]);
    expect(
      JSON.parse(await readFile(config, "utf8")).mcpServers.rea,
    ).toBeUndefined();

    const blocked = await createTestTempDirectory("rea-pi-cli-malformed-");
    const malformedPath = join(blocked, "custom-agent", "mcp.json");
    await mkdir(join(blocked, "custom-agent"));
    const malformed = `{ // Pi loads strict JSON only\n"mcpServers": { "other": { "command": "other" } }\n}\n`;
    await writeFile(malformedPath, malformed);
    const runMalformed = runIn(blocked);
    const plan = await runMalformed([
      "setup",
      "--client",
      "pi",
      "--dry-run",
      "--json",
    ]);
    expect(plan.exitCode).not.toBe(0);
    expect(plan.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      appliedActions: [],
      remediation: expect.stringContaining("malformed"),
    });
    const applied = await runMalformed([
      "setup",
      "--client",
      "pi",
      "--yes",
      "--json",
    ]);
    expect(applied.exitCode).not.toBe(0);
    expect(applied.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      appliedActions: [],
    });
    expect(await readFile(malformedPath, "utf8")).toBe(malformed);
    await expect(readFile(`${malformedPath}.rea.backup`)).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
    const doctorMalformed = await runMalformed([
      "doctor",
      "--client",
      "pi",
      "--json",
    ]);
    expect(doctorMalformed.exitCode).not.toBe(0);
    expect(doctorMalformed.json).toMatchObject({
      healthy: false,
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({ client: "pi", state: "invalid" }),
        ]),
      },
    });
    const removed = await runMalformed(["uninstall", "--json"]);
    expect(removed.exitCode).not.toBe(0);
    expect(removed.json).toMatchObject({
      status: "failed",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "pi", status: "failed" }),
      ]),
    });
    expect(await readFile(malformedPath, "utf8")).toBe(malformed);
  },
);

cliTest(
  "malformed Pi overrides do not block selected Codex setup or doctor and never fall back for Pi",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-pi-invalid-cli-");
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          HOPPER_LAUNCHER_PATH: join(home, "unconfigured-hopper"),
          PI_CODING_AGENT_DIR: "file:///agent%2fdir",
        },
        timeoutMs: 20_000,
      });
    const plan = await run([
      "setup",
      "--client",
      "codex",
      "--dry-run",
      "--json",
    ]);
    expect(plan.exitCode).toBe(0);
    expect(plan.json).toMatchObject({ status: "planned", appliedActions: [] });
    expect(await readdir(home)).toEqual([]);

    const rejected = await run(["setup", "--client", "pi", "--yes", "--json"]);
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      appliedActions: [],
      remediation: expect.stringContaining("PI_CODING_AGENT_DIR"),
    });
    expect(await readdir(home)).toEqual([]);

    const applied = await run([
      "setup",
      "--client",
      "codex",
      "--yes",
      "--json",
    ]);
    expect(applied.exitCode).toBe(0);
    expect(applied.json).toMatchObject({
      status: "ready",
      clients: { codex: { status: "configured" } },
    });
    const doctor = await run(["doctor", "--client", "codex", "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json).toMatchObject({
      healthy: true,
      identity: {
        registrations: [
          { client: "codex", state: "aligned" },
          {
            client: "pi",
            state: "invalid",
            remediation: expect.stringContaining("PI_CODING_AGENT_DIR"),
          },
        ],
      },
    });
    const piDoctor = await run(["doctor", "--client", "pi", "--json"]);
    expect(piDoctor.exitCode).not.toBe(0);
    expect(piDoctor.json).toMatchObject({ healthy: false });
    expect((await readdir(home)).sort()).toEqual([".agents", ".codex"]);
  },
);
