import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// Match native profile rules, including reserved names on POSIX.
for (const [variable, profile] of [
  ["OMP_PROFILE", "Bad Name"],
  ["OMP_PROFILE", "../escape"],
  ["OMP_PROFILE", "trailing."],
  ["OMP_PROFILE", "con.txt"],
  ["OMP_PROFILE", "com0"],
  ["OMP_PROFILE", "lpt0"],
  ["OMP_PROFILE", "a".repeat(65)],
  ["PI_PROFILE", "Bad Name"],
] as const)
  cliTest(
    `OMP rejects invalid ${variable} ${profile} without writing a fallback`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-omp-invalid-profile-");
      const agent = join(home, "selected agent");
      const config = join(agent, "mcp.json");
      const original = '{"mcpServers":{"other":{"command":"other-server"}}}\n';
      await mkdir(agent);
      await writeFile(config, original);
      const run = (args: readonly string[], profile: string) =>
        cli.run({
          arguments: args,
          cwd: home,
          environment: {
            USERPROFILE: home,
            PI_CODING_AGENT_DIR: agent,
            [variable]: profile,
          },
          timeoutMs: 20_000,
        });
      for (const option of ["--dry-run", "--yes"]) {
        const rejected = await run(
          ["setup", "--client", "omp", option, "--json"],
          profile,
        );
        expect(rejected.exitCode).not.toBe(0);
        expect(rejected.json).toMatchObject({
          status: "needs_human",
          plannedActions: [],
          appliedActions: [],
          remediation: expect.stringContaining(
            `Invalid OMP profile ${JSON.stringify(profile)}`,
          ),
        });
      }
      expect(await readFile(config, "utf8")).toBe(original);
      for (const path of [
        config + ".rea.backup",
        join(home, ".omp", "agent"),
        join(home, ".agents", "skills"),
      ])
        await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });

      if (profile !== "con.txt") return;
      const doctor = await run(
        ["doctor", "--client", "omp", "--json"],
        "con.txt",
      );
      expect(doctor.exitCode).not.toBe(0);
      expect(doctor.json).toMatchObject({
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "omp",
              state: "invalid",
              remediation: expect.stringContaining(
                "Windows reserved device name",
              ),
            }),
          ]),
        },
      });
      const unrelated = await run(
        ["setup", "--client", "qwen_code", "--yes", "--json"],
        "Bad Name",
      );
      expect(unrelated.exitCode).toBe(0);
      expect(unrelated.json).toMatchObject({ status: "ready" });
    },
  );

cliTest(
  "OMP explicit default selection overrides an invalid legacy profile",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-omp-default-profile-");
    const agent = join(home, "agent");
    const result = await cli.run({
      arguments: ["setup", "--client", "omp", "--yes", "--json"],
      cwd: home,
      environment: {
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: agent,
        OMP_PROFILE: " ",
        PI_PROFILE: "Bad Name",
      },
      timeoutMs: 20_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({ status: "ready" });
    expect(
      JSON.parse(await readFile(join(agent, "mcp.json"), "utf8")),
    ).toHaveProperty("mcpServers.rea");
  },
);
