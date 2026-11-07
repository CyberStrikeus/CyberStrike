import { join, win32 } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { skillDestinations } from "../../../src/application/SetupSkill.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

import { jsonClientRegistrationContract } from "../../support/jsonClientRegistrationContract.js";

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const workbuddyPath = (
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: Parameters<typeof supportedClients>[2] = {},
) =>
  supportedClients(home, platform, env).find(
    ({ name }) => name === "workbuddy",
  );

describe("WorkBuddy configuration paths", () => {
  it("resolves the global mcp.json under the home root", () => {
    expect(workbuddyPath("/home/a")?.configPath).toBe(
      join("/home/a", ".workbuddy", "mcp.json"),
    );
    expect(workbuddyPath("/Users/a")?.markerPath).toBe(
      join("/Users/a", ".workbuddy"),
    );
    expect(workbuddyPath("C:\\Users\\a", "win32")?.configPath).toBe(
      join("C:\\Users\\a", ".workbuddy", "mcp.json"),
    );
  });

  it("resolves the registration format as the plain mcpServers JSON dialect", () => {
    expect(workbuddyPath("/home/a")?.format).toBe("json");
  });

  it("resolves the personal skills directory under the home root", () => {
    expect(
      skillDestinations("/home/a", ["workbuddy"]).map(({ path }) => path),
    ).toEqual([
      join("/home/a", ".workbuddy", "skills", "reverse-engineer-anything"),
    ]);
    expect(
      skillDestinations("C:\\Users\\a", ["workbuddy"], {}, "win32").map(
        ({ path }) => path,
      ),
    ).toEqual([
      win32.join(
        "C:\\Users\\a",
        ".workbuddy",
        "skills",
        "reverse-engineer-anything",
      ),
    ]);
  });
});

jsonClientRegistrationContract({
  clientName: "workbuddy",
  displayName: "WorkBuddy",
  directory: ".workbuddy",
  filename: "mcp.json",
  initialSettings: {},
  settingsWithoutServers: { unrelated: { setting: true } },
});
