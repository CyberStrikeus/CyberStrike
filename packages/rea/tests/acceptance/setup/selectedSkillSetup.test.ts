import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["root", "references"] as const)(
  "rejects a linked skill %s during planning before configuring a client",
  async (kind, { cli }) => {
    const directory = await createTestTempDirectory("rea-skill-preflight-");
    const selected = join(
      directory,
      ".claude/skills/reverse-engineer-anything",
    );
    const managed = join(directory, "user-managed");
    const source = resolve("skills/reverse-engineer-anything");
    await mkdir(kind === "root" ? dirname(selected) : selected, {
      recursive: true,
    });
    await cp(kind === "root" ? source : join(source, "references"), managed, {
      recursive: true,
    });
    if (kind === "references")
      await cp(join(source, "SKILL.md"), join(selected, "SKILL.md"));
    const link = kind === "root" ? selected : join(selected, "references");
    await symlink(
      managed,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: [...arguments_, "--json"],
        cwd: directory,
        environment: { USERPROFILE: directory },
      });
    const preview = await run([
      "setup",
      "--client",
      "claude_code",
      "--dry-run",
    ]);
    const applied = await run(["setup", "--client", "claude_code", "--yes"]);
    await expect(access(join(directory, ".claude.json"))).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
    for (const result of [preview, applied]) {
      expect(result.exitCode, result.stdout).toBe(1);
      expect(result.json).toMatchObject({
        status: "needs_human",
        code: "skill_install_failed",
        appliedActions: [],
      });
      expect(result.stdout).toContain(link);
      expect(result.stdout).toContain("--skill=false");
    }
    const doctor = await run(["doctor", "--client", "claude_code", "--skill"]);
    expect(doctor.exitCode, doctor.stdout).toBe(1);
    expect(doctor.json).toMatchObject({
      healthy: false,
      identity: { skill: { state: "unmanaged" } },
    });
    expect(doctor.stdout).toContain(link);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  },
);

cliTest(
  "setup refuses a linked skill while allowing registration-only setup",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-linked-skill-cli-");
    const managed = join(directory, "managed");
    const selected = join(
      directory,
      ".claude/skills/reverse-engineer-anything",
    );
    await mkdir(managed);
    await mkdir(join(directory, ".claude/skills"), { recursive: true });
    await cp(resolve("skills/reverse-engineer-anything"), managed, {
      recursive: true,
    });
    const original = await readFile(join(managed, "SKILL.md"), "utf8");
    await symlink(
      managed,
      selected,
      process.platform === "win32" ? "junction" : "dir",
    );
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: [...arguments_, "--json"],
        cwd: directory,
        environment: { USERPROFILE: directory },
      });

    const refused = await run([
      "setup",
      "--skill-client",
      "claude_code",
      "--yes",
    ]);
    expect(refused.exitCode, refused.stdout).toBe(1);
    expect(refused.json).toMatchObject({
      status: "needs_human",
      code: "skill_install_failed",
    });
    expect(refused.stdout).toContain("symbolic link");
    const doctor = await run(["doctor", "--client", "claude_code", "--skill"]);
    expect(doctor.exitCode, doctor.stdout).toBe(1);
    expect(doctor.json).toMatchObject({
      healthy: false,
      identity: { skill: { state: "unmanaged" } },
    });
    const registration = await run([
      "setup",
      "--client",
      "claude_code",
      "--skill=false",
      "--yes",
    ]);
    expect(registration.exitCode, registration.stdout).toBe(0);
    expect(registration.json).toMatchObject({ status: "ready" });
    await access(join(directory, ".claude.json"));
    expect((await lstat(selected)).isSymbolicLink()).toBe(true);
    expect((await readdir(managed)).sort()).toEqual(["SKILL.md", "references"]);
    expect(await readFile(join(managed, "SKILL.md"), "utf8")).toBe(original);
  },
);

cliTest(
  "uninstall reports retained references and preserves their ownership manifest",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-skill-retained-cli-");
    const selected = join(
      directory,
      ".claude/skills/reverse-engineer-anything",
    );
    const managed = join(directory, "user-managed-references");
    const source = resolve("skills/reverse-engineer-anything");
    await mkdir(selected, { recursive: true });
    await cp(join(source, "SKILL.md"), join(selected, "SKILL.md"));
    await cp(join(source, "references"), managed, { recursive: true });
    await symlink(
      managed,
      join(selected, "references"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const before = await readFile(join(managed, "native-and-artifacts.md"));
    const result = await cli.run({
      arguments: ["uninstall", "--json"],
      cwd: directory,
      environment: { USERPROFILE: directory },
    });
    expect(result.exitCode, result.stdout).toBe(0);
    expect(result.json).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "skill",
          status: "retained",
          detail: expect.stringContaining("retained"),
        }),
      ]),
    });
    expect(
      Buffer.compare(
        await readFile(join(selected, "SKILL.md")),
        await readFile(join(source, "SKILL.md")),
      ),
    ).toBe(0);
    expect(
      Buffer.compare(
        await readFile(join(managed, "native-and-artifacts.md")),
        before,
      ),
    ).toBe(0);
    expect((await lstat(join(selected, "references"))).isSymbolicLink()).toBe(
      true,
    );
  },
);

cliTest(
  "skill-only setup verifies its selected client copy on install, rerun and repair",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-selected-skill-");
    const selected = join(
      directory,
      ".claude/skills/reverse-engineer-anything",
    );
    const shared = join(directory, ".agents/skills/reverse-engineer-anything");
    const run = (args: readonly string[]) =>
      cli.run({
        arguments: [...args, "--json"],
        cwd: directory,
        environment: { USERPROFILE: directory },
      });
    const preview = await run([
      "setup",
      "--skill-client",
      "claude_code",
      "--dry-run",
    ]);
    expect(preview.exitCode, preview.stdout).toBe(0);
    expect(preview.json).toMatchObject({
      status: "planned",
      doctor: {
        scope: {
          clients: [],
          skill: true,
          skill_clients: ["claude_code"],
        },
      },
    });
    const registered = await run([
      "setup",
      "--client",
      "claude_code",
      "--skill=false",
      "--yes",
    ]);
    expect(registered.exitCode, registered.stderr).toBe(0);
    const configuration = join(directory, ".claude.json");
    const before = await readFile(configuration, "utf8");
    const args = ["setup", "--skill-client", "claude_code", "--yes"];
    const installed = await run(args);
    expect(installed.exitCode, installed.stdout).toBe(0);
    expect(installed.json).toMatchObject({
      status: "ready",
      appliedActions: ["installed_skill"],
      doctor: {
        healthy: true,
        scope: { clients: [], skill: true, skill_clients: ["claude_code"] },
        identity: { skill: { state: "aligned" } },
      },
    });
    const bundle = resolve("skills/reverse-engineer-anything");
    const assertAligned = async () => {
      for (const entry of await readdir(bundle, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        const path = relative(bundle, join(entry.parentPath, entry.name));
        expect(
          Buffer.compare(
            await readFile(join(selected, path)),
            await readFile(join(bundle, path)),
          ),
        ).toBe(0);
      }
    };
    await assertAligned();
    const repeated = await run(args);
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
    });

    await writeFile(
      join(selected, "references/native-and-artifacts.md"),
      "damaged selected copy\n",
    );
    const damaged = await run(["doctor", "--client", "claude_code", "--skill"]);
    expect(damaged.json).toMatchObject({
      healthy: false,
      identity: { skill: { state: "stale" } },
    });
    const repaired = await run(args);
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    expect(repaired.json).toMatchObject({
      status: "ready",
      appliedActions: ["installed_skill"],
    });
    await assertAligned();
    await expect(access(shared)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(configuration, "utf8")).toBe(before);

    const sharedControl = await run([
      "setup",
      "--skill-client",
      "shared",
      "--yes",
    ]);
    expect(sharedControl.exitCode, sharedControl.stdout).toBe(0);
    expect(sharedControl.json).toMatchObject({ status: "ready" });
    await access(join(shared, "SKILL.md"));
  },
);

cliTest(
  "setup keeps registration and skill readiness selections independent",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-independent-skill-");
    const result = await cli.run({
      arguments: [
        "setup",
        "--client",
        "codex",
        "--skill-client",
        "claude_code",
        "--yes",
        "--json",
      ],
      cwd: directory,
      environment: { USERPROFILE: directory },
    });
    expect(result.exitCode, result.stdout).toBe(0);
    expect(result.json).toMatchObject({
      status: "ready",
      doctor: {
        healthy: true,
        scope: {
          clients: ["codex"],
          skill_clients: ["claude_code"],
          skill: true,
        },
        identity: { skill: { state: "aligned" } },
      },
    });
    await access(join(directory, ".codex/config.toml"));
    await access(
      join(directory, ".claude/skills/reverse-engineer-anything/SKILL.md"),
    );
    await expect(access(join(directory, ".claude.json"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    await expect(
      access(join(directory, ".agents/skills/reverse-engineer-anything")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);
