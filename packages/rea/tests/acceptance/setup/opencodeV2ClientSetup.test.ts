import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const setupArguments = [
  "setup",
  "--client",
  "opencode",
  "--skill=false",
  "--yes",
  "--json",
];

const layeredOpenCode = async (
  cli: TestCli,
  disabled: boolean,
  jsonc: boolean,
) => {
  const home = await createTestTempDirectory("rea-opencode-v2-activation-");
  const configurationHome = join(home, "config");
  const directory = join(configurationHome, "opencode");
  await mkdir(directory, { recursive: true });
  const lower = join(directory, "config.json");
  const upper = join(directory, jsonc ? "opencode.jsonc" : "opencode.json");
  const other = { type: "local", command: ["other-server"], disabled: true };
  const originalLower = JSON.stringify({
    mcp: {
      servers: {
        rea: {
          type: "local",
          command: ["rea", "mcp"],
          disabled,
          environment: { REA_MCP_OUTPUT_SCHEMA_PROFILE: "off" },
        },
        other,
      },
    },
  });
  const originalUpper = `${jsonc ? "// Keep the user configuration comment.\n" : ""}${JSON.stringify(
    {
      mcp: { servers: {} },
      theme: "system",
    },
  )}\n`;
  await writeFile(lower, originalLower);
  await writeFile(upper, originalUpper);
  const run = (arguments_: readonly string[]) =>
    cli.run({
      arguments: arguments_,
      cwd: home,
      environment: {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: configurationHome,
        APPDATA: join(home, "appdata"),
        LOCALAPPDATA: join(home, "localappdata"),
        HOPPER_LAUNCHER_PATH: join(home, "absent-hopper"),
      },
    });
  return { lower, upper, originalLower, originalUpper, other, run };
};

for (const disabled of [true, false]) {
  for (const jsonc of [false, true]) {
    cliTest(
      `OpenCode V2 setup activates ${jsonc ? "JSONC" : "JSON"} over a lower disabled=${disabled} registration`,
      async ({ cli }) => {
        const fixture = await layeredOpenCode(cli, disabled, jsonc);
        const setup = await fixture.run(setupArguments);
        expect(setup.exitCode, setup.stdout).toBe(0);
        expect(setup.json).toMatchObject({ status: "ready" });
        const configured = await readFile(fixture.upper, "utf8");
        expect(parse(configured)).toMatchObject({
          mcp: {
            servers: {
              rea: {
                type: "local",
              },
            },
          },
          theme: "system",
        });
        if (disabled)
          expect(parse(configured).mcp.servers.rea.disabled).toBe(false);
        if (jsonc)
          expect(configured).toContain(
            "// Keep the user configuration comment.",
          );
        expect(await readFile(fixture.lower, "utf8")).toBe(
          fixture.originalLower,
        );
        expect(await readFile(`${fixture.upper}.rea.backup`, "utf8")).toBe(
          fixture.originalUpper,
        );

        const repeated = await fixture.run(setupArguments);
        expect(repeated.exitCode, repeated.stdout).toBe(0);
        expect(repeated.json).toMatchObject({
          status: "ready",
          plannedActions: [],
          appliedActions: [],
        });
        const doctor = await fixture.run([
          "doctor",
          "--client",
          "opencode",
          "--json",
        ]);
        expect(doctor.exitCode, doctor.stdout).toBe(0);
        expect(doctor.json).toMatchObject({
          healthy: true,
          identity: {
            registrations: expect.arrayContaining([
              expect.objectContaining({ client: "opencode", state: "aligned" }),
            ]),
          },
        });
        expect(await readFile(fixture.upper, "utf8")).toBe(configured);
        expect(await readFile(fixture.lower, "utf8")).toBe(
          fixture.originalLower,
        );
        expect(
          parse(await readFile(fixture.lower, "utf8")).mcp.servers.other,
        ).toEqual(fixture.other);
      },
    );
  }
}

cliTest(
  "OpenCode V2 activation does not bypass a malformed lower configuration",
  async ({ cli }) => {
    const fixture = await layeredOpenCode(cli, true, true);
    const malformed = "{ not json";
    await writeFile(fixture.lower, malformed);
    const setup = await fixture.run(setupArguments);
    expect(setup.exitCode, setup.stdout).toBe(1);
    expect(setup.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      appliedActions: [],
      remediation: expect.stringContaining(fixture.lower),
    });
    expect(await readFile(fixture.lower, "utf8")).toBe(malformed);
    expect(await readFile(fixture.upper, "utf8")).toBe(fixture.originalUpper);
    await expect(access(`${fixture.upper}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
