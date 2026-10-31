import { expect } from "vitest";

import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

const invalidLogLevelMessage =
  'REA configuration is invalid: REA_LOG_LEVEL: Invalid option: expected one of "trace"|"debug"|"info"|"warn"|"error"|"fatal"|"silent".\n';

for (const level of ["loud", "INFO"])
  cliTest(
    `reports REA_LOG_LEVEL=${level} as invalid configuration`,
    async ({ cli }) => {
      const help = await cli.run({
        arguments: ["--help"],
        environment: { REA_LOG_LEVEL: level },
      });
      expect(help.exitCode).toBe(1);
      expect(help.stdout).toBe("");
      expect(help.stderr).toBe(invalidLogLevelMessage);

      const doctorInvocation = {
        arguments: ["--json", "doctor", "--provider", "hopper"],
        environment: { REA_LOG_LEVEL: level },
      };
      for (const doctor of [
        await cli.run(doctorInvocation),
        await runFileCli(cli, doctorInvocation),
      ]) {
        expect(doctor.exitCode, doctor.stderr).toBe(1);
        expect(doctor.stderr).toBe("");
        expect(doctor.json).toMatchObject({
          healthy: false,
          scope_checks: expect.arrayContaining([
            expect.objectContaining({
              name: "runtime-configuration:REA_LOG_LEVEL",
              ok: false,
              classification: "config_drift",
              detail: expect.stringContaining("REA_LOG_LEVEL"),
            }),
          ]),
        });
      }

      const client = await cli.run({
        arguments: ["--json", "doctor", "--client", "codex"],
        environment: { REA_LOG_LEVEL: level },
      });
      expect(client.exitCode, client.stderr).toBe(1);
      expect(client.stderr).toBe("");
      expect(client.json).toMatchObject({
        healthy: false,
        scope: { mode: "explicit", clients: ["codex"], providers: [] },
        scope_checks: expect.arrayContaining([
          expect.objectContaining({
            name: "runtime-configuration:REA_LOG_LEVEL",
            ok: false,
          }),
        ]),
        informational_checks: expect.not.arrayContaining([
          expect.objectContaining({
            name: "runtime-configuration:REA_LOG_LEVEL",
          }),
        ]),
      });
    },
  );

cliTest(
  "keeps fresh and shared CLI configuration precedence for doctor-looking data",
  async ({ cli }) => {
    for (const arguments_ of [
      ["--filter-output", "doctor", "providers"],
      ["providers", "doctor"],
      ["--format", "", "doctor"],
      ["--filter-output", "", "doctor"],
      ["--token-limit", "", "doctor"],
      ["--token-offset", "", "doctor"],
      ["--unknown", "doctor"],
      ["--version", "doctor"],
      ["--", "doctor"],
    ]) {
      const invocation = {
        arguments: arguments_,
        environment: { REA_LOG_LEVEL: "loud" },
      };
      const fresh = await cli.run(invocation);
      const shared = await runFileCli(cli, invocation);
      for (const result of [fresh, shared]) {
        expect(result.exitCode, JSON.stringify(arguments_)).toBe(1);
        expect(result.stdout, JSON.stringify(arguments_)).toBe("");
        expect(result.stderr, JSON.stringify(arguments_)).toBe(
          invalidLogLevelMessage,
        );
      }
    }

    const completion = {
      arguments: ["doctor"],
      environment: { REA_LOG_LEVEL: "loud", COMPLETE: "bash" },
    };
    const fresh = await cli.run(completion);
    const shared = await runFileCli(cli, completion);
    for (const result of [fresh, shared]) {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(invalidLogLevelMessage);
    }
  },
);
