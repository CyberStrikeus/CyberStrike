import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { supportedClients } from "../../../src/application/SupportedClients.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const home = "C:\\Users\\a";
const roaming = join(home, "AppData", "Roaming");

const configPath = (
  name: string,
  env: Parameters<typeof supportedClients>[2],
) =>
  supportedClients(home, "win32", env).find((client) => client.name === name)
    ?.configPath;

describe("Windows AppData client paths", () => {
  it.each([
    ["vscode", join(roaming, "Code", "User", "mcp.json")],
    ["trae", join(roaming, "Trae", "User", "mcp.json")],
    ["devin", join(roaming, "devin", "mcp_config.json")],
  ])("treats an empty APPDATA as unset for %s", (name, expected) => {
    expect(configPath(name, {})).toBe(expected);
    expect(configPath(name, { APPDATA: "" })).toBe(expected);
  });
});
