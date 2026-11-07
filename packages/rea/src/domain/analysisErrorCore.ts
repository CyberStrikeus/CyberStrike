import type { JsonValue } from "./jsonValue.js";
import type { FixedAllowance } from "./fixedAllowanceRemediation.js";
import {
  AnalysisError,
  type AnalysisErrorOptions,
} from "./analysisErrorBase.js";

/** A readable supplied artifact lies outside this operation's supported target formats. */
export class AnalysisUnsupportedTargetError extends AnalysisError {
  readonly _tag = "AnalysisUnsupportedTargetError";
  /** Refusal-specific recovery, when the producer knows an available workflow. */
  readonly remediationAction: string | undefined;
  constructor(
    readonly operation: string,
    readonly path: string,
    readonly reason: string,
    options?: AnalysisErrorOptions & { readonly remediationAction?: string },
  ) {
    super(`Unsupported target for ${operation} at ${path}: ${reason}`, options);
    this.remediationAction = options?.remediationAction;
  }
}

/** An analysis or transport resource failure, distinct from malformed input or unsupported coverage. */
export const ANALYSIS_RESOURCE_KINDS = [
  "memory",
  "cpu",
  "file-size",
  "transport",
  "capacity",
] as const;

/** A measured resource constraint or bounded admission refusal. */
export class AnalysisResourceConstraintError extends AnalysisError {
  readonly _tag = "AnalysisResourceConstraintError";
  /**
   * The one recovery this refusal carries. A fixed allowance and a separate
   * remediation sentence do not co-occur; retryability belongs to that same
   * object.
   */
  readonly recovery: ResourceConstraintRecovery;

  constructor(
    readonly operation: string,
    readonly resource: (typeof ANALYSIS_RESOURCE_KINDS)[number],
    readonly reason: string,
    readonly reportedLimits: Readonly<Record<string, JsonValue>> | null,
    options?: AnalysisErrorOptions & ResourceConstraintRecovery,
  ) {
    super(`Resource constraint during ${operation}: ${reason}`, options);
    this.recovery = resourceConstraintRecoveryFrom(options);
  }

  /** Projection of `recovery`. Absent when recovery names a fixed allowance. */
  get remediationAction(): string | undefined {
    return this.recovery.remediationAction;
  }

  /**
   * Projection of `recovery`. The fixed format, decoder, or capture allowance
   * that refused the request. Worker limits and host resources do not raise
   * it, so recovery derives from this allowance rather than from `resource`.
   */
  get fixedAllowance(): FixedAllowance | undefined {
    return this.recovery.fixedAllowance;
  }

  /**
   * Projection of `recovery`. Whether retrying the same request can succeed.
   * A caller-selected bound is deterministic for the same input, so it is not
   * retryable even when its resource kind would otherwise be treated as
   * admission capacity.
   */
  get retryable(): boolean | undefined {
    return this.recovery.retryable;
  }
}

const resourceConstraintRecoveryFrom = (
  options: ResourceConstraintRecovery | undefined,
): ResourceConstraintRecovery => {
  if (options?.fixedAllowance !== undefined)
    return {
      fixedAllowance: options.fixedAllowance,
      ...(options.retryable === undefined
        ? {}
        : { retryable: options.retryable }),
    };
  return {
    ...(options?.remediationAction === undefined
      ? {}
      : { remediationAction: options.remediationAction }),
    ...(options?.retryable === undefined
      ? {}
      : { retryable: options.retryable }),
  };
};

/** Carry one refusal's recovery to an error re-attributed or redacted elsewhere. */
export const resourceConstraintRecovery = (
  error: AnalysisResourceConstraintError,
  text: (value: string) => string = (value) => value,
): ResourceConstraintRecovery => {
  const recovery = error.recovery;
  return recovery.fixedAllowance !== undefined
    ? {
        fixedAllowance: {
          name: text(recovery.fixedAllowance.name),
          kind: recovery.fixedAllowance.kind,
        },
        ...(recovery.retryable === undefined
          ? {}
          : { retryable: recovery.retryable }),
      }
    : {
        ...(recovery.remediationAction === undefined
          ? {}
          : { remediationAction: text(recovery.remediationAction) }),
        ...(recovery.retryable === undefined
          ? {}
          : { retryable: recovery.retryable }),
      };
};

/** Producer-specific recovery, or a fixed allowance whose recovery is derived. */
export type ResourceConstraintRecovery =
  | {
      readonly remediationAction?: string;
      readonly fixedAllowance?: never;
      readonly retryable?: boolean;
    }
  | {
      readonly fixedAllowance: FixedAllowance;
      readonly remediationAction?: never;
      readonly retryable?: boolean;
    };

/** Provider-neutral invalid analysis input or output at an application boundary. */
export class AnalysisProtocolError extends AnalysisError {
  readonly _tag = "AnalysisProtocolError";
}

/** Caller input failed provider-neutral application parsing. */
export class AnalysisInputError extends AnalysisError {
  readonly _tag = "AnalysisInputError";
  override readonly userMessage: string | undefined;
  /** Refusal-specific correction, when the generic input-contract advice cannot fix it. */
  readonly remediationAction: string | undefined;
  /**
   * The refused values satisfy the advertised input contract; the selected
   * target lacks the requested fact for them. Re-reading the schema cannot
   * correct such a refusal, so it carries no input-contract recovery.
   */
  readonly conformsToInputContract: boolean;

  constructor(
    readonly operation: string,
    options?: AnalysisErrorOptions & {
      readonly userMessage?: string;
      readonly remediationAction?: string;
      readonly conformsToInputContract?: boolean;
    },
    readonly issues: readonly AnalysisInputIssue[] = [],
  ) {
    super(`Invalid analysis input for ${operation}`, options);
    this.userMessage = options?.userMessage;
    this.remediationAction = options?.remediationAction;
    this.conformsToInputContract = options?.conformsToInputContract ?? false;
  }
}

/** Secret-safe correction metadata for one rejected caller argument. */
export interface AnalysisInputIssue {
  readonly path: readonly (string | number)[];
  readonly reason:
    | "unknown_argument"
    | "missing_argument"
    | "invalid_type"
    | "out_of_range"
    | "invalid_value"
    | "invalid_format";
  /** Schema-authored correction guidance for cross-field or custom checks. */
  readonly message?: string;
  readonly expected?: JsonValue;
  /** Producer-examined facts about the refused value, such as its location and shape. */
  readonly observed?: JsonValue;
  readonly minimum?: number;
  readonly maximum?: number;
}

/** Refusal-specific context a producer projects with an output failure. */
export interface AnalysisOutputErrorOptions extends AnalysisErrorOptions {
  /** Caller-facing explanation for a deterministic, diagnosable refusal. */
  readonly userMessage?: string;
  readonly remediationAction?: string;
  readonly cleanupOnly?: boolean;
}

/** Provider output failed provider-neutral application parsing. */
export class AnalysisOutputError extends AnalysisError {
  readonly _tag = "AnalysisOutputError";
  override readonly userMessage: string | undefined;
  readonly remediationAction: string | undefined;
  readonly cleanupOnly: boolean;

  constructor(
    readonly operation: string,
    readonly reason: string,
    options?: AnalysisOutputErrorOptions,
  ) {
    super(`Invalid analysis output for ${operation}: ${reason}`, options);
    this.userMessage = options?.userMessage;
    this.remediationAction = options?.remediationAction;
    this.cleanupOnly = options?.cleanupOnly ?? false;
  }
}

/** Selected provider cannot execute a declared analysis operation. */
export class AnalysisCapabilityUnavailableError extends AnalysisError {
  readonly _tag = "AnalysisCapabilityUnavailableError";
  override readonly userMessage: string | undefined;
  readonly remediationAction: string | undefined;
  /** Incomplete cleanup must settle before the operation can be retried. */
  readonly retryable: boolean;

  constructor(
    readonly providerId: string,
    readonly operation: string,
    readonly reason: string,
    options?: AnalysisErrorOptions & {
      readonly userMessage?: string;
      readonly remediationAction?: string;
      readonly retryable?: boolean;
    },
  ) {
    super(
      `Provider ${providerId} cannot execute ${operation}: ${reason}`,
      options,
    );
    this.userMessage = options?.userMessage;
    this.remediationAction = options?.remediationAction;
    this.retryable = options?.retryable === true && !this.cleanupIncomplete;
  }
}

/** Caller cancellation won before provider-neutral work completed. */
export class AnalysisCancelledError extends AnalysisError {
  readonly _tag = "AnalysisCancelledError";

  constructor(
    readonly operation: string,
    options?: AnalysisErrorOptions,
  ) {
    super(`Analysis operation was cancelled: ${operation}`, options);
  }
}

/** Provider-neutral operation exceeded its declared execution deadline. */
export class AnalysisTimeoutError extends AnalysisError {
  readonly _tag = "AnalysisTimeoutError";
  override readonly userMessage: string | undefined;
  readonly remediationAction: string | undefined;

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
    options?: AnalysisErrorOptions & {
      /** Provider-specific explanation of which deadline elapsed. */
      readonly userMessage?: string;
      /** Provider-specific setting or action that changes that deadline. */
      readonly remediationAction?: string;
    },
  ) {
    super(
      `Analysis operation timed out after ${String(timeoutMs)}ms: ${operation}`,
      options,
    );
    this.userMessage = options?.userMessage;
    this.remediationAction = options?.remediationAction;
  }
}

/** Host filesystem permissions denied the selected read; this is not malformed caller input. */
export class AnalysisAccessDeniedError extends AnalysisError {
  readonly _tag = "AnalysisAccessDeniedError";
  constructor(
    readonly operation: string,
    readonly path: string,
    readonly systemCode: "EACCES" | "EPERM",
    options?: AnalysisErrorOptions,
  ) {
    super(
      `Host filesystem read access denied (${systemCode}) for ${path} during ${operation}`,
      options,
    );
  }
}

/** Selected artifact acquisition observed a change, so no stable identity can be reported. */
export class AnalysisArtifactChangedError extends AnalysisError {
  readonly _tag = "AnalysisArtifactChangedError";
  constructor(
    readonly operation: string,
    readonly path: string,
    readonly reason: string,
    options?: AnalysisErrorOptions,
  ) {
    super(`Selected artifact changed during acquisition: ${reason}`, options);
  }
}
