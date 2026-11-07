import {
  chmod,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const cases = [
  {
    client: "cursor",
    path: ".cursor/mcp.json",
    text: "malformed UTF-8",
    bytes: Buffer.concat([
      Buffer.from('{"label":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]),
    diagnostic: "not valid UTF-8",
  },
  {
    client: "cursor",
    path: ".cursor/mcp.json",
    text: "[]",
    diagnostic: "The configuration root must be an object",
  },
  {
    client: "cursor",
    path: ".cursor/mcp.json",
    text: "null",
    diagnostic: "The configuration root must be an object",
  },
  {
    client: "cursor",
    path: ".cursor/mcp.json",
    text: '{"mcpServers":null,"keep":1}',
    diagnostic: '"mcpServers" must be an object',
  },
  {
    client: "cursor",
    path: ".cursor/mcp.json",
    text: '{"mcpServers":"x","keep":1}',
    diagnostic: '"mcpServers" must be an object',
  },
  {
    client: "pi",
    path: ".pi/agent/mcp.json",
    text: '{"mcpServers":[]}',
    diagnostic: '"mcpServers" must be an object',
  },
  {
    client: "codex",
    path: ".codex/config.toml",
    text: 'mcp_servers = "x"\n',
    diagnostic: '"mcp_servers" must be an object',
  },
  {
    client: "opencode",
    path: ".config/opencode/opencode.json",
    text: '{"mcp":{"servers":null}}',
    diagnostic: '"mcp.servers" must be an object',
  },
  {
    client: "hermes",
    path: ".hermes/config.yaml",
    text: "- item\n",
    diagnostic: "The configuration root must be an object",
  },
  {
    client: "hermes",
    path: ".hermes/config.yaml",
    text: "mcp_servers: null\nkeep: 1\n",
    diagnostic: '"mcp_servers" must be an object',
  },
  {
    client: "cursor",
    path: ".cursor/mcp.json",
    text: "not-json",
    diagnostic: "Configuration is not valid JSON",
    syntax: "JSON",
  },
  {
    client: "hermes",
    path: ".hermes/config.yaml",
    text: "mcp_servers: [\n",
    diagnostic: "Configuration is not valid YAML",
    syntax: "YAML",
  },
  {
    client: "dsh",
    path: ".dsh/cordis.patch.yml",
    text: "- insert: [\n",
    diagnostic: "Invalid or unsupported Cordis YAML",
    syntax: "YAML",
  },
] as const;

for (const scenario of cases)
  cliTest(
    `setup and uninstall explain ${scenario.client} configuration ${scenario.text}`,
    async ({ cli }) => {
      const home = await createTestTempDirectory(
        "rea-client-config-diagnostic-",
      );
      const config = join(home, scenario.path);
      await mkdir(dirname(config), { recursive: true });
      const original =
        "bytes" in scenario ? scenario.bytes : Buffer.from(scenario.text);
      await writeFile(config, original);
      const environment = {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        HERMES_HOME: join(home, ".hermes"),
        DSH_HOME: join(home, ".dsh"),
      };
      const setup = await cli.run({
        arguments: [
          "setup",
          "--client",
          scenario.client,
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
      });
      if ("syntax" in scenario) {
        expect(setup.json).toMatchObject({
          remediation: expect.stringMatching(/\S/u),
        });
        if (scenario.syntax === "JSON")
          expect(setup.stdout).toContain("Invalid JSON/JSONC");
      } else {
        expect(setup.json).toMatchObject({
          remediation: expect.stringContaining(scenario.diagnostic),
        });
        expect(setup.stdout).not.toContain("invalid_type");
      }
      const uninstall = await cli.run({
        arguments: ["uninstall", "--json"],
        cwd: home,
        environment,
      });
      expect(uninstall.exitCode).toBe(1);
      expect(uninstall.json).toMatchObject({
        status: "failed",
        items: expect.arrayContaining([
          expect.objectContaining({
            name: scenario.client,
            status: "failed",
            detail: expect.stringContaining(scenario.diagnostic),
          }),
        ]),
      });
      if (!("syntax" in scenario))
        expect(uninstall.stdout).not.toContain("not valid JSON");
      expect(Buffer.compare(await readFile(config), original)).toBe(0);
      expect(await readdir(dirname(config))).toEqual([
        scenario.path.split("/").at(-1),
      ]);
    },
  );

cliTest.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "doctor reports an unreadable configuration symlink without changing it",
  async ({ cli }) => {
    const home = await createTestTempDirectory(
      "rea-doctor-denied-registration-",
    );
    const locked = join(home, "owned-denied");
    const target = join(locked, "client.json");
    await mkdir(locked);
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n';
    await writeFile(target, original);
    const config = join(home, ".claude.json");
    await symlink(target, config);
    await chmod(locked, 0);
    try {
      const result = await cli.run({
        arguments: [
          "doctor",
          "--client",
          "claude_code",
          "--skill=false",
          "--json",
        ],
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, ".config"),
        },
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        healthy: false,
        identity: {
          registrations: [
            expect.objectContaining({
              client: "claude_code",
              config_path: config,
              state: "invalid",
              command: [],
            }),
          ],
        },
      });
    } finally {
      await chmod(locked, 0o700);
    }
    expect(await readFile(target, "utf8")).toBe(original);
    expect((await readdir(home)).sort()).toEqual([
      ".claude.json",
      "owned-denied",
    ]);
  },
);
