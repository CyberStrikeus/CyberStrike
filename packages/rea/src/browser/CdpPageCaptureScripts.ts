import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import {
  createCapturedWebScriptReconciler,
  stableWebScriptKey,
} from "../domain/webInventory.js";
import type { CapturedResource } from "./CdpCaptureDocuments.js";
import type { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import type { CapturedScript } from "./CdpCaptureEventTypes.js";
import { sourceExcluded } from "./CdpCaptureValues.js";
import { capturePassiveCdpScriptSource } from "./CdpScriptSourceCapture.js";
import type { CaptureContext } from "./CdpPageCapture.js";
import type { WebSourceMapRequest } from "./WebSourceMapFetcher.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { selectedCdpCommandTimeoutMs } from "../domain/browserDeadline.js";
import { CdpScriptSourceBudget } from "./CdpScriptSourceBudget.js";

export interface CapturedScripts {
  readonly inventory: WebPageInspection["scripts"];
  readonly sourceMapRequests: readonly WebSourceMapRequest[];
}

export interface CapturedScriptSnapshot extends CapturedScripts {
  readonly scriptIds: ReadonlySet<string>;
}

export interface CaptureScriptsOptions {
  readonly context: CaptureContext;
  readonly events: CdpCaptureEvents;
  readonly rawResources: readonly CapturedResource[];
  readonly resources: WebPageInspection["resources"];
  readonly frameIds: ReadonlySet<string>;
}

interface ScriptDraftState {
  readonly context: CaptureContext;
  readonly events: CdpCaptureEvents;
  readonly frameIds: ReadonlySet<string>;
  readonly reconcileResource: ReturnType<
    typeof createCapturedWebScriptReconciler
  >;
}

type ScriptDraftItem = Omit<
  WebPageInspection["scripts"]["items"][number],
  "script_key"
>;

export const captureScripts = async (
  options: CaptureScriptsOptions,
): Promise<CapturedScriptSnapshot> => {
  const { context, events, rawResources, resources, frameIds } = options;
  let state: ScriptDraftState | undefined;
  const drafts: {
    readonly item: ScriptDraftItem;
    readonly sourceMapRawUrl: string | null;
  }[] = [];
  const scripts = new Map(events.scripts);
  const commandTimeoutMs = selectedCdpCommandTimeoutMs(
    context.input.command_timeout_ms,
  );
  const sourceBudget =
    context.input.include_script_sources && scripts.size > 0
      ? new CdpScriptSourceBudget(context.signal, commandTimeoutMs)
      : undefined;
  try {
    for (const script of scripts.values()) {
      state ??= {
        context,
        events,
        frameIds,
        reconcileResource: createCapturedWebScriptReconciler(
          rawResources,
          resources,
        ),
      };
      const source =
        sourceBudget === undefined
          ? sourceExcluded("source capture was not selected")
          : await capturePassiveCdpScriptSource({
              connection: context.connection,
              sessionId: context.sessionId,
              signal: context.signal,
              operation: context.operation,
              scriptId: script.scriptId,
              sourceBudget,
              completeness: events.completeness,
            });
      drafts.push(buildScriptDraft(script, state, source));
    }
  } finally {
    sourceBudget?.dispose();
  }
  if (!context.input.include_script_sources)
    events.completeness.exclude("script_sources", "not_approved", scripts.size);
  return {
    ...keyAndBuildInventory(drafts, scripts.size),
    scriptIds: new Set(scripts.keys()),
  };
};

/** Settle once after the last CDP read, before normalizing completeness. */
export const finalizeScriptInventory = (
  snapshot: CapturedScriptSnapshot,
  events: CdpCaptureEvents,
): WebPageInspection["scripts"] => {
  let lateCount = 0;
  for (const scriptId of events.scripts.keys())
    if (!snapshot.scriptIds.has(scriptId)) lateCount += 1;
  if (lateCount > 0) events.completeness.drop("scripts", lateCount);
  return { ...snapshot.inventory, total: snapshot.inventory.total + lateCount };
};

const buildScriptDraft = (
  script: CapturedScript,
  state: ScriptDraftState,
  source: WebPageInspection["scripts"]["items"][number]["source"],
): {
  readonly item: ScriptDraftItem;
  readonly sourceMapRawUrl: string | null;
} => {
  const inventoryScript = {
    frame_id: state.events.frameForScript(script, state.frameIds),
    url: script.url,
    cdp_hash: script.hash,
    length: script.length,
    is_module: script.isModule,
    language: script.language,
    source_map_url: script.sourceMapUrl,
  };
  return {
    item: {
      ...inventoryScript,
      origin: script.origin,
      resource_reconciliation: state.reconcileResource({
        ...inventoryScript,
        rawUrl: script.rawUrl,
      }),
      source,
    },
    sourceMapRawUrl: script.sourceMapRawUrl,
  };
};

const keyAndBuildInventory = (
  drafts: readonly {
    readonly item: ScriptDraftItem;
    readonly sourceMapRawUrl: string | null;
  }[],
  scriptCount: number,
): CapturedScripts => {
  const keyed = drafts.map((draft) => ({
    ...draft,
    base: stableWebScriptKey(draft.item),
  }));
  keyed.sort(
    (left, right) =>
      compareUnicodeCodePoints(left.base, right.base) ||
      compareUnicodeCodePoints(
        sourceDigest(left.item.source),
        sourceDigest(right.item.source),
      ) ||
      compareUnicodeCodePoints(
        left.item.frame_id ?? "",
        right.item.frame_id ?? "",
      ),
  );
  const totals = new Map<string, number>();
  for (const { base } of keyed) totals.set(base, (totals.get(base) ?? 0) + 1);
  const seen = new Map<string, number>();
  const sourceMapRequests: WebSourceMapRequest[] = [];
  const items = keyed.map(({ base, item, sourceMapRawUrl }) => {
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const scriptKey =
      totals.get(base) === 1 ? base : `${base}_${String(occurrence)}`;
    if (item.source_map_url !== null && sourceMapRawUrl !== null)
      sourceMapRequests.push({
        scriptKey,
        declaredUrl: item.source_map_url,
        fetchUrl: sourceMapRawUrl,
      });
    return { script_key: scriptKey, ...item };
  });
  return {
    inventory: { total: scriptCount, items },
    sourceMapRequests,
  };
};

const sourceDigest = (
  source: WebPageInspection["scripts"]["items"][number]["source"],
): string => (source.included ? source.artifact.sha256 : source.reason);
