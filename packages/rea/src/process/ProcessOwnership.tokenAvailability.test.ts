import { expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({
  present: true,
  reason: "process_not_in_snapshot",
}));
vi.mock("./ExecFileOutput.js", () => ({
  execFileOutput: async () => ({
    stdout: source.present ? "100 1 100 501 S fixture" : "",
  }),
}));
vi.mock("./DarwinProcessRunTokenReader.js", () => ({
  createDarwinProcessRunTokenReader: () => ({
    read: async () =>
      new Map([[100, { state: "unavailable", reason: source.reason }]]),
  }),
}));

import { createSystemProcessOwnershipHost } from "./ProcessOwnershipObservation.js";
import { ProcessRunTokenReadError } from "./ProcessRunTokenObservations.js";

it.each([
  { present: false, reason: "unused", availability: "absent" },
  { present: true, reason: "process_not_in_snapshot", availability: "absent" },
  { present: true, reason: "sysctl_failed_13", availability: "unavailable" },
])(
  "retains native run-token availability at the host adapter: %j",
  async (state) => {
    Object.assign(source, state);
    const host = createSystemProcessOwnershipHost("darwin", {});
    const failure = await host
      .environment(100)
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ProcessRunTokenReadError);
    expect(failure).toMatchObject({
      pid: 100,
      availability: state.availability,
      reason: state.present ? state.reason : "process_not_in_snapshot",
    });
  },
);
