import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "jsonc-parser";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "keeps Qwen profile registration and shared skill consistent through setup, doctor and uninstall",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-qwen-profile-");
    const home = join(root, "account");
    const profile = join(root, "selected profile");
    const settings = join(profile, "settings.json");
    const skill = join(
      home,
      ".agents",
      "skills",
      "reverse-engineer-anything",
      "SKILL.md",
    );
    const environment = { USERPROFILE: home, QWEN_HOME: profile };
    const original =
      '{\n  // Keep my configuration.\n  "model": {"name": "existing"},\n  "mcpServers": {"other": {"command": "other-server"}}\n}\n';
    await mkdir(profile, { recursive: true });
    await writeFile(settings, original);
    const run = (arguments_: readonly string[]) =>
      cli.run({ arguments: [...arguments_, "--json"], environment });

    const plan = await run(["setup", "--client", "qwen_code", "--dry-run"]);
    expect(plan.exitCode, plan.stderr).toBe(0);
    expect(plan.json).toMatchObject({
      status: "planned",
      plannedActions: [
        { kind: "configure_client", target: settings },
        {
          kind: "install_skill",
          target: join(home, ".agents", "skills", "reverse-engineer-anything"),
        },
      ],
    });
    expect(await readFile(settings, "utf8")).toBe(original);
    await expect(access(skill)).rejects.toMatchObject({ code: "ENOENT" });

    const installed = await run(["setup", "--client", "qwen_code", "--yes"]);
    expect(installed.exitCode, installed.stderr).toBe(0);
    expect(installed.json).toMatchObject({ status: "ready" });
    expect(await readFile(`${settings}.rea.backup`, "utf8")).toBe(original);
    const configured = await readFile(settings, "utf8");
    expect(configured).toContain("// Keep my configuration.");
    expect(parse(configured)).toMatchObject({
      model: { name: "existing" },
      mcpServers: {
        other: { command: "other-server" },
        rea: {
          command: process.execPath,
          args: [resolve("scripts/rea.mjs"), "mcp"],
        },
      },
    });
    expect(await readFile(skill, "utf8")).toContain(
      "name: reverse-engineer-anything",
    );

    const doctor = await run(["doctor", "--client", "qwen_code", "--skill"]);
    expect(doctor.exitCode, doctor.stderr).toBe(0);
    expect(doctor.json).toMatchObject({ healthy: true });
    const repeated = await run(["setup", "--client", "qwen_code", "--yes"]);
    expect(repeated.exitCode, repeated.stderr).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
    });
    expect(await readFile(settings, "utf8")).toBe(configured);

    const removed = await run(["uninstall"]);
    expect(removed.exitCode, removed.stderr).toBe(0);
    expect(removed.json).toMatchObject({ status: "complete" });
    expect(parse(await readFile(settings, "utf8"))).toEqual({
      model: { name: "existing" },
      mcpServers: { other: { command: "other-server" } },
    });
    await expect(access(skill)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(home, ".qwen"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
  120_000,
);
