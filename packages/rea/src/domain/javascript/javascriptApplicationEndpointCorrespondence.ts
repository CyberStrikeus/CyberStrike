import { compositeKey } from "../unicodeCodePointOrder.js";
import { canonicalJson } from "../comparisonSemantics.js";
import type { ApplicationNode } from "./javascriptApplicationGraphSchemas.js";
import type { ApplicationGraphEvidence } from "./javascriptApplicationEvidenceSchemas.js";

/** Endpoint target identity stays distinct from correspondence of unresolved syntax. */
export interface ApplicationEndpointCorrespondence {
  readonly endpointKind: string | null;
  readonly targetResolution: "exact" | "unresolved";
  readonly semanticKey: string | null;
}

/** Consume retained producer facts without treating expression text as a target. */
export const applicationEndpointCorrespondence = (
  node: ApplicationNode,
): ApplicationEndpointCorrespondence => {
  const kinds = new Set<string>();
  const keys = new Set<string>();
  let exact = node.observations.length > 0;
  let keyUnavailable = false;
  let kindUnavailable = node.observations.length === 0;
  for (const { properties, evidence } of node.observations) {
    const kind = properties.endpoint_kind;
    const value = properties.value;
    const interpretation =
      properties.interpretation === undefined
        ? "literal"
        : properties.interpretation;
    const resolution =
      properties.resolution === undefined ? "complete" : properties.resolution;
    if (typeof kind !== "string" || kind === "") {
      kindUnavailable = true;
      keyUnavailable = true;
      exact = false;
      continue;
    }
    kinds.add(kind);
    if (evidence.state === "unknown" || evidence.state === "unavailable") {
      exact = false;
      keyUnavailable = true;
      continue;
    }
    if (
      typeof value !== "string" ||
      (interpretation !== "literal" && interpretation !== "candidate") ||
      (resolution !== "complete" && resolution !== "partial")
    ) {
      exact = false;
      keyUnavailable = true;
      continue;
    }
    if (resolution === "complete" && interpretation === "literal") {
      keys.add(compositeKey([kind, "exact", value]));
      continue;
    }
    exact = false;
    const sourceSite = sourceSiteKey(evidence.location);
    if (sourceSite === null) {
      keyUnavailable = true;
      continue;
    }
    keys.add(
      compositeKey([
        kind,
        "source-site",
        interpretation,
        resolution,
        value,
        sourceSite,
      ]),
    );
  }
  return {
    endpointKind: kindUnavailable ? null : uniqueIdentity(kinds),
    targetResolution: exact && keys.size === 1 ? "exact" : "unresolved",
    semanticKey: keyUnavailable ? null : uniqueIdentity(keys),
  };
};

const uniqueIdentity = (values: ReadonlySet<string>): string | null =>
  values.size === 1 ? (values.values().next().value ?? null) : null;

const sourceSiteKey = (
  location: ApplicationGraphEvidence["location"],
): string | null =>
  location.available && location.value.kind === "source-range"
    ? canonicalJson(location.value)
    : null;
