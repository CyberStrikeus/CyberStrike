import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSetup } from "./Setup.js";
import type { SetupProgressEvent } from "./SetupTypes.js";
import { FakeSetupHost, options } from "./Setup.fixture.js";
import { SetupSkillInstallError } from "./SetupSkill.js";
import { err, ok } from "../domain/result.js";
import { HopperReleaseError } from "./HopperReleaseFeed.js";

const linkedSkillFailure = () =>
  new SetupSkillInstallError({
    path: "/fixture/home/.claude/skills/reverse-engineer-anything",
    stage: "prepare",
    reason: "Skill directory is a symbolic link",
    rollbackFailures: [],
    recoveryBackupPaths: [],
    cause: undefined,
  });

describe("Linux publisher cache approval", () => {
  it.each([true, false])(
    "discloses the selected cache or blocks an unresolved path before approval: %s",
    async (valid) => {
      const host = Object.assign(new FakeSetupHost("linux"), {
        linuxHopperReleaseCache: valid
          ? ok("/caller/cache/rea/hopper-releases")
          : err(
              new HopperReleaseError(
                "verification_unavailable",
                "Invalid selected cache path",
              ),
            ),
      });
      host.distribution = {
        id: "ubuntu",
        versionId: "24.04",
        packageFamily: "deb",
        hopperSetupSupported: true,
      };
      const result = await runSetup(options(false, true), host);
      if (valid)
        expect(
          result.plannedActions.find(({ kind }) => kind === "install_hopper")
            ?.detail,
        ).toContain("/caller/cache/rea/hopper-releases/<launcher-sha256>");
      else
        expect(result).toMatchObject({
          status: "needs_human",
          plannedActions: [],
        });
      expect(host.hopperInstalls).toBe(0);
      expect(host.configurations).toBe(0);
      expect(host.skillInstalls).toBe(0);
    },
  );
});

describe("selected skill admission", () => {
  it.each(["codex", "shared"] as const)(
    "keeps %s choices when an unselected client is linked",
    async (choice) => {
      const host = new FakeSetupHost();
      host.hopper = "/Applications/Hopper";
      host.clients = [
        { name: "claude_code", configPath: "/claude.json" },
        { name: "codex", configPath: "/codex.toml", format: "toml" },
      ];
      host.validateSkillDirectories = async (ids) => {
        host.skillDirectoryValidations.push(ids);
        return ids.includes("claude_code")
          ? err(linkedSkillFailure())
          : ok(undefined);
      };
      const result = await runSetup(
        { ...options(false), structured: false },
        host,
        async (actions, context) => {
          if (context?.stage === "select") {
            expect(actions.some(({ kind }) => kind === "install_skill")).toBe(
              true,
            );
            return {
              approved: false,
              selectedActionIds:
                choice === "codex"
                  ? ["configure_client:codex"]
                  : ["install_skill"],
            };
          }
          return true;
        },
      );
      expect(result.status).toBe("ready");
      expect(host.skillInstalls).toBe(1);
      expect(host.configurations).toBe(choice === "codex" ? 1 : 0);
      expect(host.skillDirectoryValidations).toEqual(
        choice === "codex" ? [["codex"], ["codex"]] : [[], []],
      );
    },
  );

  it.each([
    { decision: "the offered skill ID", acceptAll: false },
    { decision: "accept all", acceptAll: true },
  ])(
    "keeps a CLI-only skill choice independent of detected personal copies ($decision)",
    async ({ acceptAll }) => {
      const host = new FakeSetupHost();
      host.hopper = "/Applications/Hopper";
      host.clients = [{ name: "claude_code", configPath: "/claude.json" }];
      const offered: string[] = [];
      const result = await runSetup(
        { ...options(false), structured: false },
        host,
        async (actions, context) => {
          if (context?.stage === "select") {
            const skill = actions.find(({ kind }) => kind === "install_skill");
            offered.push(skill?.id ?? "");
            if (acceptAll) return true;
            return {
              approved: false,
              selectedActionIds: skill === undefined ? [] : [skill.id],
            };
          }
          return true;
        },
      );
      expect(offered).toEqual(["install_skill"]);
      expect(result.status).toBe("ready");
      expect(
        result.plannedActions.map(({ id, target }) => ({ id, target })),
      ).toEqual([
        {
          id: "install_skill",
          target: join(
            "/fixture/home",
            ".agents",
            "skills",
            "reverse-engineer-anything",
          ),
        },
      ]);
      expect(result.appliedActions).toEqual(["installed_skill"]);
      expect(host.skillInstalls).toBe(1);
      expect(host.configurations).toBe(0);
      expect(host.skillDirectoryValidations).toEqual([[], []]);
    },
  );

  it("rechecks directory admission after approval before changing clients or Hopper", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    host.clients = [{ name: "claude_code", configPath: "/claude.json" }];
    let linked = false;
    host.validateSkillDirectories = async () =>
      linked ? err(linkedSkillFailure()) : ok(undefined);
    const result = await runSetup(
      {
        ...options(false, true),
        clientIds: ["claude_code"],
        structured: false,
      },
      host,
      async () => {
        linked = true;
        return true;
      },
    );
    expect(result).toMatchObject({
      status: "needs_human",
      code: "skill_install_failed",
      appliedActions: [],
    });
    expect(host.configurations).toBe(0);
    expect(host.hopperInstalls).toBe(0);
    expect(host.skillInstalls).toBe(0);
  });
});

describe("skill plan destinations", () => {
  it("plans a Claude-only skill in its personal location", async () => {
    const host = new FakeSetupHost();
    host.clients = [{ name: "claude_code", configPath: "/claude.json" }];

    const result = await runSetup(
      { ...options(false), clientIds: ["claude_code"] },
      host,
    );

    expect(
      result.plannedActions
        .filter(({ kind }) => kind === "install_skill")
        .map(({ target }) => target),
    ).toEqual([
      join("/fixture/home", ".claude", "skills", "reverse-engineer-anything"),
    ]);
  });

  it("plans both shared and personal skill roots for mixed clients", async () => {
    const host = new FakeSetupHost();
    host.clients = [
      { name: "claude_code", configPath: "/claude.json" },
      { name: "codex", configPath: "/codex.toml", format: "toml" },
    ];

    const result = await runSetup(
      { ...options(false), clientIds: ["claude_code", "codex"] },
      host,
    );

    expect(
      result.plannedActions
        .filter(({ kind }) => kind === "install_skill")
        .map(({ target }) => target),
    ).toEqual([
      join("/fixture/home", ".agents", "skills", "reverse-engineer-anything"),
      join("/fixture/home", ".claude", "skills", "reverse-engineer-anything"),
    ]);
  });
});

describe("setup workflow", () => {
  it("blocks client registration when no executable entrypoint is available", async () => {
    const host = new FakeSetupHost("win32");
    host.registrationCommand = [];
    host.registrationCommandBlocker =
      "REA could not determine the current executable entrypoint.";
    host.clients = [{ name: "codex", configPath: "C:\\config\\codex.toml" }];

    const result = await runSetup(
      { ...options(true), clientIds: ["codex"], installSkill: false },
      host,
    );

    expect(result.status).toBe("needs_human");
    expect(result.plannedActions).toEqual([]);
    expect(result.remediation).toBe(host.registrationCommandBlocker);
    expect(host.configurations).toBe(0);
  });

  it("keeps a relative Node registration out of setup defaults when cwd happens to match", async () => {
    const host = new FakeSetupHost();
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];
    host.productRegistrations = [
      {
        client: "cursor",
        config_path: "/cursor.json",
        command: [process.execPath, "./rea.mjs", "mcp"],
        state: "stale",
        remediation: "Run rea setup to refresh this registration.",
      },
    ];

    const result = await runSetup(
      { ...options(false), clientIds: [], installSkill: false },
      host,
    );

    expect(result.clientStates).toContainEqual(
      expect.objectContaining({
        client: expect.objectContaining({ name: "cursor" }),
        status: "unknown",
        configured: false,
      }),
    );
    expect(result.plannedActions).toEqual([]);
    expect(host.configurations).toBe(0);
  });
});

describe("setup client selection", () => {
  it.each([
    {
      name: "explicit clients before detected clients without duplicates",
      selection: { clientIds: ["cursor", "codex", "cursor"] },
      expected: ["cursor", "codex"],
    },
    {
      name: "readiness-scope clients when no explicit list is supplied",
      selection: { readinessScope: { clients: ["cursor"] } },
      expected: ["cursor", "codex"],
    },
    {
      name: "only detected clients without an explicit selection",
      selection: {},
      expected: ["codex"],
    },
  ])("configures and verifies $name", async ({ selection, expected }) => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    const codex = {
      name: "codex",
      configPath: "/codex.toml",
      format: "toml" as const,
    };
    host.clients = [codex];
    host.availableClients = [
      { name: "cursor", configPath: "/cursor.json" },
      codex,
    ];

    const result = await runSetup(
      { ...options(true), ...selection, allDetectedClients: true },
      host,
    );

    expect(result.status).toBe("ready");
    expect(result.plannedActions.map(({ id }) => id)).toEqual(
      expected.map((id) => `configure_client:${id}`),
    );
    expect(result.appliedActions).toEqual(
      expected.map((id) => `configured_${id}`),
    );
    expect(host.configurations).toBe(expected.length);
    expect(host.skillDirectoryValidations).toEqual([expected, expected]);
    expect(host.doctorScopes.at(-1)).toEqual({
      clients: expected,
      providers: [],
      skill: true,
      skillClients: expected,
    });
    expect(host.hopperInstalls).toBe(0);
    expect(host.skillInstalls).toBe(0);
  });

  it.each([true, false])(
    "handles repeated clients once in first-selected order (dry run: %s)",
    async (dryRun) => {
      const host = new FakeSetupHost();
      host.hopper = "/Applications/Hopper";
      host.skill = "unchanged";
      host.clients = [
        { name: "cursor", configPath: "/cursor.json" },
        { name: "codex", configPath: "/codex.toml", format: "toml" },
      ];
      const inspected: string[] = [];
      const configured: string[] = [];
      const inspect = host.inspectClientConfiguration;
      const configure = host.configureClient;
      host.inspectClientConfiguration = (client) => {
        inspected.push(client.name);
        return inspect(client);
      };
      host.configureClient = (client, environment, command) => {
        configured.push(client.name);
        return configure(client, environment, command);
      };

      const result = await runSetup(
        {
          ...options(true),
          clientIds: ["codex", "cursor", "codex", "cursor"],
          installSkill: false,
          dryRun,
        },
        host,
      );

      expect(result.status).toBe(dryRun ? "planned" : "ready");
      expect(result.plannedActions.map(({ id }) => id)).toEqual([
        "configure_client:codex",
        "configure_client:cursor",
      ]);
      expect(inspected).toEqual(["codex", "cursor"]);
      expect(configured).toEqual(dryRun ? [] : ["codex", "cursor"]);
      expect(result.appliedActions).toEqual(
        dryRun ? [] : ["configured_codex", "configured_cursor"],
      );
      if (!dryRun) {
        expect(result.clients).toEqual({
          codex: { status: "configured" },
          cursor: { status: "configured" },
        });
        expect(host.doctorScopes.at(-1)?.clients).toEqual(["codex", "cursor"]);
      }
      expect(host.hopperInstalls).toBe(0);
      expect(host.skillInstalls).toBe(0);
    },
  );
});

describe("setup plan application", () => {
  it("returns a complete plan without mutation", async () => {
    const host = new FakeSetupHost();
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];
    const result = await runSetup(
      { ...options(false), clientIds: ["cursor"] },
      host,
    );
    expect(result.status).toBe("needs_confirmation");
    expect(result.plannedActions.map(({ kind }) => kind)).toEqual([
      "configure_client",
      "install_skill",
    ]);
    expect(host.hopperInstalls).toBe(0);
    expect(host.configurations).toBe(0);
    expect(result.remediation).toBe(
      "Review the setup plan, then rerun interactively or with --yes.",
    );
  });

  it("reports ready after an accepted Linux plan installs healthy Hopper", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    const result = await runSetup(
      { ...options(false), structured: false },
      host,
      () => Promise.resolve(true),
    );
    expect(result.status).toBe("ready");
    expect(result.appliedActions).toEqual([
      "installed_hopper",
      "installed_skill",
    ]);
    expect(host.hopperInstalls).toBe(1);
    expect(result.remediation).toBeUndefined();
  });

  it("requires first-run activation after installing Hopper on macOS", async () => {
    const host = new FakeSetupHost();
    const result = await runSetup(
      { ...options(false), structured: false },
      host,
      () => Promise.resolve(true),
    );
    expect(result.status).toBe("needs_human");
    expect(result.remediation).toContain("choose its demo mode");
  });

  it("declines an interactive plan without mutation", async () => {
    const host = new FakeSetupHost();
    const result = await runSetup(
      { ...options(false), structured: false },
      host,
      () => Promise.resolve(false),
    );
    expect(result.status).toBe("cancelled");
    expect(result.appliedActions).toEqual([]);
    expect(host.hopperInstalls).toBe(0);
    expect(host.doctorCalls).toBe(1);
  });

  it("treats an empty interactive selection as cancellation", async () => {
    const host = new FakeSetupHost();
    host.clients = [{ name: "codex", configPath: "/codex.toml" }];

    const result = await runSetup(
      { ...options(false), structured: false },
      host,
      () => Promise.resolve({ approved: false, selectedActionIds: [] }),
    );

    expect(result.status).toBe("ready");
    expect(result.plannedActions).toEqual([]);
    expect(result.appliedActions).toEqual([]);
    expect(host.configurations).toBe(0);
    expect(host.skillInstalls).toBe(0);
    expect(host.hopperInstalls).toBe(0);
    expect(host.doctorCalls).toBe(2);
  });

  it("requires the Hopper flag for unattended setup", async () => {
    const host = new FakeSetupHost();
    const result = await runSetup(options(true), host);
    expect(result.status).toBe("ready");
    expect(host.hopperInstalls).toBe(0);
    expect(result.appliedActions).toEqual([]);
  });

  it("returns an approved planning outcome for explicit dry runs", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    host.clients = [{ name: "codex", configPath: "/codex.toml" }];

    const result = await runSetup(
      { ...options(false), dryRun: true, clientIds: ["codex"] },
      host,
    );

    expect(result.status).toBe("planned");
    expect(result.plannedActions.map(({ id }) => id)).toEqual([
      "configure_client:codex",
    ]);
    expect(host.hopperInstalls).toBe(0);
    expect(host.configurations).toBe(0);
  });

  it("installs Hopper when unattended authorization is explicit", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    const result = await runSetup(options(true, true), host);
    expect(result.appliedActions).toEqual(["installed_hopper"]);
    expect(host.hopperInstalls).toBe(1);
    expect(result.status).toBe("ready");
    expect(result.remediation).toBeUndefined();
  });

  it("records an installed Hopper when opening the app needs manual recovery", async () => {
    const host = new FakeSetupHost("darwin");
    host.installHopper = () =>
      Promise.resolve({
        status: "installed",
        launcherPath: "/Applications/Hopper.app/Contents/MacOS/hopper",
        warning:
          "Hopper was installed, but macOS could not open it. Open it manually.",
      });

    const result = await runSetup(options(true, true), host);

    expect(result).toMatchObject({
      status: "needs_human",
      appliedActions: ["installed_hopper"],
      remediation: expect.stringContaining("Open it manually"),
    });
  });

  it("reuses existing Hopper without selecting every detected client", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.clients = [
      { name: "claude", configPath: "/claude.json" },
      { name: "cursor", configPath: "/cursor.json" },
    ];
    const result = await runSetup(options(true), host);
    expect(result.status).toBe("ready");
    expect(result.appliedActions).toEqual([]);
    expect(host.hopperInstalls).toBe(0);
  });
});

describe("setup workflow lifecycle and provider planning", () => {
  it("reports append-only lifecycle progress for each selected action", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.clients = [
      {
        name: "codex",
        displayName: "Codex",
        configPath: "/codex.toml",
      },
    ];
    host.productRegistrations = [
      {
        client: "codex",
        config_path: "/codex.toml",
        command: ["rea", "mcp"],
        state: "aligned",
        remediation: null,
      },
    ];
    const progress: SetupProgressEvent[] = [];
    await runSetup(
      { ...options(true), onProgress: (event) => progress.push(event) },
      host,
    );
    expect(progress).toEqual([
      { actionId: "configure_client:codex", label: "Codex", state: "started" },
      {
        actionId: "configure_client:codex",
        label: "Codex",
        state: "completed",
      },
      {
        actionId: "install_skill",
        label: "REA reverse-engineering skill",
        state: "started",
      },
      {
        actionId: "install_skill",
        label: "REA reverse-engineering skill",
        state: "completed",
      },
    ]);
  });

  it("plans and propagates BYO Ghidra without installing software", async () => {
    const host = new FakeSetupHost("linux");
    host.distribution = {
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    };
    host.ghidra = "/opt/ghidra_12.1.4_PUBLIC";
    host.javaHome = "/usr/lib/jvm/jdk-21";
    host.doctorHealthy = true;
    host.skill = "unchanged";
    host.clients = [{ name: "cursor", configPath: "/cursor.json" }];

    const plan = await runSetup(
      { ...options(false), clientIds: ["cursor"] },
      host,
    );
    expect(plan.plannedActions.map(({ kind }) => kind)).toEqual([
      "configure_client",
    ]);
    expect(plan.plannedActions[0]?.detail).toContain(
      "GHIDRA_INSTALL_DIR=/opt/ghidra_12.1.4_PUBLIC",
    );
    expect(plan.plannedActions[0]?.detail).toContain(
      "JAVA_HOME=/usr/lib/jvm/jdk-21",
    );
    expect(host.hopperInstalls).toBe(0);
    expect(host.configurations).toBe(0);

    const applied = await runSetup(
      { ...options(true), clientIds: ["cursor"] },
      host,
    );
    expect(applied.status).toBe("ready");
    expect(host.hopperInstalls).toBe(0);
    expect(host.configuredProviderEnvironments).toContainEqual({
      GHIDRA_INSTALL_DIR: "/opt/ghidra_12.1.4_PUBLIC",
      JAVA_HOME: "/usr/lib/jvm/jdk-21",
    });
  });

  it("reinstalls existing Hopper when explicitly requested", async () => {
    const host = new FakeSetupHost();
    host.hopper = "/Applications/Hopper";
    host.skill = "unchanged";
    host.clients = [{ name: "codex", configPath: "/codex.toml" }];
    host.clientResults.set("codex", { status: "unchanged" });

    const result = await runSetup(
      { ...options(true, true), clientIds: ["codex"] },
      host,
    );

    expect(result.plannedActions.map(({ kind }) => kind)).toEqual([
      "install_hopper",
      "configure_client",
    ]);
    expect(result.appliedActions).toEqual(["installed_hopper"]);
    expect(host.hopperInstalls).toBe(1);
    expect(host.hopperReplaceRequests).toEqual([true]);
    expect(host.configurations).toBe(0);
    expect(host.checkedHopperPaths).toEqual(["/manual/Hopper"]);
  });

  it("does not write a file when Grok Bot is selected", async () => {
    const host = new FakeSetupHost();
    host.doctorHealthy = true;
    host.skill = "unchanged";
    host.clients = [
      {
        name: "grok_bot",
        displayName: "Grok Bot",
        configPath: "/home/user/.grokbot",
        format: "unsupported",
      },
    ];

    const planned = await runSetup(
      { ...options(true), clientIds: ["grok_bot"], dryRun: true },
      host,
    );
    expect(planned.status).toBe("planned");
    expect(planned.plannedActions).toEqual([]);
    expect(planned.remediation).toContain("hosted computer");
    expect(host.configurations).toBe(0);

    const applied = await runSetup(
      { ...options(true), clientIds: ["grok_bot"] },
      host,
    );
    expect(applied.status).toBe("needs_human");
    expect(applied.appliedActions).toEqual([]);
    expect(applied.remediation).toContain("hosted computer");
    expect(host.configurations).toBe(0);
  });
});
