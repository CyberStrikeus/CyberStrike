import { err, ok, type Result } from "../domain/result.js";
import { cdpStringValue, recordValue } from "./CdpCaptureValues.js";

export interface CdpWorkerRelationships {
  readonly openerTargetId: string | null;
  readonly parentFrameId: string | null;
}

export interface CdpWorkerTarget extends CdpWorkerRelationships {
  readonly kind: "worker";
  readonly targetId: string;
  readonly type: string;
  readonly url: string;
  readonly attached: boolean;
}

/** Admit protocol facts before either consumer applies target or URL policy. */
export const parseCdpWorkerTarget = (
  input: unknown,
): Result<
  CdpWorkerTarget | { readonly kind: "non_worker" },
  { readonly _tag: "InvalidWorkerTarget" }
> => {
  const target = recordValue(input);
  const type = cdpStringValue(target?.type);
  if (target === undefined || type === undefined || type === "")
    return err({ _tag: "InvalidWorkerTarget" });
  if (!type.includes("worker")) return ok({ kind: "non_worker" });
  const targetId = cdpStringValue(target.targetId);
  const url = cdpStringValue(target.url);
  const openerTargetId = cdpStringValue(target.openerId);
  const parentFrameId = cdpStringValue(target.parentFrameId);
  if (
    targetId === undefined ||
    targetId === "" ||
    url === undefined ||
    typeof target.attached !== "boolean" ||
    (target.openerId !== undefined &&
      (openerTargetId === undefined || openerTargetId === "")) ||
    (target.parentFrameId !== undefined &&
      (parentFrameId === undefined || parentFrameId === ""))
  )
    return err({ _tag: "InvalidWorkerTarget" });
  return ok({
    kind: "worker",
    targetId,
    type,
    url,
    attached: target.attached,
    openerTargetId: openerTargetId ?? null,
    parentFrameId: parentFrameId ?? null,
  });
};

/** Optional CDP relationships establish ownership only when supplied. */
export const workerTargetOwnership = (
  relationships: CdpWorkerRelationships,
  selectedTargetId: string,
  frameIds: ReadonlySet<string>,
): "selected" | "foreign" | "unknown" => {
  const { openerTargetId, parentFrameId } = relationships;
  if (
    openerTargetId === selectedTargetId ||
    (parentFrameId !== null && frameIds.has(parentFrameId))
  )
    return "selected";
  return openerTargetId === null && parentFrameId === null
    ? "unknown"
    : "foreign";
};
