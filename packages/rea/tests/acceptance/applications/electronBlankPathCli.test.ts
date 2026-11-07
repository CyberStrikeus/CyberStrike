import { expect } from "vitest";

import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["", " \t "])(
  "rejects blank Electron application_root (%j) before filesystem or provider work",
  async (applicationRoot, { cli }) => {
    const response = await cli.run({
      arguments: [
        "capture-electron-scenario",
        JSON.stringify({
          executable_path: "/synthetic/missing-electron",
          application_path: "/synthetic/missing-app",
          application_root: applicationRoot,
        }),
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
      timeoutMs: 15000,
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_electron_scenario",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["application_root"] }),
        ]),
      },
    });
  },
);
