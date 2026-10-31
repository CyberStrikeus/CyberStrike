import { readClientPolicyBlock } from "./GeminiClientSettings.js";
import {
  readClientConfigurationFiles,
  clientConfigurationForWrite,
  clientWriteDialect,
  effectiveClientConfiguration,
  readConfigurationText,
  type ClientConfigurationSource,
  type ClientConfigurationFileError,
} from "./ClientConfigurationFiles.js";
import { err, ok, type Result } from "../domain/result.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import {
  clientConfigurationValuesEqual,
  effectiveClientServer,
  clientServerListedDisabled,
  clientServerPath,
  legacyClientServerPath,
  shadowedClientServers,
  OMP_DISABLED_SERVERS_KEY,
  parseClientConfiguration,
  parseZcodeFallbackConfiguration,
  serializeClientConfiguration,
  withClientServers,
  type ClientConfigurationDocument,
} from "./ClientConfigurationDocument.js";
import { dshDocument, DshCordisDocument } from "./DshCordisPatch.js";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { RegularFileChangedError } from "../filesystem/RegularFile.js";
import { withClientConfigurationTransaction } from "./ClientConfigurationTransaction.js";
import { isClientConfigurationCleanupFailure } from "./ClientConfigurationCleanup.js";
import {
  ClientConfigurationPublication,
  ClientConfigurationWriteError,
} from "./ClientConfigurationPublication.js";
import {
  clientRegistrationEnvironment,
  clientRegistrationEnvironmentDetailsWithBudget,
  type ProviderRequestBudgetResolver,
} from "./ClientRegistrationEnvironment.js";

import {
  clientRegistrationOwnership,
  clientRegistrationOwnershipRemediation,
  refreshClientRegistration,
} from "./ClientRegistration.js";

import { PRODUCT_IDENTITY } from "../identity.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { currentClientRegistrationCommand } from "./ClientRegistrationIdentity.js";
import { resolveClientConfigTransactionPath } from "./ClientConfigPath.js";
import { packageReadTargetChanged } from "./MsixPackageStorage.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import {
  readRegularFileText,
  readRegularFileTextSnapshot,
  InvalidUtf8FileError,
} from "./RegularFileRead.js";
import {
  preserveCurrentRecoveryBackup,
  selectCurrentRecoveryBackup,
} from "./SetupRecoveryBackup.js";
import type {
  ClientConfigurationInspection,
  ClientConfigurationResult,
  SetupProviderEnvironment,
} from "./SetupTypes.js";
import {
  registrationWriteBlocker,
  type SetupClient,
} from "./SupportedClients.js";

export class ClientConfigurationCleanupRollbackFailure extends RegularFileCleanupFailure<string> {
  constructor(
    failure: RegularFileCleanupFailure<string>,
    readonly configurationFailure: Extract<
      ClientConfigurationResult,
      { readonly status: "failed" }
    >,
  ) {
    super({
      ...failure,
      cleanupCause: new AggregateError(
        [failure.cleanupCause, configurationFailure],
        `Configuration readback cleanup and rollback failed: ${failure.path}`,
      ),
    });
  }
}

/** Configure one supported client's native stdio MCP registration shape. */
export const configureClientConfiguration = async (
  client: SetupClient,
  environment: SetupProviderEnvironment = {},
  command: readonly string[] = currentClientRegistrationCommand(),
  resolveProviderRequestBudget?: ProviderRequestBudgetResolver,
): Promise<ClientConfigurationResult> => {
  if (command.length === 0)
    return {
      status: "failed",
      reason: "registration_ownership",
      detail:
        "The running REA entrypoint could not be identified; run setup from an installed REA command.",
    };
  if (client.configPathError !== undefined)
    return { status: "failed", reason: "path" };
  const transactionPath = await resolveClientConfigTransactionPath(
    client.configPath,
  );
  if (transactionPath === undefined)
    return { status: "failed", reason: "path" };
  try {
    return await withClientConfigurationTransaction(transactionPath, () =>
      configureClientDocument(
        { client, transactionPath },
        environment,
        command,
        resolveProviderRequestBudget,
      ),
    );
  } catch (cause: unknown) {
    if (cause instanceof ConfigurationError)
      return { status: "failed", reason: "readback" };
    throw cause;
  }
};

const configureClientDocument = async (
  {
    client,
    transactionPath,
  }: { readonly client: SetupClient; readonly transactionPath: string },
  environment: SetupProviderEnvironment,
  command: readonly string[],
  resolveProviderRequestBudget?: ProviderRequestBudgetResolver,
): Promise<ClientConfigurationResult> => {
  const format = client.format;
  if (format === undefined || format === "unsupported")
    return { status: "failed", reason: "readback" };
  const files = await readClientConfigurationFiles(
    client,
    undefined,
    undefined,
    environment,
  );
  if (!files.ok) {
    throwCleanupFailure(files.error);
    return { status: "failed", reason: "readback" };
  }
  const existing = files.value.find(
    ({ sourcePath }) => sourcePath === client.configPath,
  );
  const editabilityError =
    existing?.dialect === "dsh"
      ? dshDocument(existing.document).editabilityError
      : undefined;
  if (editabilityError !== undefined)
    return { status: "failed", reason: "readback" };
  // Policy admission belongs to the transaction snapshot below, not the
  // earlier layered discovery document.
  let snapshot:
    | Awaited<ReturnType<typeof readRegularFileTextSnapshot>>
    | undefined;
  try {
    snapshot = await readRegularFileTextSnapshot(transactionPath, {
      symlinks: "reject",
    });
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure) throw cause;
    if (!isMissing(cause)) return { status: "failed", reason: "readback" };
  }
  const original = snapshot?.text;
  let parsed: ClientConfigurationDocument;
  try {
    parsed = parseClientConfiguration(
      original ??
        (format === "toml" || format === "grok" || format === "dsh"
          ? ""
          : "{}"),
      format,
    );
    parsed = clientConfigurationForWrite(parsed, files.value);
    const ownershipBlocker = registrationOwnershipBlocker(
      client,
      parsed,
      original ?? "",
      files.value,
    );
    if (ownershipBlocker !== undefined)
      return {
        status: "failed",
        reason: "registration_ownership",
        detail: ownershipBlocker,
      };
    const policy = await readClientPolicyBlock(
      client,
      parsed,
      await clientConfigurationDesired(
        client,
        environment,
        command,
        parsed,
        files.value,
        resolveProviderRequestBudget,
      ),
    );
    if (!policy.ok) {
      throwCleanupFailure(policy.error);
      return { status: "failed", reason: "readback" };
    }
    if (policy.value !== undefined)
      return { status: "failed", reason: "readback" };
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure) throw cause;
    // Malformed existing configuration fails the readback gate.
    void cause;
    return { status: "failed", reason: "readback" };
  }
  const fallback = await readZcodeFallbackServers(client, parsed);
  if (!fallback.ok) {
    if (fallback.error.kind !== "registration_ownership")
      throwCleanupFailure(fallback.error);
    return fallback.error.kind === "registration_ownership"
      ? {
          status: "failed",
          reason: "registration_ownership",
          detail: fallback.error.detail,
        }
      : { status: "failed", reason: "readback" };
  }
  const desired = await clientConfigurationDesired(
    client,
    environment,
    command,
    {
      ...parsed,
      servers: { ...fallback.value, ...parsed.servers },
    },
    files.value,
    resolveProviderRequestBudget,
  );
  if (registrationCurrent(parsed, desired)) return { status: "unchanged" };
  return persistClientConfiguration({
    client,
    transactionPath,
    snapshot,
    format,
    original,
    parsed,
    desired,
    fallbackServers: fallback.value,
  });
};

interface ClientConfigurationUpdate {
  readonly client: SetupClient;
  readonly transactionPath: string;
  readonly snapshot:
    | Awaited<ReturnType<typeof readRegularFileTextSnapshot>>
    | undefined;
  readonly format: NonNullable<SetupClient["format"]>;
  readonly original: string | undefined;
  readonly parsed: ClientConfigurationDocument;
  readonly desired: unknown;
  readonly fallbackServers: Readonly<Record<string, unknown>>;
}

const persistClientConfiguration = async ({
  client,
  transactionPath,
  snapshot,
  format,
  original,
  parsed,
  desired,
  fallbackServers,
}: ClientConfigurationUpdate): Promise<ClientConfigurationResult> => {
  // The plan chose this file; an MSIX package may have switched to its
  // private copy since, for example when it quit.
  if (client.msixPackage !== undefined) {
    const target = await packageReadTargetChanged(
      client.msixPackage,
      client.configPath,
    );
    if (!target.ok)
      return {
        status: "failed",
        reason: "target_unavailable",
        failure: {
          kind: "inspect",
          path: target.error.path,
          detail: target.error.detail,
        },
      };
    if (target.value) return { status: "failed", reason: "target_changed" };
  }
  // A native OpenCode V2 entry replaces REA's legacy V1 entry, which would
  // otherwise conflict with it.
  const legacyPath = legacyClientServerPath(
    parsed,
    PRODUCT_IDENTITY.mcpServerKey,
  );
  const registered = withClientServers(
    parsed,
    {
      ...fallbackServers,
      ...parsed.servers,
      [PRODUCT_IDENTITY.mcpServerKey]: desired,
    },
    PRODUCT_IDENTITY.mcpServerKey,
  );
  // OMP's denylist would hide the registration; keep every other listed name.
  const ompDisabled =
    parsed.dialect === "omp"
      ? parsed.document[OMP_DISABLED_SERVERS_KEY]
      : undefined;
  const enableOmp =
    Array.isArray(ompDisabled) &&
    ompDisabled.includes(PRODUCT_IDENTITY.mcpServerKey);
  const document =
    enableOmp && Array.isArray(ompDisabled)
      ? {
          ...registered,
          [OMP_DISABLED_SERVERS_KEY]: ompDisabled.filter(
            (name: unknown) => name !== PRODUCT_IDENTITY.mcpServerKey,
          ),
        }
      : registered;
  let serialized: ReturnType<typeof serializeClientConfiguration>;
  try {
    serialized = serializeClientConfiguration(
      document,
      format,
      original,
      [
        ...Object.keys(fallbackServers)
          .filter((name) => name !== PRODUCT_IDENTITY.mcpServerKey)
          .map((name) => clientServerPath(parsed, name)),
        clientServerPath(parsed, PRODUCT_IDENTITY.mcpServerKey),
        ...(legacyPath === undefined ? [] : [legacyPath]),
        ...(enableOmp ? [[OMP_DISABLED_SERVERS_KEY]] : []),
      ],
      // Ownership admission above covers every legacy member removed here.
      { removeShadowedMembersAt: legacyPath === undefined ? [] : [legacyPath] },
    );
  } catch (cause: unknown) {
    // An unserializable edit is reported before any file is written.
    return {
      status: "failed",
      reason: "write",
      failure: new ClientConfigurationWriteError(
        client.configPath,
        "serialize",
        cause,
      ).problem,
    };
  }
  if (!serialized.ok)
    return {
      status: "failed",
      reason: "shadowed_member",
      path: serialized.error.path,
    };
  let recoveryBackupPath: string | undefined;
  if (original !== undefined) {
    const preserved = await preserveCurrentRecoveryBackup(
      `${client.configPath}.rea.backup`,
      transactionPath,
      original,
    );
    if (!preserved.ok) return { status: "failed", reason: "backup" };
    recoveryBackupPath = preserved.value;
  }
  let publication: ClientConfigurationPublication;
  try {
    await mkdir(dirname(client.configPath), { recursive: true });
    publication = await ClientConfigurationPublication.write(
      transactionPath,
      serialized.value,
      original,
      { requestedPath: client.configPath, state: snapshot?.state },
    );
  } catch (cause: unknown) {
    if (isClientConfigurationCleanupFailure(cause)) throw cause;
    if (isConfigurationConflict(cause))
      return conflictFailure(recoveryBackupPath);
    return {
      status: "failed",
      reason: "write",
      failure: (cause instanceof ClientConfigurationWriteError
        ? cause
        : new ClientConfigurationWriteError(client.configPath, "publish", cause)
      ).problem,
      ...(recoveryBackupPath === undefined
        ? {}
        : { backupPath: recoveryBackupPath }),
    };
  }
  return publication.verify(async () => {
    try {
      const text = await readRegularFileText(publication.path);
      await publication.assertCurrent(text);
      const readback = parseClientConfiguration(text, format);
      if (
        !registrationCurrent(readback, desired) ||
        Object.entries(fallbackServers).some(
          ([name, entry]) =>
            name !== PRODUCT_IDENTITY.mcpServerKey &&
            !clientConfigurationValuesEqual(readback.servers[name], entry),
        )
      ) {
        return await rollbackOrReadbackFailure(
          publication,
          original,
          recoveryBackupPath,
        );
      }
    } catch (cause: unknown) {
      if (isConfigurationConflict(cause) || isMissing(cause))
        return conflictFailure(recoveryBackupPath);
      if (cause instanceof RegularFileCleanupFailure) {
        const rollback = await restoreConfig(publication, original);
        if (!rollback.ok)
          throw new ClientConfigurationCleanupRollbackFailure(
            cause,
            rollbackFailure(rollback.error, recoveryBackupPath),
          );
        throw cause;
      }
      // Readback failure restores the transaction before reporting.
      void cause;
      return rollbackOrReadbackFailure(
        publication,
        original,
        recoveryBackupPath,
      );
    }
    return {
      status: "configured",
      ...(recoveryBackupPath === undefined
        ? {}
        : { backupPath: recoveryBackupPath }),
    };
  });
};

/** Determine whether an existing client configuration matches the desired registration. */
export const clientConfigurationAligned = async (
  client: SetupClient,
  providerEnvironment: SetupProviderEnvironment,
  command: readonly string[],
  resolveProviderRequestBudget?: ProviderRequestBudgetResolver,
): Promise<boolean> => {
  if (client.configPathError !== undefined) return false;
  try {
    const files = await readClientConfigurationFiles(
      client,
      undefined,
      undefined,
      providerEnvironment,
    );
    if (!files.ok) {
      throwCleanupFailure(files.error);
      return false;
    }
    const original = await readRegularFileText(client.configPath);
    const parsed = clientConfigurationForWrite(
      parseClientConfiguration(original, client.format),
      files.value,
    );
    const desired = await clientConfigurationDesired(
      client,
      providerEnvironment,
      command,
      parsed,
      files.value,
      resolveProviderRequestBudget,
    );
    const policy = await readClientPolicyBlock(client, parsed, desired);
    if (!policy.ok) {
      throwCleanupFailure(policy.error);
      return false;
    }
    return policy.value === undefined && registrationCurrent(parsed, desired);
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure) throw cause;
    // Unreadable configuration is treated as not aligned so setup repairs it.
    void cause;
    return false;
  }
};

/** Preflight one client configuration before setup presents any mutations. */
export const inspectClientConfiguration = async (
  client: SetupClient,
  providerEnvironment: SetupProviderEnvironment,
  command: readonly string[],
  resolveProviderRequestBudget?: ProviderRequestBudgetResolver,
): Promise<ClientConfigurationInspection> => {
  let inspection: ClientConfigurationInspection;
  try {
    inspection = await inspectClientDocument(
      client,
      providerEnvironment,
      command,
      resolveProviderRequestBudget,
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ConfigurationError)) throw cause;
    return {
      status: "invalid",
      remediation: `${cause.message}: ${cause.settings.map(({ setting, constraint }) => `${setting}: ${constraint}`).join("; ")}`,
    };
  }
  if (inspection.status !== "create" && inspection.status !== "update")
    return inspection;
  // A change the running client would overwrite is not a persisted registration.
  const blocker = registrationWriteBlocker(client, "setup");
  return blocker === undefined
    ? inspection
    : { status: "invalid", remediation: blocker };
};

const inspectClientDocument = async (
  client: SetupClient,
  providerEnvironment: SetupProviderEnvironment,
  command: readonly string[],
  resolveProviderRequestBudget?: ProviderRequestBudgetResolver,
): Promise<ClientConfigurationInspection> => {
  if (client.configPathError !== undefined)
    return { status: "invalid", remediation: client.configPathError };
  if (client.format === "unsupported") return { status: "already_current" };
  const files = await readClientConfigurationFiles(
    client,
    undefined,
    undefined,
    providerEnvironment,
  );
  if (!files.ok) {
    throwCleanupFailure(files.error);
    return {
      status: "invalid",
      remediation: files.error.detail,
    };
  }
  const existing = files.value.find(
    ({ sourcePath }) => sourcePath === client.configPath,
  );
  const editabilityError =
    existing?.dialect === "dsh"
      ? dshDocument(existing.document).editabilityError
      : undefined;
  if (editabilityError !== undefined)
    return {
      status: "invalid",
      remediation: editabilityError.message,
    };
  const transactionPath = await resolveClientConfigTransactionPath(
    client.configPath,
  );
  if (transactionPath === undefined)
    return {
      status: "invalid",
      remediation:
        "The configuration path is unsafe or unresolved. Check ownership and symbolic links before rerunning setup.",
    };
  let original: string;
  try {
    original = await readRegularFileText(transactionPath);
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure) throw cause;
    if (isMissing(cause)) {
      const inherited = effectiveClientConfiguration(files.value, {
        client,
        document: undefined,
      });
      const ownershipBlocker =
        inherited === undefined
          ? undefined
          : registrationOwnershipBlocker(client, inherited, "", files.value);
      if (ownershipBlocker !== undefined)
        return { status: "invalid", remediation: ownershipBlocker };
      // This read establishes absence; do not reuse an earlier user-file policy.
      const policy = await readClientPolicyBlock(
        client,
        undefined,
        await clientConfigurationDesired(
          client,
          providerEnvironment,
          command,
          undefined,
          files.value,
          resolveProviderRequestBudget,
        ),
      );
      if (!policy.ok) {
        throwCleanupFailure(policy.error);
        return {
          status: "invalid",
          remediation: policy.error.detail,
        };
      }
      if (policy.value !== undefined)
        return { status: "invalid", remediation: policy.value };
      const fallback = await readZcodeFallbackServers(client);
      if (!fallback.ok) {
        if (fallback.error.kind !== "registration_ownership")
          throwCleanupFailure(fallback.error);
        return { status: "invalid", remediation: fallback.error.detail };
      }
      return { status: "create" };
    }
    return {
      status: "invalid",
      remediation: `The configuration file could not be read. Check its permissions before rerunning setup. ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  try {
    const parsed = clientConfigurationForWrite(
      parseClientConfiguration(original, client.format),
      files.value,
    );
    const ownershipBlocker = registrationOwnershipBlocker(
      client,
      parsed,
      original,
      files.value,
    );
    if (ownershipBlocker !== undefined)
      return { status: "invalid", remediation: ownershipBlocker };
    const desired = await clientConfigurationDesired(
      client,
      providerEnvironment,
      command,
      parsed,
      files.value,
      resolveProviderRequestBudget,
    );
    const policy = await readClientPolicyBlock(client, parsed, desired);
    if (!policy.ok) {
      throwCleanupFailure(policy.error);
      return {
        status: "invalid",
        remediation: policy.error.detail,
      };
    }
    if (policy.value !== undefined)
      return { status: "invalid", remediation: policy.value };
    if (registrationCurrent(parsed, desired))
      return { status: "already_current" };
    const fallback = await readZcodeFallbackServers(client, parsed);
    if (!fallback.ok) {
      if (fallback.error.kind !== "registration_ownership")
        throwCleanupFailure(fallback.error);
      return { status: "invalid", remediation: fallback.error.detail };
    }
  } catch (cause: unknown) {
    if (
      cause instanceof RegularFileCleanupFailure ||
      cause instanceof ConfigurationError
    )
      throw cause;
    // Malformed configuration is reported with the invalid remediation.
    void cause;
    return {
      status: "invalid",
      remediation:
        "The existing configuration is malformed. Repair it before setup applies any other changes.",
    };
  }
  const backupSelection = await selectCurrentRecoveryBackup(
    `${client.configPath}.rea.backup`,
    original,
  );
  if (!backupSelection.ok)
    return {
      status: "invalid",
      remediation: backupSelection.error.detail,
    };
  return {
    status: "update",
    backupPath: backupSelection.value.backupPath,
  };
};

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const throwCleanupFailure = (error: ClientConfigurationFileError): void => {
  if (error.cleanupFailure !== undefined) throw error.cleanupFailure;
};

/** Admit only absent or proven-owned rows that this setup would replace. */
const registrationOwnershipBlocker = (
  client: SetupClient,
  parsed: ClientConfigurationDocument,
  original: string,
  sources: readonly ClientConfigurationSource[] = [],
): string | undefined => {
  // Cordis owns registrations by stable entry ID, including malformed launchers.
  if (parsed.dialect === "dsh") return undefined;
  const name = PRODUCT_IDENTITY.mcpServerKey;
  const entries: { value: unknown; paths: readonly string[] }[] = [];
  const effective = effectiveClientConfiguration(sources, {
    client,
    document: parsed,
  });
  if (effective !== undefined && Object.hasOwn(effective.servers, name))
    entries.push({
      value: effective.servers[name],
      paths: client.configPaths ?? [client.configPath],
    });
  const fragment = parsed.servers[name];
  // A layered policy fragment inherits its launcher. Classify the effective
  // launcher above, but also admit any explicit command this write replaces.
  const inheritsLauncher =
    effective !== undefined &&
    effective !== parsed &&
    typeof fragment === "object" &&
    fragment !== null &&
    !Array.isArray(fragment) &&
    !Object.hasOwn(fragment, "command");
  if (Object.hasOwn(parsed.servers, name) && !inheritsLauncher)
    entries.push({ value: parsed.servers[name], paths: [client.configPath] });
  if (legacyClientServerPath(parsed, name) !== undefined) {
    entries.push({
      value: parsed.legacyServers[name],
      paths: [client.configPath],
    });
    entries.push(
      ...shadowedClientServers(original, parsed, name).legacyServers.map(
        (value) => ({ value, paths: [client.configPath] }),
      ),
    );
  }
  for (const entry of entries) {
    const ownership = clientRegistrationOwnership(entry.value, client);
    if (ownership !== "owned")
      return clientRegistrationOwnershipRemediation(ownership, entry.paths);
  }
  return undefined;
};

/** Admit the fallback only when the first native ZCode server would suppress it. */
const readZcodeFallbackServers = async (
  client: SetupClient,
  parsed?: ClientConfigurationDocument,
): Promise<
  Result<
    Readonly<Record<string, unknown>>,
    | ClientConfigurationFileError
    | {
        readonly kind: "registration_ownership";
        readonly path: string;
        readonly detail: string;
      }
  >
> => {
  if (
    client.format !== "zcode" ||
    (parsed !== undefined && Object.keys(parsed.servers).length > 0)
  )
    return ok({});
  const path = client.zcodeFallbackPath;
  const detail = `The ZCode fallback configuration ${path ?? "path"} is unresolved, malformed or unreadable. Repair it before rerunning setup: the first native server would suppress that fallback.`;
  if (path === undefined)
    return err({ kind: "unreadable", path: client.configPath, detail });
  const transactionPath = await resolveClientConfigTransactionPath(path);
  if (transactionPath === undefined)
    return err({ kind: "unreadable", path, detail });
  const source = await readConfigurationText(transactionPath);
  if (!source.ok)
    return err({ ...source.error, detail: `${detail} ${source.error.detail}` });
  if (source.value === undefined) return ok({});
  try {
    const parsed = parseZcodeFallbackConfiguration(source.value);
    const ownershipBlocker = registrationOwnershipBlocker(
      { ...client, configPath: path, format: "zcode_fallback" },
      parsed,
      source.value,
    );
    if (ownershipBlocker !== undefined)
      return err({
        kind: "registration_ownership",
        path,
        detail: ownershipBlocker,
      });
    const environment = clientRegistrationEnvironment(parsed);
    if (!environment.ok)
      return err({
        kind: "malformed",
        path,
        detail: `${detail} ${environment.error.settings.map(({ setting, constraint }) => `${setting}: ${constraint}`).join("; ")}`,
      });
    return ok(parsed.servers);
  } catch (cause: unknown) {
    return err({
      kind: "malformed",
      path,
      detail: `${detail} ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
};

type ConfigurationRestoreFailure =
  | { readonly kind: "conflict" }
  | {
      readonly kind: "restore";
      readonly path: string;
      readonly detail: string;
    };

const restoreConfig = async (
  publication: ClientConfigurationPublication,
  original: string | undefined,
): Promise<Result<void, ConfigurationRestoreFailure>> => {
  try {
    await publication.restore(original);
    return ok(undefined);
  } catch (cause: unknown) {
    if (isConfigurationConflict(cause) || isMissing(cause))
      return err({ kind: "conflict" });
    return err({
      kind: "restore",
      path: publication.path,
      detail: errorDetail(cause),
    });
  }
};

const rollbackOrReadbackFailure = async (
  publication: ClientConfigurationPublication,
  original: string | undefined,
  backupPath: string | undefined,
): Promise<ClientConfigurationResult> => {
  const rollback = await restoreConfig(publication, original);
  return rollback.ok
    ? {
        status: "failed",
        reason: "readback",
        ...(backupPath === undefined ? {} : { backupPath }),
      }
    : rollbackFailure(rollback.error, backupPath);
};

const rollbackFailure = (
  failure: ConfigurationRestoreFailure,
  backupPath?: string,
): Extract<ClientConfigurationResult, { readonly status: "failed" }> =>
  failure.kind === "conflict"
    ? conflictFailure(backupPath)
    : {
        status: "failed",
        reason: "rollback",
        failure,
        ...(backupPath === undefined ? {} : { backupPath }),
      };

const isConfigurationConflict = (cause: unknown): boolean =>
  cause instanceof RegularFileChangedError ||
  cause instanceof InvalidUtf8FileError;

const conflictFailure = (
  backupPath?: string,
): Extract<ClientConfigurationResult, { readonly status: "failed" }> => ({
  status: "failed",
  reason: "conflict",
  ...(backupPath === undefined ? {} : { backupPath }),
});

const errorDetail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Whether REA's entry matches, no legacy entry remains, and no client disable list suppresses it. */
const registrationCurrent = (
  parsed: ClientConfigurationDocument,
  desired: unknown,
): boolean =>
  (parsed.dialect !== "dsh" || dshDocument(parsed.document).ready) &&
  clientConfigurationValuesEqual(
    parsed.servers[PRODUCT_IDENTITY.mcpServerKey],
    desired,
  ) &&
  !Object.hasOwn(parsed.legacyServers, PRODUCT_IDENTITY.mcpServerKey) &&
  !clientServerListedDisabled(parsed, PRODUCT_IDENTITY.mcpServerKey);

const clientConfigurationDesired = async (
  client: SetupClient,
  providerEnvironment: SetupProviderEnvironment,
  command: readonly string[],
  parsed: ClientConfigurationDocument | undefined,
  sources: readonly ClientConfigurationSource[],
  resolveProviderRequestBudget?: ProviderRequestBudgetResolver,
): Promise<unknown> => {
  const effective = effectiveClientConfiguration(sources, {
    client,
    document: parsed,
  });
  const format = clientWriteDialect(
    parsed?.dialect ?? client.format ?? "json",
    sources,
  );
  const launcher =
    command.length === 0 ? [PRODUCT_IDENTITY.cliBinary, "mcp"] : command;
  if (format === "dsh") {
    const validated = clientRegistrationEnvironment(
      effective,
      providerEnvironment,
    );
    if (!validated.ok) throw validated.error;
    const desired = (
      parsed === undefined
        ? new DshCordisDocument("")
        : dshDocument(parsed.document)
    ).desired(launcher, providerEnvironment);
    if (!desired.ok) throw desired.error;
    return desired.value;
  }
  const validated = await clientRegistrationEnvironmentDetailsWithBudget(
    effective,
    providerEnvironment,
    "effective",
    client.name === "codex" || client.name === "kimi"
      ? resolveProviderRequestBudget
      : undefined,
  );
  if (!validated.ok) throw validated.error;
  // Preserve explicitly configured server settings, never the ambient process
  // environment. The effective layered view validates precedence and supplies
  // timeout facts; the target file's fragment remains the value being written.
  const environment = clientRegistrationEnvironment(
    parsed,
    providerEnvironment,
    "fragment",
  );
  if (!environment.ok) throw environment.error;
  const registrationEnvironment =
    client.name === "kimi" &&
    snapshotEnvironment(environment.value).REA_MCP_INPUT_SCHEMA_PROFILE ===
      undefined
      ? {
          ...environment.value,
          REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
        }
      : environment.value;
  const registration = refreshClientRegistration(
    client,
    format,
    launcher,
    registrationEnvironment,
    parsed === undefined
      ? undefined
      : effectiveClientServer(parsed, PRODUCT_IDENTITY.mcpServerKey),
    validated.value.timeoutInputs,
  );
  if (!registration.ok) throw registration.error;
  return registration.value;
};
