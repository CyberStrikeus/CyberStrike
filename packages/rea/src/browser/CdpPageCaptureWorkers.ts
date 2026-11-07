import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import type { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import {
  admitRecords,
  allowedSanitizedUrl,
  recordValue,
} from "./CdpCaptureValues.js";
import type { CaptureContext } from "./CdpPageCapture.js";
import { optionalCdpCommand } from "./CdpOptionalCommand.js";
import {
  parseCdpWorkerTarget,
  workerTargetOwnership,
} from "./CdpWorkerTarget.js";
import { exclusionReasonForUrl } from "./CdpCaptureEventHelpers.js";

interface CaptureWorkersInput {
  readonly context: CaptureContext;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly limitations: string[];
  readonly events: CdpCaptureEvents;
}

export const captureWorkers = async (
  input: CaptureWorkersInput,
  frameIds: ReadonlySet<string>,
): Promise<WebPageInspection["workers"]> => {
  const { context, allowedOrigins, limitations, events } = input;
  const completeness = events.completeness;
  // This final target snapshot cannot establish worker lifetimes or observed
  // worker-session activity during the preceding page observation window.
  completeness.attachLimited("workers");
  const result = await optionalCdpCommand(
    { ...context, sessionId: undefined },
    "Target.getTargets",
    {},
    limitations,
  );
  const items: WebPageInspection["workers"] = [];
  if (result === undefined) completeness.unavailable("workers");
  const targets = admitRecords(recordValue(result)?.targetInfos);
  if (result !== undefined && targets === undefined) {
    completeness.exclude("workers", "invalid_protocol_value", null);
    return items;
  }
  let malformedEntries = 0;
  for (const entry of targets ?? []) {
    const parsed = parseCdpWorkerTarget(entry);
    if (!parsed.ok) {
      malformedEntries += 1;
      continue;
    }
    const target = parsed.value;
    if (target.kind === "non_worker") continue;
    const ownership = workerTargetOwnership(
      target,
      context.target.id,
      frameIds,
    );
    if (ownership !== "selected") {
      completeness.exclude(
        "workers",
        ownership === "unknown" ? "unattributed_target" : "out_of_target_scope",
      );
      continue;
    }
    const url = allowedSanitizedUrl(target.url, allowedOrigins);
    if (url === undefined) {
      completeness.exclude("workers", exclusionReasonForUrl(target.url));
      continue;
    }
    items.push({
      target_id: target.targetId,
      type: target.type,
      url: url.url,
      origin: url.origin,
      attached: target.attached,
      opener_target_id: target.openerTargetId,
      parent_frame_id: target.parentFrameId,
    });
  }
  if (malformedEntries > 0)
    completeness.exclude("workers", "invalid_protocol_value", malformedEntries);
  return items;
};
