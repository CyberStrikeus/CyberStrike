import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { lstatSync } from "node:fs";
import { err, ok, type Result } from "../domain/result.js";
import {
  HermesClientPathError,
  resolveHermesClientHome,
} from "./HermesClientHome.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { appendCallerPath } from "../filesystem/callerPath.js";
import { resolveWindowsClaudeDesktopLocation } from "./ClaudeDesktopConfigLocation.js";
import {
  type MsixPackageView,
  windowsAppDataRoots,
} from "./MsixPackageStorage.js";

/** One supported client configuration location. */
export interface SetupClient {
  readonly name: string;
  readonly displayName?: string;
  readonly configPath: string;
  /** User configuration files in increasing precedence, including the write target. */
  readonly configPaths?: readonly string[];
  /** Read-only Gemini scopes and trust inputs; never setup write targets. */
  readonly geminiSettings?: {
    readonly systemPath: string;
    readonly defaultsPath: string;
    readonly workspaceDirectory: string;
    readonly trustedFoldersPath: string;
    readonly trustOverride?: boolean;
    readonly platform: NodeJS.Platform;
  };
  /** Unresolved path evidence only; consumers must not perform I/O on it. */
  readonly configPathError?: string;
  /** Same-scope fallback ZCode stops loading after its first native server. */
  readonly zcodeFallbackPath?: string;
  readonly markerPath?: string;
  /**
   * Registration storage shared with other products. Its presence never proves
   * this product is installed; only a recognizable REA-owned row in it proves
   * ownership of a registration REA wrote.
   */
  readonly sharedRegistration?: boolean;
  /** MSIX package storage that decides which configuration the client reads. */
  readonly msixPackage?: MsixPackageView;
  /** A running client can rewrite its configuration from memory. */
  readonly quitBeforeSetup?: boolean;
  /** Product-specific applicability evidence when configuration storage is shared. */
  readonly discoveryPaths?: readonly string[];
  readonly format?:
    | "json"
    | "claude_code"
    | "toml"
    | "vscode"
    | "copilot_cli"
    | "opencode"
    | "commandcode"
    | "grok"
    | "omp"
    | "pi"
    | "kimi"
    | "hermes"
    | "zcode_fallback"
    | "zcode"
    | "dsh"
    | "unsupported";
}

interface ClientPathFailure {
  readonly path: string;
  readonly message: string;
}

type ClientPathResult = Result<string, ClientPathFailure>;
type ClientPath =
  | readonly string[]
  | ((paths: ClientPathContext) => string | ClientPathResult);

interface ClientPathContext {
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

/** One resolved configuration location and its detection evidence. */
interface ClientLocation {
  readonly configPath: string;
  readonly markerPath: string;
  readonly msixPackage?: MsixPackageView;
}

type ClientDefinition = ClientDefinitionBase &
  (
    | {
        readonly configPath: ClientPath;
        readonly markerPath: ClientPath;
        readonly location?: undefined;
      }
    | {
        /** Resolve configuration and marker together when they share probes. */
        readonly location: (
          context: ClientPathContext,
        ) => Result<ClientLocation, ClientPathFailure>;
        readonly configPath?: undefined;
        readonly markerPath?: undefined;
      }
  );

interface ClientDefinitionBase {
  readonly name: string;
  readonly displayName: string;
  readonly discoveryPaths?: (context: ClientPathContext) => readonly string[];
  readonly sharedRegistration?: true;
  readonly format: NonNullable<SetupClient["format"]>;
  readonly quitBeforeSetup?: boolean;
  readonly zcodeFallbackPath?: (context: ClientPathContext) => string;
  readonly skillPath?: ClientPath;
  readonly configPaths?: (context: ClientPathContext) => readonly string[];
  readonly geminiSettings?: (
    context: ClientPathContext,
  ) => NonNullable<SetupClient["geminiSettings"]>;
}

/** XDG treats an empty config-home value as unset. */
const xdgConfigHome = ({ home, env }: ClientPathContext): string =>
  env.XDG_CONFIG_HOME || join(home, ".config");

const vscodeUserDirectory = ({
  home,
  platform,
  env,
}: ClientPathContext): string => {
  // Match VS Code's user-data selection before appending the User scope.
  // Empty overrides are unset; portable storage takes precedence over appdata.
  const userData = env.VSCODE_PORTABLE
    ? join(env.VSCODE_PORTABLE, "user-data")
    : env.VSCODE_APPDATA
      ? join(env.VSCODE_APPDATA, "Code")
      : platform === "win32"
        ? join(windowsAppDataRoots(home, env).roaming, "Code")
        : platform === "darwin"
          ? join(home, "Library", "Application Support", "Code")
          : join(xdgConfigHome({ home, platform, env }), "Code");
  // The catalog can describe Windows clients on another host; retain its
  // drive-absolute paths instead of resolving them against that host cwd.
  const absoluteUserData =
    platform === "win32" && win32.isAbsolute(userData) && !isAbsolute(userData)
      ? userData
      : isAbsolute(userData)
        ? resolve(userData)
        : resolve(env.VSCODE_CWD || process.cwd(), userData);
  return join(absoluteUserData, "User");
};

const traeUserDirectory = ({
  home,
  platform,
  env,
}: ClientPathContext): string => {
  if (platform === "win32")
    return join(windowsAppDataRoots(home, env).roaming, "Trae", "User");
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "Trae", "User");
  return join(xdgConfigHome({ home, platform, env }), "Trae", "User");
};

/** Windows packaging decides which file Claude Desktop reads; see its resolver. */
const claudeDesktopLocation = (
  context: ClientPathContext,
): Result<ClientLocation, ClientPathFailure> => {
  if (context.platform === "win32")
    return resolveWindowsClaudeDesktopLocation(context.home, context.env);
  const directory =
    context.platform === "linux"
      ? join(xdgConfigHome(context), "Claude")
      : join(context.home, "Library", "Application Support", "Claude");
  return ok({
    configPath: join(directory, "claude_desktop_config.json"),
    markerPath: directory,
  });
};

const claudeCodeConfigDirectory = ({ home, env }: ClientPathContext): string =>
  env.CLAUDE_CONFIG_DIR || home;

const claudeCodeMarkerDirectory = ({ home, env }: ClientPathContext): string =>
  env.CLAUDE_CONFIG_DIR || join(home, ".claude");

const codexDirectory = ({ home, env }: ClientPathContext): string =>
  env.CODEX_HOME || join(home, ".codex");

/** Kimi Code stores MCP declarations beside the rest of its home data. */
const kimiDirectory = ({ home, env }: ClientPathContext): string =>
  env.KIMI_CODE_HOME || join(home, ".kimi-code");

const qoderDirectory = ({ home, env }: ClientPathContext): string =>
  env.QODER_CONFIG_DIR || join(home, ".qoder");

/** Droid's override selects the home containing .factory, including personal skills. */
const factoryDirectory = ({ home, env }: ClientPathContext): string =>
  join(env.FACTORY_HOME_OVERRIDE || home, ".factory");

/** Match Qwen Code's home override, including tilde and cwd-relative paths. */
const qwenCodeDirectory = ({ home, env }: ClientPathContext): string => {
  const override = env.QWEN_HOME;
  if (!override) return join(home, ".qwen");
  const expanded =
    override === "~"
      ? home
      : override.startsWith("~/") || override.startsWith("~\\")
        ? join(
            home,
            ...override
              .slice(2)
              .split(/[/\\]+/)
              .filter(Boolean),
          )
        : override;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
};

const grokDirectory = ({ home, env }: ClientPathContext): string =>
  env.GROK_HOME || join(home, ".grok");

/** Match Harness home-paths for both independent roots; trim only to detect blanks. */
const dshDirectory = (
  home: string,
  override: string | undefined,
  fallback: string,
): string => {
  const selected =
    override !== undefined && override.trim().length > 0
      ? override
      : join(home, fallback);
  const expanded =
    selected === "~"
      ? home
      : selected.startsWith("~/") || selected.startsWith("~\\")
        ? join(home, selected.slice(2))
        : selected;
  return resolve(expanded);
};

const dshHomeDirectory = ({ home, env }: ClientPathContext): string =>
  dshDirectory(home, env.DSH_HOME, ".dsh");

const dshPatchDirectory = (context: ClientPathContext): string =>
  join(dshHomeDirectory(context), "cordis.patch.yml");

const hermesDirectory = ({ home, platform, env }: ClientPathContext): string =>
  resolveHermesClientHome(home, platform, env);

/** Grok Bot uses an absolute SAND_DATA_ROOT; anything else stays ~/.grokbot. */
const grokBotDirectory = ({ home, env }: ClientPathContext): string => {
  const root = env.SAND_DATA_ROOT;
  return root !== undefined && root !== "" && isAbsolute(root)
    ? root
    : join(home, ".grokbot");
};

/**
 * Grok Bot stores connectors in the signed-in account and runs them on its
 * hosted computer. The data directory is only a detection marker.
 */
export const GROK_BOT_MANUAL_REGISTRATION_REMEDIATION =
  "Grok Bot keeps connectors in the signed-in account and runs them on its hosted computer. Setup does not write that account store, and a data-directory mcp.json is not a registration. In the Grok Bot chat, add a custom MCP server named rea that runs on the Bot's computer with `npx -y rea-agents@<version> mcp`. Do not put credentials in the command or arguments. A stdio server on this machine is not attached.";

/** Remediation for a client whose connector is not a local configuration file. */
export const manualRegistrationRemediation = (
  clientName: string,
): string | undefined =>
  clientName === "grok_bot"
    ? GROK_BOT_MANUAL_REGISTRATION_REMEDIATION
    : undefined;

/**
 * Facts a setup plan must disclose so an approved registration persists:
 * which file an MSIX package reads, and that a running client can overwrite it.
 */
export const registrationPersistenceDetail = (
  client: SetupClient,
): string | undefined => {
  const name = client.displayName ?? client.name;
  const msix = client.msixPackage;
  const packageDetail =
    msix === undefined
      ? undefined
      : client.configPath === msix.privateConfigPath
        ? `${name} is installed as MSIX package ${msix.packageFamilyName}, which reads this package-private file instead of ${msix.appDataConfigPath}.`
        : `${name} is installed as MSIX package ${msix.packageFamilyName}, which reads this file until it saves its own copy at ${msix.privateConfigPath}.`;
  const quitDetail =
    client.quitBeforeSetup === true
      ? `Quit ${name} fully before approving; closing its window is not enough. A running ${name} can rewrite this file from memory and drop the registration. Start it again after setup.`
      : undefined;
  const details = [packageDetail, quitDetail].filter(
    (detail): detail is string => detail !== undefined,
  );
  return details.length === 0 ? undefined : details.join(" ");
};

/**
 * Why this process must not change an MSIX client's configuration. A process
 * the running app started sees its redirected AppData, and the app would
 * overwrite the change from memory; an unknown view cannot rule that out.
 */
export const registrationWriteBlocker = (
  client: SetupClient,
  operation: "setup" | "uninstall",
): string | undefined => {
  const msix = client.msixPackage;
  if (msix === undefined || msix.processView === "direct") return undefined;
  const name = client.displayName ?? client.name;
  if (msix.processView === "redirected")
    return `This process was started from ${name}'s MSIX package ${msix.packageFamilyName}: its AppData is redirected into that package, so ${name} is running and would overwrite ${msix.privateConfigPath} from memory. Quit ${name} fully, then rerun ${operation} from a terminal that ${name} did not start.`;
  // Setup would write the configuration the app reads; uninstall cleans both files.
  const manualEdit =
    operation === "setup"
      ? `Add REA's entry to ${client.configPath} by hand`
      : `Remove REA's entry by hand from each of ${msix.privateConfigPath} and ${msix.appDataConfigPath} that has one`;
  return `REA cannot tell whether ${name}'s MSIX package ${msix.packageFamilyName} started this process, because no private file under ${dirname(dirname(msix.privateConfigPath))} could be compared with ${dirname(dirname(msix.appDataConfigPath))}, and a ${name} that started it would overwrite the change from memory. ${manualEdit} while ${name} is fully quit, or rerun ${operation} from a terminal that ${name} did not start once REA can compare a private file there.`;
};

/** The MSIX package view, if any, that redirects this process's AppData writes. */
export const appDataRedirection = (
  clients: readonly SetupClient[],
): MsixPackageView | undefined =>
  clients.find(({ msixPackage }) => msixPackage?.processView === "redirected")
    ?.msixPackage;

const OMP_PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const OMP_RESERVED_PROFILE =
  /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/iu;

/**
 * The OMP agent directory whose `mcp.json` holds user-scope MCP servers. OMP
 * joins PI_CONFIG_DIR to the home directory, and a named profile ignores
 * PI_CODING_AGENT_DIR. Relative overrides use the setup process working directory.
 */
const ompAgentDirectory = (context: ClientPathContext): ClientPathResult => {
  const root = join(context.home, context.env.PI_CONFIG_DIR || ".omp");
  // OMP_PROFILE wins even when empty. Match OMP's validation on every host.
  const profile = (context.env.OMP_PROFILE ?? context.env.PI_PROFILE)?.trim();
  if (profile !== undefined && profile !== "" && profile !== "default") {
    if (
      !OMP_PROFILE_NAME.test(profile) ||
      profile.endsWith(".") ||
      OMP_RESERVED_PROFILE.test(profile)
    )
      return err({
        path: root,
        message: `Invalid OMP profile ${JSON.stringify(profile)}: names must match ^[a-z0-9][a-z0-9._-]{0,63}$, cannot end with ".", and cannot be a Windows reserved device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9, including extensions). Repair OMP_PROFILE or PI_PROFILE before configuring OMP.`,
      });
    return ok(join(root, "profiles", profile, "agent"));
  }
  const override = context.env.PI_CODING_AGENT_DIR;
  return ok(override ? resolve(override) : join(root, "agent"));
};

/**
 * Pi's public getAgentDir()/normalizePath semantics, not OMP's profiles.
 * Keep relative overrides relative: filesystem consumers resolve them in cwd.
 */
const piAgentDirectory = ({
  home,
  platform,
  env,
}: ClientPathContext): string => {
  const paths = platform === "win32" ? win32 : { join };
  let directory = env.PI_CODING_AGENT_DIR;
  if (!directory) return paths.join(home, ".pi", "agent");
  if (
    platform === "win32" &&
    directory.startsWith("/") &&
    !directory.startsWith("//") &&
    !directory.includes("\\")
  ) {
    const drive = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/iu.exec(
      directory,
    );
    if (drive !== null)
      directory = `${drive[1]?.toUpperCase()}:\\${drive[2]?.replaceAll("/", "\\") ?? ""}`;
  }
  if (directory === "~") return home;
  if (
    directory.startsWith("~/") ||
    (platform === "win32" && directory.startsWith("~\\"))
  )
    return paths.join(home, directory.slice(2));
  if (directory.startsWith("file://"))
    return fileURLToPath(directory, { windows: platform === "win32" });
  return directory;
};

const copilotDirectory = ({ home, env }: ClientPathContext): string =>
  env.COPILOT_HOME || join(home, ".copilot");

const commandCodeDirectory = ({ home }: ClientPathContext): string =>
  join(home, ".commandcode");

/**
 * OpenCode appends `OPENCODE_CONFIG_DIR` only when the value is non-empty.
 * An empty variable is the same as unset and leaves the XDG directory in place.
 */
const openCodeOverrideDirectory = (
  env: ClientPathContext["env"],
): string | undefined => {
  const directory = env.OPENCODE_CONFIG_DIR;
  return directory === undefined || directory === "" ? undefined : directory;
};

const opencodeDirectory = (context: ClientPathContext): string =>
  openCodeOverrideDirectory(context.env) ??
  join(xdgConfigHome(context), "opencode");

/** OpenCode loads global JSON before JSONC, then explicit file and directory overrides. */
const openCodeConfigurationPaths = (
  context: ClientPathContext,
): readonly string[] => {
  const directory = join(xdgConfigHome(context), "opencode");
  const overrideDirectory = openCodeOverrideDirectory(context.env);
  const paths = [
    join(directory, "config.json"),
    join(directory, "opencode.json"),
    join(directory, "opencode.jsonc"),
    ...(context.env.OPENCODE_CONFIG ? [context.env.OPENCODE_CONFIG] : []),
    ...(overrideDirectory !== undefined
      ? [
          join(overrideDirectory, "opencode.json"),
          join(overrideDirectory, "opencode.jsonc"),
        ]
      : []),
  ];
  const resolved = paths.map((path) => resolve(path));
  return resolved.filter((path, index) => resolved.lastIndexOf(path) === index);
};

const existingOpenCodeConfigPath = (context: ClientPathContext): string => {
  // The selected directory is loaded after an explicit file by OpenCode V1.
  const overrideDirectory = openCodeOverrideDirectory(context.env);
  const candidates =
    overrideDirectory !== undefined
      ? [
          join(overrideDirectory, "opencode.json"),
          join(overrideDirectory, "opencode.jsonc"),
        ].map((path) => resolve(path))
      : context.env.OPENCODE_CONFIG
        ? [resolve(context.env.OPENCODE_CONFIG)]
        : [
            join(opencodeDirectory(context), "opencode.json"),
            join(opencodeDirectory(context), "opencode.jsonc"),
          ].map((path) => resolve(path));
  return (
    [...candidates].reverse().find((path) => {
      try {
        lstatSync(path);
        return true;
      } catch (cause: unknown) {
        return !(
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        );
      }
    }) ??
    resolve(
      overrideDirectory !== undefined
        ? join(overrideDirectory, "opencode.json")
        : context.env.OPENCODE_CONFIG ||
            join(opencodeDirectory(context), "opencode.json"),
    )
  );
};

const geminiSettings = ({
  home,
  platform,
  env,
}: ClientPathContext): NonNullable<SetupClient["geminiSettings"]> => {
  const system =
    env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ||
    (platform === "darwin"
      ? "/Library/Application Support/GeminiCli/settings.json"
      : platform === "win32"
        ? "C:\\ProgramData\\gemini-cli\\settings.json"
        : "/etc/gemini-cli/settings.json");
  const trustOverride =
    env.GEMINI_RESTRICTED_MODE === "true" ||
    env.GEMINI_CLI_TRUST_WORKSPACE === "false"
      ? false
      : env.GEMINI_CLI_TRUST_WORKSPACE === "true"
        ? true
        : undefined;
  return {
    systemPath: system,
    defaultsPath:
      env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH ||
      join(dirname(system), "system-defaults.json"),
    workspaceDirectory: process.cwd(),
    trustedFoldersPath:
      env.GEMINI_CLI_TRUSTED_FOLDERS_PATH ||
      join(env.GEMINI_CLI_HOME || home, ".gemini", "trustedFolders.json"),
    ...(trustOverride === undefined ? {} : { trustOverride }),
    platform,
  };
};

const devinDirectory = ({ home, platform, env }: ClientPathContext): string =>
  platform === "win32"
    ? join(windowsAppDataRoots(home, env).roaming, "devin")
    : join(env.XDG_CONFIG_HOME || join(home, ".config"), "devin");

/**
 * FreeBuff's own profile directory (its `state.json` root, fixed under
 * `.config` on every platform). The shared `~/.agents` folder is not
 * FreeBuff-specific: REA's own skill installs create it, so it cannot
 * prove FreeBuff is installed.
 */
const freebuffProfileDirectory = ({ home }: ClientPathContext): string =>
  join(home, ".config", "freebuff-desktop");

/** Stable product metadata used to derive setup discovery and documentation. */
export const SUPPORTED_CLIENT_DEFINITIONS = [
  {
    name: "claude_code",
    displayName: "Claude Code",
    skillPath: (context: ClientPathContext) =>
      join(claudeCodeMarkerDirectory(context), "skills"),
    configPath: (context: ClientPathContext) =>
      join(claudeCodeConfigDirectory(context), ".claude.json"),
    markerPath: claudeCodeMarkerDirectory,
    format: "claude_code",
  },
  {
    name: "claude_desktop",
    displayName: "Claude Desktop",
    location: claudeDesktopLocation,
    quitBeforeSetup: true,
    format: "json",
  },
  {
    name: "codex",
    displayName: "Codex",
    configPath: (context: ClientPathContext) =>
      appendCallerPath(codexDirectory(context), "config.toml"),
    markerPath: codexDirectory,
    format: "toml",
  },
  {
    name: "cursor",
    displayName: "Cursor",
    configPath: [".cursor", "mcp.json"],
    markerPath: [".cursor"],
    format: "json",
  },
  {
    name: "gemini_cli",
    displayName: "Gemini CLI",
    geminiSettings,
    configPath: ({ home, env }: ClientPathContext) =>
      join(env.GEMINI_CLI_HOME || home, ".gemini", "settings.json"),
    markerPath: ({ home, env }: ClientPathContext) =>
      join(env.GEMINI_CLI_HOME || home, ".gemini"),
    skillPath: ({ home, env }: ClientPathContext) =>
      join(env.GEMINI_CLI_HOME || home, ".agents", "skills"),
    format: "json",
  },
  {
    name: "windsurf",
    displayName: "Windsurf",
    configPath: [".codeium", "windsurf", "mcp_config.json"],
    markerPath: [".codeium", "windsurf"],
    format: "json",
  },
  {
    name: "devin",
    displayName: "Devin",
    configPath: ({ home, platform, env }: ClientPathContext) =>
      join(devinDirectory({ home, platform, env }), "mcp_config.json"),
    markerPath: devinDirectory,
    format: "json",
  },
  {
    name: "opencode",
    displayName: "OpenCode",
    configPath: existingOpenCodeConfigPath,
    configPaths: openCodeConfigurationPaths,
    markerPath: opencodeDirectory,
    format: "opencode",
  },
  {
    name: "antigravity",
    displayName: "Antigravity",
    skillPath: [".gemini", "config", "skills"],
    configPath: [".gemini", "config", "mcp_config.json"],
    markerPath: [".gemini", "config"],
    format: "json",
  },
  {
    name: "copilot_cli",
    displayName: "GitHub Copilot CLI",
    configPath: (context: ClientPathContext) =>
      join(copilotDirectory(context), "mcp-config.json"),
    markerPath: copilotDirectory,
    format: "copilot_cli",
  },
  {
    name: "commandcode",
    displayName: "Command Code",
    configPath: (context: ClientPathContext) =>
      join(commandCodeDirectory(context), "mcp.json"),
    markerPath: commandCodeDirectory,
    format: "commandcode",
  },
  {
    name: "qwen_code",
    displayName: "Qwen Code",
    configPath: (context: ClientPathContext) =>
      join(qwenCodeDirectory(context), "settings.json"),
    markerPath: qwenCodeDirectory,
    format: "json",
  },
  {
    name: "kimi",
    displayName: "Kimi Code",
    configPath: (context: ClientPathContext) =>
      join(kimiDirectory(context), "mcp.json"),
    markerPath: kimiDirectory,
    format: "kimi",
  },
  {
    name: "vscode",
    displayName: "VS Code",
    configPath: (context: ClientPathContext) =>
      join(vscodeUserDirectory(context), "mcp.json"),
    markerPath: vscodeUserDirectory,
    format: "vscode",
  },
  {
    name: "trae",
    displayName: "Trae",
    skillPath: [".trae", "skills"],
    configPath: (context: ClientPathContext) =>
      join(traeUserDirectory(context), "mcp.json"),
    markerPath: traeUserDirectory,
    format: "json",
  },
  {
    name: "workbuddy",
    displayName: "WorkBuddy",
    skillPath: [".workbuddy", "skills"],
    configPath: [".workbuddy", "mcp.json"],
    markerPath: [".workbuddy"],
    format: "json",
  },
  {
    name: "grok_build",
    displayName: "Grok Build",
    configPath: (context: ClientPathContext) =>
      join(grokDirectory(context), "config.toml"),
    markerPath: grokDirectory,
    format: "grok",
  },
  {
    name: "omp",
    displayName: "OMP",
    configPath: (context: ClientPathContext) => {
      const directory = ompAgentDirectory(context);
      return directory.ok ? ok(join(directory.value, "mcp.json")) : directory;
    },
    markerPath: ompAgentDirectory,
    format: "omp",
  },
  {
    name: "pi",
    displayName: "Pi",
    configPath: (context: ClientPathContext) =>
      (context.platform === "win32" ? win32 : { join }).join(
        piAgentDirectory(context),
        "mcp.json",
      ),
    markerPath: piAgentDirectory,
    format: "pi",
  },
  {
    name: "hermes",
    displayName: "Hermes",
    skillPath: (context: ClientPathContext) =>
      appendCallerPath(hermesDirectory(context), "skills"),
    configPath: (context: ClientPathContext) =>
      appendCallerPath(hermesDirectory(context), "config.yaml"),
    markerPath: hermesDirectory,
    format: "hermes",
  },
  {
    name: "qoder",
    displayName: "Qoder",
    skillPath: (context: ClientPathContext) =>
      join(qoderDirectory(context), "skills"),
    configPath: (context: ClientPathContext) =>
      join(qoderDirectory(context), "settings.json"),
    markerPath: qoderDirectory,
    format: "json",
  },
  {
    name: "droid",
    displayName: "Factory Droid",
    skillPath: (context: ClientPathContext) =>
      join(factoryDirectory(context), "skills"),
    configPath: (context: ClientPathContext) =>
      join(factoryDirectory(context), "mcp.json"),
    markerPath: factoryDirectory,
    format: "json",
  },
  {
    name: "zcode",
    zcodeFallbackPath: ({ home }: ClientPathContext) =>
      join(home, ".agents", "mcp.json"),
    displayName: "ZCode",
    configPath: [".zcode", "cli", "config.json"],
    markerPath: [".zcode", "cli"],
    skillPath: [".zcode", "skills"],
    discoveryPaths: ({ home }: ClientPathContext) => [
      join(home, ".zcode", "cli"),
    ],
    format: "zcode",
  },
  {
    name: "dsh",
    displayName: "DeepSeek Harness",
    // The home Cordis patch applies to every profile; the skill directory is
    // shared agent storage Harness discovers.
    skillPath: ({ home, env }: ClientPathContext) =>
      join(dshDirectory(home, env.DSH_AGENTS_HOME, ".agents"), "skills"),
    configPath: dshPatchDirectory,
    markerPath: dshHomeDirectory,
    format: "dsh",
  },
  {
    name: "freebuff",
    displayName: "FreeBuff",
    // FreeBuff discovers personal skills in the shared user agents directory.
    skillPath: ({ home }: ClientPathContext) => join(home, ".agents", "skills"),
    // FreeBuff loads MCP servers from the shared user agents directory.
    configPath: ({ home }: ClientPathContext) =>
      join(home, ".agents", "mcp.json"),
    markerPath: freebuffProfileDirectory,
    discoveryPaths: (context: ClientPathContext) => [
      freebuffProfileDirectory(context),
    ],
    // The same file doubles as ZCode's user-scope fallback, so its presence
    // proves neither product is installed; see clientOwnershipEvidencePaths.
    sharedRegistration: true,
    format: "json",
  },
  {
    name: "grok_bot",
    displayName: "Grok Bot",
    configPath: grokBotDirectory,
    markerPath: grokBotDirectory,
    format: "unsupported",
  },
] as const satisfies readonly ClientDefinition[];

/**
 * Paths whose presence means the product itself is applicable, so doctor and
 * setup should inspect the client. Layered sources count: OpenCode still loads
 * its XDG files when a custom directory override does not exist. Shared
 * registration storage never establishes applicability; see
 * {@link clientOwnershipEvidencePaths}.
 */
export const clientEvidencePaths = (
  client: Pick<
    SetupClient,
    "configPath" | "configPaths" | "markerPath" | "discoveryPaths"
  >,
): readonly string[] => [
  ...new Set(
    (
      client.discoveryPaths ?? [
        client.configPath,
        ...(client.configPaths ?? []),
        client.markerPath,
      ]
    ).filter((path): path is string => path !== undefined && path.length > 0),
  ),
];

/**
 * Paths where a recognizable REA-owned row proves ownership of a registration
 * REA wrote, never that the product is installed: shared storage is created by
 * other products and by REA's own skill installs. A client whose registration
 * is product-local declares no shared storage, so this stays empty for it.
 */
export const clientOwnershipEvidencePaths = (
  client: Pick<
    SetupClient,
    "configPath" | "configPaths" | "sharedRegistration"
  >,
): readonly string[] =>
  client.sharedRegistration === true
    ? [client.configPath, ...(client.configPaths ?? [])].filter(
        (path): path is string => path !== undefined && path.length > 0,
      )
    : [];

/**
 * Registration storage this client shares with another product: its own shared
 * configuration plus any same-scope fallback another client also loads. Only
 * this storage may be retained when product applicability is unproven, because
 * failing closed on it would block REA removals for files REA does not own.
 * Product-local configuration is REA's own boundary and stays fail-closed.
 */
export const clientSharedRegistrationPaths = (
  client: Pick<
    SetupClient,
    "configPath" | "configPaths" | "sharedRegistration" | "zcodeFallbackPath"
  >,
): ReadonlySet<string> =>
  new Set([
    ...clientOwnershipEvidencePaths(client),
    ...(client.zcodeFallbackPath === undefined
      ? []
      : [client.zcodeFallbackPath]),
  ]);

const resolvePath = (
  path: ClientPath,
  context: ClientPathContext,
): ClientPathResult => {
  const resolved =
    typeof path === "function" ? path(context) : join(context.home, ...path);
  return typeof resolved === "string" ? ok(resolved) : resolved;
};

const resolveLocation = (
  definition: ClientDefinition,
  context: ClientPathContext,
): Result<ClientLocation, ClientPathFailure> => {
  if (definition.location !== undefined) return definition.location(context);
  const config = resolvePath(definition.configPath, context);
  if (!config.ok) return config;
  const marker = resolvePath(definition.markerPath, context);
  return marker.ok
    ? ok({ configPath: config.value, markerPath: marker.value })
    : marker;
};

/** Describe every client location that setup, doctor, or uninstall may inspect. */
export const supportedClients = (
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: ClientPathContext["env"] = process.env,
): readonly SetupClient[] => {
  const context = { home, platform, env };
  const definitions: readonly ClientDefinition[] = SUPPORTED_CLIENT_DEFINITIONS;
  return definitions.map((definition) => {
    try {
      const location = resolveLocation(definition, context);
      if (!location.ok)
        return {
          name: definition.name,
          displayName: definition.displayName,
          format: definition.format,
          configPath: location.error.path,
          configPathError: location.error.message,
        };
      const { configPath, markerPath, msixPackage } = location.value;
      return {
        name: definition.name,
        displayName: definition.displayName,
        configPath,
        ...(definition.geminiSettings === undefined
          ? {}
          : { geminiSettings: definition.geminiSettings(context) }),
        ...(definition.configPaths === undefined
          ? {}
          : {
              configPaths: [
                ...new Set([...definition.configPaths(context), configPath]),
              ],
            }),
        ...(definition.zcodeFallbackPath === undefined
          ? {}
          : { zcodeFallbackPath: definition.zcodeFallbackPath(context) }),
        markerPath,
        ...(msixPackage === undefined ? {} : { msixPackage }),
        ...(definition.quitBeforeSetup === true
          ? { quitBeforeSetup: true }
          : {}),
        ...(definition.discoveryPaths === undefined
          ? {}
          : { discoveryPaths: definition.discoveryPaths(context) }),
        ...(definition.sharedRegistration === true
          ? { sharedRegistration: true }
          : {}),
        format: definition.format,
      };
    } catch (cause: unknown) {
      if (cause instanceof HermesClientPathError)
        return {
          name: definition.name,
          displayName: definition.displayName,
          format: definition.format,
          configPath: cause.path,
          configPathError: cause.message,
        };
      if (definition.name !== "pi") throw cause;
      return {
        name: definition.name,
        displayName: definition.displayName,
        format: definition.format,
        configPath: env.PI_CODING_AGENT_DIR ?? "",
        configPathError: `Invalid PI_CODING_AGENT_DIR: ${cause instanceof Error ? cause.message : String(cause)}. Repair the override before configuring Pi.`,
      };
    }
  });
};

/** Resolved destinations and unresolved selections share one path-resolution owner. */
export const clientSkillDirectories = (
  home: string,
  clientIds: readonly string[] | undefined,
  environment: Readonly<NodeJS.ProcessEnv> = {},
  platform: NodeJS.Platform = process.platform,
): {
  readonly directories: readonly {
    readonly client: string;
    readonly directory: string;
  }[];
  readonly unresolved: readonly {
    readonly client: string;
    readonly path: string;
    readonly detail: string;
  }[];
} => {
  const unresolved: { client: string; path: string; detail: string }[] = [];
  const definitions: readonly ClientDefinition[] = SUPPORTED_CLIENT_DEFINITIONS;
  const selected =
    clientIds === undefined
      ? [
          "shared",
          ...definitions
            .filter(({ skillPath }) => skillPath !== undefined)
            .map(({ name }) => name),
        ]
      : clientIds.length === 0
        ? ["shared"]
        : clientIds;
  const sharedDirectory = appendCallerPath(home, ".agents/skills", platform);
  const destinations = new Map<string, { client: string; directory: string }>();
  for (const client of selected) {
    const definition = definitions.find(({ name }) => name === client);
    if (definition === undefined && client !== "shared") {
      unresolved.push({
        client,
        path: client,
        detail: `Unsupported skill client: ${client}`,
      });
      continue;
    }
    let directory: string;
    try {
      const resolved =
        definition?.skillPath === undefined
          ? ok(sharedDirectory)
          : resolvePath(definition.skillPath, {
              home,
              platform,
              env: environment,
            });
      if (!resolved.ok) {
        unresolved.push({
          client,
          path: resolved.error.path,
          detail: resolved.error.message,
        });
        continue;
      }
      directory = resolved.value;
    } catch (cause: unknown) {
      if (cause instanceof HermesClientPathError) {
        unresolved.push({ client, path: cause.path, detail: cause.message });
        continue;
      }
      throw cause;
    }
    if (!destinations.has(directory))
      destinations.set(directory, {
        client: directory === sharedDirectory ? "shared" : client,
        directory,
      });
  }
  return {
    directories: [...destinations.values()].sort((left, right) =>
      compareUnicodeCodePoints(left.directory, right.directory),
    ),
    unresolved,
  };
};
