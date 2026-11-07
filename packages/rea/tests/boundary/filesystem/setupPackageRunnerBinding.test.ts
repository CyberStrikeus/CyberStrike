import { isAbsolute } from "node:path";
import { expect, it } from "vitest";

import { systemSetupHost } from "../../../src/application/SetupHost.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each(["npm/11.16.0 node/v24.22.1", "bun/1.4.2"])(
  "binds setup invoked by %s to the already selected installation",
  async (userAgent) => {
    const home = await createTestTempDirectory("rea-runner-binding-");
    const environment = {
      HOME: home,
      USERPROFILE: home,
      PATH: process.env.PATH,
    };
    const direct = systemSetupHost(undefined, environment);
    const runner = systemSetupHost(undefined, {
      ...environment,
      npm_command: "exec",
      npm_config_user_agent: userAgent,
    });
    try {
      expect(runner.registrationCommand).toEqual(direct.registrationCommand);
      expect(isAbsolute(runner.registrationCommand[0]!)).toBe(true);
      expect(isAbsolute(runner.registrationCommand[1]!)).toBe(true);
      expect(runner.registrationCommand.at(-1)).toBe("mcp");
    } finally {
      await runner.close?.();
      await direct.close?.();
    }
  },
);
