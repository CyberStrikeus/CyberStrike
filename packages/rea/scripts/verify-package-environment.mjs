import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { supportedClients } from "../dist/application/SupportedClients.js";

/** Create an isolated prefix, fake PATH, client configs, and environment. */
export async function verifyPackageEnvironment({
  root,
  workspace,
  evidenceRoot,
  referenceRoot,
}) {
  const prefix = join(workspace, "prefix");
  const home = join(workspace, "home");
  const fakeBin = join(workspace, "bin");
  await mkdir(fakeBin, { recursive: true });
  await Promise.all([
    mkdir(evidenceRoot, { recursive: true }),
    mkdir(join(referenceRoot, "src"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(referenceRoot, "src", "main.ts"),
      'import "./dependency";\n',
    ),
    writeFile(
      join(referenceRoot, "src", "dependency.ts"),
      "export const value = 1;\n",
    ),
    writeFile(join(referenceRoot, ".env"), "PACKAGE_SECRET_SENTINEL=1\n"),
  ]);
  const brew = join(fakeBin, "brew");
  const swVers = join(fakeBin, "sw_vers");
  const npx = join(fakeBin, "npx");
  const npxLog = join(workspace, "npx.log");
  const hopper = join(workspace, "hopper");
  await writeFile(
    brew,
    '#!/bin/sh\nif [ "$1" = "--prefix" ]; then echo /fake/cask; fi\nexit 0\n',
  );
  await writeFile(swVers, "#!/bin/sh\necho 14.5\n");
  await writeFile(
    npx,
    '#!/bin/sh\nexec "$REA_VERIFY_NODE" "$REA_VERIFY_NPX_SCRIPT" "$@"\n',
  );
  await writeFile(hopper, "#!/bin/sh\nexit 0\n");
  await Promise.all([
    chmod(brew, 0o755),
    chmod(swVers, 0o755),
    chmod(hopper, 0o755),
    chmod(npx, 0o755),
  ]);
  const claudeDir = supportedClients(home, process.platform, {}).find(
    ({ name }) => name === "claude_desktop",
  )?.markerPath;
  if (claudeDir === undefined)
    throw new Error("Claude Desktop fixture has no configuration directory");
  const codexDir = join(home, ".codex");
  const cursorDir = join(home, ".cursor");
  await Promise.all([
    mkdir(claudeDir, { recursive: true }),
    mkdir(codexDir, { recursive: true }),
    mkdir(cursorDir, { recursive: true }),
  ]);
  const claudeConfig = join(claudeDir, "claude_desktop_config.json");
  const codexConfig = join(codexDir, "config.toml");
  const codexTarget = join(home, "managed-codex.toml");
  const cursorConfig = join(cursorDir, "mcp.json");
  const cursorTarget = join(home, "managed-cursor.json");
  await writeFile(claudeConfig, '{"existing":true}\n');
  await writeFile(codexTarget, 'model = "gpt-5"\n');
  await writeFile(cursorTarget, '{"existing":true}\n');
  await symlink(codexTarget, codexConfig);
  await symlink(cursorTarget, cursorConfig);
  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    CLAUDE_CONFIG_DIR: home,
    CODEX_HOME: codexDir,
    COPILOT_HOME: join(home, ".copilot"),
    GROK_HOME: join(home, ".grok"),
    SAND_DATA_ROOT: join(home, ".grokbot"),
    OMP_PROFILE: undefined,
    PI_CODING_AGENT_DIR: undefined,
    PI_CONFIG_DIR: undefined,
    PI_PROFILE: undefined,
    QWEN_HOME: undefined,
    OPENCODE_CONFIG: undefined,
    OPENCODE_CONFIG_DIR: undefined,
    GEMINI_CLI_HOME: undefined,
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: undefined,
    GEMINI_CLI_SYSTEM_DEFAULTS_PATH: undefined,
    XDG_CONFIG_HOME: join(home, ".config"),
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    REA_ANALYSIS_PROVIDER: "auto",
    ...packageHopperEnvironment(root),
    REA_NPX_LOG: npxLog,
    REA_VERIFY_NODE: process.execPath,
    REA_VERIFY_NPX_SCRIPT: fileURLToPath(
      new URL("./lib/verify-package-runner-fixture.mjs", import.meta.url),
    ),
    REA_REFERENCE_SECRET_PATTERNS_JSON: JSON.stringify([".env"]),
  };
  return {
    prefix,
    home,
    npxLog,
    claudeConfig,
    codexConfig,
    codexTarget,
    cursorConfig,
    cursorTarget,
    environment,
  };
}

export const packageHopperEnvironment = (root, platform = process.platform) => {
  const fakeLauncher = join(root, "tests/fixtures/fakeLauncher.mjs");
  if (platform !== "linux")
    return {
      HOPPER_LAUNCHER_PATH: process.execPath,
      HOPPER_LOADER_ARGS_JSON: JSON.stringify([fakeLauncher]),
    };
  return {
    HOPPER_LAUNCHER_PATH: "/bin/sh",
    // Feed availability must not turn this foreign-launcher rejection test into
    // an unrelated networking failure. Successful vendor verification is real E2E coverage.
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      `--import=${pathToFileURL(join(root, "tests/fixtures/hopperRejectionFeed.mjs")).href}`,
    ]
      .filter(Boolean)
      .join(" "),
    HOPPER_LOADER_ARGS_JSON: JSON.stringify([
      "-c",
      'node_path=$1; shift; "$node_path" "$@"',
      "rea-package-hopper",
      process.execPath,
      fakeLauncher,
    ]),
  };
};
