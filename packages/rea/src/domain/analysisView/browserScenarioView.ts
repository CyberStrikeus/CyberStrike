import type { z } from "zod";
import type { AnalysisError } from "../analysisErrorBase.js";
import {
  retainedBrowserScenarioCaptureSchema,
  type RetainedBrowserScenarioCapture as BrowserScenarioCapture,
} from "../browserScenarioCapture.js";
import type { BrowserScenarioStep as Step } from "../browserScenarioCaptureValues.js";
import { compareAsciiStrings } from "../canonicalOrdering.js";
import { err, ok } from "../result.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import {
  completeWithinViewCoverage,
  pageViewCoverage,
  type AnalysisViewCoverage,
} from "./analysisViewCoverage.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  ARTIFACT_SECTIONS,
  stepRowSchema,
  browserScenarioSummarySchema,
  stepSectionsSchema,
  summaryStepSchema,
  focusAccessibilitySchema,
  browserScenarioViewItemsSchema,
  type BrowserScenarioViewRequest,
  type ArtifactSection,
} from "./browserScenarioViewSchemas.js";

import {
  browserScenarioTransactionGroups,
  summarizeBrowserScenarioNetwork,
} from "./browserScenarioNetworkView.js";

const OPERATION = "capture_browser_scenario" as const;
const readCapture = createAnalysisViewResultReader(
  retainedBrowserScenarioCaptureSchema,
);

const unsupportedView = (): AnalysisError =>
  analysisViewInputError([
    {
      path: ["view"],
      reason: "invalid_value",
      message:
        'Parent Evidence operation "capture_browser_scenario" supports summary and browser-scenario views, plus compatible environment views.',
    },
  ]);

const sameUrl = (
  left: Step["after_url"] | undefined,
  right: Step["before_url"],
): boolean =>
  left !== undefined &&
  left.url === right.url &&
  left.redacted === right.redacted;

const stepSections = (step: Step): z.infer<typeof stepSectionsSchema> => {
  const sections: z.infer<typeof stepSectionsSchema> = {
    captured: [],
    missing: [],
    truncated: [],
  };
  for (const section of ARTIFACT_SECTIONS) {
    const { state } = step.artifacts[section];
    if (state !== "not_requested") sections[state].push(section);
  }
  return sections;
};

const summaryStep = (
  step: Step,
  previous: Step | undefined,
): z.infer<typeof summaryStepSchema> => ({
  step_index: step.step_index,
  step_id: step.step_id,
  action: step.action,
  status: step.status,
  error: step.error,
  elapsed_ms: step.elapsed_ms,
  ...(sameUrl(previous?.after_url, step.before_url)
    ? {}
    : { before_url: step.before_url }),
  after_url: step.after_url,
  events: {
    sequence_start: step.event_sequence_start,
    sequence_end: step.event_sequence_end,
  },
  sections: stepSections(step),
  completeness: step.completeness.status,
});

/** The first unsuccessful step explains a failure; otherwise the final screen does. */
const focusAccessibility = (
  steps: readonly Step[],
): z.infer<typeof focusAccessibilitySchema> => {
  const unsuccessful = steps.findIndex(({ status }) => status !== "completed");
  const focusIndex = unsuccessful === -1 ? steps.length - 1 : unsuccessful;
  const focus = steps[focusIndex];
  if (focus === undefined) throw new Error("Capture has no steps");
  const kind =
    unsuccessful === -1 ? ("last-step" as const) : "first-unsuccessful-step";
  for (let index = focusIndex; index >= 0; index -= 1) {
    const accessibility = steps[index]?.artifacts.accessibility;
    if (accessibility?.state === "captured")
      return {
        focus_step_index: focusIndex,
        focus: kind,
        step_index: index,
        accessibility,
      };
  }
  return {
    focus_step_index: focusIndex,
    focus: kind,
    step_index: null,
    accessibility: focus.artifacts.accessibility,
  };
};

/** Counts in canonical key order; a null origin sorts first. */
const sortedCounts = <Key extends string | null>(
  counts: ReadonlyMap<Key, number>,
): [Key, number][] =>
  [...counts].sort(([left], [right]) =>
    left === right
      ? 0
      : left === null
        ? -1
        : right === null
          ? 1
          : compareAsciiStrings(left, right),
  );

const increment = <Key>(counts: Map<Key, number>, key: Key): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const eventCounts = (
  capture: BrowserScenarioCapture,
): z.infer<typeof browserScenarioSummarySchema>["events"] => {
  const kinds = new Map<
    BrowserScenarioCapture["events"]["items"][number]["kind"],
    number
  >();
  for (const event of capture.events.items) increment(kinds, event.kind);
  const { omissions } = capture.events;
  return {
    retained: capture.events.retained,
    dropped: capture.events.dropped,
    by_kind: sortedCounts(kinds).map(([kind, count]) => ({ kind, count })),
    omissions: {
      by_kind: omissions.by_kind,
      network_transactions: omissions.network_transactions.length,
      network_transaction_range: omissions.network_transaction_range,
    },
  };
};

const selected = <Value>(
  filter: readonly Value[] | undefined,
): ((value: Value) => boolean) => {
  if (filter === undefined) return () => true;
  const values = new Set(filter);
  return (value) => values.has(value);
};

const stepRow = (
  { artifacts: recorded, ...step }: Step,
  selection: ReadonlySet<ArtifactSection>,
): z.infer<typeof stepRowSchema> => {
  const artifacts: z.infer<typeof stepRowSchema>["artifacts"] = {};
  const omitted: z.infer<typeof stepRowSchema>["omitted_artifacts"] = [];
  for (const section of ARTIFACT_SECTIONS) {
    const artifact = recorded[section];
    if (selection.has(section))
      Object.assign(artifacts, { [section]: artifact });
    else if (artifact.state !== "not_requested")
      omitted.push({ section, state: artifact.state });
  }
  return { ...step, artifacts, omitted_artifacts: omitted };
};

/** Scan matching rows once and materialize only the requested page. */
const selectedPage = <Input, Row>(
  source: readonly Input[],
  view: { readonly offset: number; readonly limit: number },
  matches: (item: Input, index: number) => boolean,
  project: (item: Input, index: number) => Row,
): { rows: Row[]; coverage: AnalysisViewCoverage } => {
  const rows: Row[] = [];
  let total = 0;
  for (const [index, item] of source.entries()) {
    if (!matches(item, index)) continue;
    if (total >= view.offset && rows.length < view.limit)
      rows.push(project(item, index));
    total += 1;
  }
  return { rows, coverage: pageViewCoverage(view.offset, rows.length, total) };
};

/** Text offsets are UTF-16 positions in the exact digest-bound retained artifact. */
const textPage = (
  capture: BrowserScenarioCapture,
  view: Extract<BrowserScenarioViewRequest, { collection: "text" }>,
) => {
  const artifact = capture.steps[view.step_index]!.artifacts[view.artifact];
  const value = artifact.state === "captured" ? artifact.value : null;
  const text = value?.text.slice(view.offset, view.offset + view.limit) ?? null;
  return {
    items: {
      collection: "text" as const,
      step_index: view.step_index,
      artifact: view.artifact,
      state: artifact.state,
      reason: "reason" in artifact ? artifact.reason : null,
      sha256: value?.sha256 ?? null,
      bytes: value?.bytes ?? null,
      observed: artifact.state === "truncated" ? artifact.observed : null,
      retained: artifact.state === "truncated" ? artifact.retained : null,
      text,
    },
    coverage: pageViewCoverage(
      view.offset,
      text?.length ?? 0,
      value?.text.length ?? 0,
    ),
  };
};

/** One stable page of exact recorded facts; no whole-result filtering arrays. */
const pageRecords = (
  capture: BrowserScenarioCapture,
  view: BrowserScenarioViewRequest,
): {
  readonly items: z.infer<typeof browserScenarioViewItemsSchema>;
  readonly coverage: AnalysisViewCoverage;
} => {
  if (view.collection === "text") return textPage(capture, view);
  const stepSelected = selected(view.step_indices);
  if (view.collection === "steps") {
    const artifacts = new Set(view.artifacts);
    const page = selectedPage(
      capture.steps,
      view,
      ({ step_index }) => stepSelected(step_index),
      (step) => stepRow(step, artifacts),
    );
    return {
      items: { collection: "steps", rows: page.rows },
      coverage: page.coverage,
    };
  }
  const kindSelected = selected(view.event_kinds);
  const transactionSelected = selected(view.transaction_ids);
  if (view.collection === "transactions") {
    const page = selectedPage(
      browserScenarioTransactionGroups(capture),
      view,
      (group) =>
        transactionSelected(group.transaction_id) &&
        (view.step_indices === undefined ||
          group.source_item_indices.some((index) =>
            stepSelected(capture.events.items[index]!.step_index),
          )),
      (group) => {
        const events: {
          item_index: number;
          event: BrowserScenarioCapture["events"]["items"][number];
        }[] = [];
        const omitted: {
          item_index: number;
          kind: BrowserScenarioCapture["events"]["items"][number]["kind"];
        }[] = [];
        for (const item_index of group.source_item_indices) {
          const event = capture.events.items[item_index]!;
          if (kindSelected(event.kind)) events.push({ item_index, event });
          else omitted.push({ item_index, kind: event.kind });
        }
        return {
          transaction_id: group.transaction_id,
          source_item_indices: [...group.source_item_indices],
          events,
          omitted_events: omitted,
        };
      },
    );
    return {
      items: { collection: "transactions", rows: page.rows },
      coverage: page.coverage,
    };
  }
  const page = selectedPage(
    capture.events.items,
    view,
    (event) =>
      stepSelected(event.step_index) &&
      kindSelected(event.kind) &&
      (view.transaction_ids === undefined ||
        ("transaction_id" in event &&
          transactionSelected(event.transaction_id))),
    (event, item_index) => ({ item_index, event }),
  );
  return {
    items: { collection: "events", rows: page.rows },
    coverage: page.coverage,
  };
};

/** Project retained scenario Evidence without relaunching the browser or replaying actions. */
export const projectBrowserScenarioView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (view.kind !== "summary" && view.kind !== "browser-scenario")
    return err(unsupportedView());
  assertOwnedView<SummaryAnalysisView | BrowserScenarioViewRequest>(
    view,
    "summary",
    "browser-scenario",
  );
  const parsed = readCapture(parent);
  if (!parsed.ok) return parsed;
  const capture = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: OPERATION,
    parent_digest: parent.evidenceId.slice(3),
    artifact: null,
    limitations: [...parent.limitations],
    unknowns: [
      "Step states record one controlled replay; they do not establish the application's current state.",
      "Event step references record receipt attribution; they do not prove an action caused a transaction.",
      ...(capture.events.dropped > 0
        ? [
            `${String(capture.events.dropped)} events were dropped by capture budgets; counts and pages cover retained events only.`,
          ]
        : []),
    ],
  };
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: {
        browser: capture.browser,
        scenario: capture.scenario,
        duration_ms: capture.duration_ms,
        completeness: capture.completeness,
        steps: capture.steps.map((step, index) =>
          summaryStep(step, capture.steps[index - 1]),
        ),
        final_accessibility: focusAccessibility(capture.steps),
        events: eventCounts(capture),
        network: summarizeBrowserScenarioNetwork(capture),
        limitation_count: shared.limitations.length,
      },
      coverage: completeWithinViewCoverage(1, 1),
    });
  if (
    view.collection === "text" &&
    capture.steps[view.step_index] === undefined
  )
    return err(
      analysisViewInputError([
        {
          path: ["view", "step_index"],
          reason: "invalid_value",
          message: "The selected step is not present in the retained capture.",
        },
      ]),
    );
  return ok({
    kind: "browser-scenario" as const,
    view,
    ...shared,
    source_completeness: capture.completeness,
    source_events: {
      retained: capture.events.retained,
      dropped: capture.events.dropped,
    },
    source_network_omissions: {
      transactions: capture.events.omissions.network_transactions.length,
      transaction_range: capture.events.omissions.network_transaction_range,
    },
    ...pageRecords(capture, view),
  });
};
