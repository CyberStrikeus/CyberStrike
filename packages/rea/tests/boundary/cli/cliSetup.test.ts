import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { spawn } from "@lydell/node-pty";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parse as parseToml } from "smol-toml";

import type { SetupResult } from "../../../src/application/SetupTypes.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const execute = promisify(execFile);
const decisionMarker = "REA_SETUP_DECISION:";
const decisionSchema = z.object({
  approved: z.boolean(),
  selectedActionIds: z.array(z.string()),
  cancelled: z.boolean().optional(),
});

const actions = [
  {
    id: "configure_client:codex",
    kind: "configure_client",
    label: "Codex",
    target: "/isolated/.codex/config.toml",
    detail: "Add the REA MCP registration for Codex.",
    external: false,
    operation: "create",
  },
  {
    id: "install_skill",
    kind: "install_skill",
    label: "REA reverse-engineering skill",
    target: "/isolated/.agents/skills/reverse-engineering/SKILL.md",
    detail: "Install the bundled reverse-engineering skill.",
    external: false,
    operation: "install",
  },
  {
    id: "install_hopper",
    kind: "install_hopper",
    label: "Hopper deep-analysis provider",
    target: "/isolated/Applications/Hopper Disassembler.app",
    detail: "Install the verified Hopper package.",
    external: true,
    operation: "install",
  },
] as const;

const clientStates = [
  {
    client: {
      name: "codex",
      format: "toml",
      configPath: [".codex", "config.toml"],
      marker: [".codex"],
    },
    detected: true,
    configured: false,
    status: "needs_configuration",
  },
  {
    client: {
      name: "opencode",
      format: "opencode",
      configPath: [".config", "opencode", "opencode.json"],
      marker: [".config", "opencode"],
    },
    detected: false,
    configured: false,
    status: "missing",
  },
] as const;

const agentActions = actions.filter(({ kind }) => kind !== "install_hopper");

const runSetupDryRunInTty = async (
  home: string,
  arguments_: readonly string[],
): Promise<{ readonly exitCode: number; readonly output: string }> => {
  const terminal = spawn(
    process.execPath,
    ["scripts/rea.mjs", "setup", "--dry-run", ...arguments_],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        REA_LOG_LEVEL: "silent",
        NO_COLOR: "1",
      },
      name: "xterm-256color",
      cols: 120,
      rows: 40,
    },
  );
  let output = "";
  terminal.onData((data) => {
    output += data;
  });
  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      terminal.kill();
      reject(new Error(`TTY dry run timed out after output:\n${output}`));
    }, 15_000);
    terminal.onExit(({ exitCode: code }) => {
      clearTimeout(timeout);
      resolvePromise(code);
    });
  });
  return { exitCode, output };
};

describe("TTY setup dry run", () => {
  it("prints the plan and no-mutation notice for a TTY dry run", async () => {
    const home = await createTestTempDirectory("rea-cli-setup-dry-run-");
    const { exitCode, output } = await runSetupDryRunInTty(home, [
      "--client",
      "codex",
      "--skill=false",
    ]);

    expect(exitCode, output).toBe(0);
    expect(output).toContain("CREATE  Codex");
    expect(output).toContain(join(home, ".codex/config.toml"));
    expect(output).toContain("Dry run complete. No changes were made.");
    await expect(
      access(join(home, ".codex/config.toml")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("shows the refusal instead of a blocked skill plan for a TTY dry run", async () => {
    const home = await createTestTempDirectory("rea-cli-setup-linked-dry-run-");
    const managed = join(home, "managed-skill");
    const linked = join(home, ".claude/skills/reverse-engineer-anything");
    const original = "user-managed skill bytes\n";
    await mkdir(managed);
    await writeFile(join(managed, "SKILL.md"), original);
    await mkdir(dirname(linked), { recursive: true });
    await symlink(
      managed,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );

    const { exitCode, output } = await runSetupDryRunInTty(home, [
      "--client",
      "claude_code",
    ]);

    expect(exitCode, output).toBe(1);
    expect(output).toContain("Skill directory is a symbolic link.");
    expect(output).toContain(linked);
    expect(output).toContain("--skill=false");
    expect(output).not.toContain("REA setup plan");
    expect(output).not.toContain("Install or update the REA skill");
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(managed, "SKILL.md"), "utf8")).toBe(original);
    expect(await readdir(managed)).toEqual(["SKILL.md"]);
    await expect(access(join(home, ".claude.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

cliTest.skipIf(process.platform === "win32")(
  "repairs a Codex timeout without replacing an equivalent caller-selected launcher",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-codex-alias-repair-");
    const codexHome = join(home, ".codex");
    const config = join(codexHome, "config.toml");
    const backup = `${config}.rea.backup`;
    const alias = join(home, "rea-launcher-alias.mjs");
    await mkdir(codexHome);
    await symlink(resolve("scripts/rea.mjs"), alias, "file");
    const original = [
      "# Caller-owned Codex approval policy",
      'approval_policy = "on-request"',
      'sandbox_mode = "read-only"',
      "",
      "[mcp_servers.rea]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify([alias, "mcp"])}`,
      "startup_timeout_sec = 0",
      "tool_timeout_sec = 900",
      'default_tools_approval_mode = "prompt"',
      "",
      "[mcp_servers.rea.tools.open_binary]",
      'approval_mode = "approve"',
      "output_token_limit = 2048",
      "",
    ].join("\n");
    await writeFile(config, original);
    const setup = (approval: "--dry-run" | "--yes") =>
      cli.run({
        arguments: [
          "setup",
          "--client",
          "codex",
          "--no-skill",
          approval,
          "--json",
        ],
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          CODEX_HOME: codexHome,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_DATA_HOME: join(home, ".local", "share"),
          XDG_CACHE_HOME: join(home, ".cache"),
        },
        timeoutMs: 20_000,
      });

    const planned = await setup("--dry-run");
    expect(planned.exitCode, planned.stderr).toBe(0);
    expect(planned.json).toMatchObject({
      status: "planned",
      plannedActions: [
        expect.objectContaining({
          id: "configure_client:codex",
          operation: "update",
          target: config,
          backupPath: backup,
        }),
      ],
    });
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(access(backup)).rejects.toMatchObject({ code: "ENOENT" });

    const applied = await setup("--yes");
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.json).toMatchObject({ status: "ready" });
    const repaired = await readFile(config, "utf8");
    expect(parseToml(repaired)).toMatchObject({
      approval_policy: "on-request",
      sandbox_mode: "read-only",
      mcp_servers: {
        rea: {
          command: process.execPath,
          args: [alias, "mcp"],
          startup_timeout_sec: 30,
          tool_timeout_sec: 900,
          default_tools_approval_mode: "prompt",
          tools: {
            open_binary: { approval_mode: "approve", output_token_limit: 2048 },
          },
        },
      },
    });
    expect(await readFile(backup, "utf8")).toBe(original);
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);

    const repeated = await setup("--yes");
    expect(repeated.exitCode, repeated.stderr).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      plannedActions: [],
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(repaired);
    expect(await readFile(backup, "utf8")).toBe(original);
  },
);

describe("interactive setup journey", () => {
  it("shows detected and absent clients without preselecting detected clients", async () => {
    const result = await runJourney(
      [
        step("Which agents should use REA?", "\u001b[B"),
        step("Not detected · configuration is still available", "\r"),
      ],
      false,
      [actions[0]],
    );
    expect(result.output).toContain("Detected: Codex");
    expect(result.output).toContain(
      "Not detected · configuration is still available",
    );
    expect(result.output).toContain("Which agents should use REA?");
    expect(result.output).not.toContain("What should REA set up?");
    expect(result.decision.selectedActionIds).toEqual([]);
  });

  it("selects an absent OpenCode client and bundles its skill", async () => {
    const result = await runJourney(
      [
        step("Which agents should use REA?", "\u001b[B \r"),
        step("Apply these 2 changes?", "\r"),
      ],
      false,
      [
        {
          ...actions[0],
          id: "configure_client:opencode",
          label: "OpenCode",
          target: "/isolated/.config/opencode/opencode.json",
        },
        actions[1],
      ],
    );
    expect(result.output).toContain("CREATE  OpenCode");
    expect(result.decision.selectedActionIds).toEqual([
      "configure_client:opencode",
      "install_skill",
    ]);
    expect(result.decision.approved).toBe(true);
  });

  it("shows the launcher, backup, and path before final approval", async () => {
    const result = await runJourney(
      [
        step("Which agents should use REA?", " \r"),
        step("Apply these 2 changes?", "\r"),
      ],
      false,
      [
        {
          ...actions[0],
          operation: "update",
          backupPath: "/isolated/.codex/config.toml.bak",
          commands: ["npx -y rea-agents@3.2.1 mcp"],
        },
        actions[1],
      ],
    );
    expect(result.output).toContain("/isolated/.codex/config.toml.bak");
    expect(result.output).toContain("command: npx -y rea-agents@3.2.1 mcp");
    expect(result.output.indexOf("command:")).toBeLessThan(
      result.output.indexOf("Apply these 2 changes?"),
    );
  });

  it("treats final No as cancellation", async () => {
    const result = await runJourney([
      step("Which agents should use REA?", " \r"),
      step("Apply these 2 changes?", "\u001b[D\r"),
    ]);
    expect(result.output).toContain("Setup cancelled. No changes were made.");
    expect(result.decision.cancelled).toBe(true);
    expect(result.decision.approved).toBe(false);
  });

  it("restores the terminal after Ctrl-C during selection", async () => {
    const result = await runJourney([
      step("Which agents should use REA?", "\u0003"),
    ]);
    expect(result.output).toContain("\u001b[?25h");
    expect(result.decision.cancelled).toBe(true);
  });

  it("can install the skill for CLI use without an agent registration", async () => {
    const result = await runJourney([
      step("Which agents should use REA?", "\r"),
      step("Install the guided REA skill for CLI use?", "\u001b[D\r"),
      step("Apply this change?", "\r"),
    ]);
    expect(result.decision.selectedActionIds).toEqual(["install_skill"]);
    expect(result.decision.approved).toBe(true);
  });

  it("offers Hopper separately and defaults against installing it", async () => {
    const result = await runJourney(
      [
        step("Which agents should use REA?", " \r"),
        step("Install Hopper for deep binary analysis?", "\r"),
        step("Apply these 2 changes?", "\r"),
      ],
      false,
      actions,
    );
    expect(result.decision.selectedActionIds).toEqual([
      "configure_client:codex",
      "install_skill",
    ]);
  });

  it("uses sequential prompts without auto-selecting detected agents in accessible mode", async () => {
    const result = await runJourney(
      [
        step("Configure Codex?", "\r"),
        step("Configure OpenCode?", "\u001b[A\r"),
        step("Apply this change?", "\r"),
      ],
      true,
      [{ ...actions[0], id: "configure_client:opencode", label: "OpenCode" }],
    );
    expect(result.decision.selectedActionIds).toEqual([
      "configure_client:opencode",
    ]);
  });

  it("preselects only a prior REA registration", async () => {
    const result = await runJourney(
      [
        step("Which agents should use REA?", "\r"),
        step("Apply these 2 changes?", "\r"),
      ],
      false,
      agentActions,
      ["codex"],
    );
    expect(result.decision.selectedActionIds).toEqual([
      "configure_client:codex",
      "install_skill",
    ]);
  });
});

describe("interactive setup completion", () => {
  it.each([
    { npmCommand: "", userAgent: "", launcher: "rea" },
    {
      npmCommand: "exec",
      userAgent: "npm/10.9.0 node/v24.11.0 linux x64",
      launcher: "npx rea-agents",
    },
    {
      npmCommand: "exec",
      userAgent: "bun/1.4.2 npm/? node/v26.3.0 linux x64",
      launcher: "bunx rea-agents",
    },
  ])(
    "prints an available next command for $launcher invocation",
    async ({ npmCommand, userAgent, launcher }) => {
      const { stderr } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          [
            'import { renderInteractiveSetupResult } from "./dist/cli/interactiveSetup.js";',
            "renderInteractiveSetupResult({",
            '  status: "ready",',
            "  plannedActions: [],",
            "  appliedActions: [],",
            '  clients: { codex: { status: "configured" } },',
            "  doctor: {",
            "    healthy: true,",
            '    availableProviders: ["hopper", "ghidra"],',
            '    hopperPath: "/Applications/Hopper",',
            "    checks: [],",
            '    providerInspections: [{ id: "ghidra", available: true }],',
            '    identity: { skill: { state: "aligned" }, registrations: [{ client: "codex", state: "aligned" }] },',
            "  },",
            "});",
          ].join("\n"),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) =>
                  !["npm_command", "npm_config_user_agent"].includes(
                    key.toLowerCase(),
                  ),
              ),
            ),
            npm_command: npmCommand,
            npm_config_user_agent: userAgent,
            NO_COLOR: "1",
          },
        },
      );

      expect(stderr).toContain("What you can do now");
      expect(stderr).toContain("Deep analysis: Hopper and Ghidra");
      expect(stderr).toContain("Agent access: Codex");
      expect(stderr).toContain(
        "Guided reverse-engineering workflows: installed",
      );
      expect(stderr).toContain(`CLI: ${launcher} analyze /path/to/app`);
      expect(stderr).toContain(
        'Try in Codex: "Explain how a feature works in /path/to/app and show the evidence."',
      );
    },
  );
  it("prints retained cleanup resources without relying on paths in remediation", async () => {
    const resources = ["/fixture/owned backup", "/fixture/临时目录"];
    const result: SetupResult = {
      status: "needs_human",
      code: "cleanup_failed",
      plannedActions: [],
      appliedActions: [],
      clients: {},
      clientStates: [],
      doctor: {
        healthy: true,
        environment_healthy: true,
        availableProviders: [],
        scope: {
          mode: "explicit",
          clients: [],
          providers: [],
          skill: false,
          target: null,
        },
      },
      remediation: "Owned descriptor remains busy",
      cleanup: { reason: "Owned descriptor remains busy", resources },
    };
    const { stderr } = await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import { renderInteractiveSetupResult } from "./dist/cli/interactiveSetup.js";\n' +
          `renderInteractiveSetupResult(${JSON.stringify(result)}, {});`,
      ],
      { cwd: process.cwd(), env: { ...process.env, NO_COLOR: "1" } },
    );
    expect(stderr).toContain(result.remediation);
    for (const resource of resources) expect(stderr).toContain(resource);
  });
});

interface JourneyStep {
  readonly prompt: string;
  readonly input: string;
}

interface JourneyResult {
  readonly output: string;
  readonly decision: z.infer<typeof decisionSchema>;
}

const step = (prompt: string, input: string): JourneyStep => ({
  prompt,
  input,
});

const runJourney = async (
  steps: readonly JourneyStep[],
  accessible = false,
  journeyActions: readonly object[] = agentActions,
  initialClientIds: readonly string[] = [],
): Promise<JourneyResult> => {
  const isolatedHome = await createTestTempDirectory("rea-cli-setup-test-");
  const script = [
    'import { confirmInteractiveSetup } from "./dist/cli/interactiveSetup.js";',
    `const actions = ${JSON.stringify(journeyActions)};`,
    `const context = ${JSON.stringify({ stage: "select", clientStates, selectedClientIds: initialClientIds, clientSelectionAllowed: true })};`,
    `let decision = await confirmInteractiveSetup(actions, ${JSON.stringify(accessible)}, context);`,
    "if (!decision.cancelled && decision.selectedActionIds.length > 0) {",
    "  const selected = new Set(decision.selectedActionIds);",
    `  decision = await confirmInteractiveSetup(actions.filter(({ id }) => selected.has(id)), ${JSON.stringify(accessible)}, { ...context, stage: "confirm", clientSelectionAllowed: false });`,
    "}",
    `process.stdout.write(${JSON.stringify(`\n${decisionMarker}`)} + JSON.stringify(decision) + "\\n");`,
  ].join("\n");

  return new Promise<JourneyResult>((resolvePromise, reject) => {
    let output = "";
    let nextStep = 0;
    let settled = false;
    const terminal = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
          NO_COLOR: "1",
          TERM: "xterm-256color",
        },
        name: "xterm-256color",
        cols: 120,
        rows: 40,
      },
    );
    const timeout = setTimeout(() => {
      terminal.kill();
      finish(new Error(`Timed out after output:\n${output}`));
    }, 10_000);

    terminal.onData((data) => {
      output += data;
      const pending = steps[nextStep];
      if (pending !== undefined && output.includes(pending.prompt)) {
        nextStep += 1;
        terminal.write(pending.input);
      }
    });
    terminal.onExit(({ exitCode }) => {
      if (exitCode !== 0) {
        finish(
          new Error(`Setup journey exited ${String(exitCode)}:\n${output}`),
        );
        return;
      }
      if (nextStep !== steps.length) {
        finish(new Error(`Setup journey missed an interaction:\n${output}`));
        return;
      }
      const markerIndex = output.lastIndexOf(decisionMarker);
      if (markerIndex === -1) {
        finish(new Error(`Setup journey returned no decision:\n${output}`));
        return;
      }
      const raw = output.slice(markerIndex + decisionMarker.length);
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      const serialized =
        jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart
          ? raw.slice(jsonStart, jsonEnd + 1)
          : raw.split(/\r?\n/u, 1)[0];
      if (serialized === undefined) {
        finish(
          new Error(`Setup journey returned an empty decision:\n${output}`),
        );
        return;
      }
      try {
        finish(undefined, {
          output,
          decision: decisionSchema.parse(JSON.parse(serialized)),
        });
      } catch (cause: unknown) {
        finish(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });

    function finish(error?: Error, result?: JourneyResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void rm(isolatedHome, { recursive: true, force: true }).finally(() => {
        if (error !== undefined) reject(error);
        else if (result !== undefined) resolvePromise(result);
        else reject(new Error("Setup journey completed without a result"));
      });
    }
  });
};
