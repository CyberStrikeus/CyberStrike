import { describe, expect, it } from "vitest";

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  createEsmModuleProfileCollector,
  mcpStartupPhaseBudgetRecovery,
  measureMcpStartup,
  parseLinuxVmRssBytes,
  profileMcpModuleLoading,
} from "../../../scripts/lib/mcp-startup-probe.mjs";
import {
  MCP_PHASE_BUDGET_FLOOR_MS,
  MCP_PHASE_BUDGET_MAXIMUM_MS,
  mcpPhaseBudgetRecovery,
  resolveMcpStartupBudgets,
  type McpPhaseBudget,
} from "../../../src/config/mcpStartupBudgets.js";
import {
  mcpDoctorDeadlineRecovery,
  MCP_STARTUP_POLICY,
} from "../../../src/mcpStartupPolicy.js";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const expectPhaseText = (text: string, budget: McpPhaseBudget) => {
  expect(budget.floorMilliseconds).toBe(MCP_PHASE_BUDGET_FLOOR_MS);
  expect(budget.maximumMilliseconds).toBe(MCP_PHASE_BUDGET_MAXIMUM_MS);
  expect(text).toContain(mcpPhaseBudgetRecovery(budget));
};

const expectThrownBudget = async (
  pending: Promise<unknown>,
  budget: McpPhaseBudget,
): Promise<string> => {
  let caught: unknown;
  try {
    await pending;
  } catch (cause) {
    caught = cause;
  }
  expect(caught).toBeInstanceOf(Error);
  const message = errorMessage(caught);
  expectPhaseText(message, budget);
  return message;
};

describe("MCP startup policy", () => {
  it("names phase budget settings without turning Codex's 30s into a REA knob", () => {
    const budgets = resolveMcpStartupBudgets({});
    expect(MCP_STARTUP_POLICY.codexStartupTimeoutSeconds).toBe(30);
    expect(budgets.initialize.milliseconds).toBe(15_000);
    expect(budgets.toolsList.milliseconds).toBe(5_000);
    expect(budgets.firstCatalog.milliseconds).toBe(20_000);
    expect(budgets.doctor.milliseconds).toBe(30_000);
    const initialize = mcpPhaseBudgetRecovery(budgets.initialize);
    expect(initialize).toBe(mcpStartupPhaseBudgetRecovery(budgets.initialize));
    expectPhaseText(initialize, budgets.initialize);
    expectPhaseText(
      mcpStartupPhaseBudgetRecovery(budgets.toolsList),
      budgets.toolsList,
    );
    expectPhaseText(
      mcpStartupPhaseBudgetRecovery(budgets.firstCatalog),
      budgets.firstCatalog,
    );
    const doctor = mcpDoctorDeadlineRecovery(budgets.doctor);
    expectPhaseText(doctor, budgets.doctor);
    const selected = resolveMcpStartupBudgets({
      REA_MCP_INITIALIZE_BUDGET_MS: "16000",
    });
    expect(selected.initialize.milliseconds).toBe(16_000);
    expect(selected.initialize.source).toBe("setting");
    expect(selected.toolsList).toEqual(budgets.toolsList);
    expect(MCP_STARTUP_POLICY.codexStartupTimeoutSeconds).toBe(30);
  });

  it("parses Linux resident memory without accepting other fields", () => {
    expect(
      parseLinuxVmRssBytes("Name:\tnode\nVmRSS:\t  12345 kB\nThreads:\t7\n"),
    ).toBe(12_641_280);
    expect(parseLinuxVmRssBytes("VmSize:\t12345 kB\n")).toBeNull();
  });

  it("profiles unique file-backed ESM modules without retaining paths", () => {
    const collector = createEsmModuleProfileCollector();
    collector.append(
      "ESM 1: Storing file:///opt/rea/dist/main.js\n" +
        "ESM 1: Translating StandardModule file:///opt/rea/dist/main.js\n" +
        "ESM 1: Storing file:///opt/rea/node_modules/zod/index.js",
    );

    expect(collector.result()).toEqual({
      supported: true,
      method: "node-debug-esm",
      unique_file_modules: 2,
      unique_package_modules: 0,
      unique_dependency_modules: 1,
      debug_lines: 3,
      truncated: false,
    });
  });
});

const probeChild = resolve("tests/fixtures/mcpStartupProbeChild.mjs");

const probePolicy = (
  overrides: Partial<{
    initializeBudgetMs: number;
    toolsListBudgetMs: number;
    firstCatalogBudgetMs: number;
    doctorDeadlineMs: number;
  }> = {},
) => {
  const generous = 30_000;
  return resolveMcpStartupBudgets({
    REA_MCP_INITIALIZE_BUDGET_MS: String(
      overrides.initializeBudgetMs ?? generous,
    ),
    REA_MCP_TOOLS_LIST_BUDGET_MS: String(
      overrides.toolsListBudgetMs ?? generous,
    ),
    REA_MCP_FIRST_CATALOG_BUDGET_MS: String(
      overrides.firstCatalogBudgetMs ?? generous,
    ),
    REA_MCP_DOCTOR_DEADLINE_MS: String(overrides.doctorDeadlineMs ?? generous),
  });
};

describe("packaged MCP startup probe failures", () => {
  it("names the initialize budget when that phase times out", async () => {
    const budgetMs = 200;
    const policy = probePolicy({ initializeBudgetMs: budgetMs });
    await expectThrownBudget(
      measureMcpStartup({
        command: process.execPath,
        args: [probeChild],
        environment: { ...process.env, REA_MCP_PROBE_MODE: "hang" },
        policy,
      }),
      policy.initialize,
    );
  });

  it("names the tools/list budget when that phase times out", async () => {
    const budgetMs = 200;
    const policy = probePolicy({ toolsListBudgetMs: budgetMs });
    await expectThrownBudget(
      measureMcpStartup({
        command: process.execPath,
        args: [probeChild],
        environment: {
          ...process.env,
          REA_MCP_PROBE_MODE: "initialize-then-hang",
        },
        policy,
      }),
      policy.toolsList,
    );
  });

  it("names the first-catalog budget when startup exceeds it", async () => {
    const budgetMs = 1;
    const policy = probePolicy({ firstCatalogBudgetMs: budgetMs });
    await expectThrownBudget(
      measureMcpStartup({
        command: process.execPath,
        args: [probeChild],
        environment: { ...process.env, REA_MCP_PROBE_MODE: "serve" },
        policy,
      }),
      policy.firstCatalog,
    );
  });

  it("does not add timeout guidance to an unrelated startup failure", async () => {
    try {
      await measureMcpStartup({
        command: process.execPath,
        args: [probeChild],
        environment: { ...process.env, REA_MCP_PROBE_MODE: "fail" },
        policy: probePolicy(),
      });
      throw new Error("expected the unrelated probe failure");
    } catch (cause) {
      const message = errorMessage(cause);
      expect(message).toContain("unrelated probe failure");
      expect(message).not.toContain("expected the unrelated probe failure");
      for (const budget of Object.values(probePolicy()))
        expect(message).not.toContain(budget.setting);
    }
  });

  it("names the doctor deadline when module profiling cannot initialize", async () => {
    const budgetMs = 200;
    const policy = probePolicy({ doctorDeadlineMs: budgetMs });
    await expectThrownBudget(
      profileMcpModuleLoading({
        command: process.execPath,
        args: [probeChild],
        environment: { ...process.env, REA_MCP_PROBE_MODE: "hang" },
        policy,
        packageName: "rea-agents",
      }),
      policy.doctor,
    );
  });

  it("names the tools/list budget when module profiling passes initialize", async () => {
    const budgetMs = 200;
    const policy = probePolicy({ toolsListBudgetMs: budgetMs });
    await expectThrownBudget(
      profileMcpModuleLoading({
        command: process.execPath,
        args: [probeChild],
        environment: {
          ...process.env,
          REA_MCP_PROBE_MODE: "initialize-then-hang",
        },
        policy,
        packageName: "rea-agents",
      }),
      policy.toolsList,
    );
  });

  it("does not add timeout guidance to an unrelated module-profile failure", async () => {
    try {
      await profileMcpModuleLoading({
        command: process.execPath,
        args: [probeChild],
        environment: { ...process.env, REA_MCP_PROBE_MODE: "fail" },
        policy: probePolicy(),
        packageName: "rea-agents",
      });
      throw new Error("expected the unrelated probe failure");
    } catch (cause) {
      const message = errorMessage(cause);
      expect(message).not.toContain("expected the unrelated probe failure");
      for (const budget of Object.values(probePolicy()))
        expect(message).not.toContain(budget.setting);
    }
  });
});

describe("packaged MCP first-catalog budget while a phase is pending", () => {
  it("stops a pending initialize at the shorter first-catalog budget", async () => {
    const firstCatalogMs = 250;
    const initializeMs = 8_000;
    const policy = probePolicy({
      initializeBudgetMs: initializeMs,
      firstCatalogBudgetMs: firstCatalogMs,
    });
    const started = performance.now();
    let caught: unknown;
    try {
      await measureMcpStartup({
        command: process.execPath,
        args: [probeChild],
        environment: { ...process.env, REA_MCP_PROBE_MODE: "hang" },
        policy,
      });
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = errorMessage(caught);
    expectPhaseText(message, policy.firstCatalog);
    expect(message).not.toContain("REA_MCP_INITIALIZE_BUDGET_MS");
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(initializeMs);
    expect(elapsedMs).toBeLessThan(firstCatalogMs + 2_000);
  });

  it("stops a pending tools/list at the remaining first-catalog budget", async () => {
    const firstCatalogMs = 800;
    const toolsListMs = 8_000;
    const root = await createTestTempDirectory("rea-mcp-startup-");
    const initializedPath = join(root, "initialized");
    const policy = probePolicy({
      toolsListBudgetMs: toolsListMs,
      firstCatalogBudgetMs: firstCatalogMs,
    });
    const started = performance.now();
    let caught: unknown;
    try {
      await measureMcpStartup({
        command: process.execPath,
        args: [probeChild],
        environment: {
          ...process.env,
          REA_MCP_PROBE_MODE: "initialize-then-hang",
          REA_MCP_PROBE_INITIALIZED_PATH: initializedPath,
        },
        policy,
      });
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = errorMessage(caught);
    expectPhaseText(message, policy.firstCatalog);
    expect(message).not.toContain("REA_MCP_TOOLS_LIST_BUDGET_MS");
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(toolsListMs);
    expect(elapsedMs).toBeLessThan(firstCatalogMs + 2_000);
    expect(await readFile(initializedPath, "utf8")).toBe("ready");
  });

  it("returns the catalog when every phase finishes inside its budget", async () => {
    const measurement = await measureMcpStartup({
      command: process.execPath,
      args: [probeChild],
      environment: { ...process.env, REA_MCP_PROBE_MODE: "serve" },
      policy: probePolicy(),
    });
    expect(measurement.listed_tool_count).toBe(0);
    expect(measurement.process_started_to_initialized_ms).toBeGreaterThan(0);
    expect(measurement.process_started_to_tools_list_ms).toBeGreaterThan(0);
    expect(measurement.process_started_to_tools_list_ms).toBeLessThan(30_000);
  });
});
