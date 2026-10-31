import { z } from "zod";

import { BrowserObservationError } from "../domain/browserObservationError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";

const identitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  url: z.string(),
  title: z.unknown().optional(),
  attached: z.unknown().optional(),
  webSocketDebuggerUrl: z.unknown().optional(),
});

const browserSocketIdentitySchema = identitySchema.omit({ id: true }).extend({
  targetId: identitySchema.shape.id,
});

/** Shared discovery facts; socket authority stays with each transport owner. */
export interface CdpDiscoveryTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly title: string;
  readonly attached: boolean | null;
  readonly webSocketDebuggerUrl: unknown;
}

/** A malformed optional field cannot erase valid sibling target identities. */
export const parseCdpDiscoveryTargets = (
  input: unknown,
  operation: BrowserObservationOperation,
  source: "http" | "browser-socket" = "http",
): {
  readonly targets: readonly CdpDiscoveryTarget[];
  readonly ambiguousTargetIds: readonly string[];
  readonly limitations: readonly string[];
} => {
  const label = source === "http" ? "CDP /json/list" : "CDP Target.getTargets";
  if (!Array.isArray(input))
    throw new BrowserObservationError(operation, "invalid_endpoint_response", {
      detail: `${label} must return an array of target rows.`,
    });
  const schema =
    source === "browser-socket" ? browserSocketIdentitySchema : identitySchema;
  const targets: CdpDiscoveryTarget[] = [];
  const limitations: string[] = [];
  const idCounts = new Map<string, number>();
  for (const row of input) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const id: unknown = Reflect.get(row, source === "http" ? "id" : "targetId");
    if (typeof id === "string" && id !== "")
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const ambiguousTargetIds: string[] = [];
  for (const [id, count] of idCounts) {
    if (count > 1) {
      ambiguousTargetIds.push(id);
      limitations.push(
        `${label} reported target ID ${id} in ${String(count)} rows; its identity is ambiguous and cannot be selected.`,
      );
    }
  }
  for (const [index, row] of input.entries()) {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      limitations.push(
        `${label} row ${String(index)} was excluded because its target identity is malformed: ${JSON.stringify(parsed.error.issues)}.`,
      );
      continue;
    }
    const target = parsed.data;
    const id = "targetId" in target ? target.targetId : target.id;
    if (
      target.attached !== undefined &&
      target.attached !== null &&
      typeof target.attached !== "boolean"
    )
      limitations.push(
        `${label} row ${String(index)} target ${id} reported malformed attached metadata ${JSON.stringify(target.attached)}; attachment state is unknown.`,
      );
    if (target.title !== undefined && typeof target.title !== "string")
      limitations.push(
        `${label} row ${String(index)} target ${id} reported malformed title metadata ${JSON.stringify(target.title)}; title is unavailable.`,
      );
    targets.push({
      id,
      type: target.type,
      url: target.url,
      title: typeof target.title === "string" ? target.title : "",
      attached: typeof target.attached === "boolean" ? target.attached : null,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    });
  }
  return { targets, limitations, ambiguousTargetIds };
};

/** Select only an unambiguous identity before applying target-location policy. */
export const selectCdpDiscoveryTarget = <
  Target extends { readonly id: string },
>(
  targets: readonly Target[],
  targetId: string,
  operation: BrowserObservationOperation,
  ambiguousTargetIds: readonly string[] = [],
): Target | undefined => {
  const matches = targets.filter((target) => target.id === targetId);
  if (matches.length > 1 || ambiguousTargetIds.includes(targetId))
    throw new BrowserObservationError(operation, "invalid_endpoint_response", {
      detail: `Target ID ${targetId} is ambiguous in endpoint discovery; REA cannot select its identity or location.`,
      diagnostics: { target_id: targetId },
      remediationAction:
        "Refresh discovery after the endpoint reports a unique row for this target ID, or select a different target.",
    });
  return matches[0];
};
