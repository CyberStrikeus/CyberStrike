import type {
  ReconstructionObligation,
  ReconstructionObligationManifest,
} from "../domain/reconstructionObligationLedgerSchemas.js";
import type { Evidence } from "../domain/evidence.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

type Diagnostic = ReconstructionObligation["diagnostics"][number];
type Binding = NonNullable<ReconstructionObligation["binding"]>;
type Contradiction = ReconstructionObligationManifest["contradictions"][number];

export const groupManifestBindings = (
  manifest: ReconstructionObligationManifest,
): ReadonlyMap<string, readonly Binding[]> => {
  const grouped = new Map<string, Binding[]>();
  for (const binding of manifest.bindings)
    grouped.set(binding.obligation_id, [
      ...(grouped.get(binding.obligation_id) ?? []),
      binding,
    ]);
  return grouped;
};

export const groupManifestContradictions = (
  manifest: ReconstructionObligationManifest,
): ReadonlyMap<string, readonly Contradiction[]> => {
  const grouped = new Map<string, Contradiction[]>();
  for (const contradiction of manifest.contradictions)
    grouped.set(contradiction.obligation_id, [
      ...(grouped.get(contradiction.obligation_id) ?? []),
      contradiction,
    ]);
  return grouped;
};

export const addObligationDiagnostic = (
  diagnostics: Diagnostic[],
  code: Diagnostic["code"],
  detail: string,
): void => {
  diagnostics.push({ code, detail });
};

export const uniqueObligationDiagnostics = (
  diagnostics: readonly Diagnostic[],
): Diagnostic[] =>
  [
    ...new Map(
      diagnostics.map((diagnostic) => [
        `${diagnostic.code}:${diagnostic.detail}`,
        diagnostic,
      ]),
    ).values(),
  ].sort((left, right) =>
    compareUnicodeCodePoints(
      `${left.code}:${left.detail}`,
      `${right.code}:${right.detail}`,
    ),
  );

export const contradictionDiagnostics = (
  obligationId: string,
  contradictions: ReadonlyMap<string, readonly Contradiction[]>,
  evidenceById: ReadonlyMap<string, Evidence>,
): Diagnostic[] => {
  // Each manifest entry is a separate claim. Absent Evidence leaves only its
  // own entry unestablished; it must not hide a sibling whose Evidence exists.
  const entries = contradictions.get(obligationId) ?? [];
  const missing = new Set(
    entries.flatMap(({ evidence_ids: ids }) =>
      ids.filter((evidenceId) => !evidenceById.has(evidenceId)),
    ),
  );
  const diagnostics: Diagnostic[] = [];
  if (missing.size > 0)
    addObligationDiagnostic(
      diagnostics,
      "contradiction-evidence-missing",
      `Contradiction references missing Evidence: ${[...missing].join(", ")}.`,
    );
  if (
    entries.some(({ evidence_ids: ids }) =>
      ids.every((evidenceId) => evidenceById.has(evidenceId)),
    )
  )
    addObligationDiagnostic(
      diagnostics,
      "contradiction",
      "Authenticated contradictory Evidence reopens this obligation.",
    );
  return diagnostics;
};
