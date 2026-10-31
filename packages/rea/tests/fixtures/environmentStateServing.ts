import type { ReplayArguments } from "../../src/application/environment/environmentReplay.js";
import { EnvironmentStateStore } from "../../src/application/environment/environmentStateStore.js";
import { environmentToolAnswer } from "../../src/application/environment/environmentToolAnswer.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { timedCaptureEvidence, type TimedCaptureRow } from "./analysisView.js";
import {
  environmentStateServeFixture,
  environmentStateServeInputs,
} from "./environmentServe.js";
import { BOOK_ROWS } from "./environmentStateWrites.js";

/** A served environment over the state derived from a capture of `rows`, answering tool calls as the server does. */
export const servedFrom = (rows: readonly TimedCaptureRow[] = BOOK_ROWS) => {
  const { source, state } = environmentStateServeInputs(
    environmentStateServeFixture(timedCaptureEvidence(rows)),
  );
  const store = new EnvironmentStateStore(state);
  const respond = environmentToolAnswer(source, store);
  const call = (name: string, args: ReplayArguments) => {
    const tool = source.manifest.tools.find(
      (candidate) => candidate.name === name,
    );
    if (tool === undefined) throw new Error(`The manifest lacks ${name}`);
    return respond(tool, args);
  };
  return {
    source,
    state,
    store,
    call,
    answer: (name: string, args: ReplayArguments = {}) => {
      const result = call(name, args);
      if (!result.ok) throw result.error;
      return result.value;
    },
    refusal: (name: string, args: ReplayArguments = {}) => {
      const result = call(name, args);
      if (result.ok) throw new Error(`Expected ${name} to be refused`);
      return projectAnalysisError(result.error);
    },
    /** What data/get reports, as text, so whole states compare byte for byte. */
    snapshot: () => JSON.stringify(store.snapshot()),
  };
};

export type Served = ReturnType<typeof servedFrom>;
