import {
  parseFunctionEvidence,
  type FunctionSnapshot,
} from "./functionDossierEvidence.js";

/** Authenticate fixture Evidence before passing its facts to pure comparisons. */
export const functionSnapshotFixture = (input: unknown): FunctionSnapshot => {
  const parsed = parseFunctionEvidence(input, {
    operation: "compare_functions",
    path: [],
  });
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
