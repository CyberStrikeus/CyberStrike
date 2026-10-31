import { expect, it } from "vitest";

import {
  linuxEnvironmentRestriction,
  parseLinuxProcessIds,
} from "./LinuxProcessStatus.js";

it("parses the single native status Uid and Gid rows", () => {
  const status =
    "Name:\tworker\nUid:\t1000\t1001\t1002\t1003\nGid:\t20\t21\t22\t23\n";
  expect(parseLinuxProcessIds(status, "Uid")).toEqual([1000, 1001, 1002, 1003]);
  expect(parseLinuxProcessIds(status, "Gid")).toEqual([20, 21, 22, 23]);
});

it.each([
  "Name:\tworker\n",
  "Uid:\t1000\t1001\t1002\n",
  "Uid:\t1000\t1001\t1002\t1003\nUid:\t1000\t1001\t1002\t1003\n",
  "Uid:\t1000\t-1\t1002\t1003\n",
  "Uid:\t1000\t9007199254740992\t1002\t1003\n",
  "Uid:\t1000\t1001\t1002\t1003 extra\n",
])("does not infer IDs from malformed status: %s", (status) => {
  expect(parseLinuxProcessIds(status, "Uid")).toBeUndefined();
});

const caller = { callerUid: 1000, callerGid: 1000 } as const;
const matching = [1000, 1000, 1000, 1000] as const;

it.each([
  [
    "a setgid program",
    { uids: matching, gids: [1000, 2, 2, 2], procfsOwnerUid: 1000 },
    "credentials",
  ],
  [
    "a saved UID from another account",
    { uids: [1000, 1000, 0, 1000], gids: matching, procfsOwnerUid: 1000 },
    "credentials",
  ],
  [
    "a non-dumpable process",
    { uids: matching, gids: matching, procfsOwnerUid: 0 },
    "non-dumpable",
  ],
  [
    "an inspectable process",
    { uids: matching, gids: matching, procfsOwnerUid: 1000 },
    undefined,
  ],
  [
    "a process with unknown procfs ownership and GIDs",
    { uids: matching, gids: undefined, procfsOwnerUid: undefined },
    undefined,
  ],
] as const)(
  "derives the kernel environment restriction for %s",
  (_name, facts, expected) => {
    expect(linuxEnvironmentRestriction({ ...caller, ...facts })).toBe(expected);
  },
);

it("does not derive a credential restriction without caller credentials", () => {
  expect(
    linuxEnvironmentRestriction({
      uids: [0, 0, 0, 0],
      gids: [0, 0, 0, 0],
      procfsOwnerUid: 0,
      callerUid: undefined,
      callerGid: undefined,
    }),
  ).toBeUndefined();
});
