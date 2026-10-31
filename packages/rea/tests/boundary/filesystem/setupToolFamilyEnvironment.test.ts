import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, it } from "vitest";
import { createDoctorHostFixture } from "../../../src/application/Doctor.fixture.js";
import { systemSetupHost } from "../../../src/application/SetupHost.js";
import { runSetup } from "../../../src/application/Setup.js";
import { options } from "../../../src/application/Setup.fixture.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([
  { environmentFamilies: "artifact", toolFamilies: undefined },
  { environmentFamilies: "artifact", toolFamilies: "native" },
  { environmentFamilies: "typo", toolFamilies: undefined },
  { environmentFamilies: "", toolFamilies: undefined },
  { environmentFamilies: "typo", toolFamilies: "native" },
])(
  "validates selected environment scope $environmentFamilies with option $toolFamilies taking precedence",
  async ({ environmentFamilies, toolFamilies }) => {
    const home = await createTestTempDirectory("rea-setup-tool-families-");
    const client = supportedClients(home, "darwin", {}).find(
      ({ name }) => name === "cursor",
    );
    if (client === undefined) throw new Error("missing Cursor client");
    await mkdir(dirname(client.configPath), { recursive: true });
    await writeFile(client.configPath, '{"theme":"caller"}\n');
    const createHost = () => ({
      ...systemSetupHost(createDoctorHostFixture({ homeDirectory: home }), {
        REA_MCP_TOOL_FAMILIES: environmentFamilies,
        UNRELATED_CALLER_VARIABLE: "must not persist",
      }),
      detectedClients: async () => [client],
      supportedClients: async () => [client],
    });
    const selected = {
      ...options(true),
      clientIds: ["cursor"],
      installSkill: false,
      proposeHopper: false,
      readinessScope: { clients: [], providers: [], skill: false },
      ...(toolFamilies === undefined ? {} : { toolFamilies }),
    };
    const first = await runSetup(selected, createHost());
    if (toolFamilies === undefined && environmentFamilies !== "artifact") {
      expect(first.status).toBe("needs_human");
      expect(first.appliedActions).toEqual([]);
      expect(first.remediation).toContain("REA_MCP_TOOL_FAMILIES");
      await expect(
        access(`${client.configPath}.rea.backup`),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(client.configPath, "utf8")).toBe(
        '{"theme":"caller"}\n',
      );
      return;
    }
    expect(first.clients.cursor).toMatchObject({ status: "configured" });
    const configured = await readFile(client.configPath, "utf8");
    expect(JSON.parse(configured)).toMatchObject({
      theme: "caller",
      mcpServers: {
        rea: { env: { REA_MCP_TOOL_FAMILIES: toolFamilies ?? "artifact" } },
      },
    });
    expect(configured).not.toContain("UNRELATED_CALLER_VARIABLE");
    const second = await runSetup(selected, createHost());
    expect(second.appliedActions).toEqual([]);
    expect(await readFile(client.configPath, "utf8")).toBe(configured);
  },
);
