import type {
  ClientConfigurationResult,
  SetupHost,
  SetupProviderEnvironment,
  SetupProgressEvent,
} from "./SetupTypes.js";
import type { SetupClient } from "./SupportedClients.js";

export const failedConfigurationMessage = (
  result: Extract<ClientConfigurationResult, { readonly status: "failed" }>,
): string => {
  switch (result.reason) {
    case "registration_ownership":
      return result.detail;
    case "conflict":
      return "Agent configuration changed during setup. Review the current file and rerun setup.";
    case "target_changed":
      return "The client began reading a different configuration file after the plan was shown, so no change was made. Rerun setup to review the new target.";
    case "target_unavailable":
      return `The client configuration read target could not be established because ${result.failure.path} could not be inspected: ${result.failure.detail}. Repair access to that path, then rerun setup.`;
    case "path":
      return "Agent configuration path could not be safely verified. Check its permissions and, if it is a symbolic link, verify that the link resolves to a regular file owned by the current user, then rerun setup.";
    case "backup":
      return "Agent configuration could not be backed up, so no change was made. Check file permissions, then rerun setup.";
    case "write": {
      if (result.failure === undefined)
        return "Agent configuration could not be updated. Check file permissions, then rerun setup.";
      const failure = result.failure;
      const operation =
        failure.operation === "preserve_ownership"
          ? `preserve owner/group${failure.requestedOwnership === undefined ? "" : ` ${failure.requestedOwnership.uid}:${failure.requestedOwnership.gid}`}`
          : failure.operation.replaceAll("_", " ");
      const reason =
        failure.systemCode === undefined
          ? failure.detail
          : `${failure.systemCode}: ${failure.detail}`;
      const recovery =
        result.backupPath === undefined
          ? ""
          : ` The backup remains at ${result.backupPath}.`;
      return `Agent configuration could not ${operation} at ${failure.path}: ${reason}.${recovery} Review the reported operation and file ownership or permissions before rerunning setup.`;
    }
    case "shadowed_member":
      return `Agent configuration repeats the member at ${JSON.stringify(result.path)}; removing the member the client reads would activate an earlier duplicate, so no change was made. Remove the duplicate members, then rerun setup.`;
    case "rollback":
      return result.backupPath === undefined
        ? `Agent configuration rollback failed at ${result.failure.path}: ${result.failure.detail}; the failed first-run file may remain. Remove or repair it before rerunning setup.`
        : `Agent configuration rollback failed at ${result.failure.path}: ${result.failure.detail}. Inspect the preserved backup at ${result.backupPath} and restore the intended configuration, then rerun setup.`;
    case "readback":
      return result.backupPath === undefined
        ? "Agent configuration could not be verified. Repair the configuration file, then rerun setup."
        : `Agent configuration could not be verified after writing. The original was restored and its backup at ${result.backupPath} was retained. Repair the configuration file or restore that backup, then rerun setup.`;
  }
};

/** Configure every detected agent and report the first failed transaction. */
export const configureDetectedClients = async (options: {
  readonly host: SetupHost;
  readonly detectedClients: readonly SetupClient[];
  readonly providerEnvironment: SetupProviderEnvironment;
  readonly command: readonly string[];
  readonly clients: Record<string, ClientConfigurationResult>;
  readonly appliedActions: string[];
  readonly onProgress?: (event: SetupProgressEvent) => void;
}): Promise<string | undefined> => {
  let failure: string | undefined;
  for (const client of options.detectedClients) {
    const actionId = `configure_client:${client.name}`;
    const label = client.displayName ?? client.name;
    options.onProgress?.({ actionId, label, state: "started" });
    const result = await options.host.configureClient(
      client,
      options.providerEnvironment,
      options.command,
    );
    options.clients[client.name] = result;
    if (result.status === "failed") {
      failure ??= failedConfigurationMessage(result);
      options.onProgress?.({
        actionId,
        label,
        state: "failed",
        detail: failedConfigurationMessage(result),
      });
    } else if (result.status === "configured") {
      options.appliedActions.push(`configured_${client.name}`);
      options.onProgress?.({ actionId, label, state: "completed" });
    } else {
      options.onProgress?.({
        actionId,
        label,
        state: "warning",
        detail:
          result.status === "unchanged"
            ? "Already current"
            : "Manual configuration required",
      });
    }
  }
  return failure;
};
