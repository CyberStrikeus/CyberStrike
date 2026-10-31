import { expect } from "vitest";

import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "reports an invalid capture decoder heap from doctor without failing registration",
  async ({ cli }) => {
    const doctor = await cli.run({
      arguments: ["doctor", "--json"],
      environment: {
        REA_LOG_LEVEL: "silent",
        REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "7",
      },
    });
    expect(doctor.exitCode, doctor.stderr).toBe(1);
    expect(doctor.stderr).toBe("");
    expect(doctor.json).toMatchObject({
      healthy: false,
      scope_checks: expect.arrayContaining([
        expect.objectContaining({
          name: "runtime-configuration:REA_CAPTURE_DECODER_OLD_GENERATION_MIB",
          ok: false,
          classification: "config_drift",
        }),
      ]),
    });
  },
);
