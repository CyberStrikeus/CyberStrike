import { expect, it } from "vitest";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { parseEnvironment } from "./environment.js";
import {
  MCP_PHASE_BUDGET_FLOOR_MS,
  MCP_PHASE_BUDGET_MAXIMUM_MS,
  parseMcpStartupBudgets,
  resolveMcpStartupBudgets,
} from "./mcpStartupBudgets.js";
import { parseConfig } from "./parseConfig.js";

const expectedDefaultBudgets = {
  initialize: {
    setting: "REA_MCP_INITIALIZE_BUDGET_MS",
    phase: "MCP initialize phase budget",
    milliseconds: 15_000,
    source: "default",
    defaultMilliseconds: 15_000,
    floorMilliseconds: 1,
    maximumMilliseconds: 2_147_483_647,
  },
  toolsList: {
    setting: "REA_MCP_TOOLS_LIST_BUDGET_MS",
    phase: "MCP tools/list phase budget",
    milliseconds: 5_000,
    source: "default",
    defaultMilliseconds: 5_000,
    floorMilliseconds: 1,
    maximumMilliseconds: 2_147_483_647,
  },
  firstCatalog: {
    setting: "REA_MCP_FIRST_CATALOG_BUDGET_MS",
    phase: "MCP first-catalog phase budget",
    milliseconds: 20_000,
    source: "default",
    defaultMilliseconds: 20_000,
    floorMilliseconds: 1,
    maximumMilliseconds: 2_147_483_647,
  },
  doctor: {
    setting: "REA_MCP_DOCTOR_DEADLINE_MS",
    phase: "MCP doctor startup deadline",
    milliseconds: 30_000,
    source: "default",
    defaultMilliseconds: 30_000,
    floorMilliseconds: 1,
    maximumMilliseconds: 2_147_483_647,
  },
};

it("resolves the default phase budgets and their configuration metadata", () => {
  expect(parseMcpStartupBudgets({})).toEqual({
    ok: true,
    value: expectedDefaultBudgets,
  });
  expect(resolveMcpStartupBudgets({})).toEqual(expectedDefaultBudgets);
  const parsed = parseConfig({});
  if (!parsed.ok) throw new Error("unset phase budgets were rejected");
  expect(parsed.value.analysisProvider).toBe("auto");
});

it("uses valid phase budget overrides", () => {
  expect(
    parseMcpStartupBudgets({
      REA_MCP_INITIALIZE_BUDGET_MS: "16000",
      REA_MCP_TOOLS_LIST_BUDGET_MS: "6000",
      REA_MCP_FIRST_CATALOG_BUDGET_MS: "21000",
      REA_MCP_DOCTOR_DEADLINE_MS: String(MCP_PHASE_BUDGET_MAXIMUM_MS),
    }),
  ).toEqual({
    ok: true,
    value: {
      initialize: {
        ...expectedDefaultBudgets.initialize,
        milliseconds: 16_000,
        source: "setting",
      },
      toolsList: {
        ...expectedDefaultBudgets.toolsList,
        milliseconds: 6_000,
        source: "setting",
      },
      firstCatalog: {
        ...expectedDefaultBudgets.firstCatalog,
        milliseconds: 21_000,
        source: "setting",
      },
      doctor: {
        ...expectedDefaultBudgets.doctor,
        milliseconds: 2_147_483_647,
        source: "setting",
      },
    },
  });
  const parsed = parseConfig({ REA_MCP_DOCTOR_DEADLINE_MS: "31000" });
  if (!parsed.ok) throw new Error("valid doctor deadline was rejected");
});

it.each([
  ["REA_MCP_INITIALIZE_BUDGET_MS", ""],
  ["REA_MCP_INITIALIZE_BUDGET_MS", "0"],
  ["REA_MCP_TOOLS_LIST_BUDGET_MS", "-1"],
  ["REA_MCP_FIRST_CATALOG_BUDGET_MS", "020000"],
  ["REA_MCP_DOCTOR_DEADLINE_MS", "10_000"],
  ["REA_MCP_DOCTOR_DEADLINE_MS", "1e4"],
  ["REA_MCP_INITIALIZE_BUDGET_MS", " 15000"],
  ["REA_MCP_TOOLS_LIST_BUDGET_MS", "5000 "],
  ["REA_MCP_FIRST_CATALOG_BUDGET_MS", "1.5"],
  ["REA_MCP_DOCTOR_DEADLINE_MS", String(MCP_PHASE_BUDGET_MAXIMUM_MS + 1)],
  ["REA_MCP_INITIALIZE_BUDGET_MS", "9".repeat(40)],
])("rejects invalid %s=%j as a configuration error", (setting, value) => {
  const parsed = parseMcpStartupBudgets({ [setting]: value });
  if (parsed.ok)
    throw new Error(`Accepted ${setting}=${JSON.stringify(value)}`);
  expect(parsed.error).toBeInstanceOf(ConfigurationError);
  const constraint = parsed.error.settings[0]?.constraint ?? "";
  expect(parsed.error.settings).toEqual([{ setting, constraint }]);
  expect(constraint).toContain(setting);
  expect(constraint).toContain("positive decimal integer");
  expect(constraint).toContain(
    `from ${String(MCP_PHASE_BUDGET_FLOOR_MS)} to ${String(MCP_PHASE_BUDGET_MAXIMUM_MS)} ms`,
  );
  expect(parsed.error.message).toBe(constraint);
  const startup = parseEnvironment({ [setting]: value });
  if (startup.ok) throw new Error(`Startup accepted ${setting}`);
  expect(startup.error.settings).toContainEqual({ setting, constraint });
  const config = parseConfig({ [setting]: value });
  if (config.ok) throw new Error(`parseConfig accepted ${setting}`);
  expect(projectAnalysisError(config.error)).toMatchObject({
    code: "configuration_invalid",
    message: expect.stringContaining(setting),
  });
  expect(() => resolveMcpStartupBudgets({ [setting]: value })).toThrow(
    ConfigurationError,
  );
});

it("names every invalid phase budget instead of keeping a default", () => {
  const parsed = parseMcpStartupBudgets({
    REA_MCP_INITIALIZE_BUDGET_MS: "0",
    REA_MCP_TOOLS_LIST_BUDGET_MS: "6000",
    REA_MCP_DOCTOR_DEADLINE_MS: "nope",
  });
  if (parsed.ok) throw new Error("invalid budgets were accepted");
  expect(parsed.error.settings.map(({ setting }) => setting)).toEqual([
    "REA_MCP_INITIALIZE_BUDGET_MS",
    "REA_MCP_DOCTOR_DEADLINE_MS",
  ]);
  expect(parsed.error.message).not.toContain("6000");
});
