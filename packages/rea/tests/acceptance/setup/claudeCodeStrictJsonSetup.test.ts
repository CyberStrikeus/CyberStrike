import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const peer = '"peer": { "command": "/usr/bin/true", "args": [] }';

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

const setupArguments = [
  "setup",
  "--client",
  "claude_code",
  "--skill=false",
  "--json",
] as const;
const doctorArguments = [
  "doctor",
  "--client",
  "claude_code",
  "--skill=false",
  "--json",
] as const;

// Native Claude Code rejects these documents with its strict JSON reader.
for (const [syntax, original] of [
  [
    "a comment",
    `{\n  // preserve this unrelated setting\n  "mcpServers": {\n    ${peer}\n  }\n}\n`,
  ],
  ["a trailing comma", `{\n  "mcpServers": {\n    ${peer},\n  }\n}\n`],
] as const)
  cliTest(
    `Claude Code setup, doctor, and uninstall refuse JSON with ${syntax}`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-claude-strict-json-");
      const config = join(home, ".claude.json");
      await writeFile(config, original);
      const run = runIn(cli, home);

      for (const mode of ["--dry-run", "--yes"]) {
        const setup = await run([...setupArguments, mode]);
        expect(setup.exitCode, setup.stdout).toBe(1);
        expect(setup.json).toMatchObject({
          status: "needs_human",
          plannedActions: [],
          appliedActions: [],
          remediation: expect.stringContaining("malformed"),
        });
      }
      const doctor = await run(doctorArguments);
      expect(doctor.exitCode).toBe(1);
      expect(doctor.json).toMatchObject({
        healthy: false,
        identity: {
          registrations: [
            expect.objectContaining({
              client: "claude_code",
              state: "invalid",
            }),
          ],
        },
      });
      const removed = await run(["uninstall", "--json"]);
      expect(removed.exitCode).toBe(1);
      expect(removed.json).toMatchObject({
        status: "failed",
        items: expect.arrayContaining([
          expect.objectContaining({ name: "claude_code", status: "failed" }),
        ]),
      });
      expect(await readFile(config, "utf8")).toBe(original);
      await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

for (const prefix of ["", "﻿"])
  cliTest(
    `Claude Code setup configures strict JSON with prefix ${JSON.stringify(prefix)}`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-claude-strict-json-");
      const config = join(home, ".claude.json");
      const original = `${prefix}{\n  "mcpServers": {\n    ${peer}\n  }\n}\n`;
      await writeFile(config, original);
      const run = runIn(cli, home);

      const setup = await run([...setupArguments, "--yes"]);
      expect(setup.exitCode, setup.stdout).toBe(0);
      expect(setup.json).toMatchObject({
        status: "ready",
        clients: { claude_code: { status: "configured" } },
      });
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
      const configured = await readFile(config, "utf8");
      expect(configured.startsWith(`${prefix}{`)).toBe(true);
      expect(JSON.parse(configured.slice(prefix.length))).toMatchObject({
        mcpServers: {
          peer: { command: "/usr/bin/true", args: [] },
          rea: { command: expect.any(String) },
        },
      });
      const doctor = await run(doctorArguments);
      expect(doctor.json).toMatchObject({
        identity: {
          registrations: [
            expect.objectContaining({
              client: "claude_code",
              state: "aligned",
            }),
          ],
        },
      });
    },
  );
