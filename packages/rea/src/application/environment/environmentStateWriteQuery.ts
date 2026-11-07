import { pinnedQuery } from "../../domain/analysisView/environmentStateWriteStamps.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../../domain/result.js";
import { refused, type StateServing } from "./environmentStateAnswer.js";
import { callQuery } from "./environmentStateCallLines.js";
import type { WriteRequest } from "./environmentStateWriteAnswer.js";
import {
  environmentToolArguments,
  hasRepeatedQueryArgument,
} from "./environmentTools.js";

/** A served write call with the query its recording pins: a parameter it leaves out takes the recorded value; another value or parameter, or a repeated one, is refused. */
export const pinnedRequest = (
  serving: StateServing,
  request: WriteRequest,
): Result<WriteRequest, AnalysisError> => {
  const { tool, plan, args } = request;
  if (hasRepeatedQueryArgument(tool, args))
    return err(
      refused(
        tool,
        "The state write model cannot apply repeated query parameters; the state is unchanged.",
      ),
    );
  const query = pinnedQuery(
    serving.source.exchanges.get(plan.exemplar_ordinal ?? -1)?.query,
    callQuery(tool, args),
  );
  if (!query.ok) return err(refused(tool, `Tool ${tool.name} ${query.error}`));
  const names = environmentToolArguments(tool).query;
  const filled = new Map(Object.entries(args));
  for (const [name, value] of query.value) {
    const argument = names.get(name) ?? name;
    if (filled.get(argument) == null) filled.set(argument, value);
  }
  return ok({ ...request, args: Object.fromEntries(filled) });
};
