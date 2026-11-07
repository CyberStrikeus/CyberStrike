import type { Evidence } from "../evidence.js";
import type { FunctionDossier } from "../native/functionDossier.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { normalizeCfg } from "../functionComparisonNormalization.js";
import { hasStableNativeSymbol } from "./nativeSymbol.js";
import { assessFunctionCallCoverage } from "../functionCallCoverage.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";

/** An observed structural signature proposes candidates; it never proves identity. */
export const functionStructuralCandidate = (
  evidence: Evidence,
  dossier: FunctionDossier,
): string | null => {
  if (
    evidence.subject?.architecture == null ||
    dossier.facet_availability?.cfg?.available !== true ||
    dossier.facet_availability?.callees?.available !== true ||
    dossier.facet_availability?.strings_names?.available !== true ||
    dossier.unresolved_calls === undefined ||
    assessFunctionCallCoverage(evidence.relationship_coverage, dossier).blockers
      .length > 0 ||
    (dossier.swift_string_literal_omissions?.length ?? 0) > 0 ||
    evidence.analysis_profile === null
  )
    return null;
  const cfg = normalizeCfg(dossier.basic_blocks);
  if (
    cfg === null ||
    cfg.length === 0 ||
    dossier.callees.some(
      (callee) => !hasStableNativeSymbol(callee.name, callee.symbol),
    )
  )
    return null;
  const calls = dossier.callees
    .map((callee) => callee.name)
    .sort(compareUnicodeCodePoints);
  const strings = [
    ...dossier.referenced_strings.map((value) => value.value),
    ...(dossier.swift_string_literals ?? []).map((value) => value.value),
  ].sort(compareUnicodeCodePoints);
  // Empty leaf functions otherwise produce huge uninformative CFG-only buckets.
  if (calls.length === 0 && strings.length === 0) return null;
  return digestCanonicalValue({
    algorithm: "observed-cfg-calls-strings-v1",
    profile: evidence.analysis_profile.digest,
    architecture: evidence.subject.architecture,
    cfg,
    calls,
    strings,
  });
};
