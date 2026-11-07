import { createAnalysisExecution } from "../../src/application/AnalysisProvider.js";
import { ok } from "../../src/domain/result.js";

const FIXTURE_PROVIDER = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
} as const;

/** Wrap fixture output in the same atomic provider envelope as production. */
export const observed = (value: unknown) =>
  ok(createAnalysisExecution(value, FIXTURE_PROVIDER));
