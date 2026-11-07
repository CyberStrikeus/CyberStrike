import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { pathExists } from "./lib/verify-package-core.mjs";

/** Install the separately locked Skills CLI so verification resolves no registry metadata. */
const lockedSkillsCli = async (commands, root, workspace) => {
  const tool = join(workspace, "skills-cli");
  await mkdir(tool, { recursive: true });
  for (const file of ["package.json", "package-lock.json"])
    await cp(join(root, "scripts/verify-tools/skills", file), join(tool, file));
  await commands.execNpm(
    ["ci", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: tool, timeout: 120_000 },
  );
  const installed = join(tool, "node_modules/skills");
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  return {
    version: manifest.version,
    entry: join(installed, manifest.bin.skills),
  };
};

/** Exercise Skills' default root discovery without ignored build outputs. */
export async function verifyRepositorySkill({ root, workspace, commands }) {
  const snapshot = join(workspace, "repository");
  const consumer = join(workspace, "skill-consumer");
  const home = join(workspace, "skill-consumer-home");
  const tracked = (
    await commands.exec(
      "git",
      ["ls-files", "--cached", "--format=%(objectmode) %(path)", "-z"],
      { cwd: root },
    )
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const entry of tracked) {
    const mode = entry.slice(0, 6);
    const path = entry.slice(7);
    const destination = join(snapshot, path);
    // A GitHub clone without submodule initialization has only these directories.
    if (mode === "160000") {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(root, path), destination, { verbatimSymlinks: true });
  }
  if (await pathExists(join(snapshot, "skills")))
    throw new Error("repository skill check must run without generated skills");
  await mkdir(consumer, { recursive: true });
  await mkdir(home, { recursive: true });
  const { version: skillsVersion, entry } = await lockedSkillsCli(
    commands,
    root,
    workspace,
  );
  await commands.exec(
    process.execPath,
    [
      entry,
      "add",
      snapshot,
      "--skill",
      "reverse-engineer-anything",
      "--agent",
      "codex",
      "--yes",
    ],
    {
      cwd: consumer,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        CODEX_HOME: join(home, ".codex"),
        DO_NOT_TRACK: "1",
        SKILLS_NO_TELEMETRY: "1",
        CI: "1",
      },
      timeout: 120_000,
    },
  );
  const authoredRoot = join(
    snapshot,
    ".agents/skills/reverse-engineer-anything",
  );
  const installedSkills = join(consumer, ".agents/skills");
  const installedRoot = join(installedSkills, "reverse-engineer-anything");
  const files = await filePaths(authoredRoot);
  if (
    JSON.stringify(await readdir(installedSkills)) !==
      JSON.stringify(["reverse-engineer-anything"]) ||
    JSON.stringify(await filePaths(installedRoot)) !== JSON.stringify(files)
  )
    throw new Error(
      "Skills did not install exactly the selected public bundle",
    );
  for (const path of files) {
    const authored = await readFile(join(authoredRoot, path));
    if (!authored.equals(await readFile(join(installedRoot, path))))
      throw new Error(`Skills changed authored skill content: ${path}`);
  }
  return { skillsVersion, files };
}

async function filePaths(root) {
  return (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}
