import { expect, it } from "vitest";

import { parseLinuxProcessStat } from "./LinuxProcessStat.js";

const statRecord = (
  options: {
    readonly pid?: string;
    readonly command?: string;
    readonly state?: string;
    readonly flags?: string;
    readonly parentPid?: string;
    readonly processGroupId?: string;
    readonly sessionId?: string;
    readonly startTime?: string;
  } = {},
): string => {
  const fields = [
    options.state ?? "S",
    options.parentPid ?? "17",
    options.processGroupId ?? "18",
    options.sessionId ?? "19",
  ];
  while (fields.length < 19) fields.push("0");
  fields[6] = options.flags ?? "0";
  fields.push(options.startTime ?? "987654");
  return `${options.pid ?? "42"} (${options.command ?? "worker"}) ${fields.join(" ")}`;
};

it("parses command names containing parentheses and retains native relation facts", () => {
  expect(
    parseLinuxProcessStat(statRecord({ command: "worker ) old ) name" })),
  ).toEqual({
    pid: 42,
    startTime: "987654",
    lifecycle: "non-zombie",
    parentPid: 17,
    processGroupId: 18,
    sessionId: 19,
  });
});

it("accepts zero parent, process-group, and session IDs as native facts", () => {
  expect(
    parseLinuxProcessStat(
      statRecord({ parentPid: "0", processGroupId: "0", sessionId: "0" }),
    ),
  ).toMatchObject({ parentPid: 0, processGroupId: 0, sessionId: 0 });
});

it("retains identity when Linux teardown reports unavailable group and session IDs", () => {
  // Linux v6.8 fs/proc/array.c: do_task_stat initializes pgid/sid to -1
  // and only replaces them while lock_task_sighand succeeds.
  expect(
    parseLinuxProcessStat(
      statRecord({
        parentPid: "0",
        processGroupId: "-1",
        sessionId: "-1",
        state: "X",
        flags: "4",
      }),
    ),
  ).toEqual({
    pid: 42,
    startTime: "987654",
    lifecycle: "dead",
    parentPid: 0,
    processGroupId: -1,
    sessionId: -1,
  });
  expect(
    parseLinuxProcessStat(statRecord({ processGroupId: "-2" })),
  ).toBeUndefined();
  expect(
    parseLinuxProcessStat(statRecord({ sessionId: "-2" })),
  ).toBeUndefined();
});

it("distinguishes zombie lifecycle and rejects malformed or missing identity fields", () => {
  expect(parseLinuxProcessStat(statRecord({ state: "Z" }))?.lifecycle).toBe(
    "zombie",
  );
  expect(parseLinuxProcessStat("(worker) S 1 2 3")).toBeUndefined();
  expect(parseLinuxProcessStat(statRecord({ pid: "0" }))).toBeUndefined();
  expect(parseLinuxProcessStat(statRecord({ state: "??" }))).toBeUndefined();
  expect(parseLinuxProcessStat(statRecord({ startTime: "not-a-number" }))).toBe(
    undefined,
  );
});

it.each(["R", "S", "D"])(
  "retains PF_EXITING separately from terminal state %s",
  (state) => {
    expect(
      parseLinuxProcessStat(statRecord({ state, flags: "4194316" }))?.lifecycle,
    ).toBe("exiting");
    expect(
      parseLinuxProcessStat(statRecord({ state, flags: "4194312" }))?.lifecycle,
    ).toBe("non-zombie");
  },
);

it.each(["Z", "X", "x"])(
  "recognizes terminal native state %s independently of flags",
  (state) => {
    expect(
      parseLinuxProcessStat(statRecord({ state, flags: "invalid" }))?.lifecycle,
    ).toBe(state === "Z" ? "zombie" : "dead");
  },
);

it.each(["invalid", "-1", "4.1", "9007199254740992"])(
  "preserves identity and relations with unknown flags %s",
  (flags) => {
    expect(parseLinuxProcessStat(statRecord({ flags }))).toEqual({
      pid: 42,
      startTime: "987654",
      lifecycle: undefined,
      parentPid: 17,
      processGroupId: 18,
      sessionId: 19,
    });
  },
);
