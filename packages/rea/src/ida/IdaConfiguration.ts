import { isAbsolute } from "node:path";
import { z } from "zod";
import { jsonRecordSchema } from "../domain/jsonRecord.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { AnalysisInputIssue } from "../domain/analysisErrorCore.js";
import { projectInputIssues } from "../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  withOwnedRegularFile,
  regularFileCancellation,
  RegularFileCleanupFailure,
} from "../filesystem/OwnedRegularFile.js";
import {
  RegularFileOperationCancelled,
  NonRegularFileReadError,
} from "../filesystem/RegularFile.js";
import { readBoundedFileBytes } from "../process/BoundedFileBytes.js";

/** Omitted registration `timeoutMs` for each upstream IDA MCP request. */
export const DEFAULT_IDA_REQUEST_TIMEOUT_MS = 300_000;
/** Shortest valid registration request timeout. */
const MIN_IDA_REQUEST_TIMEOUT_MS = 1;
/** Node timer ceiling. Larger registration values would be clamped instead of honored. */
export const MAX_IDA_REQUEST_TIMEOUT_MS = 2_147_483_647;

const common = {
  sensitive: z
    .strictObject({
      headers: z.array(z.string().min(1)).default([]),
      env: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  mode: z.enum(["attached", "headless"]).default("attached"),
  protocol: z.literal("native").optional(),
  timeoutMs: z
    .int()
    .min(MIN_IDA_REQUEST_TIMEOUT_MS)
    .max(MAX_IDA_REQUEST_TIMEOUT_MS)
    .default(DEFAULT_IDA_REQUEST_TIMEOUT_MS),
  workspaceRoot: z
    .string()
    .refine(isAbsolute, "workspaceRoot must be absolute on the REA host")
    .optional(),
};
const registrationSchema = z
  .union([
    z
      .object({
        ...common,
        type: z.literal("stdio").optional(),
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: jsonRecordSchema(z.string()).default({}),
      })
      .strict(),
    z
      .object({
        ...common,
        type: z.literal("http").optional(),
        url: z.url().refine((value) => {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
            url.username === "" &&
            url.password === ""
          );
        }, "IDA MCP must use a local HTTP endpoint without URL credentials"),
        headers: jsonRecordSchema(z.string()).default({}),
      })
      .strict(),
  ])
  .refine(
    (config) => config.protocol !== "native" || config.mode === "attached",
    "The native IDA MCP protocol requires attached mode",
  );

/** An upstream MCP registration plus REA's database lifecycle selection. */
export type IdaConfiguration = z.infer<typeof registrationSchema>;

/** Render only schema-owned constraints, never rejected registration values. */
const registrationConstraint = (
  issue: AnalysisInputIssue,
): string | undefined => {
  if (issue.path.length === 1 && issue.path[0] === "timeoutMs")
    return `timeoutMs must be an integer from ${String(MIN_IDA_REQUEST_TIMEOUT_MS)} to ${String(MAX_IDA_REQUEST_TIMEOUT_MS)} milliseconds`;
  return issue.message === undefined
    ? undefined
    : `${issue.path.join(".") || "registration"}: ${issue.message}`;
};

/** Resolved compatibility facts; persisted identities and diagnostics intentionally differ. */
export const IDA_COMPATIBILITY_PROFILES = {
  legacy: {
    protocol: "legacy",
    mode: "attached",
    identity: "legacy-1.4",
    diagnosticIdentity: "legacy-1.4",
    diagnosticLabel: "attached",
  },
  modern: {
    protocol: "modern",
    mode: "headless",
    identity: "database-supervisor",
    diagnosticIdentity: "database-supervisor",
    diagnosticLabel: "headless",
  },
  native: {
    protocol: "native",
    mode: "attached",
    identity: "native-ida-mcp",
    diagnosticIdentity: "native",
    diagnosticLabel: "native attached",
  },
} as const;
export type IdaCompatibilityProfile =
  (typeof IDA_COMPATIBILITY_PROFILES)[keyof typeof IDA_COMPATIBILITY_PROFILES];

/** Preserve existing attached/headless registrations when protocol is omitted. */
export const idaCompatibilityProfile = (
  config: IdaConfiguration,
): IdaCompatibilityProfile =>
  IDA_COMPATIBILITY_PROFILES[
    config.protocol ?? (config.mode === "attached" ? "legacy" : "modern")
  ];

/** Read one explicit registration without starting or installing a provider. */
export const readIdaConfiguration = (
  path: string,
  options: {
    readonly signal?: AbortSignal;
    readonly resourceScope: RetainedResourceScope;
  },
): Promise<Result<IdaConfiguration, ConfigurationError>> =>
  options.resourceScope.run(async () => {
    let closeLease: AnalysisCleanupLease | undefined;
    try {
      const text = await withOwnedRegularFile<string>(
        path,
        {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          retainFailedClose: (owner) => {
            closeLease = AnalysisCleanupLease.forCloseOwner(owner, path);
            options.resourceScope.retain(
              {
                close: () => closeLease!.release(),
                get cleanupResources() {
                  return closeLease!.cleanupResources;
                },
              },
              path,
            );
          },
        },
        async ({ handle, initial: metadata }) => {
          if (metadata.size > MAXIMUM_REGISTRATION_BYTES)
            throw registrationTooLarge();
          const bytes = await readBoundedFileBytes(
            handle,
            MAXIMUM_REGISTRATION_BYTES,
            {
              signal: options.signal,
              cancellationFailure: (reason) =>
                new RegularFileOperationCancelled(reason),
            },
          );
          if (bytes === undefined) throw registrationTooLarge();
          return bytes.toString("utf8");
        },
      );
      const input: unknown = JSON.parse(text);
      const envelope = z
        .object({ mcpServers: z.object({ "ida-pro-mcp": z.unknown() }) })
        .safeParse(input);
      const registration = envelope.success
        ? envelope.data.mcpServers["ida-pro-mcp"]
        : input;
      const parsed = registrationSchema.safeParse(registration);
      if (parsed.success) return ok(parsed.data);
      // Only schema-authored correction text is admitted; Zod's aggregate
      // message can contain registration values, including credentials.
      const constraints = projectInputIssues(
        parsed.error.issues,
        registration,
      ).flatMap((issue) => {
        const constraint = registrationConstraint(issue);
        return constraint === undefined ? [] : [constraint];
      });
      if (constraints.length === 0)
        return err(
          idaConfigurationError(
            "REA_IDA_MCP_CONFIG must contain an IDA MCP command/args or local url registration; see docs/ida-provider.md.",
            parsed.error,
          ),
        );
      return err(
        new ConfigurationError(
          `REA_IDA_MCP_CONFIG: ${constraints.join("; ")}. See docs/ida-provider.md.`,
          {
            cause: parsed.error,
            settings: constraints.map((constraint) => ({
              setting: "REA_IDA_MCP_CONFIG",
              constraint,
            })),
          },
        ),
      );
    } catch (cause: unknown) {
      if (cause instanceof ConfigurationError) return err(cause);
      if (cause instanceof NonRegularFileReadError)
        return err(
          idaConfigurationError(
            `REA_IDA_MCP_CONFIG must select a regular JSON file: ${path}`,
            cause,
          ),
        );
      if (cause instanceof AnalysisCancelledError) throw cause;
      const cancellation = regularFileCancellation(cause);
      if (cancellation !== undefined) {
        if (cause instanceof RegularFileCleanupFailure) {
          const error = new AnalysisCancelledError("ida:registration", {
            cause: cancellation.reason,
            cleanup: {
              reason:
                cause.cleanupCause instanceof Error
                  ? cause.cleanupCause.message
                  : String(cause.cleanupCause),
              resources: [path],
            },
          });
          closeLease?.bindCleanupError(error);
          throw error;
        }
        throw new AnalysisCancelledError("ida:registration", {
          cause: cancellation.reason,
        });
      }
      if (cause instanceof RegularFileCleanupFailure) {
        const primary =
          cause.outcome.kind === "failed"
            ? cause.outcome.cause
            : cause.cleanupCause;
        const primaryMessage =
          cause.outcome.kind === "failed"
            ? primary instanceof ConfigurationError
              ? primary.message
              : primary instanceof NonRegularFileReadError
                ? `REA_IDA_MCP_CONFIG must select a regular JSON file: ${path}`
                : `Cannot read IDA MCP registration ${path}: ${primary instanceof Error ? primary.message : String(primary)}`
            : `Cannot close IDA MCP registration ${path}; provide a readable JSON configuration.`;
        const error = new ConfigurationError(primaryMessage, {
          cause,
          cleanup: {
            reason:
              cause.cleanupCause instanceof Error
                ? cause.cleanupCause.message
                : String(cause.cleanupCause),
            resources: [path],
          },
          settings: [
            {
              setting: "REA_IDA_MCP_CONFIG",
              constraint: `Close remains incomplete for ${path}`,
            },
          ],
        });
        closeLease?.bindCleanupError(error);
        return err(error);
      }
      return err(
        idaConfigurationError(
          `Cannot read IDA MCP registration ${path}; provide a readable JSON configuration.`,
          cause,
        ),
      );
    }
  });

const MAXIMUM_REGISTRATION_BYTES = 65_536;

/**
 * Read at most the registration limit from one regular file. Opening without
 * blocking and checking the descriptor's type keeps a FIFO, socket or device
 * from stalling diagnostics while it waits for a producer.
 */
const registrationTooLarge = (): ConfigurationError =>
  idaConfigurationError(
    "REA_IDA_MCP_CONFIG exceeds the 64 KiB registration size.",
  );

/**
 * Name the registration key that sets an IDA request or readiness deadline.
 * `ceilingMs` is the parsed `timeoutMs`; a shorter effective value is the time
 * remaining inside that ceiling.
 */
export const idaRegistrationTimeoutGuidance = (
  timeoutMs: number,
  phase: "request" | "readiness",
  ceilingMs: number = timeoutMs,
): { readonly userMessage: string; readonly remediationAction: string } => ({
  userMessage:
    phase === "readiness"
      ? `IDA readiness reached its ${String(timeoutMs)} ms deadline while the headless worker was still busy (deadlineExpired).`
      : ceilingMs === timeoutMs
        ? `This IDA request reached the registration timeoutMs deadline of ${String(timeoutMs)} ms (deadlineExpired).`
        : `This IDA request reached its ${String(timeoutMs)} ms deadline (deadlineExpired), within the registration timeoutMs ceiling of ${String(ceilingMs)} ms.`,
  remediationAction: `Set timeoutMs in the JSON file named by REA_IDA_MCP_CONFIG to an integer from 1 to ${String(MAX_IDA_REQUEST_TIMEOUT_MS)} (omitted means ${String(DEFAULT_IDA_REQUEST_TIMEOUT_MS)}). REA applies the edited file on the next IDA connection after it re-reads the registration; an already open session keeps the timeout it connected with. Allow execution, cleanup and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.`,
});

/** A REA_IDA_MCP_CONFIG rejection that names the setting it concerns. */
export const idaConfigurationError = (
  constraint: string,
  cause?: unknown,
): ConfigurationError =>
  new ConfigurationError(constraint, {
    ...(cause === undefined ? {} : { cause }),
    settings: [{ setting: "REA_IDA_MCP_CONFIG", constraint }],
  });
