import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { FakeSetupHost, options } from "./Setup.fixture.js";
import { runSetup } from "./Setup.js";
import { currentClientRegistrationCommand } from "./ClientRegistrationIdentity.js";
import { CURRENT_ENTRYPOINT_PATH } from "../process/CurrentEntrypointPath.js";
import { discoverSetupState } from "./SetupPlan.js";
import type { MsixPackageView } from "./MsixPackageStorage.js";
import {
  registrationWriteBlocker,
  type SetupClient,
} from "./SupportedClients.js";

// Host joins keep containment checks meaningful on POSIX test hosts too.
const PROFILE = String.raw`C:\Users\a`;
const ROAMING = join(PROFILE, "AppData", "Roaming");
const LOCAL = join(PROFILE, "AppData", "Local");
const PRIVATE_CONFIG = join(
  LOCAL,
  "Packages",
  "Claude_pzs8sxrjxfjjc",
  "LocalCache",
  "Roaming",
  "Claude",
  "claude_desktop_config.json",
);
const APPDATA_CONFIG = join(ROAMING, "Claude", "claude_desktop_config.json");

/** Claude Desktop as setup resolves it from its MSIX package storage. */
const msixClaudeDesktop = (
  processView: MsixPackageView["processView"],
): SetupClient => ({
  name: "claude_desktop",
  displayName: "Claude Desktop",
  configPath: PRIVATE_CONFIG,
  quitBeforeSetup: true,
  msixPackage: {
    packageFamilyName: "Claude_pzs8sxrjxfjjc",
    privateConfigPath: PRIVATE_CONFIG,
    appDataConfigPath: APPDATA_CONFIG,
    virtualizedRoots: [ROAMING, LOCAL],
    processView,
  },
});

describe("setup workflow", () => {
  it("omits an aligned managed skill from an otherwise empty plan", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    const result = await runSetup(options(false), host);
    expect(result.status).toBe("ready");
    expect(result.plannedActions).toEqual([]);
    expect(result.appliedActions).toEqual([]);
    expect(host.skillInstalls).toBe(0);
  });

  it("installs missing Linux demo dependencies for existing Hopper", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    host.hopper = "/opt/hopper/bin/Hopper";
    host.linuxDemoRuntimeMissing = true;
    const result = await runSetup(
      { ...options(false), structured: false },
      host,
      () => Promise.resolve(true),
    );
    expect(result.status).toBe("ready");
    expect(host.hopperInstalls).toBe(1);
    expect(result.plannedActions.map(({ kind }) => kind)).toContain(
      "install_hopper",
    );
  });

  it("does not reinstall Hopper for an unsupported configured path", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    host.hopper = "/custom/Hopper";
    host.unsupportedHopperVersion = true;
    const result = await runSetup(
      {
        ...options(true),
        clientIds: [],
        installSkill: false,
        proposeHopper: false,
        readinessScope: { providers: ["hopper"] },
      },
      host,
    );
    expect(result.status).toBe("needs_human");
    expect(host.hopperInstalls).toBe(0);
    expect(result.plannedActions.map(({ kind }) => kind)).not.toContain(
      "install_hopper",
    );
  });

  it("blocks malformed client configuration before Hopper or file mutation", async () => {
    const host = new FakeSetupHost();
    host.clients = [
      { name: "codex", displayName: "Codex", configPath: "/codex.toml" },
    ];
    host.clientInspections.set("codex", {
      status: "invalid",
      remediation: "Repair the existing TOML.",
    });

    const result = await runSetup(
      { ...options(true, true), clientIds: ["codex"] },
      host,
    );

    expect(result.status).toBe("needs_human");
    expect(result.remediation).toBe("Codex: Repair the existing TOML.");
    expect(host.hopperInstalls).toBe(0);
    expect(host.configurations).toBe(0);
    expect(host.skillInstalls).toBe(0);
  });

  it("blocks malformed configuration before unrelated writes with an existing provider", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    host.clients = [
      {
        name: "claude_desktop",
        displayName: "Claude Desktop",
        configPath: "/claude.json",
      },
      { name: "cursor", displayName: "Cursor", configPath: "/cursor.json" },
    ];
    host.clientInspections.set("claude_desktop", {
      status: "invalid",
      remediation: "Repair the existing JSON.",
    });

    const result = await runSetup(
      { ...options(true), clientIds: ["claude_desktop"] },
      host,
    );

    expect(result.status).toBe("needs_human");
    expect(result.remediation).toBe(
      "Claude Desktop: Repair the existing JSON.",
    );
    expect(host.configurations).toBe(0);
    expect(host.skillInstalls).toBe(0);
  });

  it("plans a client update when Hopper installation changes its desired environment", async () => {
    const host = new FakeSetupHost();
    host.clients = [
      { name: "codex", displayName: "Codex", configPath: "/codex.toml" },
    ];
    host.clientInspections.set("codex", { status: "already_current" });

    const result = await runSetup(
      { ...options(false, true), clientIds: ["codex"] },
      host,
    );

    expect(
      result.plannedActions.map(({ id, operation }) => ({
        id,
        operation,
      })),
    ).toContainEqual({
      id: "configure_client:codex",
      operation: "update",
    });
    expect(host.configurations).toBe(0);
  });
});

describe("optional Hopper installation failures", () => {
  it("reports a failed Hopper installation and still configures the selected clients", async () => {
    // Hopper is optional; a package conflict must not cost the approved client
    // registrations and skill (#5113).
    const host = new FakeSetupHost();
    host.hopperInstallSucceeds = false;
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];
    const result = await runSetup(
      {
        ...options(true, true),
        clientIds: ["cursor"],
        skillClientIds: ["cursor"],
      },
      host,
    );
    expect(result.status).toBe("needs_human");
    expect(result.code).toBe("download_failed");
    expect(result.remediation).toBe("Download failed.");
    expect(result.appliedActions).not.toContain("installed_hopper");
    expect(host.configurations).toBe(1);
    expect(host.configuredProviderEnvironments).toEqual([{}]);
    expect(host.skillInstalls).toBe(1);
  });

  it("keeps the Hopper failure when a client write also fails", async () => {
    const host = new FakeSetupHost();
    host.hopperInstallSucceeds = false;
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];
    host.clientResults.set("cursor", { status: "failed", reason: "write" });
    const result = await runSetup(
      { ...options(true, true), clientIds: ["cursor"] },
      host,
    );
    expect(result.code).toBe("download_failed");
    expect(result.remediation).toContain("Download failed.");
    expect(result.remediation).toContain("could not be updated");
    expect(result.clients.cursor).toMatchObject({
      status: "failed",
      reason: "write",
    });
    expect(host.configurations).toBe(1);
  });

  it("keeps the Hopper repair steps when the skill install also fails", async () => {
    const host = new FakeSetupHost();
    host.hopperInstallSucceeds = false;
    host.skill = "failed";
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];
    const result = await runSetup(
      {
        ...options(true, true),
        clientIds: ["cursor"],
        skillClientIds: ["cursor"],
      },
      host,
    );
    expect(result.code).toBe("skill_install_failed");
    expect(result.remediation).toContain("Download failed.");
    expect(result.remediation).toContain("injected skill write failure");
    expect(host.skillInstalls).toBe(1);
  });
});

describe("configured Linux Hopper selection", () => {
  it("keeps an explicitly configured launcher even when demo checks fail", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    host.hopper = "/opt/hopper/bin/Hopper";
    host.hopperLauncherConfigured = true;
    host.linuxDemoRuntimeMissing = true;
    const doctor = await host.doctor();
    const initial = await host.initialSetupState();
    const discovery = await discoverSetupState({
      host,
      providerConfigured: initial.providerConfigured,
      forceHopperInstall: false,
      proposeHopper: true,
      hopperLauncherConfigured: true,
      initialDoctor: doctor,
    });
    expect(discovery.installHopper).toBe(false);
  });

  it("still offers repair for an unconfigured REA managed install", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    host.hopper = "/opt/hopper/bin/Hopper";
    host.unsupportedHopperVersion = true;
    const initial = await host.initialSetupState();
    const discovery = await discoverSetupState({
      host,
      providerConfigured: initial.providerConfigured,
      forceHopperInstall: false,
      proposeHopper: true,
      initialDoctor: await host.doctor(),
    });
    expect(discovery.installHopper).toBe(true);
  });
});

it("offers shared skill intent when the detected personal copy is current", async () => {
  const host = new FakeSetupHost();
  host.hopper = "/Applications/Hopper";
  host.clients = [{ name: "claude_code", configPath: "/claude.json" }];
  host.skillNeedsInstall = (clients) => Promise.resolve(clients.length === 0);
  const result = await runSetup(
    { ...options(false), structured: false },
    host,
    async (actions, context) => {
      if (context?.stage !== "select") return true;
      expect(actions).toContainEqual(
        expect.objectContaining({ id: "install_skill" }),
      );
      return { approved: false, selectedActionIds: ["install_skill"] };
    },
  );
  expect(result.status).toBe("ready");
  expect(result.plannedActions).toEqual([
    expect.objectContaining({
      id: "install_skill",
      target: join(
        host.homeDirectory,
        ".agents",
        "skills",
        "reverse-engineer-anything",
      ),
    }),
  ]);
  expect(host.configurations).toBe(0);
  expect(host.skillInstalls).toBe(1);
});

describe("setup workflow action selection", () => {
  it("executes only actions selected by the interactive adapter", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    host.clients = [
      { name: "codex", displayName: "Codex", configPath: "/codex.toml" },
      { name: "cursor", displayName: "Cursor", configPath: "/cursor.json" },
    ];

    const result = await runSetup(
      { ...options(false), structured: false },
      host,
      () =>
        Promise.resolve({
          approved: true,
          selectedActionIds: ["configure_client:codex"],
        }),
    );

    expect(result.plannedActions.map(({ id }) => id)).toEqual([
      "configure_client:codex",
    ]);
    expect(result.clients).toEqual({ codex: { status: "configured" } });
    expect(host.configurations).toBe(1);
    expect(host.skillInstalls).toBe(0);
  });

  it("preflights only selected clients and offers supported clients without markers", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    host.clients = [];
    host.availableClients = [
      { name: "codex", displayName: "Codex", configPath: "/codex.toml" },
      { name: "cursor", displayName: "Cursor", configPath: "/cursor.json" },
    ];
    host.clientInspections.set("cursor", {
      status: "invalid",
      remediation: "Repair the deselected Cursor configuration.",
    });

    const result = await runSetup(
      { ...options(true), clientIds: ["codex"] },
      host,
    );

    expect(result.status).toBe("ready");
    expect(result.plannedActions.map(({ id }) => id)).toEqual([
      "configure_client:codex",
    ]);
    expect(host.configurations).toBe(1);
    expect(result.clientStates).toMatchObject([
      { client: { name: "codex" }, detected: false, status: "missing" },
      { client: { name: "cursor" }, detected: false, status: "missing" },
    ]);
  });

  it("does not default to a foreign command registered under the rea key", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    host.clients = [{ name: "codex", configPath: "/codex.toml" }];
    host.productRegistrations = [
      {
        client: "codex",
        config_path: "/codex.toml",
        command: ["unrelated-agent", "serve"],
        state: "stale",
        remediation: "Refresh this registration.",
      },
    ];

    const result = await runSetup(options(true), host);

    expect(result.status).toBe("ready");
    expect(result.plannedActions).toEqual([]);
    expect(host.configurations).toBe(0);
    expect(result.clientStates).toMatchObject([
      { client: { name: "codex" }, configured: false },
    ]);
  });

  it("uses a Windows-safe executable command for an explicit client", async () => {
    const host = new FakeSetupHost("win32");
    host.scopedDoctorHealthy = true;
    host.skill = "unchanged";
    host.clients = [{ name: "codex", configPath: "C:\\config\\codex.toml" }];

    const result = await runSetup(
      { ...options(true), clientIds: ["codex"], installSkill: false },
      host,
    );

    expect(result.status).toBe("ready");
    expect(host.configuredCommands).toEqual([
      currentClientRegistrationCommand({
        platform: "win32",
        entrypointPath: CURRENT_ENTRYPOINT_PATH,
      }),
    ]);
    expect(
      currentClientRegistrationCommand({
        platform: "win32",
        entrypointPath: CURRENT_ENTRYPOINT_PATH,
      }),
    ).toEqual([process.execPath, CURRENT_ENTRYPOINT_PATH, "mcp"]);
    expect(
      currentClientRegistrationCommand({
        platform: "win32",
        entrypointPath: undefined,
      }),
    ).toEqual([]);
  });
});

describe("setup configuration failure recovery", () => {
  it.each([
    [
      "path",
      "Agent configuration path could not be safely verified. Check its permissions and, if it is a symbolic link, verify that the link resolves to a regular file owned by the current user, then rerun setup.",
    ],
    [
      "backup",
      "Agent configuration could not be backed up, so no change was made. Check file permissions, then rerun setup.",
    ],
    [
      "write",
      "Agent configuration could not be updated. Check file permissions, then rerun setup.",
    ],
    [
      "readback",
      "Agent configuration could not be verified. Repair the configuration file, then rerun setup.",
    ],
  ] as const)("explains %s configuration recovery", async (reason, message) => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.clients = [{ name: "internal_client_key", configPath: "/agent.json" }];
    host.clientResults.set("internal_client_key", { status: "failed", reason });
    // Exercise registration recovery without selecting a synthetic skill client.
    const result = await runSetup(
      {
        ...options(true),
        clientIds: ["internal_client_key"],
        installSkill: false,
      },
      host,
    );
    expect(result.status).toBe("needs_human");
    expect(result.remediation).toBe(message);
    expect(result.remediation).not.toContain("internal_client_key");
    expect(result.plannedActions).toEqual([
      expect.objectContaining({
        id: "configure_client:internal_client_key",
        kind: "configure_client",
        target: "/agent.json",
      }),
    ]);
    expect(result.clients).toEqual({
      internal_client_key: { status: "failed", reason },
    });
    expect(result.appliedActions).toEqual([]);
    expect(host.configurations).toBe(1);
    expect(host.skillDirectoryValidations).toEqual([]);
    expect(host.skillInstalls).toBe(0);
    expect(host.hopperInstalls).toBe(0);
  });

  it("names the recovery backup that holds the restored original after a readback failure", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.clients = [{ name: "cursor", configPath: "/agent.json" }];
    const backupPath = `/agent.json.rea.backup.${"a".repeat(64)}.recovery`;
    host.clientResults.set("cursor", {
      status: "failed",
      reason: "readback",
      backupPath,
    });
    const result = await runSetup(
      { ...options(true), clientIds: ["cursor"] },
      host,
    );
    expect(result.remediation).toBe(
      `Agent configuration could not be verified after writing. The original was restored and its backup at ${backupPath} was retained. Repair the configuration file or restore that backup, then rerun setup.`,
    );
  });
});

describe("MSIX Claude Desktop setup", () => {
  it("discloses which file MSIX Claude Desktop reads and that it must be quit", async () => {
    const host = new FakeSetupHost("win32");
    host.hopper = join(PROFILE, "Hopper");
    host.skill = "unchanged";
    host.clients = [msixClaudeDesktop("direct")];

    const result = await runSetup(
      { ...options(false), clientIds: ["claude_desktop"], dryRun: true },
      host,
    );

    expect(result.status).toBe("planned");
    const [action] = result.plannedActions;
    expect(action?.target).toBe(PRIVATE_CONFIG);
    expect(action?.detail).toContain(
      `Claude Desktop is installed as MSIX package Claude_pzs8sxrjxfjjc, which reads this package-private file instead of ${APPDATA_CONFIG}.`,
    );
    expect(action?.detail).toContain(
      "Quit Claude Desktop fully before approving; closing its window is not enough.",
    );
  });

  it("names the files to edit by hand when the process view is unknown", () => {
    // The package reads its private copy, so a manual setup edit belongs there.
    const client = msixClaudeDesktop("unknown");
    expect(registrationWriteBlocker(client, "setup")).toContain(
      `Add REA's entry to ${PRIVATE_CONFIG} by hand`,
    );
    expect(registrationWriteBlocker(client, "uninstall")).toContain(
      `Remove REA's entry by hand from each of ${PRIVATE_CONFIG} and ${APPDATA_CONFIG} that has one`,
    );
  });

  it("refuses AppData writes from a process the MSIX package started", async () => {
    const host = new FakeSetupHost("win32");
    host.hopper = join(PROFILE, "Hopper");
    host.skill = "unchanged";
    const vscode = join(ROAMING, "Code", "User", "mcp.json");
    host.clients = [
      msixClaudeDesktop("redirected"),
      { name: "vscode", displayName: "VS Code", configPath: vscode },
      {
        name: "codex",
        displayName: "Codex",
        configPath: join(PROFILE, ".codex", "config.toml"),
      },
    ];

    const blocked = await runSetup(
      { ...options(true), clientIds: ["vscode", "codex"] },
      host,
    );
    expect(blocked.status).toBe("needs_human");
    expect(blocked.remediation).toContain(
      `Changes to ${vscode} would not reach the files other apps read.`,
    );
    expect(host.configurations).toBe(0);

    const homeOnly = await runSetup(
      { ...options(true), clientIds: ["codex"] },
      host,
    );
    expect(homeOnly.status).toBe("ready");
    expect(host.configurations).toBe(1);
  });

  it("refuses registrations whose launcher only one MSIX package can see", async () => {
    const host = new FakeSetupHost("win32");
    host.hopper = join(PROFILE, "Hopper");
    host.registrationCommandBlocker = "Install REA outside the package.";
    host.clients = [
      { name: "codex", displayName: "Codex", configPath: "/codex.toml" },
    ];

    const blocked = await runSetup(
      { ...options(true), clientIds: ["codex"] },
      host,
    );
    expect(blocked.status).toBe("needs_human");
    expect(blocked.remediation).toBe("Install REA outside the package.");
    expect(host.configurations).toBe(0);
    expect(host.skillInstalls).toBe(0);

    const skillOnly = await runSetup(
      { ...options(true), clientIds: [], installSkill: true },
      host,
    );
    expect(skillOnly.status).toBe("ready");
    expect(host.skillInstalls).toBe(1);
  });
});

describe("setup tool family scope", () => {
  it("writes the requested scope into the registration environment", async () => {
    const host = new FakeSetupHost();
    host.doctorHealthy = true;
    host.skill = "unchanged";
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];

    const plan = await runSetup(
      {
        ...options(false),
        clientIds: ["cursor"],
        toolFamilies: "session,application",
      },
      host,
    );
    expect(plan.plannedActions[0]?.detail).toContain(
      "REA_MCP_TOOL_FAMILIES=session,application",
    );

    const applied = await runSetup(
      {
        ...options(true),
        clientIds: ["cursor"],
        toolFamilies: "session,application",
      },
      host,
    );
    expect(applied.status).toBe("ready");
    expect(host.configuredProviderEnvironments).toContainEqual({
      REA_MCP_TOOL_FAMILIES: "session,application",
    });
  });

  it("still offers Hopper on an unconfigured machine when a scope is set", async () => {
    const host = new FakeSetupHost("darwin");
    host.version = "14.5";
    host.skill = "unchanged";
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];

    const result = await runSetup(
      {
        ...options(false),
        clientIds: ["cursor"],
        toolFamilies: "session",
        proposeHopper: true,
      },
      host,
    );

    // The advertised family scope is a registration setting, not provider
    // discovery; it must not suppress the Hopper installation offer.
    expect(result.plannedActions.map(({ kind }) => kind)).toContain(
      "install_hopper",
    );
  });
});
