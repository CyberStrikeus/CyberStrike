import { once } from "node:events";
import { expect } from "vitest";

import { readProcessRunId } from "../../../src/process/ProcessOwnership.js";
import { createSystemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { readProcessRunTokens } from "../../../src/process/ProcessRunTokenObservations.js";
import { processTest } from "../../support/process/processFixture.js";

processTest.skipIf(process.platform !== "linux").for([
  { name: "absent", runId: undefined },
  { name: "selected", runId: "source-process-token" },
])(
  "reads $name run tokens from the live process environment",
  async ({ runId }, { processes }) => {
    const environment = {
      EMPTY: "",
      VALUE: "a=b",
      ["__proto__"]: "source-value",
      ...(runId === undefined ? {} : { REA_PROCESS_RUN_ID: runId }),
    };
    const child = processes.spawn(
      process.execPath,
      ["-e", "process.stdin.resume()"],
      { env: environment },
    );
    await once(child, "spawn");
    const host = createSystemProcessOwnershipHost("linux", {});
    const row = (await host.listProcesses()).find(
      ({ pid }) => pid === child.pid,
    );
    if (row === undefined) throw new Error("Selected child was not observed");

    expect(await host.environment(row.pid)).toEqual(environment);
    expect(await readProcessRunId(row.pid, host)).toBe(runId);
    const observations = [];
    for await (const observation of readProcessRunTokens(host, [row]))
      observations.push(observation);
    expect(observations).toEqual([
      { process: row, observation: { state: "readable", runId } },
    ]);
    child.stdin.end();
  },
);
