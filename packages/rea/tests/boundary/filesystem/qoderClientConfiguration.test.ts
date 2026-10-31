import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { skillDestinations } from "../../../src/application/SetupSkill.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

import { jsonClientRegistrationContract } from "../../support/jsonClientRegistrationContract.js";

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const qoderPath = (
  home: string,
  platform: NodeJS.Platform = "linux",
  env: Parameters<typeof supportedClients>[2] = {},
) => supportedClients(home, platform, env).find(({ name }) => name === "qoder");

describe("Qoder configuration paths", () => {
  it("resolves the user settings file and marker directory", () => {
    expect(qoderPath("/home/a")).toEqual({
      name: "qoder",
      displayName: "Qoder",
      configPath: join("/home/a", ".qoder", "settings.json"),
      markerPath: join("/home/a", ".qoder"),
      format: "json",
    });
    expect(qoderPath("/Users/a", "darwin")?.configPath).toBe(
      join("/Users/a", ".qoder", "settings.json"),
    );
    expect(qoderPath("C:\\Users\\a", "win32")?.configPath).toBe(
      join("C:\\Users\\a", ".qoder", "settings.json"),
    );
  });

  it("honors the QODER_CONFIG_DIR override", () => {
    expect(
      qoderPath("/home/a", "linux", { QODER_CONFIG_DIR: "/opt/qoder" })
        ?.configPath,
    ).toBe(join("/opt/qoder", "settings.json"));
    expect(
      qoderPath("/home/a", "linux", { QODER_CONFIG_DIR: "" })?.configPath,
    ).toBe(join("/home/a", ".qoder", "settings.json"));
  });

  it("resolves the personal skills directory beside the config root", () => {
    expect(
      skillDestinations("/home/a", ["qoder"]).map(({ path }) => path),
    ).toEqual([
      join("/home/a", ".qoder", "skills", "reverse-engineer-anything"),
    ]);
    expect(
      skillDestinations("/home/a", ["qoder"], {
        QODER_CONFIG_DIR: "/opt/qoder",
      }).map(({ path }) => path),
    ).toEqual([join("/opt/qoder", "skills", "reverse-engineer-anything")]);
  });
});

jsonClientRegistrationContract({
  clientName: "qoder",
  displayName: "Qoder",
  directory: ".qoder",
  filename: "settings.json",
  initialSettings: { model: { name: "qoder-model" } },
  settingsWithoutServers: { general: { vimMode: false } },
});
