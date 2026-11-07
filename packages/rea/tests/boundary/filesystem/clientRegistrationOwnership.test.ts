import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { expect, it } from "vitest";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const codexSource = (invalid: string): string =>
  [
    'caller_root = "keep"',
    "[mcp_servers.rea]",
    `command = "${PRODUCT_IDENTITY.cliBinary}"`,
    'args = ["mcp"]',
    invalid,
    "[mcp_servers.peer]",
    'command = "peer"',
    "args = []",
    "",
  ].join("\n");

it.each([
  {
    client: "codex",
    path: ".codex/config.toml",
    invalid: "invalid tool policy",
    source: codexSource('enabled_tools = "not-an-array"'),
    parse: (text: string): unknown => parseToml(text),
    remaining: {
      caller_root: "keep",
      mcp_servers: { peer: { command: "peer", args: [] } },
    },
  },
  {
    client: "codex",
    path: ".codex/config.toml",
    invalid: "a nonpositive startup timeout",
    source: codexSource("startup_timeout_sec = 0"),
    parse: (text: string): unknown => parseToml(text),
    remaining: {
      caller_root: "keep",
      mcp_servers: { peer: { command: "peer", args: [] } },
    },
  },
  {
    client: "opencode",
    path: ".config/opencode/opencode.json",
    invalid: "a non-string environment value",
    source: JSON.stringify({
      caller_root: "keep",
      mcp: {
        servers: {
          rea: {
            type: "local",
            command: [PRODUCT_IDENTITY.cliBinary, "mcp"],
            environment: { CALLER_SETTING: 42 },
          },
          peer: { type: "local", command: ["peer"] },
        },
      },
    }),
    parse: (text: string): unknown => JSON.parse(text),
    remaining: {
      caller_root: "keep",
      mcp: { servers: { peer: { type: "local", command: ["peer"] } } },
    },
  },
])(
  "removes the owned $client registration despite $invalid",
  async (sample) => {
    const home = await createTestTempDirectory("rea-registration-ownership-");
    const configPath = join(home, sample.path);
    const environment = {
      CODEX_HOME: join(home, ".codex"),
      XDG_CONFIG_HOME: join(home, ".config"),
    };
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, sample.source);
    const statuses = await readClientRegistrationStatuses(home, undefined, {
      environment,
    });
    expect(
      statuses.find(({ client }) => client === sample.client),
    ).toMatchObject({
      state: "invalid",
    });
    const host = systemUninstallHost(home, undefined, environment);
    try {
      const client = (await host.clients()).find(
        (client) =>
          client.name === sample.client && client.configPath === configPath,
      );
      if (client === undefined)
        throw new Error("Expected the configured client");
      expect(await host.removeClient(client)).toMatchObject({
        name: sample.client,
        status: "removed",
      });
      expect(sample.parse(await readFile(configPath, "utf8"))).toEqual(
        sample.remaining,
      );
      expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(
        sample.source,
      );
    } finally {
      expect(await host.close?.()).toBeUndefined();
    }
  },
);

it("retains an OpenCode remote registration with a REA-like command", async () => {
  const home = await createTestTempDirectory("rea-registration-remote-owner-");
  const configPath = join(home, ".config/opencode/opencode.json");
  const environment = { XDG_CONFIG_HOME: join(home, ".config") };
  const source = JSON.stringify({
    caller_root: "keep",
    mcp: {
      servers: {
        rea: {
          type: "remote",
          url: "https://caller.example/mcp",
          command: [PRODUCT_IDENTITY.cliBinary, "mcp"],
        },
        peer: { type: "local", command: ["peer"] },
      },
    },
  });
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, source);
  const statuses = await readClientRegistrationStatuses(home, undefined, {
    environment,
  });
  expect(statuses.find(({ client }) => client === "opencode")).toMatchObject({
    state: "invalid",
  });
  const host = systemUninstallHost(home, undefined, environment);
  try {
    const client = (await host.clients()).find(
      (client) =>
        client.name === "opencode" && client.configPath === configPath,
    );
    if (client === undefined) throw new Error("Expected the configured client");
    expect(await host.removeClient(client)).toMatchObject({
      name: "opencode",
      status: "retained",
    });
    expect(await readFile(configPath, "utf8")).toBe(source);
    expect(await readdir(dirname(configPath))).toEqual(["opencode.json"]);
  } finally {
    expect(await host.close?.()).toBeUndefined();
  }
});
