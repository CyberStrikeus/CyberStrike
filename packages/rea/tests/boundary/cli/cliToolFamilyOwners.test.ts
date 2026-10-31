import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { toolFamilyId } from "../../../src/contracts/toolFamilies.js";

const SHARED_APPLICATION_TOOLS = [
  ["export_web_scripts", "registerWebScriptCommands", "registerWebScriptTool"],
  [
    "trace_web_module_imports",
    "registerWebModuleCommands",
    "registerWebModuleTool",
  ],
  [
    "trace_web_source_location",
    "registerWebSourceLocationCommands",
    "registerWebSourceLocationTool",
  ],
] as const;

const familyBody = (source: string, family: string): string => {
  const marker = `${family}: () =>`;
  const start = source.indexOf(marker);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unclosed ${family} registrar`);
};

describe("CLI and MCP tool family ownership", () => {
  const cli = readFileSync("src/cli.ts", "utf8");
  const server = readFileSync("src/server/createServer.ts", "utf8");

  it("walks family ids without loading the contract tables", () => {
    expect(cli).toContain('from "./contracts/toolFamilyIds.js"');
    expect(cli).not.toContain("toolFamilies.js");
    expect(server).toContain('from "../contracts/toolFamilyIds.js"');
    expect(server).not.toContain("toolFamilies.js");
  });

  it("keeps web script commands in the application family on both adapters", () => {
    const cliApplication = familyBody(cli, "application");
    const cliBrowser = familyBody(cli, "browser");
    const serverApplication = familyBody(server, "application");
    const serverBrowser = familyBody(server, "browser");
    for (const [
      tool,
      cliRegistrar,
      serverRegistrar,
    ] of SHARED_APPLICATION_TOOLS) {
      expect(toolFamilyId(tool)).toBe("application");
      expect(cliApplication).toContain(cliRegistrar);
      expect(cliBrowser).not.toContain(cliRegistrar);
      expect(serverApplication).toContain(serverRegistrar);
      expect(serverBrowser).not.toContain(serverRegistrar);
    }
  });
});
