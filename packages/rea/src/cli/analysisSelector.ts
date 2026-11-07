import { AnalysisInputError } from "../domain/analysisErrorCore.js";

/** Each separately emitted args/options schema must expose the selector choice. */
export const requiredSelectorGuidance = (alternatives: string): string =>
  `Supply at least one of ${alternatives}.`;

export const addressOrProcedureGuidance = requiredSelectorGuidance(
  "the positional address or --procedure",
);

/** Agreement details belong on the command, rather than every schema field. */
export const equalSelectorGuidance =
  "Equal values are accepted; conflicts fail.";

/** Preserve a CLI selector supplied positionally or through its named option. */
export const resolveCliAnalysisSelector = (
  positional: string | undefined,
  named: string | undefined,
  option: string,
  operation: string,
): string => {
  if (positional !== undefined && named !== undefined && positional !== named)
    throw new AnalysisInputError(operation, undefined, [
      {
        path: [option],
        reason: "invalid_value",
        message: `The positional selector and --${option} select different objects; supply one selector.`,
      },
    ]);
  const selected = named ?? positional;
  if (selected === undefined)
    throw new AnalysisInputError(operation, undefined, [
      {
        path: [option],
        reason: "missing_argument",
        message: `Supply a positional selector or --${option}=<value>. Use the named option for values beginning with a dash.`,
        expected: "string",
      },
    ]);
  return selected;
};
