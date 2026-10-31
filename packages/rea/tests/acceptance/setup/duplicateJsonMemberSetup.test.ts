import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const assertSelectedLauncher = async (value: unknown) => {
  const [runtime, entrypoint] = z
    .tuple([z.string(), z.string(), z.literal("mcp")])
    .parse(value);
  expect(isAbsolute(runtime)).toBe(true);
  expect(isAbsolute(entrypoint)).toBe(true);
  expect(await realpath(runtime)).toBe(await realpath(process.execPath));
  expect(await realpath(entrypoint)).toBe(
    await realpath(resolve("scripts/rea.mjs")),
  );
};

// JSON.parse, JSONC parse, and native Claude Code read the last duplicate.
const shadowParent = '"mcpServers": {"shadow": {"command": "/usr/bin/false"}},';
const shadowLeaf = '"rea": {"command": "/usr/bin/false"},';
const owned =
  '"rea": {"command": "npx", "args": ["-y", "rea-agents@6.6.0", "mcp"]}';

const runIn = (cli: TestCli, home: string) => (arguments_: readonly string[]) =>
  cli.run({
    arguments: arguments_,
    cwd: home,
    environment: {
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: home,
      XDG_CONFIG_HOME: join(home, ".config"),
    },
  });

const setupArguments = (client: string) =>
  ["setup", "--client", client, "--skill=false", "--json", "--yes"] as const;

const openCodeOwned =
  '{"type":"local","command":["npx","-y","rea-agents@6.6.0","mcp"]}';
const openCodeForeign = '{"type":"local","command":["/usr/bin/false"]}';

const writeConfiguration = async (path: string, text: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
};

for (const [layout, original] of [
  [
    "a repeated server table",
    `{\n  ${shadowParent}\n  "mcpServers": {"peer": {"command": "/usr/bin/true"}}\n}\n`,
  ],
  ["a repeated rea member", `{\n  "mcpServers": {${shadowLeaf} ${owned}}\n}\n`],
] as const)
  cliTest(
    `Claude Code setup edits the effective member of ${layout}`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-json-duplicate-");
      const config = join(home, ".claude.json");
      await writeFile(config, original);
      const run = runIn(cli, home);

      const setup = await run(setupArguments("claude_code"));
      expect(setup.exitCode, setup.stdout).toBe(0);
      expect(setup.json).toMatchObject({
        status: "ready",
        clients: { claude_code: { status: "configured" } },
      });
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
      const configured = await readFile(config, "utf8");
      expect(configured).toContain(
        layout === "a repeated server table" ? shadowParent : shadowLeaf,
      );
      const registration = z
        .object({
          mcpServers: z.object({
            rea: z.object({ command: z.string(), args: z.array(z.string()) }),
          }),
        })
        .parse(JSON.parse(configured)).mcpServers.rea;
      await assertSelectedLauncher([
        registration.command,
        ...registration.args,
      ]);

      const repeated = await run(setupArguments("claude_code"));
      expect(repeated.exitCode, repeated.stdout).toBe(0);
      expect(repeated.json).toMatchObject({
        status: "ready",
        plannedActions: [],
      });
      expect(await readFile(config, "utf8")).toBe(configured);
    },
  );

cliTest(
  "JSONC setup keeps comments and the shadowed server table",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-jsonc-duplicate-");
    await mkdir(join(home, ".cursor"));
    const config = join(home, ".cursor", "mcp.json");
    const head = `{\n  // shadowed table\n  ${shadowParent}\n  /* effective table */\n`;
    await writeFile(
      config,
      `${head}  "mcpServers": {\n    "peer": {"command": "/usr/bin/true"} // peer\n  }\n}\n`,
    );

    const setup = await runIn(cli, home)(setupArguments("cursor"));
    expect(setup.exitCode, setup.stdout).toBe(0);
    expect(setup.json).toMatchObject({
      clients: { cursor: { status: "configured" } },
    });
    const configured = await readFile(config, "utf8");
    expect(configured.startsWith(head)).toBe(true);
    expect(configured).toContain("// peer");
    expect(configured.indexOf('"rea"')).toBeGreaterThan(head.length);
  },
);

cliTest(
  "uninstall removes an owned registration from the effective server table",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-json-duplicate-");
    const config = join(home, ".claude.json");
    const original = `{\n  ${shadowParent}\n  "mcpServers": {"peer": {"command": "/usr/bin/true"}, ${owned}}\n}\n`;
    await writeFile(config, original);

    const removed = await runIn(cli, home)(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(0);
    expect(removed.json).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ name: "claude_code", status: "removed" }),
      ]),
    });
    const remaining = await readFile(config, "utf8");
    expect(remaining.startsWith(`{\n  ${shadowParent}\n`)).toBe(true);
    expect(JSON.parse(remaining)).toEqual({
      mcpServers: { peer: { command: "/usr/bin/true" } },
    });
  },
);

cliTest(
  "uninstall refuses to activate a shadowed duplicate registration",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-json-duplicate-");
    const config = join(home, ".claude.json");
    const original = `{\n  "mcpServers": {${shadowLeaf} ${owned}}\n}\n`;
    await writeFile(config, original);

    const removed = await runIn(cli, home)(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(1);
    expect(removed.json).toMatchObject({
      status: "failed",
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "claude_code",
          status: "failed",
          detail: expect.stringContaining("activate an earlier duplicate"),
        }),
      ]),
    });
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest(
  "uninstall removes repeated owned entries and preserves inactive parents, peers, and its original backup",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-json-owned-repeats-");
    const config = join(home, ".claude.json");
    const inactive = '{"inactivePeer":{"command":"/usr/bin/false"}}';
    const active = `{"rea":{"command":"npx","args":["-y","rea-agents@6.6.0","mcp"]},"peer":{"command":"/usr/bin/true"},"rea":{"command":"npx","args":["-y","rea-agents@6.5.0","mcp"]}}`;
    const original = `{"mcpServers":${inactive},"mcpServers":${active}}\n`;
    await writeFile(config, original);

    const run = runIn(cli, home);
    const removed = await run(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(0);
    expect(removed.json).toMatchObject({
      status: "complete",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "claude_code", status: "removed" }),
      ]),
    });
    const afterRemoval = await readFile(config, "utf8");
    expect(JSON.parse(afterRemoval)).toEqual({
      mcpServers: { peer: { command: "/usr/bin/true" } },
    });
    expect(afterRemoval).toContain(`"mcpServers":${inactive}`);
    expect(afterRemoval).toContain('"peer":{"command":"/usr/bin/true"}');
    expect(afterRemoval).not.toContain("rea-agents@");
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);

    const repeated = await run(["uninstall", "--json"]);
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect(await readFile(config, "utf8")).toBe(afterRemoval);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
  },
);

cliTest(
  "preflights a later Cursor null duplicate before changing Claude or creating backups",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-json-repeat-preflight-");
    const claude = join(home, ".claude.json");
    const claudeOriginal = `{"mcpServers":{${owned}}}\n`;
    await writeFile(claude, claudeOriginal);
    const cursor = join(home, ".cursor", "mcp.json");
    const cursorOriginal = `{"mcpServers":{"rea":null,${owned}}}\n`;
    await writeConfiguration(cursor, cursorOriginal);

    const removed = await runIn(cli, home)(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(1);
    expect(removed.json).toMatchObject({
      status: "failed",
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "cursor",
          status: "failed",
          detail: expect.stringContaining("earlier duplicate"),
        }),
        expect.objectContaining({ name: "uninstall", status: "skipped" }),
      ]),
    });
    expect(await readFile(claude, "utf8")).toBe(claudeOriginal);
    expect(await readFile(cursor, "utf8")).toBe(cursorOriginal);
    for (const path of [claude, cursor])
      await expect(readFile(`${path}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
  },
);

cliTest(
  "preflights a foreign OpenCode V1 fallback before changing Claude or creating backups",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-json-opencode-fallback-");
    const claude = join(home, ".claude.json");
    const claudeOriginal = `{"mcpServers":{${owned}}}\n`;
    await writeFile(claude, claudeOriginal);
    const openCode = join(home, ".config", "opencode", "opencode.json");
    const openCodeOriginal = `{"mcp":{"servers":{"rea":${openCodeOwned}},"rea":${openCodeForeign}}}\n`;
    await writeConfiguration(openCode, openCodeOriginal);

    const removed = await runIn(cli, home)(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(1);
    expect(removed.json).toMatchObject({
      status: "failed",
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "opencode",
          status: "failed",
          detail: expect.stringContaining("would activate it"),
        }),
        expect.objectContaining({ name: "uninstall", status: "skipped" }),
      ]),
    });
    expect(await readFile(claude, "utf8")).toBe(claudeOriginal);
    expect(await readFile(openCode, "utf8")).toBe(openCodeOriginal);
    for (const path of [claude, openCode])
      await expect(readFile(`${path}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
  },
);

cliTest(
  "OpenCode setup migrates every owned repeated V1 entry while preserving the V2 peer",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-json-opencode-migration-");
    const config = join(home, ".config", "opencode", "opencode.json");
    const original = `{"mcp":{"servers":{"peer":{"type":"local","command":["/usr/bin/true"]}},"rea":${openCodeOwned},"rea":${openCodeOwned}}}\n`;
    await writeConfiguration(config, original);

    const setup = await runIn(cli, home)(setupArguments("opencode"));
    expect(setup.exitCode, setup.stdout).toBe(0);
    expect(setup.json).toMatchObject({
      clients: { opencode: { status: "configured" } },
    });
    const { mcp } = JSON.parse(await readFile(config, "utf8")) as {
      mcp: Record<string, unknown> & { servers: Record<string, unknown> };
    };
    expect(Object.hasOwn(mcp, "rea")).toBe(false);
    expect(mcp.servers).toMatchObject({
      peer: { command: ["/usr/bin/true"] },
      rea: { type: "local" },
    });
    const registration = z
      .object({ command: z.unknown() })
      .parse(mcp.servers.rea);
    await assertSelectedLauncher(registration.command);
  },
);
