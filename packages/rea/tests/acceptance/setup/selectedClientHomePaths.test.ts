import {
  access,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect } from "vitest";

import { MANAGED_SKILL_FILES } from "../../../src/application/SetupSkill.js";
import { parseClientConfiguration } from "../../../src/application/ClientConfigurationDocument.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "configures Codex in the filesystem-selected CODEX_HOME and shared skills in HOME with backups and repeat setup",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-selected-client-home-");
    const selected = join(root, "selected");
    await mkdir(join(selected, "deep"), { recursive: true });
    await symlink(join(selected, "deep"), join(root, "link"));
    const home = join(root, "home");
    await mkdir(home);
    const codexHome = `${root}/link/..`;
    const config = join(selected, "config.toml");
    const lexicalConfig = join(root, "config.toml");
    const original =
      'model = "selected-model"\n[mcp_servers.other]\ncommand = "other-server"\n';
    const sentinel = 'model = "unselected-model"\n';
    await mkdir(dirname(config), { recursive: true });
    await mkdir(dirname(lexicalConfig), { recursive: true });
    await writeFile(config, original);
    await writeFile(lexicalConfig, sentinel);
    const manifest = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const lexicalManifest = join(
      root,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    await mkdir(dirname(manifest), { recursive: true });
    await mkdir(dirname(lexicalManifest), { recursive: true });
    const originalSkill = "previous selected instructions\n";
    const sentinelSkill = "unselected instructions\n";
    await writeFile(manifest, originalSkill);
    await writeFile(lexicalManifest, sentinelSkill);
    const run = () =>
      cli.run({
        arguments: [
          "setup",
          "--client",
          "codex",
          "--skill-client",
          "codex",
          "--yes",
          "--json",
        ],
        cwd: root,
        environment: {
          HOME: home,
          USERPROFILE: home,
          CODEX_HOME: codexHome,
          HOPPER_LAUNCHER_PATH: join(root, "missing-hopper"),
          GHIDRA_INSTALL_DIR: join(root, "missing-ghidra"),
          JAVA_HOME: join(root, "missing-java"),
        },
      });
    const configured = await run();
    expect(configured.exitCode, configured.stdout + configured.stderr).toBe(0);
    const registered = parseClientConfiguration(
      await readFile(config, "utf8"),
      "toml",
    );
    expect(registered.document.model).toBe("selected-model");
    expect(registered.servers.other).toMatchObject({ command: "other-server" });
    expect(registered.servers.rea).toBeDefined();
    const installed = await readFile(manifest, "utf8");
    expect(installed).toContain("name: reverse-engineer-anything");
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(`${manifest}.rea.backup`, "utf8")).toBe(
      originalSkill,
    );
    expect(await readFile(lexicalConfig, "utf8")).toBe(sentinel);
    expect(await readFile(lexicalManifest, "utf8")).toBe(sentinelSkill);
    await expect(access(`${lexicalConfig}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(`${lexicalManifest}.rea.backup`)).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    const before = await readFile(config);
    const repeated = await run();
    expect(repeated.exitCode, repeated.stdout + repeated.stderr).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
    });
    expect((await readFile(config)).equals(before)).toBe(true);
    expect(await readFile(manifest, "utf8")).toBe(installed);
    expect(await readFile(lexicalConfig, "utf8")).toBe(sentinel);
    expect(await readFile(lexicalManifest, "utf8")).toBe(sentinelSkill);
    expect(
      (await readdir(dirname(manifest))).filter((name) =>
        name.startsWith(".rea-skill-"),
      ),
    ).toEqual([]);
  },
);

cliTest.skipIf(process.platform === "win32")(
  "uses the native HOME selection for shared skill setup, readback and uninstall",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-selected-skill-home-");
    const selected = join(root, "selected");
    await mkdir(join(selected, "nested"), { recursive: true });
    await symlink(join(selected, "nested"), join(root, "alias"));
    const home = `${root}/alias/..`;
    const relative = ".agents/skills/reverse-engineer-anything";
    const skill = join(selected, relative);
    const lexicalSkill = join(root, relative);
    const original = "previous selected instructions\n";
    const oldReference = "previous selected reference\n";
    const sentinel = "unselected instructions\n";
    const sentinelReference = "unselected reference\n";
    const reference = "references/connection-and-recovery.md";
    for (const directory of [skill, lexicalSkill])
      await mkdir(join(directory, "references"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), original);
    await writeFile(join(skill, reference), oldReference);
    await writeFile(join(lexicalSkill, "SKILL.md"), sentinel);
    await writeFile(join(lexicalSkill, reference), sentinelReference);
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: [...arguments_, "--json"],
        cwd: root,
        environment: {
          HOME: home,
          USERPROFILE: home,
          XDG_CACHE_HOME: `${home}/.cache`,
        },
      });
    const configured = await run([
      "setup",
      "--skill-client",
      "shared",
      "--yes",
    ]);
    expect(configured.exitCode, configured.stdout + configured.stderr).toBe(0);
    expect(configured.json).toMatchObject({
      status: "ready",
      appliedActions: ["installed_skill"],
    });
    const installed = await readFile(join(skill, "SKILL.md"), "utf8");
    expect(installed).toContain("name: reverse-engineer-anything");
    const installedReference = await readFile(join(skill, reference), "utf8");
    expect(installedReference).not.toBe(oldReference);
    expect(await readFile(join(skill, "SKILL.md.rea.backup"), "utf8")).toBe(
      original,
    );
    expect(await readFile(`${join(skill, reference)}.rea.backup`, "utf8")).toBe(
      oldReference,
    );
    expect(await readFile(join(lexicalSkill, "SKILL.md"), "utf8")).toBe(
      sentinel,
    );
    expect(await readFile(join(lexicalSkill, reference), "utf8")).toBe(
      sentinelReference,
    );
    for (const path of [
      join(lexicalSkill, "SKILL.md.rea.backup"),
      `${join(lexicalSkill, reference)}.rea.backup`,
    ])
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    const repeated = await run(["setup", "--skill-client", "shared", "--yes"]);
    expect(repeated.exitCode, repeated.stdout + repeated.stderr).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
    });
    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe(installed);
    expect(await readFile(join(skill, reference), "utf8")).toBe(
      installedReference,
    );
    const doctor = await run(["doctor", "--skill"]);
    // Doctor also discovers client-specific locations. Gemini uses the lexical
    // HOME sibling, whose deliberately stale sentinel must remain untouched.
    expect(doctor.exitCode, doctor.stdout + doctor.stderr).toBe(1);
    expect(doctor.json).toMatchObject({
      identity: {
        skill: {
          state: "stale",
          issues: [{ client: "gemini_cli", path: lexicalSkill, kind: "stale" }],
        },
      },
    });
    expect(
      (await readdir(skill)).filter((name) => name.startsWith(".rea-skill-")),
    ).toEqual([]);
    expect(
      (await readdir(join(skill, "references"))).filter((name) =>
        name.startsWith(".rea-skill-"),
      ),
    ).toEqual([]);
    const cacheRelative =
      process.platform === "darwin"
        ? "Library/Caches/rea/kuna"
        : process.platform === "linux"
          ? ".cache/rea/kuna"
          : undefined;
    const cacheDirectories = [
      ".rea/cache",
      ".rea/state",
      ...(cacheRelative === undefined ? [] : [cacheRelative]),
    ];
    for (const relative of cacheDirectories) {
      await mkdir(join(selected, relative), { recursive: true });
      await mkdir(join(root, relative), { recursive: true });
      await writeFile(join(selected, relative, "marker"), "selected cache");
      await writeFile(join(root, relative, "marker"), "unselected cache");
    }
    const legacyUserNote = join(selected, ".rea/analyst-note.txt");
    await writeFile(legacyUserNote, "legacy user note\n");
    const userNote = join(skill, "analyst-note.txt");
    await writeFile(userNote, "selected user note\n");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const uninstalled = await run(["uninstall", "--purge-data"]);
      expect(
        uninstalled.exitCode,
        uninstalled.stdout + uninstalled.stderr,
      ).toBe(0);
      expect(uninstalled.json).toMatchObject({ status: "complete" });
      for (const relative of cacheDirectories) {
        await expect(access(join(selected, relative))).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(await readFile(join(root, relative, "marker"), "utf8")).toBe(
          "unselected cache",
        );
      }
      expect(await readFile(legacyUserNote, "utf8")).toBe("legacy user note\n");
      for (const relativePath of MANAGED_SKILL_FILES)
        await expect(access(join(skill, relativePath))).rejects.toMatchObject({
          code: "ENOENT",
        });
      expect(await readFile(userNote, "utf8")).toBe("selected user note\n");
      expect(await readFile(join(skill, "SKILL.md.rea.backup"), "utf8")).toBe(
        original,
      );
      expect(
        await readFile(`${join(skill, reference)}.rea.backup`, "utf8"),
      ).toBe(oldReference);
      expect(await readFile(join(lexicalSkill, "SKILL.md"), "utf8")).toBe(
        sentinel,
      );
      expect(await readFile(join(lexicalSkill, reference), "utf8")).toBe(
        sentinelReference,
      );
    }
  },
);
