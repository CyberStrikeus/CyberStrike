import type { AsarHeaderAdmission } from "../config/asarHeaderAdmission.js";
import type {
  ElectronPageInspection,
  InspectElectronPageInput,
} from "../domain/javascript/electronObservation.js";
import type { CdpConnection } from "./CdpConnection.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import { recordValue } from "./CdpCaptureValues.js";
import type { CdpEndpointTarget } from "./CdpEndpoint.js";
import { optionalCdpCommand } from "./CdpOptionalCommand.js";
import { authorizedElectronFile } from "./ElectronFileScope.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import {
  parseCdpWorkerTarget,
  workerTargetOwnership,
} from "./CdpWorkerTarget.js";

/** Inventory local worker targets without attaching to them. */
export const captureElectronWorkers = async (input: {
  readonly connection: CdpConnection;
  readonly signal?: AbortSignal;
  readonly target: CdpEndpointTarget;
  readonly request: InspectElectronPageInput;
  readonly frameIds: ReadonlySet<string>;
  readonly completeness: CdpCaptureCompleteness;
  readonly limitations: string[];
  readonly asarHeaderAdmission: AsarHeaderAdmission;
}): Promise<ElectronPageInspection["workers"]> => {
  const result = await optionalCdpCommand(
    {
      connection: input.connection,
      sessionId: undefined,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
    "Target.getTargets",
    {},
    input.limitations,
  );
  if (result === undefined) {
    input.completeness.unavailable("workers");
    return [];
  }
  const workers: ElectronPageInspection["workers"] = [];
  // A missing target list or a non-record entry is unreadable, not empty.
  const targetInfos = recordValue(result)?.targetInfos;
  if (!Array.isArray(targetInfos)) {
    input.completeness.exclude("workers", "invalid_protocol_value", null);
    return [];
  }
  for (const entry of targetInfos) {
    throwIfElectronWorkerCaptureCancelled(input.signal);
    const parsed = parseCdpWorkerTarget(entry);
    if (!parsed.ok) {
      input.completeness.exclude("workers", "invalid_protocol_value");
      continue;
    }
    const target = parsed.value;
    if (target.kind === "non_worker") continue;
    const ownership = workerTargetOwnership(
      target,
      input.target.id,
      input.frameIds,
    );
    if (ownership !== "selected") {
      input.completeness.exclude(
        "workers",
        ownership === "unknown" ? "unattributed_target" : "out_of_target_scope",
      );
      continue;
    }
    const path = await authorizedElectronFile(
      target.url,
      input.signal,
      "inspect_electron_page",
      input.asarHeaderAdmission,
    );
    if (path === undefined) {
      input.completeness.exclude("workers", "out_of_target_scope");
      continue;
    }
    workers.push({
      target_id: target.targetId,
      type: target.type,
      file_path: path,
      attached: target.attached,
      opener_target_id: target.openerTargetId,
      parent_frame_id: target.parentFrameId,
    });
  }
  return workers.sort((left, right) =>
    compareUnicodeCodePoints(left.target_id, right.target_id),
  );
};

const throwIfElectronWorkerCaptureCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError("inspect_electron_page", {
      cause: signal.reason,
    });
};
