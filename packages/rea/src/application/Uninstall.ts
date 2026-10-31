import { appendCallerPath } from "../filesystem/callerPath.js";
import {
  isClientConfigurationCleanupFailure,
  retryClientConfigurationCleanup,
} from "./ClientConfigurationCleanup.js";
import {
  ClientConfigurationShapeError,
  clientConfigurationServersKey,
  parseClientConfiguration,
  serializeClientConfiguration,
  clientServerPath,
  legacyClientServerPath,
  shadowedClientServers,
  withClientServers,
  type ClientConfigurationDocument,
} from "./ClientConfigurationDocument.js";
import { err, ok, type Result } from "../domain/result.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { copyFile, lstat, realpath, rm, rmdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { basename, dirname } from "node:path";
import {
  defaultKunaCacheDirectory,
  sameLexicalDirectory,
} from "../config/kunaCacheDirectory.js";
import { linuxHopperReleaseCacheDirectory } from "./LinuxHopperCacheDirectory.js";

import { ClientConfigurationPublication } from "./ClientConfigurationPublication.js";
import {
  effectiveClientConfiguration,
  type ClientConfigurationSource,
} from "./ClientConfigurationFiles.js";
import { clientRegistrationOwnership } from "./ClientRegistration.js";

import { PRODUCT_IDENTITY } from "../identity.js";
import {
  isManagedSkillManifest,
  MANAGED_SKILL_FILES,
  readSkillFile,
  skillDestinationSelection,
} from "./SetupSkill.js";
import { dshDocument } from "./DshCordisPatch.js";
import { resolveClientConfigTransactionPath } from "./ClientConfigPath.js";
import {
  preserveCurrentRecoveryBackup,
  type RecoveryBackupPreservationOptions,
} from "./SetupRecoveryBackup.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import {
  InvalidUtf8FileError,
  readRegularFileText,
} from "./RegularFileRead.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  appDataRedirection,
  clientOwnershipEvidencePaths,
  clientSharedRegistrationPaths,
  manualRegistrationRemediation,
  registrationWriteBlocker,
  supportedClients,
  type SetupClient,
} from "./SupportedClients.js";
import {
  redirectedWriteBlocker,
  type MsixPackageView,
} from "./MsixPackageStorage.js";

interface ManagedPathStats {
  readonly uid?: number;
  isFile?(): boolean;
  isDirectory?(): boolean;
  isSymbolicLink(): boolean;
}

/** Injectable filesystem operations used to prove uninstall failure recovery. */
export interface UninstallFileSystem {
  readText(path: string): Promise<string>;
  readRegularText?(path: string): Promise<string>;
  /** Preserve the first backup; reject an existing destination with EEXIST. */
  copy(source: string, destination: string): Promise<void>;
  publishConfiguration(
    path: string,
    contents: string,
    original: string,
  ): Promise<
    Pick<
      ClientConfigurationPublication,
      "path" | "verify" | "assertCurrent" | "restore"
    >
  >;
  stat(path: string): Promise<ManagedPathStats>;
  realpath?(path: string): Promise<string>;
  remove(path: string, recursive?: boolean): Promise<void>;
  /** Remove a directory only if it is empty; a non-empty one is kept. */
  removeEmptyDirectory?(path: string): Promise<void>;
}

const systemFileSystem = (
  resources: ArtifactResourceScope,
): UninstallFileSystem => ({
  readText: (path) => readRegularFileText(path, { resources }),
  readRegularText: (path) => readSkillFile(path, resources),
  copy: (source, destination) =>
    copyFile(source, destination, fsConstants.COPYFILE_EXCL),
  publishConfiguration: (path, contents, original) =>
    ClientConfigurationPublication.write(path, contents, original),
  stat: (path) => lstat(path),
  realpath: (path) => realpath(path),
  remove: (path, recursive = true) => rm(path, { recursive }),
  removeEmptyDirectory: (path) => rmdir(path),
});

/** One completed or refused action, preserving its candidate configuration path. */
export interface UninstallAction {
  readonly status: "removed" | "retained" | "skipped" | "failed";
  readonly detail: string;
  readonly configuration_path?: string;
}

/** One client summary with its constituent actions when multiple paths apply. */
export interface UninstallItem extends UninstallAction {
  readonly name: string;
  readonly actions?: readonly UninstallAction[];
}

/** Structured, idempotent result of removing REA-owned state. */
export interface UninstallResult {
  readonly status: "complete" | "failed";
  readonly items: readonly UninstallItem[];
}

/** Applicability established once from product-specific discovery evidence. */
export interface UninstallClient extends SetupClient {
  readonly applicability?: "unverified";
  /** Clients that load this same registration table as a fallback report the
   * owner's outcome without inspecting or editing the file again. */
  readonly sharedWith?: readonly string[];
}

/** Filesystem boundary used by the contained uninstall workflow. */
export interface UninstallHost {
  clients(): Promise<readonly UninstallClient[]>;
  /** Report a configuration that cannot be read safely, before any removal. */
  inspectClient(client: UninstallClient): Promise<UninstallItem | undefined>;
  removeClient(client: UninstallClient): Promise<UninstallItem>;
  inspectSkill?(): Promise<UninstallItem | undefined>;
  removeSkill(): Promise<UninstallItem>;
  purgeData(): Promise<readonly UninstallItem[]>;
  close?(): Promise<string | undefined>;
}

/**
 * Remove only REA-owned registrations and managed files, optionally including
 * local state. A client configuration that cannot be read safely stops the
 * operation before anything is removed; one that fails during removal stops
 * the remaining removals.
 */
export const runUninstall = async (
  purgeData: boolean,
  host: UninstallHost = systemUninstallHost(),
): Promise<UninstallResult> => {
  let result: UninstallResult | undefined;
  let primaryFailure: unknown;
  let failed = false;
  try {
    const clients = await host.clients();
    const blocked: UninstallItem[] = [];
    for (const client of clients) {
      const blocking = await host.inspectClient(client);
      if (blocking !== undefined)
        blocked.push({ ...blocking, configuration_path: client.configPath });
    }
    const skillBlocker = await host.inspectSkill?.();
    if (skillBlocker !== undefined) blocked.push(skillBlocker);
    const items: UninstallItem[] =
      blocked.length > 0
        ? [
            ...blocked,
            item(
              "uninstall",
              "skipped",
              "No REA registration, skill, or data was removed. Repair each failed configuration, then rerun uninstall.",
            ),
          ]
        : await removeAll(clients, purgeData, host);
    items.push({
      name: "analysis_engine",
      status: "retained",
      detail: "Hopper is not owned by REA uninstall.",
    });
    const reported = collapseUninstallItems(
      projectSharedRegistrations(items, clients),
    );
    result = {
      status: reported.some(({ status }) => status === "failed")
        ? "failed"
        : "complete",
      items: reported,
    };
  } catch (cause: unknown) {
    failed = true;
    primaryFailure = cause;
  }
  let cleanupFailure: string | undefined;
  try {
    cleanupFailure = await host.close?.();
  } catch (cause: unknown) {
    cleanupFailure = `Uninstall resource cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  if (failed) {
    if (cleanupFailure !== undefined)
      throw new AggregateError(
        [primaryFailure, new Error(cleanupFailure)],
        "Uninstall failed and its resource cleanup remains incomplete.",
        { cause: primaryFailure },
      );
    throw primaryFailure;
  }
  if (result === undefined)
    throw new Error("Uninstall result was not produced.");
  if (cleanupFailure === undefined) return result;
  const items = collapseUninstallItems([
    ...result.items,
    item("uninstall_cleanup", "failed", cleanupFailure),
  ]);
  return { status: "failed", items };
};

/**
 * Each client is reread when it is edited, so a concurrent change is never
 * overwritten. A client that fails then still stops the remaining removals.
 */
const removeAll = async (
  clients: readonly UninstallClient[],
  purgeData: boolean,
  host: UninstallHost,
): Promise<UninstallItem[]> => {
  const items: UninstallItem[] = [];
  for (const client of clients) {
    const removed = await host.removeClient(client);
    items.push({ ...removed, configuration_path: client.configPath });
    if (removed.status === "failed")
      return [
        ...items,
        item(
          "uninstall",
          "skipped",
          "Uninstall stopped at this failure; the items above report what changed. Repair the failed configuration, then rerun uninstall.",
        ),
      ];
  }
  items.push(await host.removeSkill());
  if (purgeData) items.push(...(await host.purgeData()));
  return items;
};

/**
 * Report a shared file's single outcome under every client that loads it. The
 * owner edits the file once, so a fallback reader reports what happened to its
 * registration instead of finding it already absent.
 */
const projectSharedRegistrations = (
  items: readonly UninstallItem[],
  clients: readonly UninstallClient[],
): UninstallItem[] => {
  const readersByRegistration = new Map<string, readonly string[]>();
  for (const client of clients)
    if (client.sharedWith !== undefined && client.sharedWith.length > 0)
      readersByRegistration.set(
        JSON.stringify([client.name, client.configPath]),
        client.sharedWith,
      );
  if (readersByRegistration.size === 0) return [...items];
  return items.flatMap((next) => {
    const readers =
      next.configuration_path === undefined
        ? undefined
        : readersByRegistration.get(
            JSON.stringify([next.name, next.configuration_path]),
          );
    if (readers === undefined) return [next];
    const { name, ...action } = next;
    return [name, ...readers].map((reader) => ({ ...action, name: reader }));
  });
};

/**
 * Ownership is a readable, recognizable REA-owned row, never the shared
 * file's existence. An unrelated malformed file must not establish ownership;
 * it stays retained without blocking other removals.
 */
const hasOwnershipEvidence = async (
  client: UninstallClient,
  fileSystem: UninstallFileSystem,
): Promise<boolean> => {
  for (const path of clientOwnershipEvidencePaths(client)) {
    let original: string;
    try {
      original = await fileSystem.readText(path);
    } catch (cause: unknown) {
      // A close failure after a completed read still carries the exact text
      // in its retained outcome, and that text is the ownership fact: only a
      // read that never completed proves nothing. Preserve it, so later read
      // failures stay blocking instead of softening to retained.
      if (!(cause instanceof RegularFileCleanupFailure)) continue;
      if (cause.outcome.kind !== "completed") continue;
      const completed: unknown = cause.outcome.value;
      if (typeof completed !== "string") continue;
      original = completed;
    }
    let parsed: ClientConfigurationDocument;
    try {
      parsed = parseClientConfiguration(original, client.format);
    } catch {
      // Malformed shared data is retained, never ownership evidence.
      continue;
    }
    const removal = clientRegistrationRemoval(parsed, original, client);
    // Refusing the edit never retracts the owned-row fact: an effective
    // REA-owned row shadowed by a foreign duplicate still proves ownership,
    // so later read failures stay blocking instead of softening to retained.
    const owned = removal.ok ? removal.value : removal.error.owned;
    if (owned.removeNative || owned.legacyPath !== undefined) return true;
  }
  return false;
};

/** Installation evidence for one probed path, never inferred from absence. */
interface DiscoveryProbe {
  readonly applicable: boolean;
  readonly unresolved: boolean;
}

/** A client's shared-storage applicability from its discovery paths: a hit
 * proves installation, a miss leaves it unproven, and any other probe failure
 * leaves it unresolved — never absence. */
const discoveryApplicability = async (
  discoveryPaths: readonly string[] | undefined,
  fileSystem: UninstallFileSystem,
): Promise<DiscoveryProbe> => {
  if (discoveryPaths === undefined)
    return { applicable: true, unresolved: false };
  let applicable = false;
  let unresolved = false;
  for (const path of discoveryPaths) {
    try {
      // The product's own directory proves installation, not a leftover link
      // to it: `stat` is `lstat`, so a dangling profile link passes here even
      // though setup and doctor, which follow the target, reject it. Resolve
      // the link for the same answer, keeping `lstat` for removal safety.
      const stats = await fileSystem.stat(path);
      if (stats.isSymbolicLink() && fileSystem.realpath !== undefined)
        await fileSystem.realpath(path);
      return { applicable: true, unresolved: false };
    } catch (cause: unknown) {
      // Absence keeps scanning until one discovery path exists; any
      // other probe failure leaves applicability unresolved.
      if (!isMissing(cause)) unresolved = true;
    }
  }
  return { applicable, unresolved };
};

/** One physical configuration path a client claims. */
interface ClientConfigClaim {
  readonly client: SetupClient;
  readonly configPath: string;
  /** The path is another product's storage this client falls back to. */
  readonly fallback: boolean;
}

/** One physical file, the client whose configuration it is, and the other
 * clients that load it as a fallback. */
interface SharedConfigPath {
  readonly owner: ClientConfigClaim;
  readonly readers: readonly ClientConfigClaim[];
}

/**
 * Resolve each physical configuration file to the clients that edit it. A
 * client's own configuration owns its registration row; a fallback view only
 * reports the owner's decision instead of racing it to "absent". Two clients
 * that each declare the same path as their own configuration keep their own
 * row, because they write different tables.
 */
const sharedConfigPaths = (
  clients: readonly SetupClient[],
): readonly SharedConfigPath[] => {
  const claimsByPath = new Map<string, ClientConfigClaim[]>();
  for (const client of clients)
    for (const claim of [
      ...uninstallConfigPaths(client).map((configPath) => ({
        client,
        configPath,
        fallback: false,
      })),
      ...(client.zcodeFallbackPath === undefined
        ? []
        : [
            {
              client,
              configPath: client.zcodeFallbackPath,
              fallback: true,
            },
          ]),
    ])
      claimsByPath.set(claim.configPath, [
        ...(claimsByPath.get(claim.configPath) ?? []),
        claim,
      ]);
  return [...claimsByPath.values()].flatMap((claims): SharedConfigPath[] => {
    const fallbacks = claims.filter((claim) => claim.fallback);
    const owners = claims.filter((claim) => !claim.fallback);
    // A fallback view can only report one client's row. OpenCode can be pointed
    // at FreeBuff's file through `OPENCODE_CONFIG`, and both then own the path
    // while writing different tables, so each keeps its own decision.
    if (owners.length > 0)
      return owners.map((owner) => {
        const format = owner.client.format;
        // ZCode's fallback reads mcpServers, never another table in the same
        // file (for example OpenCode's mcp table). Use the format owner's
        // mapping instead of reinterpreting table names here.
        const readers =
          format !== undefined &&
          format !== "unsupported" &&
          format !== "dsh" &&
          clientConfigurationServersKey(format) ===
            clientConfigurationServersKey("zcode_fallback")
            ? fallbacks
            : [];
        return { owner, readers };
      });
    const [only] = fallbacks;
    if (only === undefined)
      throw new Error("A configuration path has no claiming client.");
    return [{ owner: only, readers: [] }];
  });
};

/** Create uninstall effects contained to detected client configs and REA-owned paths. */
export const systemUninstallHost = (
  selectedHome: string | undefined = undefined,
  selectedFileSystem: UninstallFileSystem | undefined = undefined,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  platform: NodeJS.Platform = process.platform,
): UninstallHost => {
  const home =
    selectedHome ?? homeDirectoryFromEnvironment(environment, platform);
  const resources = new ArtifactResourceScope();
  // Whole-operation admission must not share a gate with its nested file reads:
  // a peer's pending cleanup otherwise waits for the operation requesting it.
  const configurationOperations = new ArtifactResourceScope();
  const fileSystem = selectedFileSystem ?? systemFileSystem(resources);
  const preflightOwnedClients = new WeakSet<UninstallClient>();
  // Set with the client list: the package view that redirects this
  // process's AppData writes, if any.
  let redirection: MsixPackageView | undefined;
  const clientWriteBlocker = (client: SetupClient): string | undefined =>
    registrationWriteBlocker(client, "uninstall") ??
    redirectedWriteBlocker(redirection, [client.configPath], "uninstall");
  const skillWriteBlocker = (path: string): string | undefined =>
    redirectedWriteBlocker(redirection, [path], "uninstall");
  return {
    clients: async () => {
      const supported = supportedClients(home, platform, environment);
      redirection = appDataRedirection(supported);
      // Shared configuration alone cannot establish product applicability.
      // Definitive absence leaves the shared paths unverified while owned
      // rows in a readable configuration can still be removed independently;
      // an unresolved probe is unknown, never absence.
      const probes = new Map<string, DiscoveryProbe>();
      for (const client of supported)
        probes.set(
          client.name,
          await discoveryApplicability(client.discoveryPaths, fileSystem),
        );
      const paths = sharedConfigPaths(supported);
      const clients: UninstallClient[] = [];
      for (const client of supported)
        for (const path of paths) {
          if (path.owner.client !== client) continue;
          // A fallback reader constrains this file only while it may load it:
          // definitive absence leaves the file to its owner. A reader that may
          // load the owner's registration makes applicability one fact per
          // physical file, so its installed proof applies and its unresolved
          // probe keeps the file fail-closed.
          const readers = path.readers.filter(({ client: reader }) => {
            const probe = probes.get(reader.name);
            return probe?.applicable === true || probe?.unresolved === true;
          });
          const probesForPath = [path.owner, ...readers].map(
            ({ client: participant }) =>
              probes.get(participant.name) ?? {
                applicable: false,
                unresolved: false,
              },
          );
          // Only definitive absence may soften failures for storage REA does
          // not own: a denied or failed probe leaves applicability unresolved,
          // and unresolved applicability must not downgrade shared-config
          // failures to retained. A denied product-local path means an unknown
          // registration state, which must stop uninstall instead of reporting
          // success.
          const applicability: Pick<UninstallClient, "applicability"> =
            probesForPath.some(({ applicable }) => applicable) ||
            probesForPath.some(({ unresolved }) => unresolved) ||
            !clientSharedRegistrationPaths(client).has(path.owner.configPath)
              ? {}
              : { applicability: "unverified" };
          clients.push({
            ...client,
            configPath: path.owner.configPath,
            ...(path.owner.fallback
              ? { format: "zcode_fallback" as const }
              : {}),
            ...applicability,
            ...(readers.length === 0
              ? {}
              : {
                  sharedWith: readers.map(({ client: reader }) => reader.name),
                }),
          });
        }
      return clients;
    },
    inspectClient: (client) =>
      configurationOperations.run(async () => {
        const ownershipEstablished =
          client.sharedRegistration === true &&
          clientOwnershipEvidencePaths(client).length > 0 &&
          (await hasOwnershipEvidence(client, fileSystem));
        const read = await readClientConfiguration(
          client,
          fileSystem,
          resources,
          ownershipEstablished,
        );
        if (read.kind === "item")
          return read.item.status === "failed" ? read.item : undefined;
        const removal = clientRegistrationRemoval(
          read.parsed,
          read.original,
          client,
        );
        if (!removal.ok)
          return item(client.name, "failed", removal.error.detail);
        // ZCode switches the entire server table to its shared fallback once
        // the last native server disappears. Inspect the table it would load,
        // not just the REA row: unrelated servers may otherwise become active.
        if (
          client.format === "zcode" &&
          removal.value.removeNative &&
          Object.keys(read.parsed.servers).length === 1 &&
          client.zcodeFallbackPath !== undefined
        ) {
          const fallbackClient: UninstallClient = {
            ...client,
            configPath: client.zcodeFallbackPath,
            configPaths: [client.zcodeFallbackPath],
            format: "zcode_fallback",
          };
          const fallback = await readClientConfiguration(
            fallbackClient,
            fileSystem,
            resources,
            true,
          );
          if (fallback.kind === "item") {
            if (fallback.item.status !== "skipped") return fallback.item;
          } else {
            const fallbackRemoval = clientRegistrationRemoval(
              fallback.parsed,
              fallback.original,
              fallbackClient,
            );
            if (!fallbackRemoval.ok)
              return item(client.name, "failed", fallbackRemoval.error.detail);
            const remaining = Object.keys(fallback.parsed.servers).filter(
              (name) =>
                name !== PRODUCT_IDENTITY.mcpServerKey ||
                !fallbackRemoval.value.removeNative,
            );
            if (remaining.length > 0)
              return item(
                client.name,
                "failed",
                "Removing REA's last native ZCode server would activate retained fallback servers; no change was made. Review the fallback configuration, then rerun uninstall.",
              );
          }
        }
        if (
          client.format === "opencode" &&
          (removal.value.removeNative || removal.value.legacyPath !== undefined)
        ) {
          const originalLayers: ClientConfigurationSource[] = [];
          const remainingLayers: ClientConfigurationSource[] = [];
          for (const configPath of client.configPaths ?? [client.configPath]) {
            const layer =
              configPath === client.configPath
                ? read
                : await readClientConfiguration(
                    { ...client, configPath },
                    fileSystem,
                    resources,
                    ownershipEstablished,
                  );
            if (layer.kind === "item") {
              if (layer.item.status !== "skipped") return layer.item;
              continue;
            }
            const layerRemoval = clientRegistrationRemoval(
              layer.parsed,
              layer.original,
              client,
            );
            if (!layerRemoval.ok)
              return item(client.name, "failed", layerRemoval.error.detail);
            originalLayers.push({ ...layer.parsed, sourcePath: configPath });
            const servers = { ...layer.parsed.servers };
            const legacyServers = { ...layer.parsed.legacyServers };
            const name = PRODUCT_IDENTITY.mcpServerKey;
            if (layerRemoval.value.removeNative) delete servers[name];
            if (layerRemoval.value.legacyPath !== undefined)
              delete legacyServers[name];
            remainingLayers.push({
              ...layer.parsed,
              servers,
              legacyServers,
              sourcePath: configPath,
            });
          }
          const selected =
            effectiveClientConfiguration(originalLayers)?.servers[
              PRODUCT_IDENTITY.mcpServerKey
            ];
          const remaining =
            effectiveClientConfiguration(remainingLayers)?.servers[
              PRODUCT_IDENTITY.mcpServerKey
            ];
          const altersEffectiveRegistration =
            clientRegistrationOwnership(selected, client) === "owned"
              ? remaining !== undefined
              : !isDeepStrictEqual(selected, remaining);
          if (altersEffectiveRegistration)
            return item(
              client.name,
              "failed",
              "Removing REA's registration would activate or change an unowned OpenCode registration in another configuration layer, including a possible V1 fallback; no change was made. Remove or replace that registration manually, then rerun uninstall.",
            );
        }
        if (
          !removal.value.removeNative &&
          removal.value.legacyPath === undefined
        )
          return undefined;
        preflightOwnedClients.add(client);
        // A removal the running package would revert, or redirect into its
        // private storage, would leave the registration in place.
        const blocker = clientWriteBlocker(client);
        return blocker === undefined
          ? undefined
          : item(client.name, "failed", blocker);
      }),
    removeClient: (client) =>
      configurationOperations.run(() =>
        removeClient(
          client,
          fileSystem,
          resources,
          () => clientWriteBlocker(client),
          preflightOwnedClients.has(client),
        ),
      ),
    inspectSkill: async () => {
      const selection = skillDestinationSelection(
        home,
        undefined,
        environment,
        platform,
      );
      if (selection.issues.length > 0)
        return item(
          "skill",
          "failed",
          selection.issues
            .map(({ path, detail }) => `${detail} (${path})`)
            .join(" "),
        );
      for (const destination of selection.destinations) {
        const inspected = await inspectManagedSkill(
          destination.path,
          destination.client,
          fileSystem,
        );
        if (inspected?.status === "failed") return inspected;
        if (inspected !== undefined) continue;
        const blocker = skillWriteBlocker(destination.path);
        if (blocker !== undefined) return item("skill", "failed", blocker);
      }
      return undefined;
    },
    removeSkill: () =>
      removeManagedSkills(
        home,
        fileSystem,
        environment,
        platform,
        skillWriteBlocker,
      ),
    purgeData: () => purgeSelectedData(home, environment, platform, fileSystem),
    close: async () => {
      try {
        await configurationOperations.close();
        await resources.close();
        return undefined;
      } catch (cause: unknown) {
        return `Uninstall resource cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      }
    },
  };
};

/**
 * Every user file that can hold REA's registration for one client. An MSIX
 * package can read either its private copy or the AppData file, and earlier
 * setups wrote the AppData file, so both lose REA's entry.
 */
const uninstallConfigPaths = (client: SetupClient): readonly string[] => [
  ...new Set([
    ...(client.configPaths ?? [client.configPath]),
    ...(client.msixPackage === undefined
      ? []
      : [
          client.msixPackage.privateConfigPath,
          client.msixPackage.appDataConfigPath,
        ]),
  ]),
];

/** Whether removal would change this configuration. */
const registrationPresent = (parsed: ClientConfigurationDocument): boolean => {
  const name = PRODUCT_IDENTITY.mcpServerKey;
  return (
    Object.hasOwn(parsed.servers, name) ||
    // Beside a native OpenCode V2 table, OpenCode also loads a V1 `mcp.rea`.
    legacyClientServerPath(parsed, name) !== undefined ||
    // Harness ownership is the stable entry id. A stale or malformed launcher
    // still belongs to that id, and so does a direct patch that projects no row.
    (parsed.dialect === "dsh" && dshDocument(parsed.document).carriesEntry)
  );
};

type ClientConfigurationRead =
  | { readonly kind: "item"; readonly item: UninstallItem }
  | {
      readonly kind: "configuration";
      readonly transactionPath: string;
      readonly original: string;
      readonly parsed: ClientConfigurationDocument;
    };

/** The configuration text, or the outcome to report for a failed read. A
 * completed physical read is retained even when its handle fails to close:
 * that exact text still drives removal, so an owned row it proves stays
 * actionable instead of softening to retained. */
const readClientConfigurationText = async (
  client: UninstallClient,
  transactionPath: string,
  io: {
    readonly fileSystem: UninstallFileSystem;
    readonly resources: ArtifactResourceScope;
    readonly configurationFailure: (detail: string) => ClientConfigurationRead;
  },
): Promise<string | ClientConfigurationRead> => {
  try {
    return await io.fileSystem.readText(transactionPath);
  } catch (cause: unknown) {
    if (isClientConfigurationCleanupFailure(cause)) {
      const cleanup = await retryClientConfigurationCleanup(
        cause,
        io.resources,
      );
      const detail =
        cleanup.primary instanceof InvalidUtf8FileError
          ? "Configuration is not valid UTF-8 and was not changed; its resources could not be released. Repair it, then rerun uninstall."
          : "Configuration could not be read or its resources could not be released. Check file permissions, then rerun uninstall.";
      // An unreleased handle is REA's own incomplete cleanup, never foreign-
      // storage uncertainty: it must stop removal outright, so later removals
      // and purge cannot outrun the failure that close() reports afterwards.
      if (cleanup.cleanup !== undefined)
        return itemRead(item(client.name, "failed", detail));
      const completed: unknown =
        cause.outcome.kind === "completed" ? cause.outcome.value : undefined;
      if (typeof completed !== "string") return io.configurationFailure(detail);
      return completed;
    }
    return isMissing(cause)
      ? itemRead(item(client.name, "skipped", "Configuration does not exist."))
      : io.configurationFailure(
          cause instanceof InvalidUtf8FileError
            ? "Configuration is not valid UTF-8 and was not changed. Repair it, then rerun uninstall."
            : "Configuration could not be read. Check file permissions, then rerun uninstall.",
        );
  }
};

const readClientConfiguration = async (
  client: UninstallClient,
  fileSystem: UninstallFileSystem,
  resources: ArtifactResourceScope,
  ownershipEstablished = false,
): Promise<ClientConfigurationRead> => {
  const applicabilityUnverified =
    client.applicability === "unverified" && !ownershipEstablished;
  const configurationFailure = (detail: string): ClientConfigurationRead =>
    itemRead(
      item(
        client.name,
        applicabilityUnverified ? "retained" : "failed",
        applicabilityUnverified
          ? `Product applicability could not be established. Shared configuration was retained without blocking other REA removals. ${detail}`
          : detail,
      ),
    );
  if (client.configPathError !== undefined)
    return configurationFailure(client.configPathError);
  if (client.format === "unsupported")
    return itemRead(
      item(
        client.name,
        "skipped",
        manualRegistrationRemediation(client.name) ??
          "This client has no documented local MCP configuration boundary.",
      ),
    );
  const resolved = await resolveUninstallConfigPath(client, fileSystem);
  if (typeof resolved !== "string")
    return resolved.status === "failed"
      ? configurationFailure(resolved.detail)
      : itemRead(resolved);
  const transactionPath = resolved;
  const original = await readClientConfigurationText(client, transactionPath, {
    fileSystem,
    resources,
    configurationFailure,
  });
  if (typeof original !== "string") return original;
  try {
    const parsed = parseClientConfiguration(original, client.format);
    return { kind: "configuration", transactionPath, original, parsed };
  } catch (cause: unknown) {
    return configurationFailure(
      cause instanceof ClientConfigurationShapeError ||
        cause instanceof ConfigurationError
        ? `Configuration was not changed: ${cause.message}. Repair it, then rerun uninstall.`
        : `Configuration is not valid ${client.format === "toml" || client.format === "grok" ? "TOML" : client.format === "opencode" ? "JSONC" : client.format === "hermes" || client.format === "dsh" ? "YAML" : "JSON"} and was not changed. Repair it, then rerun uninstall.`,
    );
  }
};

const itemRead = (result: UninstallItem): ClientConfigurationRead => ({
  kind: "item",
  item: result,
});

/**
 * Share the exact ownership and applicability decision with preflight. A
 * removable legacy entry carries its document path, so removal edits exactly
 * the entry this decision admitted.
 */
type RegistrationRemoval = {
  readonly removeNative: boolean;
  readonly legacyPath: readonly string[] | undefined;
};
type RegistrationRemovalRefusal = {
  readonly kind: "shadowed_unowned_member" | "foreign_legacy_fallback";
  readonly detail: string;
  /** The owned rows that motivated removal; refusing the edit keeps them. */
  readonly owned: RegistrationRemoval;
};

const clientRegistrationRemoval = (
  parsed: ClientConfigurationDocument,
  original: string,
  client: SetupClient,
): Result<RegistrationRemoval, RegistrationRemovalRefusal> => {
  const name = PRODUCT_IDENTITY.mcpServerKey;
  if (
    parsed.dialect === "dsh" &&
    dshDocument(parsed.document).hasUnknownStructure
  )
    return ok({ removeNative: false, legacyPath: undefined });
  const removeNative =
    (parsed.dialect === "dsh" && dshDocument(parsed.document).carriesEntry) ||
    (Object.hasOwn(parsed.servers, name) &&
      clientRegistrationOwnership(parsed.servers[name], client) === "owned");
  const legacyPath = legacyClientServerPath(parsed, name);
  const removeLegacy =
    legacyPath !== undefined &&
    clientRegistrationOwnership(parsed.legacyServers[name], client) === "owned";
  const ownership: RegistrationRemoval = {
    removeNative,
    legacyPath: removeLegacy ? legacyPath : undefined,
  };
  if (removeNative || removeLegacy) {
    const shadowed = shadowedClientServers(original, parsed, name);
    if (
      (removeNative &&
        shadowed.servers.some(
          (member) => clientRegistrationOwnership(member, client) !== "owned",
        )) ||
      (removeLegacy &&
        shadowed.legacyServers.some(
          (member) => clientRegistrationOwnership(member, client) !== "owned",
        ))
    )
      return err({
        kind: "shadowed_unowned_member",
        detail: SHADOWED_UNOWNED_MEMBER_DETAIL,
        owned: ownership,
      });
  }
  if (removeNative && legacyPath !== undefined && !removeLegacy)
    return err({
      kind: "foreign_legacy_fallback",
      detail: UNOWNED_LEGACY_FALLBACK_DETAIL,
      owned: ownership,
    });
  return ok(ownership);
};

const SHADOWED_UNOWNED_MEMBER_DETAIL = `Configuration repeats the "${PRODUCT_IDENTITY.mcpServerKey}" member, and an earlier duplicate is not REA-owned; removing the registration the client reads would activate an earlier duplicate, so no change was made. Remove the duplicate members manually, then rerun uninstall.`;

const UNOWNED_LEGACY_FALLBACK_DETAIL = `OpenCode falls back to the V1 "mcp.${PRODUCT_IDENTITY.mcpServerKey}" entry, which is not REA-owned; removing REA's native registration would activate it, so no change was made. Remove or replace that V1 entry manually, then rerun uninstall.`;

/** Preserve the bytes uninstall is about to edit and return the backup holding them. */
const backupClientConfiguration = async (
  client: SetupClient,
  transactionPath: string,
  original: string,
  options: RecoveryBackupPreservationOptions,
): Promise<string | UninstallItem> => {
  const failed = (detail: string) =>
    item(
      client.name,
      "failed",
      `Configuration could not be backed up, so no change was made. ${detail}`,
    );
  try {
    const preserved = await preserveCurrentRecoveryBackup(
      `${client.configPath}.rea.backup`,
      transactionPath,
      original,
      options,
    );
    if (preserved.ok) return preserved.value;
    if (preserved.error.kind === "occupied")
      return failed(
        `${preserved.error.detail}. Move that file aside, then rerun uninstall.`,
      );
  } catch (cause: unknown) {
    // The resource scope retains a backup handle whose close failed.
    if (!(cause instanceof RegularFileCleanupFailure)) throw cause;
  }
  return failed("Check file permissions, then rerun uninstall.");
};

const removeClient = async (
  client: UninstallClient,
  fileSystem: UninstallFileSystem,
  resources: ArtifactResourceScope,
  writeBlocker?: () => string | undefined,
  preflightOwned = false,
): Promise<UninstallItem> => {
  const read = await readClientConfiguration(
    client,
    fileSystem,
    resources,
    preflightOwned,
  );
  if (read.kind === "item") return read.item;
  const { transactionPath, original, parsed } = read;
  const name = PRODUCT_IDENTITY.mcpServerKey;
  if (
    parsed.dialect === "dsh" &&
    dshDocument(parsed.document).hasUnknownStructure
  )
    return item(
      client.name,
      "retained",
      "A Cordis expression may produce registration rows, so the patch was retained without changes.",
    );
  if (!registrationPresent(parsed))
    return item(client.name, "skipped", "REA registration is absent.");
  const removal = clientRegistrationRemoval(parsed, original, client);
  if (!removal.ok) return item(client.name, "failed", removal.error.detail);
  const { removeNative, legacyPath } = removal.value;
  const removeLegacy = legacyPath !== undefined;
  if (!removeNative && !removeLegacy)
    return item(
      client.name,
      "retained",
      "The rea-named registration is not REA-owned.",
    );
  const blocker = writeBlocker?.();
  if (blocker !== undefined) return item(client.name, "failed", blocker);
  const remaining = { ...parsed.servers };
  if (removeNative) delete remaining[name];
  const document = withClientServers(
    parsed,
    remaining,
    removeLegacy ? name : undefined,
  );
  const editedPaths = [
    ...(removeNative ? [clientServerPath(parsed, name)] : []),
    ...(legacyPath === undefined ? [] : [legacyPath]),
  ];
  let serialized: ReturnType<typeof serializeClientConfiguration>;
  try {
    serialized = serializeClientConfiguration(
      document,
      client.format,
      original,
      editedPaths,
      // clientRegistrationRemoval admitted only names whose repeats REA owns.
      { removeShadowedMembersAt: editedPaths },
    );
  } catch {
    return item(
      client.name,
      "failed",
      "Configuration could not be updated, so no change was made. Repair the configuration, then rerun uninstall.",
    );
  }
  if (!serialized.ok)
    return item(
      client.name,
      "failed",
      `Configuration repeats the member at ${JSON.stringify(serialized.error.path)}; removing the registration the client reads would activate an earlier duplicate, so no change was made. Remove the duplicate members manually, then rerun uninstall.`,
    );
  const backupPath = await backupClientConfiguration(
    client,
    transactionPath,
    original,
    {
      copy: (source, destination) => fileSystem.copy(source, destination),
      resources,
    },
  );
  if (typeof backupPath !== "string") return backupPath;
  const manualRecovery = () =>
    item(
      client.name,
      "failed",
      `Configuration could not be updated or restored. Restore the backup at ${backupPath} manually, then rerun uninstall.`,
    );
  let publication: Awaited<
    ReturnType<UninstallFileSystem["publishConfiguration"]>
  >;
  try {
    publication = await fileSystem.publishConfiguration(
      transactionPath,
      serialized.value,
      original,
    );
  } catch (cause: unknown) {
    if (isClientConfigurationCleanupFailure(cause))
      await retryClientConfigurationCleanup(cause, resources);
    return manualRecovery();
  }
  try {
    return await publication.verify(async () => {
      try {
        const text = await fileSystem.readText(publication.path);
        await publication.assertCurrent(text);
        const readback = parseClientConfiguration(text, client.format);
        if (
          (removeNative && Object.hasOwn(readback.servers, name)) ||
          (readback.dialect === "dsh" &&
            dshDocument(readback.document).carriesEntry) ||
          (removeLegacy && Object.hasOwn(readback.legacyServers, name))
        )
          throw new Error("registration readback mismatch");
        return item(
          client.name,
          "removed",
          `Removed registration from ${client.configPath}.`,
        );
      } catch (cause: unknown) {
        if (isClientConfigurationCleanupFailure(cause))
          await retryClientConfigurationCleanup(cause, resources);
        try {
          await publication.restore(original);
        } catch {
          return manualRecovery();
        }
        return item(
          client.name,
          "failed",
          `Configuration could not be updated. The original was restored and its backup at ${backupPath} was retained. Repair the configuration or restore that backup, then rerun uninstall.`,
        );
      }
    });
  } catch (cause: unknown) {
    if (isClientConfigurationCleanupFailure(cause))
      await retryClientConfigurationCleanup(cause, resources);
    return item(
      client.name,
      "failed",
      `Configuration verification or resource cleanup failed. The backup at ${backupPath} was retained. Check the configuration and rerun uninstall.`,
    );
  }
};

const resolveUninstallConfigPath = async (
  client: SetupClient,
  fileSystem: UninstallFileSystem,
): Promise<string | UninstallItem> => {
  const path = await resolveClientConfigTransactionPath(
    client.configPath,
    fileSystem.realpath === undefined
      ? { lstat: fileSystem.stat }
      : { lstat: fileSystem.stat, realpath: fileSystem.realpath },
  );
  return (
    path ??
    item(
      client.name,
      "failed",
      "Configuration path could not be safely verified. Check its permissions and, if it is a symbolic link, verify that the link resolves to a regular file owned by the current user, then rerun uninstall.",
    )
  );
};

/** Purge the same default cache namespaces selected by their producers. */
const purgeSelectedData = async (
  home: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
  fileSystem: UninstallFileSystem,
): Promise<readonly UninstallItem[]> => {
  const items: UninstallItem[] = [];
  const directories: string[] = [];
  if (platform === "darwin" || platform === "linux") {
    const defaultCache = defaultKunaCacheDirectory(home, environment, platform);
    directories.push(defaultCache);
    const custom = environment.REA_KUNA_CACHE_DIR;
    // Lexical spellings identify the default namespace for reporting.
    // Removal still uses the owned-path checks below. Other selections
    // remain separately reported without resolving symbolic links.
    if (
      custom !== undefined &&
      custom !== defaultCache &&
      !sameLexicalDirectory(custom, defaultCache, platform)
    )
      items.push(
        item(
          "kuna-custom-cache",
          "retained",
          `Caller-selected Kuna cache ${custom} was retained because purge does not establish ownership of that entire directory.`,
        ),
      );
  }
  if (platform === "linux") {
    const hopper = linuxHopperReleaseCacheDirectory(environment, home);
    if (hopper.ok) directories.push(hopper.value);
    else items.push(item("hopper-releases", "failed", hopper.error.message));
  }
  // Resolve selections before a managed namespace removal can delete cwd.
  // Keep the existing result and removal order after planning those facts.
  items.unshift(
    ...(await purgeManagedData(appendCallerPath(home, ".rea"), fileSystem, [
      "cache",
      "state",
    ])),
  );
  for (const directory of directories)
    items.push(
      ...(await purgeManagedData(dirname(directory), fileSystem, [
        basename(directory),
      ])),
    );
  return items;
};

const purgeManagedData = async (
  root: string,
  fileSystem: UninstallFileSystem,
  names: readonly string[],
): Promise<readonly UninstallItem[]> => {
  try {
    const stats = await fileSystem.stat(root);
    const linked = stats.isSymbolicLink();
    if (linked || stats.isDirectory?.() !== true)
      return names.map((name) =>
        item(
          name,
          "retained",
          `REA did not remove this item because its managed data root ${root} is ${linked ? "a symbolic link" : "not a directory"}. Verify the root before removing its data manually.`,
        ),
      );
  } catch (cause: unknown) {
    return names.map((name) =>
      isMissing(cause)
        ? item(
            name,
            "skipped",
            `${appendCallerPath(root, name)} does not exist.`,
          )
        : item(
            name,
            "failed",
            `The managed data root ${root} could not be verified. Check its permissions, then rerun uninstall.`,
          ),
    );
  }
  const items: UninstallItem[] = [];
  for (const name of names)
    items.push(
      await removeManagedPath(appendCallerPath(root, name), name, fileSystem),
    );
  return items;
};

const removeManagedPath = async (
  path: string,
  name: string,
  fileSystem: UninstallFileSystem,
): Promise<UninstallItem> => {
  try {
    const stats = await fileSystem.stat(path);
    if (stats.isSymbolicLink())
      return item(
        name,
        "retained",
        "REA did not remove this item because its managed path is a symbolic link. Verify the link target before removing it manually.",
      );
    await fileSystem.remove(path);
    return item(name, "removed", `Removed ${path}.`);
  } catch (cause: unknown) {
    return isMissing(cause)
      ? item(name, "skipped", `${path} does not exist.`)
      : item(
          name,
          "failed",
          "This item could not be removed. Check file permissions, then rerun uninstall.",
        );
  }
};

const removeManagedSkills = async (
  home: string,
  fileSystem: UninstallFileSystem,
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
  writeBlocker?: (path: string) => string | undefined,
): Promise<UninstallItem> => {
  const selection = skillDestinationSelection(
    home,
    undefined,
    environment,
    platform,
  );
  if (selection.issues.length > 0)
    return item(
      "skill",
      "failed",
      selection.issues
        .map(({ path, detail }) => `${detail} (${path})`)
        .join(" "),
    );
  // Every destination shares one summary item; preserve both client and path.
  const results = await Promise.all(
    selection.destinations.map(({ client, path }) =>
      removeManagedSkill(path, `${client} (${path})`, fileSystem, writeBlocker),
    ),
  );
  const failed = results.find(({ status }) => status === "failed");
  if (failed !== undefined)
    return item(
      "skill",
      "failed",
      results
        .map(({ name, status, detail }) => `${name}: ${status} (${detail})`)
        .join(" "),
    );
  const status = results.some(
    ({ status: resultStatus }) => resultStatus === "removed",
  )
    ? "removed"
    : results.some(({ status: resultStatus }) => resultStatus === "retained")
      ? "retained"
      : "skipped";
  return item(
    "skill",
    status,
    results
      .map(
        ({ name, status: resultStatus, detail }) =>
          `${name}: ${resultStatus} (${detail})`,
      )
      .join(" "),
  );
};

const inspectManagedSkill = async (
  path: string,
  name: string,
  fileSystem: UninstallFileSystem,
): Promise<UninstallItem | undefined> => {
  let root: ManagedPathStats;
  try {
    root = await fileSystem.stat(path);
  } catch (cause: unknown) {
    return isMissing(cause)
      ? item(name, "skipped", "Skill directory does not exist.")
      : item(name, "failed", "Skill directory could not be inspected.");
  }
  if (root.isSymbolicLink())
    return item(name, "retained", "Skill directory is a symbolic link.");
  if (root.isDirectory?.() !== true)
    return item(name, "retained", "Skill path is not a directory.");

  const manifestPath = appendCallerPath(path, "SKILL.md");
  try {
    const manifest = await fileSystem.stat(manifestPath);
    if (manifest.isSymbolicLink())
      return item(name, "retained", "Skill manifest is a symbolic link.");
    if (manifest.isFile?.() !== true)
      return item(name, "retained", "Skill manifest is not a regular file.");
  } catch (cause: unknown) {
    return isMissing(cause)
      ? item(name, "retained", "Skill ownership could not be established.")
      : item(name, "failed", "Skill manifest could not be inspected.");
  }
  let content: string;
  try {
    content = await (fileSystem.readRegularText?.(manifestPath) ??
      fileSystem.readText(manifestPath));
  } catch (cause: unknown) {
    return isMissing(cause)
      ? item(name, "retained", "Skill ownership could not be established.")
      : item(name, "failed", "Skill manifest could not be read.");
  }
  if (!isManagedSkillManifest(content))
    return item(name, "retained", "Skill manifest is not REA-owned.");

  return undefined;
};

const removeManagedSkill = async (
  path: string,
  name: string,
  fileSystem: UninstallFileSystem,
  writeBlocker?: (path: string) => string | undefined,
): Promise<UninstallItem> => {
  const inspection = await inspectManagedSkill(path, name, fileSystem);
  if (inspection !== undefined) return inspection;
  const blocker = writeBlocker?.(path);
  if (blocker !== undefined) return item(name, "failed", blocker);

  const manifestName = "SKILL.md";
  const otherFiles = MANAGED_SKILL_FILES.filter(
    (relativePath) => relativePath !== manifestName,
  );
  const results: UninstallItem[] = [];
  for (const relativePath of otherFiles)
    results.push(
      await removeManagedSkillFile(path, relativePath, name, fileSystem),
    );
  if (
    results.some(({ status }) => status === "failed" || status === "retained")
  )
    results.push(
      item(
        name,
        "retained",
        "REA ownership manifest was retained because a managed file could not be safely removed.",
      ),
    );
  else {
    const manifest = await removeManagedSkillFile(
      path,
      manifestName,
      name,
      fileSystem,
    );
    results.push(manifest);
    const directories =
      manifest.status === "removed"
        ? await removeEmptyManagedDirectories(path, name, fileSystem)
        : undefined;
    if (directories !== undefined) results.push(directories);
  }
  const failed = results.find(({ status }) => status === "failed");
  if (failed !== undefined)
    return item(name, "failed", results.map(({ detail }) => detail).join(" "));
  if (results.some(({ status }) => status === "retained"))
    return item(
      name,
      "retained",
      [...new Set(results.map(({ detail }) => detail))].join(" "),
    );
  const removed = results.some(({ status }) => status === "removed");
  return item(
    name,
    removed ? "removed" : "skipped",
    "REA-managed skill files were removed; other files were preserved.",
  );
};

/** Directories setup creates for managed files, deepest first, then the root. */
const MANAGED_SKILL_DIRECTORIES = [
  ...new Set(
    MANAGED_SKILL_FILES.map((relativePath) =>
      relativePath.split("/").slice(0, -1).join("/"),
    ).filter((directory) => directory.length > 0),
  ),
].sort((left, right) => right.split("/").length - left.split("/").length);

/** Remove managed directories left empty; any remaining user file keeps them. */
const removeEmptyManagedDirectories = async (
  root: string,
  name: string,
  fileSystem: UninstallFileSystem,
): Promise<UninstallItem | undefined> => {
  if (fileSystem.removeEmptyDirectory === undefined) return undefined;
  for (const directory of [
    ...MANAGED_SKILL_DIRECTORIES.map((relative) =>
      appendCallerPath(root, relative),
    ),
    root,
  ]) {
    try {
      await fileSystem.removeEmptyDirectory(directory);
    } catch (cause: unknown) {
      // User files, an absent directory, or a non-directory keep it as is.
      if (!isKeptDirectory(cause))
        return item(
          name,
          "failed",
          `Managed skill directory could not be removed: ${directory}.`,
        );
    }
  }
  return undefined;
};

const isKeptDirectory = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  ["ENOTEMPTY", "EEXIST", "ENOENT", "ENOTDIR"].includes(String(cause.code));

const removeManagedSkillFile = async (
  root: string,
  relativePath: string,
  name: string,
  fileSystem: UninstallFileSystem,
): Promise<UninstallItem> => {
  const segments = relativePath.split(/[\\/]/u);
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = appendCallerPath(parent, segment);
    try {
      const stats = await fileSystem.stat(parent);
      if (stats.isSymbolicLink() || stats.isDirectory?.() !== true)
        return item(
          name,
          "retained",
          `Managed path parent was retained: ${parent}.`,
        );
    } catch (cause: unknown) {
      return isMissing(cause)
        ? item(
            name,
            "skipped",
            `${appendCallerPath(parent, segments.at(-1) ?? "")} does not exist.`,
          )
        : item(
            name,
            "failed",
            `Managed path parent could not be inspected: ${parent}.`,
          );
    }
  }

  const target = appendCallerPath(root, relativePath);
  let stats: ManagedPathStats;
  try {
    stats = await fileSystem.stat(target);
  } catch (cause: unknown) {
    return isMissing(cause)
      ? item(name, "skipped", `${target} does not exist.`)
      : item(name, "failed", `Managed file could not be inspected: ${target}.`);
  }
  if (stats.isSymbolicLink())
    return item(
      name,
      "retained",
      `Managed file is a symbolic link: ${target}.`,
    );
  if (stats.isFile?.() !== true)
    return item(
      name,
      "retained",
      `Managed path is not a regular file: ${target}.`,
    );
  try {
    await fileSystem.remove(target, false);
    return item(name, "removed", `Removed ${target}.`);
  } catch (cause: unknown) {
    return isMissing(cause)
      ? item(name, "skipped", `${target} does not exist.`)
      : item(name, "failed", `Managed file could not be removed: ${target}.`);
  }
};

const item = (
  name: string,
  status: UninstallItem["status"],
  detail: string,
): UninstallItem => ({ name, status, detail });

/**
 * Layered clients are removed file by file, but callers look up one status by
 * client name. Aggregate status does not invalidate any constituent outcome.
 */
const collapseUninstallItems = (
  items: readonly UninstallItem[],
): UninstallItem[] => {
  const grouped = new Map<string, UninstallAction[]>();
  for (const next of items) {
    const { name, actions, ...action } = next;
    const group = grouped.get(name) ?? [];
    group.push(
      ...(actions !== undefined && actions.length > 0 ? actions : [action]),
    );
    grouped.set(name, group);
  }
  return [...grouped].map(([name, actions]) => {
    const first = actions[0];
    if (first === undefined)
      throw new Error("Uninstall outcome group has no actions.");
    if (actions.length === 1) return { name, ...first };
    const status = actions.reduce(
      (selected, action) =>
        uninstallStatusPriority(action.status) >
        uninstallStatusPriority(selected)
          ? action.status
          : selected,
      first.status,
    );
    return {
      name,
      status,
      detail: [...new Set(actions.map(({ detail }) => detail))].join(" "),
      actions,
    };
  });
};

const uninstallStatusPriority = (status: UninstallItem["status"]): number => {
  switch (status) {
    case "failed":
      return 3;
    case "removed":
      return 2;
    case "retained":
      return 1;
    case "skipped":
      return 0;
    default: {
      const exhaustive: never = status;
      throw new TypeError(
        `Unhandled uninstall item status: ${String(exhaustive)}`,
      );
    }
  }
};
const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";
