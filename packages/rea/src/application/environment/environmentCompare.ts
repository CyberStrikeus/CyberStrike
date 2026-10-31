import {
  ownMember,
  decodedSegment,
  same,
} from "../../domain/analysisView/environmentStateRules.js";
import type { FieldRule } from "../../domain/analysisView/environmentStateWriteRules.js";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  compareAnswers,
  DIFFERENCE_CATEGORIES,
  STEP_DIFFERENCE_LIMIT,
  type Answer,
  type Difference,
  type DifferenceCategory,
  type Normalised,
} from "./environmentCompareDiff.js";
import {
  environmentArguments,
  IdMap,
  learnIds,
  translatePath,
} from "./environmentCompareIds.js";
import {
  bulkIds,
  collectionScope,
  literalPositions,
  bodyTools,
  matchProbeRequest,
  probeArguments,
  parameterScopes,
  type ProbeToolCall,
} from "./environmentCompareMatch.js";
import {
  probeRequests,
  requestBody,
  sendsBodies,
  type ProbeStep,
  type UnobservedRecord,
} from "./environmentCompareProbe.js";
import {
  inputError,
  parseCaptureEvidence,
  replayedBody,
  type EnvironmentManifestTool,
  type EnvironmentSource,
  type ReplayedBody,
} from "./environmentSource.js";
import {
  selectsRecordedLine,
  type ReplayArguments,
  type ReplayResult,
} from "./environmentReplay.js";
import { prepareServedState, servedCatalog } from "./environmentState.js";
import type { StateAnswer } from "./environmentStateAnswer.js";
import { EnvironmentStateStore } from "./environmentStateStore.js";
import {
  environmentToolAnswer,
  type EnvironmentToolAnswer,
} from "./environmentToolAnswer.js";
import type { EnvironmentToolDefinition } from "./environmentTools.js";

/** One probe capture file: its label for the report and its parsed JSON. */
export interface CompareProbeInput {
  readonly label: string;
  readonly value: unknown;
}

/** One probe request, how the environment answered it, and how that differs from the application. */
export interface CompareStep {
  readonly ordinal: number;
  readonly method: string;
  readonly path: string;
  readonly tool: string | null;
  readonly live_status: number | null;
  readonly env_status: number | null;
  readonly equal: boolean;
  /** Equal but for item order, which an application that returns sets in no fixed order cannot reproduce either. */
  readonly equal_ignoring_order: boolean;
  readonly categories: DifferenceCategory[];
  readonly differences: Difference[];
  readonly ignored_query: string[];
}

export interface CompareProbeReport {
  readonly label: string;
  readonly evidence_id: string;
  readonly steps: number;
  readonly equal: number;
  readonly ids_mapped: number;
  readonly id_conflicts: number;
  readonly normalised: Normalised;
  readonly results: CompareStep[];
  /** Records left uncompared, in probe order, each with its reason. */
  readonly unobserved: UnobservedRecord[];
}

export interface CompareReport {
  readonly status: "complete";
  readonly environment: {
    readonly name: string;
    readonly manifest_evidence_id: string;
    readonly evidence_id: string;
    readonly state: "served" | "replay-only";
  };
  readonly summary: {
    readonly probes: number;
    readonly steps: number;
    readonly equal: number;
    readonly agreement: number | null;
    readonly agreement_ignoring_order: number | null;
    /** Probe records left uncompared, outside the steps agreement counts. */
    readonly unobserved: number;
    readonly categories: Record<DifferenceCategory, number>;
    readonly normalised: Normalised;
  };
  readonly tools: { tool: string; steps: number; equal: number }[];
  readonly probes: CompareProbeReport[];
}

const NORMALISED_KEYS = [
  "ids",
  "clocks",
  "generated",
  "large_bodies",
  "unobserved_bodies",
] as const;
const emptyNormalised = (): Normalised => ({
  ids: 0,
  clocks: 0,
  generated: 0,
  large_bodies: 0,
  unobserved_bodies: 0,
});

const isSuccess = (status: number | null): boolean =>
  status !== null && status >= 200 && status < 300;

/** Where a call's answer holds its own entities, and the collection they belong to: a read view's entity or list pointer, a write's response pointer, else the root. A write that answers with only the new id learns that scalar. */
const entityOf = (
  run: ProbeRun,
  tool: EnvironmentManifestTool,
  segments: readonly string[],
  answer: ReplayResult,
): {
  readonly scope: string;
  readonly at: string;
  readonly identity: boolean;
  readonly rules: readonly FieldRule[];
} => {
  const view = run.store?.state.views.get(tool.name);
  const plan = run.store?.state.writes.get(tool.name);
  const response = plan?.response;
  const scope = collectionScope(tool, segments);
  if (view?.shape === "item" || view?.shape === "list")
    return { scope, at: view.pointer, identity: false, rules: [] };
  const identity = response?.shape === "identity";
  const at = identity
    ? (response.pointer ?? "")
    : (response?.pointer ?? plan?.observation?.pointer ?? "");
  const provenance = (answer as Partial<StateAnswer>).state;
  const renderedWrite =
    provenance?.source === "state" &&
    (provenance.view === "create" ||
      provenance.view === "update" ||
      provenance.view === "document-write" ||
      provenance.view === "delete");
  // A missing target replays a recorded absence with state provenance too;
  // only an applied write can render the plan's entity response.
  const rules =
    plan?.served === true && response?.shape === "entity" && renderedWrite
      ? plan.rules
      : [];
  return { scope, at, identity, rules };
};

const fromState = (answer: ReplayResult): boolean => {
  const state = (answer as Partial<StateAnswer>).state;
  // Missing-item selection comes from state, but its response is a recording.
  return state?.source === "state" && state.view !== "missing";
};

/** Identity facts come from decoded JSON or text scalars, never binary presentations or truncated bodies. */
const identityValue = (body: ReplayedBody): JsonValue | undefined => {
  if (body.kind === "json") return body.value;
  if (body.kind === "text") return body.text;
  return undefined;
};

/** The environment's body as the application's is read: a replayed recording of empty text, unlike a JSON empty string, is no body. */
const envBody = (run: ProbeRun, answer: ReplayResult): ReplayedBody => {
  if (fromState(answer)) return { kind: "json", value: answer.body };
  const exchange = run.source.exchanges.get(answer.replay.record_ordinal);
  if (exchange === undefined)
    return answer.body === ""
      ? { kind: "none" }
      : { kind: "json", value: answer.body };
  const body = replayedBody(exchange);
  // Empty replayed text is no body; a JSON empty string remains a JSON value.
  if (body.kind === "text" && body.text === "") return { kind: "none" };
  if (body.kind === "json") return { kind: "json", value: answer.body };
  if (body.kind === "text")
    return {
      kind: "text",
      text: typeof answer.body === "string" ? answer.body : body.text,
    };
  if (body.kind === "base64")
    return {
      ...body,
      encoded: typeof answer.body === "string" ? answer.body : body.encoded,
      whole: body.whole && !answer.replay.truncated,
    };
  if (body.kind === "cut")
    return {
      kind: "cut",
      text: typeof answer.body === "string" ? answer.body : body.text,
    };
  return body;
};

/**
 * Whether the environment answered this call itself: from its state, or from a recording of exactly this call, every
 * recorded query value supplied and the body it sent, rather than replaying another call's recording.
 */
const answersCall = (
  run: ProbeRun,
  call: ProbeToolCall,
  args: Readonly<Record<string, JsonValue>>,
  answer: ReplayResult,
): boolean => {
  if (fromState(answer)) return true;
  const exchange = run.source.exchanges.get(answer.replay.record_ordinal);
  if (
    !answer.replay.exact_match ||
    exchange === undefined ||
    !selectsRecordedLine(call.tool, exchange, args)
  )
    return false;
  const body = probeArguments(call.tool, run.bodies).body;
  // A tool with no body parameter matches; one that takes a body matches only the body this call sent, including none.
  if (body === undefined) return true;
  return same(run.recordedBodies.get(exchange.ordinal), ownMember(args, body));
};

/** A served tool's input check: the first problem with a call's arguments, or undefined. */
type InputCheck = (args: ReplayArguments) => string | undefined;

/** The input schema check the MCP server applies before a served tool answers, so a call it refuses is not compared as answered. */
const inputCheck = (definition: EnvironmentToolDefinition): InputCheck => {
  const schema = fromJsonSchema<ReplayArguments>(definition.inputSchema)[
    "~standard"
  ];
  return (args) => {
    const checked = schema.validate(args);
    return checked instanceof Promise
      ? undefined
      : checked.issues?.[0]?.message;
  };
};

interface ProbeRun {
  readonly source: EnvironmentSource;
  /** The request body of each capture record, by ordinal, that a replayed answer's call is compared with. */
  readonly recordedBodies: ReadonlyMap<number, JsonValue | undefined>;
  readonly answer: EnvironmentToolAnswer;
  readonly store: EnvironmentStateStore | undefined;
  /** The tools the environment offers, by name, with their input checks. */
  readonly served: ReadonlyMap<string, InputCheck>;
  /** The served tools that take a body their method does not, as a bulk delete names its entities. */
  readonly bodies: ReadonlySet<string>;
  readonly map: IdMap;
  readonly normalised: Normalised;
}

const heldIds = (
  store: EnvironmentStateStore | undefined,
): ReadonlySet<string> =>
  new Set(
    store?.snapshot().rea_state.entities.map((entity) => entity.id) ?? [],
  );

const stepOf = (
  base: Pick<CompareStep, "ordinal" | "method" | "path" | "live_status">,
  call: ProbeToolCall | undefined,
  outcome: { env_status: number | null; differences: Difference[] },
): CompareStep => {
  const categories = [...new Set(outcome.differences.map((d) => d.category))];
  return {
    ...base,
    tool: call?.tool.name ?? null,
    env_status: outcome.env_status,
    equal: outcome.differences.length === 0,
    equal_ignoring_order: outcome.differences.every(
      (difference) => difference.category === "order",
    ),
    categories,
    differences: outcome.differences.slice(0, STEP_DIFFERENCE_LIMIT),
    ignored_query: [...(call?.ignoredQuery ?? [])],
  };
};

/** Answer one probe request as the environment would and compare it with the application's answer; one without an answer is only made. */
const compareStep = (
  run: ProbeRun,
  manifest: EnvironmentSource["manifest"],
  probe: ProbeStep,
): CompareStep | undefined => {
  const { request, live } = probe;
  const base = {
    ordinal: probe.ordinal,
    method: request.method,
    path: request.path,
    live_status: live?.status ?? null,
  };
  const report = (
    call: ProbeToolCall | undefined,
    outcome: { env_status: number | null; differences: Difference[] },
  ): CompareStep | undefined =>
    live === undefined ? undefined : stepOf(base, call, outcome);
  // Matched in the environment's terms, so a tool whose path holds a seeded id literally still matches. Scopes and
  // literals come from the live path: translating a parent id first would name a different collection than learning did.
  const liveSegments = request.path.slice(1).split("/");
  const fitted = matchProbeRequest(manifest, request, run.bodies);
  const scopes =
    fitted === undefined
      ? undefined
      : parameterScopes(fitted.tool, liveSegments);
  const literals =
    fitted === undefined ? undefined : literalPositions(fitted.tool);
  const path = translatePath(
    request.path,
    run.map,
    (index) => scopes?.get(index),
    (index) => literals?.has(index) === true,
  );
  const call = matchProbeRequest(manifest, { ...request, path }, run.bodies);
  if (call === undefined)
    return report(call, {
      env_status: null,
      differences: [{ category: "no-tool", pointer: "" }],
    });
  const check = run.served.get(call.tool.name);
  if (check === undefined)
    return report(call, {
      env_status: null,
      differences: [{ category: "not-served", pointer: "" }],
    });
  const held = heldIds(run.store);
  const unknownPath = call.pathArguments.some((name) => {
    const value = ownMember(call.args, name);
    if (typeof value !== "string") return false;
    const id = decodedSegment(value);
    return !run.map.hasEnv(id) && !held.has(id);
  });
  const refusedWith = (message: string): CompareStep | undefined =>
    report(call, {
      env_status: null,
      differences: [
        { category: "refused", pointer: "", env: message.slice(0, 200) },
      ],
    });
  const bulk = bulkIds(run, call, liveSegments);
  const args = environmentArguments(call, run.map, bulk);
  const problem = check(args);
  if (problem !== undefined)
    return refusedWith(`Invalid arguments: ${problem}`);
  const answered = run.answer(call.tool, args, call.observedQuery);
  if (!answered.ok) return refusedWith(answered.error.message);
  if (live === undefined) return undefined;
  const env: Answer = {
    status: answered.value.status,
    body: envBody(run, answered.value),
  };
  const entity = entityOf(run, call.tool, liveSegments, answered.value);
  // Another call's recording holds other entities, whose ids would map wrongly and, the first pairing winning, for good.
  if (answersCall(run, call, args, answered.value))
    learnIds(identityValue(live.body), identityValue(env.body), run.map, {
      heldIds: heldIds(run.store),
      scope: entity.scope,
      entityAt: entity.at,
      identity: entity.identity,
    });
  const compared = compareAnswers(live, env, run.map, entity);
  for (const key of NORMALISED_KEYS)
    run.normalised[key] += compared.normalised[key];
  const differences = [...compared.differences];
  if (unknownPath && isSuccess(live.status) && !isSuccess(env.status))
    differences.unshift({ category: "unmapped-id", pointer: "" });
  return stepOf(base, call, { env_status: env.status, differences });
};

const probeReport = (
  probe: { readonly label: string; readonly evidenceId: string },
  run: ProbeRun,
  results: CompareStep[],
  unobserved: UnobservedRecord[],
): CompareProbeReport => ({
  label: probe.label,
  evidence_id: probe.evidenceId,
  steps: results.length,
  equal: results.filter((step) => step.equal).length,
  ids_mapped: run.map.size,
  id_conflicts: run.map.conflicts,
  normalised: run.normalised,
  results,
  unobserved,
});

const summaryOf = (
  probes: readonly CompareProbeReport[],
): CompareReport["summary"] => {
  const steps = probes.flatMap((probe) => probe.results);
  const categories = Object.fromEntries(
    DIFFERENCE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<DifferenceCategory, number>;
  for (const step of steps)
    for (const category of step.categories) categories[category] += 1;
  const equal = steps.filter((step) => step.equal).length;
  const ratio = (count: number): number | null =>
    steps.length === 0
      ? null
      : Math.round((count / steps.length) * 1000) / 1000;
  const normalised = emptyNormalised();
  for (const probe of probes)
    for (const key of NORMALISED_KEYS) normalised[key] += probe.normalised[key];
  return {
    probes: probes.length,
    steps: steps.length,
    equal,
    agreement: ratio(equal),
    agreement_ignoring_order: ratio(
      steps.filter((step) => step.equal_ignoring_order).length,
    ),
    unobserved: probes.reduce((sum, probe) => sum + probe.unobserved.length, 0),
    categories,
    normalised,
  };
};

const toolsOf = (
  probes: readonly CompareProbeReport[],
): CompareReport["tools"] => {
  const tools = new Map<
    string,
    { tool: string; steps: number; equal: number }
  >();
  for (const step of probes.flatMap((probe) => probe.results)) {
    if (step.tool === null) continue;
    const entry = tools.get(step.tool) ?? {
      tool: step.tool,
      steps: 0,
      equal: 0,
    };
    entry.steps += 1;
    if (step.equal) entry.equal += 1;
    tools.set(step.tool, entry);
  }
  return [...tools.values()].sort(
    (left, right) =>
      left.equal / left.steps - right.equal / right.steps ||
      (left.tool < right.tool ? -1 : 1),
  );
};

/** Compare an environment with probe captures of the application: each probe from a reset state, every request answered and compared. */
export const compareEnvironment = (input: {
  readonly source: EnvironmentSource;
  readonly captureValue: unknown;
  readonly probes: readonly CompareProbeInput[];
  readonly operation: string;
}): Result<CompareReport, AnalysisError> => {
  const { source, operation } = input;
  const state = prepareServedState(source, input.captureValue, {
    operation,
  }).state;
  const catalog = servedCatalog(source, state, source.manifest.name, operation);
  if (!catalog.ok) return catalog;
  const served = new Map(
    catalog.value.tools.map((definition) => [
      definition.name,
      inputCheck(definition),
    ]),
  );
  const bodies = bodyTools(catalog.value.tools);
  const recorded = parseCaptureEvidence(
    operation,
    input.captureValue,
    "manifest",
  );
  const recordedBodies = new Map(
    recorded.ok
      ? recorded.value.records.map((record) => [
          record.ordinal,
          requestBody(record),
        ])
      : [],
  );
  const probes: CompareProbeReport[] = [];
  for (const [index, probe] of input.probes.entries()) {
    // A probe's request bodies are its call arguments, which a replay projection of a browser capture drops.
    const capture = parseCaptureEvidence(operation, probe.value, "manifest");
    // Without response bodies only statuses would compare, and without request bodies writes would be made empty.
    const problem = !capture.ok
      ? capture.error.message
      : !capture.value.responseBodies
        ? "a browser probe needs capture.network.response_body selected, or only statuses would compare."
        : !capture.value.requestBodies && sendsBodies(capture.value.records)
          ? "a browser probe that makes POST, PUT or PATCH calls needs capture.network.request_body selected, or those calls would be made without their bodies."
          : undefined;
    if (!capture.ok || problem !== undefined)
      return err(
        inputError(
          operation,
          [
            {
              path: ["probe", index],
              reason: "invalid_value",
              message: `${probe.label}: ${problem}`,
            },
          ],
          "A probe file cannot be compared.",
        ),
      );
    const store =
      state === undefined ? undefined : new EnvironmentStateStore(state);
    const run: ProbeRun = {
      source,
      recordedBodies,
      answer: environmentToolAnswer(source, store),
      store,
      served,
      bodies,
      map: new IdMap(),
      normalised: emptyNormalised(),
    };
    const { steps, unobserved } = probeRequests(capture.value.records);
    const results = steps.flatMap(
      (step) => compareStep(run, source.manifest, step) ?? [],
    );
    probes.push(
      probeReport(
        { label: probe.label, evidenceId: capture.value.evidenceId },
        run,
        results,
        unobserved,
      ),
    );
  }
  return ok({
    status: "complete",
    environment: {
      name: source.manifest.name,
      manifest_evidence_id: source.manifestEvidenceId,
      evidence_id: source.evidenceId,
      state: state === undefined ? "replay-only" : "served",
    },
    summary: summaryOf(probes),
    tools: toolsOf(probes),
    probes,
  });
};
