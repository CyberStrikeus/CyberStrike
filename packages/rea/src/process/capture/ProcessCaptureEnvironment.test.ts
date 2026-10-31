import { expect, it } from "vitest";

import { processScenarioSchema } from "../../domain/process/processScenario.js";
import { makeProcessCaptureEnvironment } from "./ProcessCaptureEnvironment.js";

it("uses Windows environment identity for caller overrides and capture-owned values", () => {
  const scenario = processScenarioSchema.parse({
    executable: "node",
    environment: {
      path: "caller-bin",
      term: "caller-terminal",
      rea_process_run_id: "caller-token",
    },
  });
  expect(
    makeProcessCaptureEnvironment({
      scenario,
      hostEnvironment: {
        Path: "host-bin",
        TERM: "host-terminal",
        REA_PROCESS_RUN_ID: "host-token",
        OMITTED: undefined,
      },
      runId: "capture-token",
      platform: "win32",
    }),
  ).toEqual({
    PATH: "caller-bin",
    TERM: "caller-terminal",
    REA_PROCESS_RUN_ID: "capture-token",
  });
});

it("preserves distinct POSIX names and supplies the terminal default", () => {
  const scenario = processScenarioSchema.parse({
    executable: "node",
    environment: { path: "caller-bin", term: "lowercase-terminal" },
  });
  expect(
    makeProcessCaptureEnvironment({
      scenario,
      hostEnvironment: { PATH: "host-bin", OMITTED: undefined },
      runId: "capture-token",
      platform: "linux",
    }),
  ).toEqual({
    PATH: "host-bin",
    path: "caller-bin",
    term: "lowercase-terminal",
    TERM: "xterm-256color",
    REA_PROCESS_RUN_ID: "capture-token",
  });
});
