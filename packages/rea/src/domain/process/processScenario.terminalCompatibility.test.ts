import { expect, it } from "vitest";

import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "./processCaptureExample.js";
import { parseProcessCapture } from "./processCaptureParsing.js";
import { digestProcessCommitment } from "./processScenario.js";

it("retains a previously recorded one-column scenario in process Evidence", () => {
  const scenario = {
    ...EMPTY_PROCESS_CAPTURE_EXAMPLE.manifest.scenario,
    terminal: { columns: 1, rows: 2, scrollback: 0 },
  };
  const capture = {
    ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
    manifest: {
      ...EMPTY_PROCESS_CAPTURE_EXAMPLE.manifest,
      scenario,
      full_scenario_sha256: digestProcessCommitment(scenario),
    },
  };
  expect(parseProcessCapture(capture).manifest.scenario).toEqual(scenario);
});
