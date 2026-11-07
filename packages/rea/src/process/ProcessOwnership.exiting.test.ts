import { expect, it, vi } from "vitest";
import {
  cleanupOwnedProcessGroup,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import {
  readProcessOwnershipFacts,
  settleExitingProcessIdentities,
} from "./ProcessOwnershipObservation.js";
import { processIdentityHasExited } from "./ProcessLifecycle.js";

const row: ProcessTableEntry = {
  pid: 910,
  parentPid: 17,
  processGroupId: 910,
  state: "R",
  command: "[MainThread]",
};
const identity = (
  lifecycle: "non-zombie" | "exiting" | "zombie" | "dead",
  generation = "start:1",
): ProcessIdentityObservation => ({
  state: "readable",
  identity: generation,
  lifecycle: { state: "observed", lifecycle },
  relation: {
    state: "observed",
    parentPid: row.parentPid,
    processGroupId: row.processGroupId,
  },
});
const hostWith = (
  observe: () => ProcessIdentityObservation,
): ProcessOwnershipHost => ({
  listProcesses: vi.fn(async () => [row]),
  environment: async () => ({}),
  processIdentities: vi.fn(
    async (rows: readonly ProcessTableEntry[]) =>
      new Map(rows.map(({ pid }) => [pid, observe()])),
  ),
  runTokens: vi.fn(
    async (rows: readonly ProcessTableEntry[]) =>
      new Map(
        rows.map(({ pid }) => [
          pid,
          { state: "unavailable" as const, reason: "EACCES" },
        ]),
      ),
  ),
  signalGroup: vi.fn(),
});

it.each(["zombie", "dead", "absent"] as const)(
  "settles exiting token reads only after a fresh native %s observation",
  async (terminal) => {
    let reads = 0;
    const host = hostWith(() =>
      ++reads < 3
        ? identity("exiting")
        : terminal === "absent"
          ? { state: "absent", reason: "not-in-snapshot" }
          : identity(terminal),
    );
    const facts = await readProcessOwnershipFacts([row], host);
    expect(processIdentityHasExited(facts[0]?.identityAfter)).toBe(true);
    expect(facts[0]?.token).toEqual({ state: "unavailable", reason: "EACCES" });
    expect(host.processIdentities).toHaveBeenCalledTimes(3);
    expect(host.runTokens).toHaveBeenCalledTimes(1);
    expect(host.listProcesses).not.toHaveBeenCalled();
    expect(host.signalGroup).not.toHaveBeenCalled();
  },
);

it("keeps unconfirmed exit explicit at the bounded deadline", async () => {
  const host = hostWith(() => identity("exiting"));
  const result = await cleanupOwnedProcessGroup(
    {
      runId: "run",
      leaderPid: row.pid,
      processGroupId: row.processGroupId,
      expectedCommand: "/exact/node",
    },
    host,
  );
  expect(result).toMatchObject({
    cleaned: false,
    reason: "owned launcher exit could not be confirmed",
  });
  expect(host.signalGroup).not.toHaveBeenCalled();
});

it("settles launcher exit before comparing a stale command display", async () => {
  let reads = 0;
  const host = hostWith(() =>
    ++reads === 1 ? identity("exiting") : identity("zombie"),
  );
  await expect(
    cleanupOwnedProcessGroup(
      {
        runId: "run",
        leaderPid: row.pid,
        processGroupId: row.processGroupId,
        expectedCommand: "/exact/node",
      },
      host,
    ),
  ).resolves.toMatchObject({ cleaned: true, signaled: false });
  expect(host.signalGroup).not.toHaveBeenCalled();
});

it("stops at PID reuse and preserves the changed generation", async () => {
  let reads = 0;
  const host = hostWith(() =>
    ++reads < 3 ? identity("exiting") : identity("exiting", "start:2"),
  );
  const facts = await readProcessOwnershipFacts([row], host);
  expect(facts[0]).toMatchObject({
    state: "replaced",
    identityBefore: { identity: "start:1" },
    identityAfter: { identity: "start:2" },
  });
  expect(host.processIdentities).toHaveBeenCalledTimes(3);
  expect(host.signalGroup).not.toHaveBeenCalled();
});

it("preserves unknown exit evidence without inferring terminal absence", async () => {
  const host = hostWith(() => ({
    state: "unavailable",
    reason: "native identity denied",
  }));
  const result = await settleExitingProcessIdentities(
    [row],
    host,
    new Map([[row.pid, identity("exiting")]]),
  );
  expect(result.get(row.pid)).toEqual({
    state: "unavailable",
    reason: "native identity denied",
  });
  expect(processIdentityHasExited(result.get(row.pid))).toBe(false);
});

it("refreshes only selected exiting PIDs and preserves other native observations", async () => {
  const other = { ...row, pid: 911 };
  const host = hostWith(() => identity("zombie"));
  const initial = new Map([
    [row.pid, identity("exiting")],
    [other.pid, identity("non-zombie")],
  ]);
  const result = await settleExitingProcessIdentities(
    [row, other],
    host,
    initial,
  );
  expect(host.processIdentities).toHaveBeenCalledExactlyOnceWith(
    [row],
    undefined,
    undefined,
  );
  expect(result.get(other.pid)).toBe(initial.get(other.pid));
  expect(host.listProcesses).not.toHaveBeenCalled();
});

it("preserves caller cancellation during native exit settlement", async () => {
  const abort = new AbortController();
  const reason = new Error("caller cancelled exit observation");
  const host = hostWith(() => identity("exiting"));
  const pending = settleExitingProcessIdentities(
    [row],
    host,
    new Map([[row.pid, identity("exiting")]]),
    abort.signal,
  );
  abort.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(host.processIdentities).not.toHaveBeenCalled();
});
