import { deepStrictEqual } from "node:assert";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { parse as parseToml } from "smol-toml";

import { clientRegistrationCommandText } from "../dist/cli/clientRegistrationCommandText.js";
import { TOOL_CONTRACTS } from "../dist/contracts/toolContracts.js";
import { PRODUCT_IDENTITY } from "../dist/identity.js";
import { pathExists } from "./lib/verify-package-core.mjs";
import { parse as parseJsonc } from "jsonc-parser";
import { skillReferenceIssues } from "./lib/docs-facts.mjs";
import {
  verifyInteractiveSetup,
  verifyRedirectedStdoutSetup,
} from "./lib/verify-setup-terminal.mjs";
import { setupPlanFailureMessage } from "./verify-package-setup-plan.mjs";

const OPENCODE_ORIGINAL = `{
  // OpenCode preferences must survive setup.
  "model": "provider/model",
  "mcp": {
    // Keep this independently managed server.
    "other": { "type": "local", "command": ["node", "other.js"] },
  },
}\n`;

const CODEX_ORIGINAL = [
  "# Keep Codex preferences and their spelling.",
  'model = "gpt-5"',
  'notify = ["a", "b"]',
  "literal = 'C:\\demo\\path'",
  "",
].join("\n");

const isDirectRegistration = async (command, cli) =>
  Array.isArray(command) &&
  command.length === 3 &&
  typeof command[0] === "string" &&
  typeof command[1] === "string" &&
  isAbsolute(command[0]) &&
  isAbsolute(command[1]) &&
  command[2] === "mcp" &&
  (await realpath(command[0])) === (await realpath(process.execPath)) &&
  (await realpath(command[1])) === (await realpath(cli));

const verifyMcpAdd = async ({ commands, cli, environment, npxLog, home }) => {
  await commands.run(cli, ["mcp", "add"], environment);
  const settings = JSON.parse(
    await readFile(join(home, ".config", "amp", "settings.json"), "utf8"),
  );
  const registration = settings?.["amp.mcpServers"]?.rea;
  if (!Array.isArray(registration?.args))
    throw new Error("Incur mcp add did not write the native Amp registration");
  const command = [registration.command, ...registration.args];
  if (!(await isDirectRegistration(command, cli)))
    throw new Error(
      "Incur mcp add did not register the selected absolute runtime and REA script",
    );
  // Amp consumes the same command through Incur's parser. Check the delegated
  // helper receives that command as one argument, without flattening its argv.
  deepStrictEqual(JSON.parse(await readFile(npxLog, "utf8")), [
    "add-mcp",
    clientRegistrationCommandText(command),
    "--name",
    "rea",
    "-y",
    "-g",
  ]);
};

const verifySetupPlan = async ({
  commands,
  cli,
  environment,
  claudeConfig,
  cursorConfig,
  codexTarget,
  opencodeConfig,
  opencodeOriginal,
  supportedSetupHost,
}) => {
  const plannedExecution = await commands.runWithStatus(
    cli,
    ["setup", "--all-detected", "--dry-run", "--json"],
    environment,
  );
  const planned = JSON.parse(plannedExecution.stdout);
  if (supportedSetupHost) {
    const plannedActions = Array.isArray(planned?.plannedActions)
      ? planned.plannedActions
      : undefined;
    const appliedActions = Array.isArray(planned?.appliedActions)
      ? planned.appliedActions
      : undefined;
    const plannedClaudeConfig = await readFile(claudeConfig, "utf8");
    const plannedCodexConfig = await readFile(codexTarget, "utf8");
    const plannedCursorConfig = await readFile(cursorConfig, "utf8");
    const plannedOpenCodeConfig = await readFile(opencodeConfig, "utf8");
    if (
      planned?.status !== "planned" ||
      plannedExecution.status !== 0 ||
      plannedActions === undefined ||
      appliedActions === undefined ||
      appliedActions.length !== 0 ||
      !plannedActions.some((action) => action?.kind === "configure_client") ||
      !plannedActions.some((action) => action?.kind === "install_skill") ||
      plannedClaudeConfig !== '{"existing":true}\n' ||
      plannedCodexConfig !== CODEX_ORIGINAL ||
      plannedCursorConfig !== '{"existing":true}\n' ||
      plannedOpenCodeConfig !== opencodeOriginal
    )
      throw new Error(
        setupPlanFailureMessage({
          planned,
          plannedExecution,
          plannedClaudeConfig,
          plannedCodexConfig,
          plannedCursorConfig,
        }),
      );
  }
  return { planned };
};

const verifyAbsentOpenCodeSetup = async ({
  commands,
  cli,
  environment,
  home,
}) => {
  const xdgConfigHome = join(home, ".xdg-opencode-absent");
  const configPath = join(xdgConfigHome, "opencode", "opencode.json");
  if (await pathExists(configPath))
    throw new Error("packaged OpenCode first-run fixture was not absent");
  const execution = await commands.runWithStatus(
    cli,
    ["setup", "--yes", "--client", "opencode", "--skill=false", "--json"],
    { ...environment, XDG_CONFIG_HOME: xdgConfigHome },
  );
  const result = JSON.parse(execution.stdout);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (
    execution.status !== 0 ||
    result.status !== "ready" ||
    !result.appliedActions.includes("configured_opencode") ||
    config.mcp?.rea?.type !== "local" ||
    config.mcp.rea.enabled !== true ||
    !(await isDirectRegistration(config.mcp.rea.command, cli))
  )
    throw new Error(
      `packaged setup did not configure explicitly selected OpenCode without a config file: ${JSON.stringify(result)}`,
    );
  await rm(xdgConfigHome, { recursive: true, force: true });
};

const verifyAbsentClaudeCodeSetup = async ({
  commands,
  cli,
  environment,
  home,
}) => {
  const freshHome = join(home, ".claude-code-absent-home");
  const configPath = join(freshHome, ".claude.json");
  const markerPath = join(freshHome, ".claude");
  await rm(freshHome, { recursive: true, force: true });
  await mkdir(freshHome, { recursive: true });
  const childEnvironment = {
    ...environment,
    HOME: freshHome,
    USERPROFILE: freshHome,
    XDG_CONFIG_HOME: join(freshHome, ".config"),
  };
  delete childEnvironment.CLAUDE_CONFIG_DIR;
  if ((await pathExists(configPath)) || (await pathExists(markerPath)))
    throw new Error("packaged Claude Code first-run fixture was not absent");
  const args = [
    "setup",
    "--yes",
    "--client",
    "claude_code",
    "--skill=false",
    "--json",
  ];
  const firstExecution = await commands.runWithStatus(
    cli,
    args,
    childEnvironment,
  );
  const first = JSON.parse(firstExecution.stdout);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const registration = first.doctor.identity?.registrations?.find(
    ({ client }) => client === "claude_code",
  );
  if (
    firstExecution.status !== 0 ||
    first.status !== "ready" ||
    !first.appliedActions.includes("configured_claude_code") ||
    !(await isDirectRegistration(
      [
        config.mcpServers?.rea?.command,
        ...(config.mcpServers?.rea?.args ?? []),
      ],
      cli,
    )) ||
    (await pathExists(markerPath)) ||
    registration?.state !== "aligned" ||
    registration.config_path !== configPath
  )
    throw new Error(
      `packaged setup did not configure an explicitly selected Claude Code with no marker directory: ${JSON.stringify(first)}`,
    );
  const repeatExecution = await commands.runWithStatus(
    cli,
    args,
    childEnvironment,
  );
  const repeat = JSON.parse(repeatExecution.stdout);
  if (
    repeatExecution.status !== 0 ||
    repeat.status !== "ready" ||
    repeat.appliedActions.length !== 0 ||
    repeat.plannedActions.length !== 0
  )
    throw new Error(
      `packaged setup was not idempotent for Claude Code without a marker directory: ${JSON.stringify(repeat)}`,
    );
  await rm(freshHome, { recursive: true, force: true });
};

const verifySetupApply = async ({
  commands,
  cli,
  environment,
  supportedSetupHost,
  hopperSetupSupported,
}) => {
  const status = "ready";
  const hopperStatus =
    hopperSetupSupported === true ? "needs_confirmation" : "needs_human";
  const firstExecution = await commands.runWithStatus(
    cli,
    ["setup", "--yes", "--all-detected", "--json"],
    environment,
  );
  const first = JSON.parse(firstExecution.stdout);
  const alignedExecution = await commands.runWithStatus(
    cli,
    ["setup", "--all-detected", "--json"],
    environment,
  );
  const aligned = JSON.parse(alignedExecution.stdout);
  const secondExecution = await commands.runWithStatus(
    cli,
    [
      "setup",
      "--client",
      "claude_desktop",
      "--client",
      "codex",
      "--client",
      "cursor",
      "--install-hopper",
      "--json",
    ],
    environment,
  );
  const second = JSON.parse(secondExecution.stdout);
  if (supportedSetupHost) {
    if (
      first.status !== status ||
      second.status !== hopperStatus ||
      firstExecution.status !== (status === "ready" ? 0 : 1) ||
      secondExecution.status !== 1 ||
      aligned.status !== status ||
      alignedExecution.status !== (status === "ready" ? 0 : 1) ||
      aligned.plannedActions.length !== 0 ||
      aligned.appliedActions.length !== 0 ||
      !second.plannedActions.some(({ kind }) => kind === "install_hopper") ||
      second.appliedActions.length !== 0
    )
      throw new Error(
        `packaged setup did not preserve idempotent agent configuration and explicit Hopper reinstall behavior: ${JSON.stringify({ first, aligned, second })}`,
      );
  }
  return {
    first,
    aligned,
    second,
    firstExecution,
    alignedExecution,
    secondExecution,
    status,
  };
};

/** Verify the live registration and exact pre-setup backup bytes. */
export const assertClientConfig = async (cli, configPath, original) => {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (
    config.existing !== true ||
    !(await isDirectRegistration(
      [
        config.mcpServers?.rea?.command,
        ...(config.mcpServers?.rea?.args ?? []),
      ],
      cli,
    ))
  )
    throw new Error("packaged client readback failed");
  if (!(await readFile(`${configPath}.rea.backup`)).equals(original))
    throw new Error("packaged client backup failed");
};

const assertOpenCodeConfig = async ({
  cli,
  configPath,
  expectedRegistration,
}) => {
  const contents = await readFile(configPath, "utf8");
  const errors = [];
  const config = parseJsonc(contents, errors, { allowTrailingComma: true });
  const mcp = config?.mcp;
  if (
    errors.length !== 0 ||
    !contents.includes("// OpenCode preferences must survive setup.") ||
    !contents.includes("// Keep this independently managed server.") ||
    config?.model !== "provider/model" ||
    mcp?.other?.command?.[0] !== "node" ||
    (expectedRegistration &&
      (mcp?.rea?.type !== "local" ||
        mcp.rea.enabled !== true ||
        !(await isDirectRegistration(mcp.rea.command, cli)))) ||
    (!expectedRegistration && mcp?.rea !== undefined)
  )
    throw new Error("packaged OpenCode JSONC registration readback failed");
};

const assertCodexSymlink = async ({
  cli,
  codexConfig,
  cursorConfig,
  codexTarget,
}) => {
  const codex = await readFile(codexTarget, "utf8");
  const registration = parseToml(codex).mcp_servers?.rea;
  if (
    !(await lstat(codexConfig)).isSymbolicLink() ||
    !(await lstat(cursorConfig)).isSymbolicLink() ||
    !codex.includes("[mcp_servers.rea]") ||
    !(await isDirectRegistration(
      [registration?.command, ...(registration?.args ?? [])],
      cli,
    )) ||
    !codex.includes("startup_timeout_sec = 30") ||
    !codex.startsWith(CODEX_ORIGINAL) ||
    (await readFile(`${codexConfig}.rea.backup`, "utf8")) !== CODEX_ORIGINAL
  )
    throw new Error("packaged setup did not preserve config symlinks");
};

const assertSkill = async ({ skillPath, siblingSkillPath, root }) => {
  const skill = await readFile(skillPath, "utf8");
  const canonicalSkill = await readFile(
    join(root, "skills/reverse-engineer-anything/SKILL.md"),
    "utf8",
  );
  if (skill !== canonicalSkill)
    throw new Error("packaged skill did not match its canonical source");
  const canonicalRoot = join(root, "skills/reverse-engineer-anything");
  for (const reference of await readdir(join(canonicalRoot, "references"))) {
    const installed = await readFile(
      join(dirname(skillPath), "references", reference),
      "utf8",
    );
    const canonical = await readFile(
      join(canonicalRoot, "references", reference),
      "utf8",
    );
    if (installed !== canonical)
      throw new Error(
        `packaged skill reference did not match canonical source: ${reference}`,
      );
  }
  const issues = await skillReferenceIssues(dirname(skillPath));
  if (issues.length > 0) throw new Error(issues.join("\n"));
  if ((await readFile(siblingSkillPath, "utf8")) !== "unrelated skill\n")
    throw new Error("packaged skill installation modified a sibling skill");
};

const assertAlignedDoctor = async (commands, cli, environment) => {
  const alignedDoctorExecution = await commands.runWithStatus(
    cli,
    ["doctor", "--json"],
    environment,
  );
  const alignedDoctor = JSON.parse(alignedDoctorExecution.stdout);
  if (
    alignedDoctorExecution.status !== (alignedDoctor.healthy ? 0 : 1) ||
    alignedDoctor.identity?.skill?.state !== "aligned" ||
    alignedDoctor.identity?.skill?.installed_tool_count !==
      TOOL_CONTRACTS.length ||
    alignedDoctor.checks?.some(({ name }) => name === "skill:identity")
  )
    throw new Error(
      "packaged doctor did not report the upgraded skill aligned",
    );
};

const verifyConfigReadback = async ({
  commands,
  cli,
  environment,
  claudeConfig,
  cursorConfig,
  codexConfig,
  codexTarget,
  root,
  skillPath,
  siblingSkillPath,
  opencodeConfig,
  opencodeOriginal,
  claudeOriginal,
  cursorOriginal,
}) => {
  await assertClientConfig(cli, claudeConfig, claudeOriginal);
  await assertClientConfig(cli, cursorConfig, cursorOriginal);
  await assertCodexSymlink({
    cli,
    codexConfig,
    cursorConfig,
    codexTarget,
  });
  await assertSkill({ skillPath, siblingSkillPath, root });
  await assertOpenCodeConfig({
    cli,
    configPath: opencodeConfig,
    expectedRegistration: true,
  });
  if (
    (await readFile(`${opencodeConfig}.rea.backup`, "utf8")) !==
    opencodeOriginal
  )
    throw new Error(
      "packaged OpenCode backup did not preserve the original JSONC",
    );
  await assertAlignedDoctor(commands, cli, environment);
};

const verifySetupFailureRecovery = async ({
  commands,
  cli,
  environment,
  claudeConfig,
  cursorConfig,
  status,
}) => {
  await writeFile(claudeConfig, "malformed");
  await writeFile(cursorConfig, '{"existing":true}\n');
  const failedExecution = await commands.runWithStatus(
    cli,
    ["setup", "--yes", "--all-detected", "--json"],
    environment,
  );
  const failed = JSON.parse(failedExecution.stdout);
  const cursorAfterFailure = JSON.parse(await readFile(cursorConfig, "utf8"));
  if (
    failed.status !== "needs_human" ||
    failedExecution.status !== 1 ||
    Object.keys(failed.clients ?? {}).length !== 0 ||
    failed.appliedActions.length !== 0 ||
    !failed.remediation?.includes("Claude Desktop") ||
    (await readFile(claudeConfig, "utf8")) !== "malformed" ||
    cursorAfterFailure.existing !== true ||
    cursorAfterFailure.mcpServers?.rea !== undefined
  )
    throw new Error(
      `packaged setup mutated clients after a preflight failure: ${JSON.stringify(failed)}`,
    );
  await writeFile(claudeConfig, "{}\n");
  const recoveredExecution = await commands.runWithStatus(
    cli,
    ["setup", "--yes", "--all-detected", "--json"],
    environment,
  );
  const recovered = JSON.parse(recoveredExecution.stdout);
  const registration = JSON.parse(await readFile(cursorConfig, "utf8"))
    .mcpServers?.rea;
  if (
    recovered.status !== status ||
    recoveredExecution.status !== (status === "ready" ? 0 : 1) ||
    !(await isDirectRegistration(
      [registration?.command, ...(registration?.args ?? [])],
      cli,
    ))
  )
    throw new Error("packaged setup did not recover");
};

const verifyDanglingSymlink = async ({ commands, cli, environment, home }) => {
  const geminiDir = join(home, ".gemini");
  const geminiConfig = join(geminiDir, "settings.json");
  await mkdir(geminiDir, { recursive: true });
  await symlink(join(home, "missing-gemini.json"), geminiConfig);
  const danglingExecution = await commands.runWithStatus(
    cli,
    ["setup", "--yes", "--client", "gemini_cli", "--json"],
    environment,
  );
  const dangling = JSON.parse(danglingExecution.stdout);
  if (
    dangling.status !== "needs_human" ||
    danglingExecution.status !== 1 ||
    Object.keys(dangling.clients ?? {}).length !== 0 ||
    dangling.appliedActions.length !== 0 ||
    !dangling.remediation?.includes("Gemini CLI") ||
    !dangling.remediation?.includes("unsafe or unresolved") ||
    !(await lstat(geminiConfig)).isSymbolicLink() ||
    (await pathExists(`${geminiConfig}.rea.backup`))
  )
    throw new Error(
      `packaged setup did not reject a dangling config symlink before mutation: ${JSON.stringify(dangling)}`,
    );
  await rm(geminiDir, { recursive: true });
};

const verifyUninstall = async ({
  commands,
  cli,
  environment,
  cursorConfig,
  codexConfig,
  cursorTarget,
  codexTarget,
  opencodeConfig,
}) => {
  const uninstallExecution = await commands.runWithStatus(
    cli,
    ["uninstall", "--json"],
    environment,
  );
  const uninstall = JSON.parse(uninstallExecution.stdout);
  const cursorAfterUninstall = JSON.parse(await readFile(cursorTarget, "utf8"));
  const codexAfterUninstall = await readFile(codexTarget, "utf8");
  const openCodeErrors = [];
  const openCodeAfterUninstall = parseJsonc(
    await readFile(opencodeConfig, "utf8"),
    openCodeErrors,
    { allowTrailingComma: true },
  );
  if (
    uninstall.status !== "complete" ||
    uninstallExecution.status !== 0 ||
    uninstall.items?.find(({ name }) => name === "cursor")?.status !==
      "removed" ||
    uninstall.items?.find(({ name }) => name === "codex")?.status !==
      "removed" ||
    !(await lstat(cursorConfig)).isSymbolicLink() ||
    !(await lstat(codexConfig)).isSymbolicLink() ||
    cursorAfterUninstall.existing !== true ||
    cursorAfterUninstall.mcpServers?.rea !== undefined ||
    codexAfterUninstall !== CODEX_ORIGINAL ||
    codexAfterUninstall.includes("mcp_servers.rea") ||
    openCodeErrors.length !== 0 ||
    openCodeAfterUninstall?.model !== "provider/model" ||
    openCodeAfterUninstall?.mcp?.rea !== undefined ||
    openCodeAfterUninstall?.mcp?.other?.command?.[0] !== "node" ||
    !(await readFile(`${opencodeConfig}.rea.backup`, "utf8")).includes(
      "OpenCode preferences must survive setup",
    ) ||
    !(await readFile(`${opencodeConfig}.rea.backup`, "utf8")).includes(
      "Keep this independently managed server",
    ) ||
    (await readFile(`${opencodeConfig}.rea.backup`, "utf8")) !==
      OPENCODE_ORIGINAL ||
    (await readFile(`${cursorConfig}.rea.backup`, "utf8")) !==
      '{"existing":true}\n' ||
    (await readFile(`${codexConfig}.rea.backup`, "utf8")) !== CODEX_ORIGINAL
  )
    throw new Error(
      `packaged uninstall did not preserve config symlinks: ${JSON.stringify(uninstall)}`,
    );
};

/** Verify setup transactions, skill installation, and uninstall for supported hosts. */
export async function verifyPackageSetup({
  commands,
  cli,
  packageRunnerCli,
  environment,
  home,
  npxLog,
  claudeConfig,
  codexConfig,
  cursorConfig,
  codexTarget,
  cursorTarget,
  supportedSetupHost,
  hopperSetupSupported,
  root,
}) {
  await verifyMcpAdd({ commands, cli, environment, npxLog, home });
  const skillPath = join(
    home,
    ".agents/skills/reverse-engineer-anything/SKILL.md",
  );
  const siblingSkillPath = join(home, ".agents/skills/unrelated/SKILL.md");
  if (supportedSetupHost) {
    await writeFile(codexTarget, CODEX_ORIGINAL);
    await mkdir(join(home, ".agents/skills/unrelated"), { recursive: true });
    await writeFile(siblingSkillPath, "unrelated skill\n");
  }
  const opencodeConfig = join(
    environment.XDG_CONFIG_HOME ?? join(home, ".config"),
    "opencode",
    "opencode.json",
  );
  if (supportedSetupHost) {
    await mkdir(join(opencodeConfig, ".."), { recursive: true });
    await writeFile(opencodeConfig, OPENCODE_ORIGINAL);
  }
  const unchangedPaths = [
    claudeConfig,
    cursorConfig,
    codexTarget,
    opencodeConfig,
    skillPath,
  ];
  const [claudeOriginal, cursorOriginal] = supportedSetupHost
    ? await Promise.all([readFile(claudeConfig), readFile(cursorConfig)])
    : [];
  await verifyInteractiveSetup({
    commands,
    command: packageRunnerCli,
    environment,
    root,
    unchangedPaths,
  });
  await verifyRedirectedStdoutSetup({
    commands,
    command: packageRunnerCli,
    environment,
    root,
    unchangedPaths,
  });
  await verifySetupPlan({
    commands,
    cli,
    environment,
    claudeConfig,
    cursorConfig,
    codexTarget,
    opencodeConfig,
    opencodeOriginal: OPENCODE_ORIGINAL,
    supportedSetupHost,
  });
  const apply = await verifySetupApply({
    commands,
    cli,
    environment,
    supportedSetupHost,
    hopperSetupSupported,
  });
  if (supportedSetupHost) {
    await verifyAbsentOpenCodeSetup({ commands, cli, environment, home });
    await verifyAbsentClaudeCodeSetup({ commands, cli, environment, home });
    await verifyConfigReadback({
      commands,
      cli,
      environment,
      claudeConfig,
      cursorConfig,
      codexConfig,
      codexTarget,
      root,
      skillPath,
      siblingSkillPath,
      opencodeConfig,
      opencodeOriginal: OPENCODE_ORIGINAL,
      claudeOriginal,
      cursorOriginal,
    });
    await verifySetupFailureRecovery({
      commands,
      cli,
      environment,
      claudeConfig,
      cursorConfig,
      status: apply.status,
    });
    await verifyDanglingSymlink({ commands, cli, environment, home });
    await verifyUninstall({
      commands,
      cli,
      environment,
      cursorConfig,
      codexConfig,
      cursorTarget,
      codexTarget,
      opencodeConfig,
    });
  } else if (
    apply.first.status !== "needs_human" ||
    apply.aligned.status !== "needs_human" ||
    apply.second.status !== "needs_human"
  ) {
    throw new Error("packaged setup did not reject an unsupported host");
  }
}
