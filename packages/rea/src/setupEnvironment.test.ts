import { currentClientRegistrationCommand } from "./application/ClientRegistrationIdentity.js";
import { UpdateCommandRunner } from "./application/UpdateCommandRunner.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createDoctorHostFixture } from "./application/Doctor.fixture.js";
import * as macHopperInstaller from "./application/MacHopper.js";
import { runSetup } from "./application/Setup.js";
import { discoverSetupState } from "./application/SetupPlan.js";
import { options } from "./application/Setup.fixture.js";
import { systemSetupHost } from "./application/SetupHost.js";
import { systemUninstallHost } from "./application/Uninstall.js";
import { createSystemDoctorHost } from "./doctorRuntime.js";
import { PRODUCT_IDENTITY } from "./identity.js";
import {
  invokingPackageRunner,
  withoutPackageRunnerIdentity,
} from "./application/ClientRegistrationIdentity.js";
import { snapshotEnvironment } from "./process/snapshotEnvironment.js";

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "/caller/tools with spaces/ilspycmd"])(
  "preserves the explicit ILSpy path %s without inventing an unset value",
  async (selected) => {
    const host = systemSetupHost(
      createDoctorHostFixture({
        ...(selected === undefined ? {} : { configuredIlspyCmdPath: selected }),
        ilspyCmdVersion: async () => "ilspycmd 9.1.0",
      }),
      selected === undefined ? {} : { REA_ILSPY_CMD_PATH: selected },
    );
    try {
      const state = await host.initialSetupState();
      expect(state.providerEnvironment.REA_ILSPY_CMD_PATH).toBe(selected);
      if (selected !== undefined)
        expect(state.doctor.checks).toContainEqual(
          expect.objectContaining({ name: "ilspycmd", ok: true }),
        );
    } finally {
      await host.close?.();
    }
  },
);

it("plans setup and uninstall against selected home and client overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-selected-setup-"));
  const environment = {
    HOME: join(root, "selected-home"),
    USERPROFILE: join(root, "selected-home"),
    CODEX_HOME: join(root, "selected-codex"),
    npm_command: "exec",
  };
  vi.stubEnv("HOME", join(root, "ambient-home"));
  vi.stubEnv("CODEX_HOME", join(root, "ambient-codex"));
  vi.stubEnv("npm_command", "other");
  try {
    const doctor = createDoctorHostFixture({ homeDirectory: environment.HOME });
    const host = systemSetupHost(doctor, environment);
    const result = await runSetup(
      {
        ...options(false),
        dryRun: true,
        clientIds: ["codex"],
        installSkill: true,
      },
      host,
    );
    expect(result.status).toBe("planned");
    expect(result.plannedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "configure_client:codex",
          target: join(environment.CODEX_HOME, "config.toml"),
        }),
        expect.objectContaining({
          id: "install_skill",
          target: join(
            environment.HOME,
            ".agents/skills",
            PRODUCT_IDENTITY.skillName,
          ),
        }),
      ]),
    );
    expect(host.registrationCommand).toEqual(
      currentClientRegistrationCommand({ platform: "win32", environment }),
    );
    const clients = await systemUninstallHost(
      environment.HOME,
      undefined,
      environment,
    ).clients();
    expect(clients.find(({ name }) => name === "codex")?.configPath).toBe(
      join(environment.CODEX_HOME, "config.toml"),
    );
    expect(JSON.stringify(result)).not.toContain("ambient-");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("composes provider diagnostics from selected configuration rather than ambient configuration", async () => {
  vi.stubEnv("GHIDRA_INSTALL_DIR", "/ambient/ghidra");
  vi.stubEnv("REA_IDA_MCP_CONFIG", "/ambient/ida.json");
  const host = createSystemDoctorHost({
    GHIDRA_INSTALL_DIR: "/selected/ghidra",
    REA_IDA_MCP_CONFIG: "/selected/ida.json",
  });
  const inspections = await host.providerInspections?.();
  expect(inspections?.find(({ id }) => id === "ghidra")?.configured).toBe(true);
  expect(JSON.stringify(inspections)).toContain("/selected/ghidra");
  expect(JSON.stringify(inspections)).toContain("/selected/ida.json");
  expect(JSON.stringify(inspections)).not.toContain("/ambient/");
});

it("includes the macOS Hopper installer diagnostic in setup remediation", async () => {
  const install = vi
    .spyOn(macHopperInstaller, "installMacHopper")
    .mockResolvedValue({
      status: "failed",
      reason: "mount",
      diagnostic: "hdiutil attach exited 1:\n\u001b[31mresource busy\u001b[0m",
    });
  const host = systemSetupHost(
    createDoctorHostFixture({ platform: "darwin" }),
    { HOME: "/fixture/home", USERPROFILE: "/fixture/home" },
  );
  try {
    const result = await host.installHopper(false);
    expect(result).toMatchObject({
      status: "failed",
      code: "mount_failed",
      remediation: expect.stringContaining(
        "Installer detail: hdiutil attach exited 1: resource busy",
      ),
    });
    if (result.status !== "failed") throw new Error("expected setup failure");
    expect(result.remediation).not.toContain("\u001b");
  } finally {
    await host.close?.();
    install.mockRestore();
  }
});

it("preserves a validated selected JEB endpoint in setup registrations without claiming live readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-jeb-setup-"));
  const endpoint = "http://127.0.0.1:8425/mcp/";
  const ambientEndpoint = "http://127.0.0.1:8426/mcp";
  vi.stubEnv("REA_JEB_MCP_URL", ambientEndpoint);
  try {
    const environment = {
      HOME: root,
      USERPROFILE: root,
      CODEX_HOME: join(root, "codex"),
      REA_JEB_MCP_URL: endpoint,
    };
    const doctorHost = createSystemDoctorHost(environment);
    const setupHost = systemSetupHost(doctorHost, environment);
    const state = await setupHost.initialSetupState();

    expect(state.providerEnvironment).toHaveProperty(
      "REA_JEB_MCP_URL",
      endpoint,
    );
    const planned = await runSetup(
      {
        ...options(false),
        dryRun: true,
        clientIds: ["codex"],
        installSkill: false,
      },
      setupHost,
    );
    expect(planned.status).toBe("planned");
    expect(JSON.stringify(planned.plannedActions)).toContain(endpoint);
    expect(JSON.stringify(planned.plannedActions)).not.toContain(
      ambientEndpoint,
    );
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  {
    name: "registration-only settings",
    environment: {
      REA_ANALYSIS_PROVIDER: "auto",
      REA_BRIDGE_MAX_REQUEST_BYTES: "33554432",
      REA_GHIDRA_STARTUP_TIMEOUT_MS: "2700000",
      REA_HOPPER_STARTUP_TIMEOUT_MS: "120000",
      REA_MCP_INPUT_SCHEMA_PROFILE: "full",
      REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "256",
      REA_REGEX_MATCHING_DEADLINE_MS: "10000",
      REA_REGEX_WORKER_HEAP_REQUEST_MIB: "256",
      REA_MCP_INITIALIZE_BUDGET_MS: "16000",
      REA_MCP_TOOLS_LIST_BUDGET_MS: "6000",
      REA_MCP_FIRST_CATALOG_BUDGET_MS: "21000",
      REA_MCP_DOCTOR_DEADLINE_MS: "31000",
    },
    providerConfigured: false,
    installHopper: true,
  },
  {
    name: "an explicit unready provider selection",
    environment: { REA_ANALYSIS_PROVIDER: "ghidra" },
    providerConfigured: true,
    installHopper: false,
  },
])(
  "derives Hopper proposal behavior from setup-host facts for $name",
  async ({ environment, providerConfigured, installHopper }) => {
    const doctorHost = createDoctorHostFixture({
      platform: "darwin",
      validTarget: () => Promise.resolve(false),
      executable: () => Promise.resolve(false),
    });
    const setupHost = systemSetupHost(doctorHost, {
      HOME: "/fixture/home",
      USERPROFILE: "/fixture/home",
      ...environment,
    });
    try {
      const initial = await setupHost.initialSetupState();
      expect(initial.providerConfigured).toBe(providerConfigured);
      if ("REA_MCP_INPUT_SCHEMA_PROFILE" in environment) {
        expect(initial.providerEnvironment).toMatchObject({
          REA_ANALYSIS_PROVIDER: "auto",
          REA_BRIDGE_MAX_REQUEST_BYTES: "33554432",
          REA_GHIDRA_STARTUP_TIMEOUT_MS: "2700000",
          REA_HOPPER_STARTUP_TIMEOUT_MS: "120000",
          REA_MCP_INPUT_SCHEMA_PROFILE: "full",
          REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "256",
          REA_REGEX_MATCHING_DEADLINE_MS: "10000",
          REA_REGEX_WORKER_HEAP_REQUEST_MIB: "256",
          REA_MCP_INITIALIZE_BUDGET_MS: "16000",
          REA_MCP_TOOLS_LIST_BUDGET_MS: "6000",
          REA_MCP_FIRST_CATALOG_BUDGET_MS: "21000",
          REA_MCP_DOCTOR_DEADLINE_MS: "31000",
        });
      } else {
        expect(initial.providerEnvironment).not.toHaveProperty(
          "REA_BRIDGE_MAX_REQUEST_BYTES",
        );
        expect(initial.providerEnvironment).not.toHaveProperty(
          "REA_REGEX_MATCHING_DEADLINE_MS",
        );
        expect(initial.providerEnvironment).not.toHaveProperty(
          "REA_REGEX_WORKER_HEAP_REQUEST_MIB",
        );
        expect(initial.providerEnvironment).not.toHaveProperty(
          "REA_MCP_INITIALIZE_BUDGET_MS",
        );
      }
      const discovery = await discoverSetupState({
        host: setupHost,
        providerConfigured: initial.providerConfigured,
        forceHopperInstall: false,
        proposeHopper: true,
        initialDoctor: initial.doctor,
      });
      expect(discovery.installHopper).toBe(installHopper);
    } finally {
      await setupHost.close?.();
    }
  },
);

it("passes only selected environment to updater subprocesses and drops npm invocation identity", async () => {
  vi.stubEnv("REA_UPDATE_MARKER", "ambient");
  const result = await updateCommands.runProbe(
    [
      process.execPath,
      "-e",
      "process.stdout.write(JSON.stringify({marker:process.env.REA_UPDATE_MARKER,npm:process.env.npm_command,ambient:process.env.HOME}))",
    ],
    { REA_UPDATE_MARKER: "selected", npm_command: "exec" },
  );
  expect(result).toEqual({ ok: true, value: '{"marker":"selected"}' });
});

it.each([
  { userAgent: "npm/10.9.0 node/v24.11.0 win32 x64", runner: "npx" },
  { userAgent: "bun/1.4.2 npm/? node/v26.3.0 win32 x64", runner: "bunx" },
] as const)(
  "registers the $runner launcher from a Windows CLI environment snapshot",
  ({ userAgent, runner }) => {
    // The CLI snapshot canonicalizes Windows variable names to upper case.
    const environment = snapshotEnvironment(
      { npm_command: "exec", npm_config_user_agent: userAgent },
      "win32",
    );
    expect(invokingPackageRunner(environment, "win32")).toBe(runner);
    expect(
      systemSetupHost(
        createDoctorHostFixture({ platform: "win32" }),
        environment,
      ).registrationCommand,
    ).toEqual(currentClientRegistrationCommand({ platform: "win32" }));
    expect(withoutPackageRunnerIdentity(environment, "win32")).toEqual({
      NPM_CONFIG_USER_AGENT: userAgent,
    });
  },
);

it.each([
  {
    architecture: "x64",
    hopperSetupSupported: true,
    code: "download_failed",
    downloads: 1,
  },
  {
    architecture: "arm64",
    hopperSetupSupported: false,
    code: "unsupported_host",
    downloads: 0,
  },
] as const)(
  "installs Linux Hopper from the selected doctor host's $architecture classification",
  async ({ architecture, hopperSetupSupported, code, downloads }) => {
    // Installation must follow the doctor host's facts, never the ambient
    // os-release and process.arch. A refused download keeps the supported case
    // from writing or invoking a package manager.
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 403 }));
    const host = systemSetupHost(
      createDoctorHostFixture({
        platform: "linux",
        architecture,
        linuxDistribution: () =>
          Promise.resolve({
            id: "ubuntu",
            versionId: "24.04",
            packageFamily: "deb",
            hopperSetupSupported,
          }),
      }),
      { HOME: "/fixture/home" },
    );
    try {
      expect(await host.installHopper(false)).toMatchObject({
        status: "failed",
        code,
      });
      expect(fetch).toHaveBeenCalledTimes(downloads);
    } finally {
      fetch.mockRestore();
      await host.close?.();
    }
  },
);

it("registers the selected Windows package runner after canonicalizing environment aliases", async () => {
  const environment = snapshotEnvironment(
    {
      NPM_COMMAND: "run",
      npm_command: "exec",
      NPM_CONFIG_USER_AGENT: "npm/10.9.0 node/v24.11.0 win32 x64",
    },
    "win32",
  );
  expect(environment).toEqual({
    NPM_COMMAND: "exec",
    NPM_CONFIG_USER_AGENT: "npm/10.9.0 node/v24.11.0 win32 x64",
  });
  expect(invokingPackageRunner(environment, "win32")).toBe("npx");

  const host = systemSetupHost(
    createDoctorHostFixture({ platform: "win32" }),
    environment,
  );
  try {
    expect(host.registrationCommand).toEqual(
      currentClientRegistrationCommand({ platform: "win32" }),
    );
  } finally {
    await host.close?.();
  }
});

let updateCommands: UpdateCommandRunner;
beforeEach(() => {
  updateCommands = new UpdateCommandRunner();
});
afterEach(async () => {
  await updateCommands.close();
});
