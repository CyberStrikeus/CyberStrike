import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { jsonRecordSchema } from "../jsonRecord.js";

const positiveBudget = z.int().safe().positive();
/** Read the explicitly committed output budget without applying scenario defaults. */
export const processScenarioOutputBudgetProjectionSchema = z
  .object({ output_bytes: positiveBudget })
  .passthrough();
/**
 * Maximum xterm backing cells for one visible-plus-scrollback buffer. Each
 * xterm BufferLine stores three Uint32 words per cell (12 MB at this cap),
 * before row objects, serialization strings, and retained frame copies.
 */
export const PROCESS_TERMINAL_CELL_BUDGET = 1_000_000;
/** The pinned xterm renderer cannot represent a one-column terminal. */
export const PROCESS_TERMINAL_MIN_COLUMNS = 2;
const timedEventBase = { at_ms: z.int().safe().nonnegative() };
const reservedRunIdEnvironmentName = "REA_PROCESS_RUN_ID";
const ENVIRONMENT_NAME_CHARACTER = "[^=\\x00]";

/**
 * Nonempty environment names other than the reserved run identifier. The
 * exclusion is spelled as a complement instead of a negative look-ahead,
 * because RE2 and Rust schema validators reject look-around and would refuse
 * every tool in the advertised catalog.
 */
const environmentNamePattern = (reserved: string): RegExp => {
  // After the complete reserved name, at least one more character is needed.
  let rest = `${ENVIRONMENT_NAME_CHARACTER}+`;
  for (let index = reserved.length - 1; index >= 0; index -= 1) {
    const character = reserved[index] ?? "";
    // Diverge here, match the next reserved character, or (after a nonempty
    // prefix) end the name early.
    const choice = `[^=\\x00${character}]${ENVIRONMENT_NAME_CHARACTER}*|${character}${rest}`;
    rest = index === 0 ? choice : `(?:${choice})?`;
  }
  return new RegExp(`^(?:${rest})$`, "u");
};

const environmentName = z
  .string()
  .min(1, "Environment names must not be empty")
  .regex(environmentNamePattern(reservedRunIdEnvironmentName), {
    error: (issue) =>
      issue.input === reservedRunIdEnvironmentName
        ? `${reservedRunIdEnvironmentName} is reserved by the process adapter`
        : "Environment names cannot contain '=' or NUL",
  });
const unsupportedPtyEnvironmentName = "__proto__";
const ptyEnvironmentName = environmentName.regex(
  environmentNamePattern(unsupportedPtyEnvironmentName),
  {
    error:
      "The installed PTY backend cannot preserve the __proto__ environment name; pass it through /usr/bin/env instead.",
  },
);
const childProcessString = z
  .string()
  .regex(
    /^[^\x00]*$/u,
    "Values passed to operating-system APIs cannot contain NUL",
  );
const processEnvironmentSchema = jsonRecordSchema(
  childProcessString,
  ptyEnvironmentName,
);

const fitsProcessTerminalCellBudget = (
  columns: number,
  rows: number,
  scrollback: number,
): boolean =>
  rows + scrollback <= Math.floor(PROCESS_TERMINAL_CELL_BUDGET / columns);

export const normalizationSchema = z.object({
  paths: z.boolean(),
  pids: z.boolean(),
  ports: z.boolean(),
  time_bucket_ms: positiveBudget,
  patterns: z.array(
    z.object({
      pattern: z.string(),
      replacement: z.string(),
    }),
  ),
});

/** Compute a canonical SHA-256 commitment independent of object key order. */
export const digestProcessCommitment = (value: unknown): string => {
  const serialized = canonicalize(value);
  if (serialized === undefined)
    throw new TypeError("Process capture commitment is not canonical JSON");
  return createHash("sha256").update(serialized).digest("hex");
};

/** Explicit private-input facts contain no textual marker that can collide with a value. */
export const sensitiveProcessInputProjection = (data: string) => ({
  data: "",
  sensitive: true as const,
  input_bytes: Buffer.byteLength(data),
});

const committedScenarioEvents = (
  events: ProcessScenario["events"],
  includeSensitiveInputLength: boolean,
) =>
  events.map((event) =>
    event.type === "input" && event.sensitive
      ? {
          ...event,
          ...(includeSensitiveInputLength
            ? sensitiveProcessInputProjection(event.data)
            : { data: "" }),
        }
      : event,
  );

/** Build the caller-selected scenario projection committed by process-capture Evidence. */
export const processScenarioCommitment = (
  scenario: ProcessScenario,
  executableSha256?: string,
): Readonly<Record<string, unknown>> => {
  // A zero interval is today's immediate kill; leaving it out keeps the
  // committed identity of every scenario that predates the field unchanged.
  const { finalization_ms: finalizationMs, ...committed } = scenario;
  return {
    ...committed,
    ...(finalizationMs > 0 ? { finalization_ms: finalizationMs } : {}),
    events: committedScenarioEvents(scenario.events, true),
    executable_sha256: executableSha256 ?? null,
  };
};

/** Project observation settings shared by capture and reconstruction. */
export const processComparisonContract = (
  scenario: ProcessScenario,
): Readonly<Record<string, unknown>> => ({
  working_directory: scenario.working_directory,
  environment: scenario.environment,
  ambient_environment: "unknown",
  filesystem_observation_paths: scenario.filesystem_observation_paths,
  terminal: scenario.terminal,
  // Input bytes are intentionally absent from compatibility identity. Their
  // redacted observations remain unknown, so equal commitments never imply
  // that two secret values were the same.
  events: committedScenarioEvents(scenario.events, false),
  timeout_ms: scenario.timeout_ms,
  idle_timeout_ms: scenario.idle_timeout_ms,
  settle_ms: scenario.settle_ms,
  ...(scenario.finalization_ms > 0
    ? { finalization_ms: scenario.finalization_ms }
    : {}),
  limits: scenario.limits,
  normalization: scenario.normalization,
  terminal_observation_version: "deferred-rendered-journal-v1",
  ...(scenario.events.some((event) => event.type === "input" && event.sensitive)
    ? { sensitive_input_redaction_version: "literal-terminal-input-v1" }
    : {}),
  ...(scenario.normalization.pids
    ? { pid_normalization_version: "sampled-identifiers-v2" }
    : {}),
  ...(scenario.normalization.paths
    ? { path_normalization_version: "path-component-boundaries-v3" }
    : {}),
  ...(scenario.normalization.ports
    ? { port_normalization_version: "contextual-endpoints-v3" }
    : {}),
  ...(scenario.normalization.patterns.length > 0
    ? { pattern_normalization_version: "literal-replacements-v1" }
    : {}),
  rendered_line_format: "trailing-spaces-trimmed-v1",
});

/**
 * Boundary schema for one bounded process experiment.
 * Defaults are part of the evidence contract and must remain deterministic.
 */
export const processScenarioSchema = z
  .strictObject({
    executable: childProcessString.min(1),
    arguments: z.array(childProcessString).default([]),
    working_directory: childProcessString.default("."),
    environment: processEnvironmentSchema.default({}),
    filesystem_observation_paths: z
      .array(childProcessString.min(1))
      .default([]),
    terminal: z
      .strictObject({
        columns: z
          .int()
          .min(PROCESS_TERMINAL_MIN_COLUMNS)
          .max(65_535)
          .default(80),
        rows: z.int().min(1).max(65_535).default(24),
        scrollback: z.int().safe().nonnegative().default(1_000),
      })
      .describe(
        "The renderer requires at least 2 columns. The visible terminal and scrollback together must use at most 1,000,000 xterm renderer cells: columns × (rows + scrollback). Resize events use the same minimum width, scrollback and limit. This release has no runtime override.",
      )
      .default({ columns: 80, rows: 24, scrollback: 1_000 }),
    events: z
      .array(
        z.discriminatedUnion("type", [
          z.strictObject({
            ...timedEventBase,
            type: z.literal("input"),
            data: z.string(),
            sensitive: z.boolean().default(false),
          }),
          z.strictObject({
            ...timedEventBase,
            type: z.literal("resize"),
            columns: z.int().min(PROCESS_TERMINAL_MIN_COLUMNS).max(65_535),
            rows: z.int().min(1).max(65_535),
          }),
          z.strictObject({
            ...timedEventBase,
            type: z.literal("signal"),
            signal: z.enum(["SIGINT", "SIGTERM", "SIGKILL"]),
          }),
        ]),
      )
      .default([]),
    timeout_ms: positiveBudget.default(30_000),
    idle_timeout_ms: positiveBudget.default(30_000),
    settle_ms: z.int().safe().nonnegative().default(100),
    finalization_ms: z
      .int()
      .safe()
      .nonnegative()
      .default(0)
      .describe(
        "Milliseconds a target may keep running after SIGTERM when timeout_ms or idle_timeout_ms fires, before SIGKILL; 0 sends SIGKILL immediately. Both signals reach the captured root only while its launch-time start identity still matches; cancellation ends the run at once.",
      ),
    limits: z
      .strictObject({
        output_bytes: positiveBudget.default(1_000_000),
        files: positiveBudget.default(10_000),
        file_bytes: positiveBudget.default(10_000_000),
        processes: positiveBudget.default(1_000),
        filesystem_depth: z.int().safe().nonnegative().default(16),
      })
      .strict()
      .default({
        output_bytes: 1_000_000,
        files: 10_000,
        file_bytes: 10_000_000,
        processes: 1_000,
        filesystem_depth: 16,
      }),
    normalization: z
      .strictObject({
        paths: z.boolean().default(false),
        pids: z.boolean().default(true),
        ports: z.boolean().default(true),
        time_bucket_ms: positiveBudget.default(10),
        patterns: z
          .array(
            z.strictObject({
              pattern: z
                .string()
                .describe(
                  "Literal text to replace in captured output; not a regular expression.",
                ),
              replacement: z.string(),
            }),
          )
          .default([]),
      })
      .default({
        paths: false,
        pids: true,
        ports: true,
        time_bucket_ms: 10,
        patterns: [],
      }),
  })
  .superRefine((scenario, context) => {
    // Each budget is a safe integer, but their sum is not checked anywhere
    // else. BigInt keeps the comparison exact beyond the representable range.
    const lifecycleBudget =
      BigInt(scenario.timeout_ms) +
      BigInt(scenario.finalization_ms) +
      BigInt(scenario.settle_ms);
    if (lifecycleBudget > BigInt(Number.MAX_SAFE_INTEGER))
      context.addIssue({
        code: "custom",
        message: `timeout_ms + finalization_ms + settle_ms must stay at or below ${String(Number.MAX_SAFE_INTEGER)} ms, the largest total exactly representable as a JavaScript number`,
        path: ["timeout_ms"],
      });
    if (
      !fitsProcessTerminalCellBudget(
        scenario.terminal.columns,
        scenario.terminal.rows,
        scenario.terminal.scrollback,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["terminal"],
        message: `terminal columns × (rows + scrollback) must not exceed ${String(PROCESS_TERMINAL_CELL_BUDGET)} renderer cells. This release has no runtime override.`,
      });
    for (let index = 1; index < scenario.events.length; index += 1) {
      const event = scenario.events[index];
      const previous = scenario.events[index - 1];
      if (eventsOutOfOrder(event, previous)) {
        context.addIssue({
          code: "custom",
          message: "events must be ordered by at_ms",
          path: ["events", index],
        });
      }
    }
    for (const [index, event] of scenario.events.entries()) {
      if (
        event.type === "resize" &&
        !fitsProcessTerminalCellBudget(
          event.columns,
          event.rows,
          scenario.terminal.scrollback,
        )
      )
        context.addIssue({
          code: "custom",
          path: ["events", index],
          message: `resize event at ${String(event.at_ms)} ms exceeds the ${String(PROCESS_TERMINAL_CELL_BUDGET)}-cell renderer budget with the selected scrollback. This release has no runtime override.`,
        });
      if (event.at_ms > scenario.timeout_ms) {
        context.addIssue({
          code: "custom",
          message: `event at ${String(event.at_ms)} ms occurs after the ${String(scenario.timeout_ms)} ms scenario timeout`,
          path: ["events", index],
        });
      }
    }
  });

const eventsOutOfOrder = (
  event: { readonly at_ms: number } | undefined,
  previous: { readonly at_ms: number } | undefined,
): boolean =>
  event !== undefined && previous !== undefined && event.at_ms < previous.at_ms;

/** Parsed instructions and resource bounds for one process experiment. */
export type ProcessScenario = z.infer<typeof processScenarioSchema>;
