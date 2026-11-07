import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const setupArguments = ["setup", "--client", "gemini_cli", "--yes", "--json"];
const doctorArguments = ["doctor", "--client", "gemini_cli", "--json"];

const geminiWorkspace = async (cli: TestCli) => {
  const home = await createTestTempDirectory("rea-gemini-workspace-trust-");
  const project = join(home, "project");
  const workspace = join(project, ".gemini/settings.json");
  const user = join(home, ".gemini/settings.json");
  await mkdir(dirname(workspace), { recursive: true });
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    GEMINI_CLI_HOME: home,
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(home, "system.json"),
    GEMINI_CLI_SYSTEM_DEFAULTS_PATH: join(home, "defaults.json"),
    GEMINI_CLI_TRUSTED_FOLDERS_PATH: join(home, "trust.json"),
  };
  const initial = await cli.run({
    arguments: setupArguments,
    cwd: home,
    environment,
  });
  expect(initial.exitCode, initial.stdout).toBe(0);
  const originalUser = await readFile(user);
  const run = (arguments_: readonly string[]) =>
    cli.run({ arguments: arguments_, cwd: project, environment });
  return { workspace, user, originalUser, environment, run };
};

cliTest(
  "Gemini does not require workspace trust until workspace settings exist",
  async ({ cli }) => {
    const fixture = await geminiWorkspace(cli);
    const trust = join(dirname(fixture.user), "trustedFolders.json");
    fixture.environment.GEMINI_CLI_TRUSTED_FOLDERS_PATH = trust;
    for (const text of ["{}", "{ not json"]) {
      await writeFile(trust, text);
      const setup = await fixture.run(setupArguments);
      expect(setup.exitCode, setup.stdout).toBe(0);
      expect(setup.json).toMatchObject({ status: "ready", appliedActions: [] });
      const doctor = await fixture.run(doctorArguments);
      expect(doctor.exitCode, doctor.stdout).toBe(0);
      expect(doctor.json).toMatchObject({
        healthy: true,
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "gemini_cli",
              state: "aligned",
              remediation: null,
            }),
          ]),
        },
      });
      await expect(access(fixture.workspace)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(trust, "utf8")).toBe(text);
      expect(
        Buffer.compare(await readFile(fixture.user), fixture.originalUser),
      ).toBe(0);
    }

    const workspaceText = "{ not json";
    await writeFile(fixture.workspace, workspaceText);
    const setup = await fixture.run(setupArguments);
    expect(setup.exitCode, setup.stdout).toBe(1);
    expect(setup.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      appliedActions: [],
      remediation: expect.stringContaining(trust),
    });
    const doctor = await fixture.run(doctorArguments);
    expect(doctor.exitCode, doctor.stdout).toBe(1);
    expect(doctor.json).toMatchObject({
      healthy: false,
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({
            client: "gemini_cli",
            state: "invalid",
            remediation: expect.stringContaining(trust),
          }),
        ]),
      },
    });
    expect(await readFile(fixture.workspace, "utf8")).toBe(workspaceText);
    expect(await readFile(trust, "utf8")).toBe("{ not json");
    expect(
      Buffer.compare(await readFile(fixture.user), fixture.originalUser),
    ).toBe(0);
  },
);

for (const scenario of [
  { name: "an unlisted workspace", environment: {} },
  {
    name: "an explicitly untrusted workspace",
    environment: { GEMINI_CLI_TRUST_WORKSPACE: "false" },
  },
  {
    name: "a restricted workspace with an explicit trust opt-in",
    environment: {
      GEMINI_CLI_TRUST_WORKSPACE: "true",
      GEMINI_RESTRICTED_MODE: "true",
    },
  },
])
  cliTest(
    `Gemini setup and doctor ignore malformed settings in ${scenario.name}`,
    async ({ cli }) => {
      const fixture = await geminiWorkspace(cli);
      Object.assign(fixture.environment, scenario.environment);
      const malformed = Buffer.from("{ not json");
      await writeFile(fixture.workspace, malformed);

      const setup = await fixture.run(setupArguments);
      expect(setup.exitCode, setup.stdout).toBe(0);
      expect(setup.json).toMatchObject({ status: "ready", appliedActions: [] });
      const doctor = await fixture.run(doctorArguments);
      expect(doctor.exitCode, doctor.stdout).toBe(0);
      expect(doctor.json).toMatchObject({
        healthy: true,
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "gemini_cli",
              state: "aligned",
              remediation: null,
            }),
          ]),
        },
      });
      expect(Buffer.compare(await readFile(fixture.workspace), malformed)).toBe(
        0,
      );
      expect(
        Buffer.compare(await readFile(fixture.user), fixture.originalUser),
      ).toBe(0);
      await expect(
        access(`${fixture.workspace}.rea.backup`),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });

      if (scenario.name === "an explicitly untrusted workspace") {
        const excluded = Buffer.from(
          JSON.stringify({ mcp: { excluded: ["rea"] } }),
        );
        await writeFile(fixture.workspace, excluded);
        const excludedSetup = await fixture.run(setupArguments);
        expect(excludedSetup.exitCode, excludedSetup.stdout).toBe(0);
        const excludedDoctor = await fixture.run(doctorArguments);
        expect(excludedDoctor.exitCode, excludedDoctor.stdout).toBe(0);
        expect(excludedDoctor.json).toMatchObject({
          identity: {
            registrations: expect.arrayContaining([
              expect.objectContaining({
                client: "gemini_cli",
                state: "aligned",
              }),
            ]),
          },
        });
        expect(
          Buffer.compare(await readFile(fixture.workspace), excluded),
        ).toBe(0);
      }
    },
  );

cliTest(
  "Gemini still rejects malformed settings and exclusions in a trusted workspace",
  async ({ cli }) => {
    const fixture = await geminiWorkspace(cli);
    fixture.environment.GEMINI_CLI_TRUST_WORKSPACE = "true";
    for (const scenario of [
      {
        text: "{ not json",
        state: "invalid",
        diagnostic: "Invalid JSON/JSONC",
      },
      {
        text: JSON.stringify({ mcp: { excluded: ["rea"] } }),
        state: "stale",
        diagnostic: "mcp.excluded",
      },
    ]) {
      const original = Buffer.from(scenario.text);
      await writeFile(fixture.workspace, original);
      const setup = await fixture.run(setupArguments);
      expect(setup.exitCode, setup.stdout).toBe(1);
      expect(setup.json).toMatchObject({
        status: "needs_human",
        plannedActions: [],
        appliedActions: [],
        remediation: expect.stringContaining(scenario.diagnostic),
      });
      const doctor = await fixture.run(doctorArguments);
      expect(doctor.exitCode, doctor.stdout).toBe(1);
      expect(doctor.json).toMatchObject({
        healthy: false,
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "gemini_cli",
              state: scenario.state,
              remediation: expect.stringContaining(scenario.diagnostic),
            }),
          ]),
        },
      });
      expect(Buffer.compare(await readFile(fixture.workspace), original)).toBe(
        0,
      );
      expect(
        Buffer.compare(await readFile(fixture.user), fixture.originalUser),
      ).toBe(0);
      await expect(
        access(`${fixture.workspace}.rea.backup`),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  },
);
