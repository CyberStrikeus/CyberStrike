import { expect, it } from "vitest";

import type { ProcessOwnershipHost } from "./ProcessOwnership.js";
import { readProcessRunId } from "./ProcessOwnership.js";

it.each([undefined, "selected-token", ""])(
  "reads only the process environment's own run token %j",
  async (selected) => {
    const environment: Record<string, string> = Object.create({
      REA_PROCESS_RUN_ID: "inherited-token",
    });
    if (selected !== undefined) environment.REA_PROCESS_RUN_ID = selected;
    const host: ProcessOwnershipHost = {
      listProcesses: async () => [],
      environment: async () => environment,
      signalGroup: () => undefined,
    };
    expect(await readProcessRunId(42, host)).toBe(selected);
  },
);

it("passes cancellation through run-token reads", async () => {
  const controller = new AbortController();
  const cancellation = new Error("cancelled");
  const host: ProcessOwnershipHost = {
    listProcesses: async () => [],
    environment: async (_pid, signal) => {
      if (signal === undefined) throw new Error("run-token signal was omitted");
      return await new Promise<Readonly<Record<string, string>>>(
        (_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        },
      );
    },
    signalGroup: () => undefined,
  };

  const reading = readProcessRunId(42, host, controller.signal);
  controller.abort(cancellation);

  await expect(reading).rejects.toBe(cancellation);
});
