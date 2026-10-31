import type { ClientConfigurationWriteProblem } from "./ClientConfigurationPublication.js";
import type { DoctorReport, DoctorScope, runDoctor } from "./Doctor.js";
import type { LinuxDistribution } from "./LinuxHopper.js";
import type { HopperReleaseError } from "./HopperReleaseFeed.js";
import type {
  SkillDestination,
  SkillInstallResult,
  SetupSkillInstallError,
} from "./SetupSkill.js";
import type { Result } from "../domain/result.js";
import type {
  AnalysisCleanupObservation,
  AnalysisError,
} from "../domain/analysisErrorBase.js";
import type { SetupClient } from "./SupportedClients.js";
import type {
  SetupFailureCode,
  SetupHopperInstallResult,
} from "./SetupInstallFailure.js";

/** Exact non-secret provider variables propagated into managed registrations. */
export type SetupProviderEnvironment = Readonly<Record<string, string>>;

/** Read-only host facts shared by the initial setup plan. */
export interface SetupInitialState {
  readonly hopperPath?: string;
  /** Whether the caller explicitly selected a Hopper launcher in its environment. */
  readonly hopperLauncherConfigured?: boolean;
  /** Whether the caller or host has an analysis provider configuration. */
  readonly providerConfigured: boolean;
  readonly providerEnvironment: SetupProviderEnvironment;
  readonly doctor: DoctorReport;
}

/** Result of one backup/write/readback transaction. */
export type ClientConfigurationResult =
  | {
      readonly status: "failed";
      readonly reason: "registration_ownership";
      readonly detail: string;
    }
  | {
      readonly status: "failed";
      readonly reason: "conflict";
      readonly backupPath?: string;
    }
  | {
      readonly status: "unchanged" | "configured" | "skipped";
      readonly backupPath?: string;
    }
  | {
      readonly status: "failed";
      readonly reason: "path" | "target_changed" | "backup";
    }
  | {
      readonly status: "failed";
      readonly reason: "write";
      readonly failure?: ClientConfigurationWriteProblem;
      readonly backupPath?: string;
    }
  | {
      readonly status: "failed";
      /** Removing the member a client reads would activate an earlier duplicate. */
      readonly reason: "shadowed_member";
      readonly path: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly reason: "readback";
      /** Snapshot of the restored original, when this transaction made one. */
      readonly backupPath?: string;
    }
  | {
      readonly status: "failed";
      readonly reason: "target_unavailable";
      readonly failure: {
        readonly kind: "inspect";
        readonly path: string;
        readonly detail: string;
      };
    }
  | {
      readonly status: "failed";
      readonly reason: "rollback";
      readonly backupPath?: string;
      readonly failure: {
        readonly kind: "restore";
        readonly path: string;
        readonly detail: string;
      };
    };

/** Read-only state used to block unsafe setup plans before any mutation. */
export type ClientConfigurationInspection =
  | { readonly status: "already_current" }
  | {
      readonly status: "create" | "update";
      readonly backupPath?: string;
    }
  | {
      readonly status: "invalid";
      readonly remediation: string;
    };
/** Effects required by the idempotent, non-blocking setup workflow. */
export interface SetupHost {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly linuxHopperReleaseCache?: Result<string, HopperReleaseError>;
  skillDestinations(clientIds: readonly string[]): readonly SkillDestination[];
  readonly registrationCommand: readonly string[];
  /** Why client registration cannot proceed from this host. */
  readonly registrationCommandBlocker?: string;
  readonly nodeVersion: string;
  macosVersion(): Promise<string | undefined>;
  linuxDistribution(): Promise<LinuxDistribution | undefined>;
  initialSetupState(scope?: DoctorScope): Promise<SetupInitialState>;
  installHopper(replaceExisting: boolean): Promise<SetupHopperInstallResult>;
  /** Retry retained owners. Returned or thrown errors with explicit cleanup
   * owners follow live release state; ownerless failures remain unconfirmed.
   * runSetup does not observe later direct calls to a caller-supplied host. */
  close?(): Promise<AnalysisError | undefined>;
  detectedClients(): Promise<readonly SetupClient[]>;
  supportedClients(): Promise<readonly SetupClient[]>;
  configureClient(
    client: SetupClient,
    providerEnvironment: SetupProviderEnvironment,
    command: readonly string[],
  ): Promise<ClientConfigurationResult>;
  clientNeedsConfigure(
    client: SetupClient,
    providerEnvironment: SetupProviderEnvironment,
    command: readonly string[],
  ): Promise<boolean>;
  inspectClientConfiguration(
    client: SetupClient,
    providerEnvironment: SetupProviderEnvironment,
    command: readonly string[],
  ): Promise<ClientConfigurationInspection>;
  skillNeedsInstall(clientIds: readonly string[]): Promise<boolean>;
  validateSkillDirectories(
    clientIds: readonly string[],
  ): Promise<Result<void, SetupSkillInstallError>>;
  installSkill(clientIds: readonly string[]): Promise<SkillInstallResult>;
  doctor(scope?: DoctorScope): Promise<Awaited<ReturnType<typeof runDoctor>>>;
}
/** Structured setup outcome carrying remediation instead of prompting. */
export interface SetupResult {
  readonly status:
    | "planned"
    | "cancelled"
    | "needs_confirmation"
    | "ready"
    | "needs_human";
  readonly plannedActions: readonly SetupAction[];
  readonly appliedActions: readonly string[];
  readonly clients: Readonly<Record<string, ClientConfigurationResult>>;
  readonly doctor: SetupDoctorSummary;
  /** Supported-client discovery state captured before setup mutations. */
  readonly clientStates: readonly SetupClientState[];
  readonly remediation?: string;
  readonly code?: SetupFailureCode;
  /** Identified resources still retained after finalization; absent after confirmed release. */
  readonly cleanup?: AnalysisCleanupObservation | undefined;
}

/** Whether the requested setup actions still need approval or human repair. */
export const isSetupFailure = (result: SetupResult): boolean => {
  const status = result.status;
  switch (status) {
    case "planned":
    case "cancelled":
    case "ready":
      return false;
    case "needs_confirmation":
    case "needs_human":
      return true;
    default: {
      const exhaustive: never = status;
      throw new TypeError(
        `Unhandled setup result status: ${String(exhaustive)}`,
      );
    }
  }
};

/** Relevant health and identity evidence for the selected setup scope. */
export interface SetupDoctorSummary {
  readonly healthy: boolean;
  readonly environment_healthy: boolean;
  readonly scope: DoctorReport["scope"];
  readonly hopperPath?: string;
  readonly availableProviders: readonly string[];
  readonly providerInspections?: DoctorReport["providerInspections"];
  readonly identity?: Pick<
    NonNullable<DoctorReport["identity"]>,
    "skill" | "registrations"
  >;
}

/** Read-only state for one supported client location. */
export interface SetupClientState {
  readonly client: SetupClient;
  readonly detected: boolean;
  readonly configured: boolean;
  readonly status:
    | "configured"
    | "missing"
    | "needs_configuration"
    | "invalid"
    | "unknown";
}

/** One concrete setup mutation disclosed before approval. */
export interface SetupAction {
  readonly id: string;
  readonly kind: "install_hopper" | "configure_client" | "install_skill";
  readonly label: string;
  readonly target: string;
  readonly detail: string;
  readonly external: boolean;
  readonly operation: "create" | "update" | "install";
  readonly backupPath?: string;
  readonly networkOrigins?: readonly string[];
  readonly commands?: readonly string[];
  readonly integrity?: string;
}

/** Explicit authorization supplied by an interactive or unattended CLI adapter. */
export interface SetupOptions {
  readonly approved: boolean;
  readonly installHopper: boolean;
  readonly structured: boolean;
  readonly proposeHopper?: boolean;
  readonly clientIds?: readonly string[];
  /** Skill roots to update independently of MCP registrations (maintenance). */
  readonly skillClientIds?: readonly string[];
  readonly installSkill?: boolean;
  /** Comma-separated tool families the MCP registration advertises. */
  readonly toolFamilies?: string;
  readonly readinessScope?: DoctorScope;
  readonly dryRun?: boolean;
  readonly allDetectedClients?: boolean;
  readonly onProgress?: (event: SetupProgressEvent) => void;
}

/** One settled or active setup operation projected to the interactive adapter. */
export interface SetupProgressEvent {
  readonly actionId: string;
  readonly label: string;
  readonly state: "started" | "completed" | "warning" | "failed";
  readonly detail?: string;
}

/** Interactive selection and final consent returned by the CLI adapter. */
export interface SetupConfirmationDecision {
  readonly approved: boolean;
  readonly selectedActionIds: readonly string[];
  readonly cancelled?: boolean;
}

/** Read-only context shown while selecting clients or reviewing exact actions. */
export interface SetupConfirmationContext {
  readonly stage: "select" | "confirm";
  readonly clientStates: readonly SetupClientState[];
  readonly selectedClientIds: readonly string[];
  readonly clientSelectionAllowed: boolean;
}

/** Adapter-owned selection and confirmation for the setup workflow. */
export type SetupConfirmation = (
  actions: readonly SetupAction[],
  context?: SetupConfirmationContext,
) => Promise<boolean | SetupConfirmationDecision>;
