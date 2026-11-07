import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";

import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  codexToolPolicy,
  codexToolPolicySource,
} from "../../fixtures/codexToolPolicy.js";

it.each(["tables", "inline table"] as const)(
  "preserves Codex %s policy and status through refresh",
  async (layout) => {
    const home = await createTestTempDirectory("rea-codex-policy-refresh-");
    const configPath = join(home, ".codex/config.toml");
    await mkdir(dirname(configPath));
    const original = codexToolPolicySource(layout);
    await writeFile(configPath, original);
    const client = { name: "codex", configPath, format: "toml" } as const;
    const status = async () =>
      (
        await readClientRegistrationStatuses(home, undefined, {
          environment: {},
        })
      ).find(({ client }) => client === "codex");
    expect(await status()).toMatchObject({ state: "aligned" });
    expect(
      await inspectClientConfiguration(
        client,
        {},
        currentClientRegistrationCommand(),
      ),
    ).toEqual({ status: "already_current" });
    const overrides = { REA_MCP_INPUT_SCHEMA_PROFILE: "full" };
    expect(
      await configureClientConfiguration(
        client,
        overrides,
        currentClientRegistrationCommand(),
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(
      parseToml(configured, { integersAsBigInt: "asNeeded" }),
    ).toMatchObject({
      mcp_servers: {
        rea: {
          ...codexToolPolicy,
          startup_timeout_sec: 19,
          tool_timeout_sec: 999,
          env: { CALLER_SETTING: "kept exactly", ...overrides },
        },
      },
    });
    expect(await status()).toMatchObject({ state: "aligned" });
    expect(
      await configureClientConfiguration(
        client,
        overrides,
        currentClientRegistrationCommand(),
      ),
    ).toEqual({ status: "unchanged" });
    expect(await readFile(configPath, "utf8")).toBe(configured);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  },
);

it.each([
  ['tools = ["binary_session"]', "tools"],
  ["tools = { binary_session = true }", "tools.binary_session"],
  [
    'tools = { binary_session = { approval_mode = "unknown" } }',
    "tools.binary_session.approval_mode",
  ],
  [
    "tools = { binary_session = { output_token_limit = -1 } }",
    "tools.binary_session.output_token_limit",
  ],
  ['default_tools_approval_mode = "unknown"', "default_tools_approval_mode"],
  ["enabled_tools = true", "enabled_tools"],
] as const)(
  "blocks malformed Codex policy %s before writes",
  async (setting, field) => {
    const home = await createTestTempDirectory("rea-codex-invalid-policy-");
    const configPath = join(home, ".codex/config.toml");
    await mkdir(dirname(configPath));
    const original = [
      "[mcp_servers.rea]",
      'command = "npx"',
      `args = ["-y", "${PRODUCT_IDENTITY.registrationPackageSpecifier}", "mcp"]`,
      "startup_timeout_sec = 30",
      "tool_timeout_sec = 450",
      setting,
      "",
    ].join("\n");
    await writeFile(configPath, original);
    const client = { name: "codex", configPath, format: "toml" } as const;
    const inspection = await inspectClientConfiguration(
      client,
      {},
      currentClientRegistrationCommand(),
    );
    expect(inspection).toMatchObject({
      status: "invalid",
      remediation: expect.stringContaining(field),
    });
    expect(
      await configureClientConfiguration(
        client,
        {},
        currentClientRegistrationCommand(),
      ),
    ).toEqual({ status: "failed", reason: "readback" });
    const statuses = await readClientRegistrationStatuses(home, undefined, {
      environment: {},
    });
    expect(statuses.find(({ client }) => client === "codex")).toMatchObject({
      state: "invalid",
      remediation: expect.stringContaining(field),
    });
    expect(await readFile(configPath, "utf8")).toBe(original);
    expect(await readdir(dirname(configPath))).toEqual(["config.toml"]);
  },
);

it.each([{ tools: ["binary_session"] }, { tools: ["*"] }, { tools: [] }])(
  "preserves Copilot's tool selection $tools through refresh",
  async ({ tools }) => {
    const home = await createTestTempDirectory("rea-copilot-tools-policy-");
    const configPath = join(home, ".copilot/mcp-config.json");
    await mkdir(dirname(configPath));
    const command = currentClientRegistrationCommand();
    const original = JSON.stringify({
      mcpServers: {
        rea: {
          command: command[0],
          args: command.slice(1),
          type: "stdio",
          tools,
          future_policy: { requireReview: true },
        },
      },
    });
    await writeFile(configPath, original);
    const client = {
      name: "copilot_cli",
      configPath,
      format: "copilot_cli",
    } as const;
    const status = async () =>
      (
        await readClientRegistrationStatuses(home, undefined, {
          environment: {},
        })
      ).find(({ client }) => client === "copilot_cli");
    expect(await status()).toMatchObject({ state: "aligned" });
    const overrides = { REA_MCP_INPUT_SCHEMA_PROFILE: "compact" };
    expect(
      await configureClientConfiguration(client, overrides, command),
    ).toMatchObject({ status: "configured" });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      mcpServers: {
        rea: {
          type: "stdio",
          tools,
          future_policy: { requireReview: true },
        },
      },
    });
    expect(
      await configureClientConfiguration(client, overrides, command),
    ).toEqual({ status: "unchanged" });
    expect(await status()).toMatchObject({ state: "aligned" });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  },
);
