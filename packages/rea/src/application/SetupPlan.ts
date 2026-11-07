import { SetupSkillInstallError, type SkillDestination } from "./SetupSkill.js";
import { classifyClientRegistrationCommand } from "./ClientRegistrationIdentity.js";
import type { LinuxPackageFamily } from "./HopperReleaseFeed.js";
import {
  linuxHopperInstallDisclosure,
  LINUX_HOPPER_SETUP_HOSTS,
  type LinuxDistribution,
} from "./LinuxHopper.js";
import { macHopperInstallDisclosure } from "./MacHopper.js";
import { macHopperUserApplicationPath } from "./MacHopperPaths.js";
import type {
  ClientConfigurationInspection,
  SetupAction,
  SetupClientState,
  SetupHost,
  SetupProviderEnvironment,
} from "./SetupTypes.js";
import {
  appDataRedirection,
  registrationPersistenceDetail,
  type SetupClient,
} from "./SupportedClients.js";
import { redirectedWriteBlocker } from "./MsixPackageStorage.js";
import type { DoctorReport } from "./Doctor.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { CURRENT_ENTRYPOINT_PATH } from "../process/CurrentEntrypointPath.js";
import { macosMajorVersion } from "../domain/macosVersion.js";

/** Whether automated Hopper installation can run on this host, and why not. */
export type HopperInstallEligibility =
  | { readonly supported: true }
  | { readonly supported: false; readonly remediation: string };

/** Read-only setup facts shared by client selection and preflight. */
export interface SetupDiscovery {
  readonly initialDoctor: Awaited<ReturnType<SetupHost["doctor"]>>;
  readonly installHopper: boolean;
  readonly hopperInstall: HopperInstallEligibility;
  readonly clients: readonly SetupClient[];
  readonly detectedClientIds: readonly string[];
  readonly defaultClientIds: readonly string[];
  readonly clientStates: readonly SetupClientState[];
  readonly linuxPackageFamily?: LinuxPackageFamily;
}

/** Discover supported clients and current registrations without mutation. */
export const discoverSetupState = async (input: {
  readonly host: SetupHost;
  readonly providerConfigured: boolean;
  readonly forceHopperInstall: boolean;
  readonly hopperLauncherConfigured?: boolean;
  readonly proposeHopper: boolean;
  readonly initialDoctor: DoctorReport;
}): Promise<SetupDiscovery> => {
  const { initialDoctor } = input;
  const linuxHopperRepairNeeded =
    input.hopperLauncherConfigured !== true &&
    initialDoctor.checks.some(
      ({ name, ok, detail }) =>
        !ok &&
        (name === "hopper-demo-runtime" ||
          (name === "hopper-version" && detail === "/opt/hopper/bin/Hopper")),
    );
  const linuxDistribution =
    input.host.platform === "linux"
      ? await input.host.linuxDistribution()
      : undefined;
  const hopperInstall = hopperInstallEligibility(
    input.host.platform,
    input.host.platform === "darwin"
      ? await input.host.macosVersion()
      : undefined,
    linuxDistribution,
  );
  const installHopper =
    input.forceHopperInstall ||
    (hopperInstall.supported &&
      input.proposeHopper &&
      (!input.providerConfigured || linuxHopperRepairNeeded));
  const [clients, detectedClients] = await Promise.all([
    input.host.supportedClients(),
    input.host.detectedClients(),
  ]);
  const detectedIds = new Set(detectedClients.map(({ name }) => name));
  const registrations = initialDoctor.identity?.registrations ?? [];
  const registrationByClient = new Map(
    registrations.map((registration) => [registration.client, registration]),
  );
  const clientStates = clients.map((client): SetupClientState => {
    const registration = registrationByClient.get(client.name);
    const commandIdentity =
      registration === undefined
        ? undefined
        : classifyClientRegistrationCommand(
            registration.command,
            CURRENT_ENTRYPOINT_PATH,
          );
    const ownedRegistration =
      (registration?.state === "aligned" || registration?.state === "stale") &&
      commandIdentity === "owned";
    const configured = ownedRegistration;
    const status: SetupClientState["status"] =
      registration?.state === "invalid"
        ? "invalid"
        : registration?.state === "unknown" || commandIdentity === "unknown"
          ? "unknown"
          : ownedRegistration && registration.state === "aligned"
            ? "configured"
            : ownedRegistration && registration.state === "stale"
              ? "needs_configuration"
              : detectedIds.has(client.name)
                ? "needs_configuration"
                : "missing";
    return {
      client,
      detected: detectedIds.has(client.name),
      configured,
      status,
    };
  });
  const defaultClientIds = registrations
    .filter(
      (registration) =>
        (registration.state === "aligned" || registration.state === "stale") &&
        classifyClientRegistrationCommand(
          registration.command,
          CURRENT_ENTRYPOINT_PATH,
        ) === "owned",
    )
    .map(({ client }) => client);
  return {
    initialDoctor,
    installHopper,
    hopperInstall,
    clients,
    detectedClientIds: [...detectedIds],
    defaultClientIds,
    clientStates,
    ...(linuxDistribution?.packageFamily === undefined
      ? {}
      : { linuxPackageFamily: linuxDistribution.packageFamily }),
  };
};

/** Preflight exactly the selected clients and produce their concrete actions. */
export const planSetupActions = async (input: {
  readonly discovery: SetupDiscovery;
  readonly host: SetupHost;
  readonly providerEnvironment: SetupProviderEnvironment;
  readonly command: readonly string[];
  readonly clientIds: readonly string[];
  readonly skillClientIds: readonly string[];
  readonly installSkill: boolean;
}): Promise<{
  readonly plannedActions: readonly SetupAction[];
  readonly selectedClients: readonly SetupClient[];
  readonly clientsToConfigure: readonly SetupClient[];
  readonly blocker?: string;
}> => {
  const byId = new Map(
    input.discovery.clients.map((client) => [client.name, client]),
  );
  const unknownClient = input.clientIds.find((id) => !byId.has(id));
  if (unknownClient !== undefined) {
    return {
      plannedActions: [],
      selectedClients: [],
      clientsToConfigure: [],
      blocker: `Unsupported setup client: ${unknownClient}.`,
    };
  }
  const selectedClients = input.clientIds.flatMap((id) => {
    const client = byId.get(id);
    return client === undefined ? [] : [client];
  });
  const hopperCache = input.host.linuxHopperReleaseCache;
  if (input.discovery.installHopper && hopperCache?.ok === false)
    return {
      plannedActions: [],
      selectedClients,
      clientsToConfigure: [],
      blocker: hopperCache.error.message,
    };
  if (
    selectedClients.length > 0 &&
    input.host.registrationCommandBlocker !== undefined
  )
    return {
      plannedActions: [],
      selectedClients,
      clientsToConfigure: [],
      blocker: input.host.registrationCommandBlocker,
    };
  const inspections = await Promise.all(
    selectedClients.map(async (client) => ({
      client,
      inspection: await input.host.inspectClientConfiguration(
        client,
        input.providerEnvironment,
        input.command,
      ),
    })),
  );
  const invalid = inspections.find(
    ({ inspection }) => inspection.status === "invalid",
  );
  if (invalid?.inspection.status === "invalid") {
    return {
      plannedActions: [],
      selectedClients,
      clientsToConfigure: [],
      blocker: `${invalid.client.displayName ?? invalid.client.name}: ${invalid.inspection.remediation}`,
    };
  }
  let skillDestinations: readonly SkillDestination[] = [];
  try {
    if (input.installSkill)
      skillDestinations = input.host.skillDestinations(input.skillClientIds);
  } catch (cause: unknown) {
    if (!(cause instanceof SetupSkillInstallError)) throw cause;
    return {
      plannedActions: [],
      selectedClients,
      clientsToConfigure: [],
      blocker: cause.remediation,
    };
  }
  const clientPlans = plannedClientWrites(
    inspections,
    input.discovery.installHopper,
  );
  const plannedActions = setupPlan({
    platform: input.host.platform,
    homeDirectory: input.host.homeDirectory,
    ...(hopperCache?.ok === true
      ? { hopperCacheDirectory: hopperCache.value }
      : {}),
    installHopper: input.discovery.installHopper,
    installSkill: input.installSkill,
    skillClientIds: input.skillClientIds,
    skillDestinations,
    clients: clientPlans,
    providerEnvironment: input.providerEnvironment,
    ...(input.discovery.linuxPackageFamily === undefined
      ? {}
      : { linuxPackageFamily: input.discovery.linuxPackageFamily }),
    command: input.command,
  });
  const blocker =
    (clientPlans.length > 0
      ? input.host.registrationCommandBlocker
      : undefined) ??
    redirectedWriteBlocker(
      appDataRedirection(input.discovery.clients),
      plannedActions
        .filter(({ kind }) => kind !== "install_hopper")
        .map(({ target }) => target),
      "setup",
    );
  return {
    plannedActions,
    selectedClients,
    clientsToConfigure: selectedClients.filter((client) =>
      clientPlans.some(({ client: planned }) => planned.name === client.name),
    ),
    ...(blocker === undefined ? {} : { blocker }),
  };
};

/** Selected clients whose registration setup writes, with the disclosed operation. */
const plannedClientWrites = (
  inspections: readonly {
    readonly client: SetupClient;
    readonly inspection: ClientConfigurationInspection;
  }[],
  installHopper: boolean,
) =>
  inspections.flatMap(({ client, inspection }) =>
    client.format !== "unsupported" &&
    (inspection.status === "create" ||
      inspection.status === "update" ||
      (installHopper && inspection.status === "already_current"))
      ? [
          {
            client,
            operation:
              inspection.status === "already_current"
                ? ("update" as const)
                : inspection.status,
            ...(inspection.status !== "already_current" &&
            inspection.backupPath !== undefined
              ? { backupPath: inspection.backupPath }
              : {}),
          },
        ]
      : [],
  );

/** Describe every selected setup mutation before user approval. */
const setupPlan = (input: {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly hopperCacheDirectory?: string;
  readonly installHopper: boolean;
  readonly installSkill: boolean;
  readonly skillClientIds: readonly string[];
  readonly skillDestinations: readonly SkillDestination[];
  readonly clients: readonly {
    readonly client: SetupClient;
    readonly operation: "create" | "update";
    readonly backupPath?: string;
  }[];
  readonly providerEnvironment: SetupProviderEnvironment;
  readonly linuxPackageFamily?: LinuxPackageFamily;
  readonly command: readonly string[];
}): readonly SetupAction[] => [
  ...(input.installHopper
    ? [
        {
          id: "install_hopper",
          kind: "install_hopper" as const,
          label: "Hopper deep-analysis provider",
          target:
            input.platform === "darwin"
              ? macHopperUserApplicationPath(input.homeDirectory)
              : "system package manager",
          detail:
            input.platform === "linux"
              ? `Download the current official Hopper demo, verify its PGP publisher and launcher bytes, and retain archive, public-key.asc and release.json under ${input.hopperCacheDirectory ?? `${input.homeDirectory}/.cache/rea/hopper-releases`}/<launcher-sha256> for offline verification. Preserve replaced damaged evidence beside it as <launcher-sha256>.backup-<id>. Install Hopper plus its Xvfb demo-session dependencies${input.linuxPackageFamily === "deb" ? ", including the shared library matching the distribution Python interpreter" : ""}. REA uses a private display and selects Hopper's offered demo mode for each analysis session.`
              : "Download the official Hopper package, verify it, and install it. Hopper may show its demo or license prompt when first opened.",
          external: true,
          operation: "install" as const,
          ...(input.platform === "linux"
            ? input.linuxPackageFamily === undefined
              ? {}
              : linuxDisclosure(input.linuxPackageFamily)
            : {
                networkOrigins: macHopperInstallDisclosure.networkOrigins,
                commands: macHopperInstallDisclosure.commands,
              }),
        },
      ]
    : []),
  ...input.clients
    .filter(({ client }) => client.format !== "unsupported")
    .map(({ client, operation, backupPath }): SetupAction => ({
      id: `configure_client:${client.name}`,
      kind: "configure_client",
      label: client.displayName ?? client.name,
      target: client.configPath,
      detail: clientConfigurationDetail(
        client,
        input.command,
        input.providerEnvironment,
        input.installHopper,
      ),
      external: false,
      operation,
      ...(backupPath === undefined ? {} : { backupPath }),
    })),
  ...(input.installSkill
    ? input.skillDestinations.map(({ client, path }): SetupAction => ({
        id: client === "shared" ? "install_skill" : `install_skill:${client}`,
        kind: "install_skill",
        label:
          client === "claude_code"
            ? "REA skill for Claude Code"
            : "REA reverse-engineering skill",
        target: path,
        detail:
          client === "claude_code"
            ? "Install or update the REA skill in Claude Code's personal skill directory."
            : "Install or update the bundled REA reverse-engineering skill and on-demand references.",
        external: false,
        operation: "install",
      }))
    : []),
];

const linuxDisclosure = (family: LinuxPackageFamily) => {
  const disclosure = linuxHopperInstallDisclosure(
    family,
    process.getuid?.() === 0,
  );
  return {
    networkOrigins: disclosure.networkOrigins,
    commands: disclosure.commands,
    integrity: disclosure.integrity,
  };
};

/** Refuse a selected Hopper installation this host cannot run, before mutation. */
export const hopperInstallRefusal = (
  discovery: Pick<SetupDiscovery, "installHopper" | "hopperInstall">,
): string | undefined =>
  discovery.installHopper && !discovery.hopperInstall.supported
    ? discovery.hopperInstall.remediation
    : undefined;

/**
 * Decide automated Hopper installation once from the host facts read during
 * discovery, so proposals, explicit requests, and recovery advice agree. An
 * unknown or unparseable macOS version and an unidentified Linux distribution
 * are not eligible.
 */
const hopperInstallEligibility = (
  platform: NodeJS.Platform,
  macosVersion: string | undefined,
  linuxDistribution: LinuxDistribution | undefined,
): HopperInstallEligibility => {
  if (platform === "darwin") {
    const major = macosMajorVersion(macosVersion);
    return major !== undefined && major >= 12
      ? { supported: true }
      : { supported: false, remediation: "Upgrade to macOS 12 or newer." };
  }
  if (platform === "linux")
    return linuxDistribution?.hopperSetupSupported === true
      ? { supported: true }
      : {
          supported: false,
          remediation: `Automated Hopper setup requires ${LINUX_HOPPER_SETUP_HOSTS}; configure an existing supported provider instead.`,
        };
  return {
    supported: false,
    remediation:
      "REA supports Hopper on macOS and selected x86_64 Linux distributions.",
  };
};

const clientConfigurationDetail = (
  client: SetupClient,
  command: readonly string[],
  environment: SetupProviderEnvironment,
  installHopper: boolean,
): string => {
  const entries = Object.entries(environment)
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
    .map(([name, value]) => `${name}=${value}`);
  const environmentDetail =
    entries.length === 0
      ? " No additional provider environment variables. Existing server environment overrides are retained."
      : ` Detected provider environment: ${entries.join(", ")}. Existing server environment overrides are retained; detected values replace matching keys.`;
  const hopperDetail = installHopper
    ? environment.HOPPER_LAUNCHER_PATH === undefined
      ? " If this plan installs Hopper, REA will add HOPPER_LAUNCHER_PATH using the launcher path reported by that installation."
      : " The HOPPER_LAUNCHER_PATH value shown above is the current fallback; if this plan installs Hopper, REA will replace it with the launcher path reported by that installation."
    : "";
  const persistence = registrationPersistenceDetail(client);
  return `Add the REA MCP registration for ${client.displayName ?? client.name}; preserve unrelated configuration. The backup path reflects the configuration inspected for this plan; if that file changes before execution, setup will select a recovery path for its current contents. Command: ${command.map((part) => JSON.stringify(part)).join(" ")}.${environmentDetail}${hopperDetail}${persistence === undefined ? "" : ` ${persistence}`}`;
};
