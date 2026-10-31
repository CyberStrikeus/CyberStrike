import type { AnalysisViewResult } from "../../domain/analysisView/analysisView.js";
import {
  changesState,
  type StateDocument,
  type StateEntity,
  type StateType,
  type StateView,
} from "../../domain/analysisView/environmentStateRules.js";
import type { StateWritePlan } from "../../domain/analysisView/environmentStateWriteRules.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisResourceConstraintError,
  type AnalysisInputIssue,
} from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import { inspectAnalysisViewValidated } from "../analysisView/AnalysisViewService.js";
import {
  ENVIRONMENT_SERVE_OPERATION,
  inputError,
  parseEvidenceFile,
  parseViewEvidence,
  type EnvironmentManifestTool,
  type EnvironmentSource,
} from "./environmentSource.js";
import { STATE_INTAKE_LIMIT_BYTES } from "./environmentStateDocument.js";
import { initialStateBytes } from "./environmentStateStore.js";
import {
  describeWrite,
  writeBody,
  writeQuery,
} from "./environmentStateWriteDescription.js";
import {
  environmentToolDefinitions,
  type EnvironmentDataPlane,
  type EnvironmentToolDefinition,
} from "./environmentTools.js";

type EnvironmentStateView = Extract<
  AnalysisViewResult,
  { kind: "environment-state" }
>;

/** The initial state an environment-state view extracted for the served manifest, authenticated and cross-checked. */
export interface EnvironmentState {
  readonly evidenceId: string;
  readonly types: readonly StateType[];
  /** Render plans keyed by tool name. */
  readonly views: ReadonlyMap<string, StateView>;
  readonly entities: readonly StateEntity[];
  readonly documents: readonly StateDocument[];
  /** Write plans keyed by tool name. */
  readonly writes: ReadonlyMap<string, StateWritePlan>;
  /** The instant the served clock starts from, or null when the capture has no times. */
  readonly writeClock: string | null;
}

/** The write plans a catalog serves from, and the views naming calls that only read: none before a state is derived. */
type ServedWrites = Pick<EnvironmentState, "writes"> &
  Partial<Pick<EnvironmentState, "views">>;

/** Serving from the state serves read tools, calls the capture shows reading only, and the write tools whose effect it confirmed. */
const servedFromState = (
  tool: EnvironmentManifestTool,
  state: ServedWrites,
): boolean => {
  const view = state.views?.get(tool.name);
  return (
    !changesState(tool.method, tool.path_template) ||
    (view?.shape === "recorded" && view.reason === "query-body") ||
    state.writes.get(tool.name)?.served === true
  );
};

/** The tools an environment serves and the data plane its card declares. */
export interface ServedCatalog {
  readonly tools: readonly EnvironmentToolDefinition[];
  readonly dataPlane: EnvironmentDataPlane;
}

/** The catalog an environment serves: every manifest tool for replay; from a state, the read tools, the confirmed write tools and the data plane. */
export const servedCatalog = (
  source: EnvironmentSource,
  state: ServedWrites | undefined,
  name: string,
  operation: string = ENVIRONMENT_SERVE_OPERATION,
): Result<ServedCatalog, AnalysisResourceConstraintError> => {
  const dataPlane: EnvironmentDataPlane =
    state === undefined ? "none" : "state";
  const tools = environmentToolDefinitions(
    state === undefined
      ? source
      : {
          ...source,
          manifest: {
            ...source.manifest,
            tools: source.manifest.tools.filter((tool) =>
              servedFromState(tool, state),
            ),
          },
        },
    name,
    {
      operation,
      dataPlane,
      ...(state === undefined
        ? {}
        : {
            describe: (tool) =>
              describeWrite(
                state.writes.get(tool.name),
                writeQuery(state.writes.get(tool.name), source),
              ),
            body: (tool, recorded) =>
              writeBody(state.writes.get(tool.name), recorded),
            query: (tool) => writeQuery(state.writes.get(tool.name), source),
          }),
    },
  );
  return tools.ok ? ok({ tools: tools.value, dataPlane }) : tools;
};

const refusal = (
  operation: string,
  issue: AnalysisInputIssue,
  userMessage: string,
): AnalysisError =>
  inputError(
    operation,
    [{ ...issue, path: ["state", "normalized_result", ...issue.path] }],
    userMessage,
  );

/** Why the state does not belong to the served manifest and capture, if it does not. */
const stateMismatch = (
  operation: string,
  view: EnvironmentStateView,
  source: EnvironmentSource,
): AnalysisError | undefined => {
  if (view.parent_evidence_id !== source.evidenceId)
    return refusal(
      operation,
      {
        path: ["parent_evidence_id"],
        reason: "invalid_value",
        expected: source.evidenceId,
        message: `The state cites parent Evidence ${view.parent_evidence_id}; the evidence file is ${source.evidenceId}.`,
      },
      "The state was extracted from a different capture than the supplied evidence file.",
    );
  const rules = source.manifest.view.template_rules;
  if (
    view.view.template_rules.length !== rules.length ||
    view.view.template_rules.some((rule, index) => rule !== rules[index])
  )
    return refusal(
      operation,
      {
        path: ["view", "template_rules"],
        reason: "invalid_value",
        expected: [...rules],
        message:
          "The state must be extracted with the manifest's template_rules, in the same order, so its tool names are the manifest's.",
      },
      "The state was extracted with different template rules than the manifest.",
    );
  const tools = new Set(source.manifest.tools.map((tool) => tool.name));
  const index = view.views.findIndex((entry) => !tools.has(entry.tool));
  return index < 0
    ? undefined
    : refusal(
        operation,
        {
          path: ["views", index, "tool"],
          reason: "invalid_value",
          message: "Every state view must name a tool of the served manifest.",
        },
        "The state names a tool the manifest does not have.",
      );
};

/**
 * Load the environment-state Evidence for an already loaded manifest and
 * capture, refusing a state extracted from another capture or with other
 * template rules; refusals name the command that loaded it.
 */
export const loadEnvironmentState = (
  stateValue: unknown,
  source: EnvironmentSource,
  operation: string = ENVIRONMENT_SERVE_OPERATION,
): Result<EnvironmentState, AnalysisError> => {
  const parsed = parseViewEvidence(
    operation,
    "state",
    stateValue,
    "environment-state",
  );
  if (!parsed.ok) return parsed;
  const { view, evidenceId } = parsed.value;
  const mismatch = stateMismatch(operation, view, source);
  if (mismatch !== undefined) return err(mismatch);
  return ok({
    evidenceId,
    types: view.types,
    views: new Map(view.views.map((entry) => [entry.tool, entry])),
    entities: view.entities,
    documents: view.documents,
    writes: new Map(view.writes.map((plan) => [plan.tool, plan])),
    writeClock: view.write_clock,
  });
};

/** Derive the state the capture observed with the manifest's rules, projected as retained Evidence, and check it as a supplied state. */
export const deriveEnvironmentState = (
  source: EnvironmentSource,
  captureValue: unknown,
  operation: string = ENVIRONMENT_SERVE_OPERATION,
): Result<EnvironmentState, AnalysisError> => {
  const capture = parseEvidenceFile(operation, "evidence", captureValue);
  if (!capture.ok) return capture;
  const captureId = capture.value.evidence_id;
  const projected = inspectAnalysisViewValidated(
    {
      source: { kind: "retained-evidence", evidence_id: captureId },
      view: {
        kind: "environment-state",
        template_rules: [...source.manifest.view.template_rules],
      },
    },
    (evidenceId) => (evidenceId === captureId ? capture.value : undefined),
  );
  return projected.ok
    ? loadEnvironmentState(projected.value, source, operation)
    : projected;
};

/** What a command reports about the state: the state Evidence it serves, or why it serves replay. */
export type StateServingReport =
  | { readonly served: true; readonly evidence_id: string }
  | { readonly served: false; readonly reason: "replay-only" }
  | {
      readonly served: false;
      readonly reason: "unavailable";
      readonly code: string;
      readonly message: string;
    };

/** The state an environment serves, if any, and how its command reports it. */
export interface ServedState {
  readonly state: EnvironmentState | undefined;
  readonly report: StateServingReport;
}

/** What preparing the state yields: served or unavailable, never replay-only, which only the serve command chooses. */
export interface PreparedState extends ServedState {
  readonly report: Exclude<
    StateServingReport,
    { readonly reason: "replay-only" }
  >;
}

/** The derived state, unless data/get would write it past what data/add loads back, so its own report could not be restored. */
export const admitServedState = (
  state: EnvironmentState,
  operation: string,
): Result<EnvironmentState, AnalysisResourceConstraintError> => {
  const bytes = initialStateBytes(state);
  return bytes > STATE_INTAKE_LIMIT_BYTES
    ? err(
        new AnalysisResourceConstraintError(
          operation,
          "capacity",
          "The derived state is larger than data/add loads, so it cannot be served",
          { max_state_bytes: STATE_INTAKE_LIMIT_BYTES, state_bytes: bytes },
          {
            retryable: false,
            remediationAction:
              "Capture fewer or smaller responses, or serve the environment as replay only.",
          },
        ),
      )
    : ok(state);
};

const unavailable = (error: AnalysisError): PreparedState => {
  const { code, message } = projectAnalysisError(error);
  return {
    state: undefined,
    report: { served: false, reason: "unavailable", code, message },
  };
};

/** Serve the derived state when its catalog fits under the served name; otherwise serve replay and report why. */
export const prepareServedState = (
  source: EnvironmentSource,
  captureValue: unknown,
  options: {
    readonly name?: string | undefined;
    readonly operation?: string;
  } = {},
): PreparedState => {
  const operation = options.operation ?? ENVIRONMENT_SERVE_OPERATION;
  const name = options.name ?? source.manifest.name;
  // The read catalog depends only on the manifest and name, so checking it first spares deriving a state that cannot be served.
  const reads = servedCatalog(source, { writes: new Map() }, name, operation);
  if (!reads.ok) return unavailable(reads.error);
  const derived = deriveEnvironmentState(source, captureValue, operation);
  if (!derived.ok) return unavailable(derived.error);
  const admitted = admitServedState(derived.value, operation);
  if (!admitted.ok) return unavailable(admitted.error);
  // Served write tools join the catalog, so the whole catalog is admitted again.
  const catalog = servedCatalog(source, derived.value, name, operation);
  return catalog.ok
    ? {
        state: derived.value,
        report: { served: true, evidence_id: derived.value.evidenceId },
      }
    : unavailable(catalog.error);
};
