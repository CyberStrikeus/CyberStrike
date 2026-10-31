import { expect, it, vi } from "vitest";

import type {
  ProcessIdentityObservation,
  ProcessOwnershipFact,
  ProcessOwnershipHost,
  ProcessTableEntry,
  ProcessRunTokenObservation,
  ProcessNativeRelationObservation,
} from "./ProcessOwnership.js";
import { readProcessOwnershipFacts } from "./ProcessOwnershipObservation.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

const row: ProcessTableEntry = {
  pid: 42,
  parentPid: 1,
  processGroupId: 42,
  state: "S",
  command: "fixture",
};

const identity = (
  value: string,
  lifecycle: "non-zombie" | "zombie" | "dead" = "non-zombie",
  relation: ProcessNativeRelationObservation = {
    state: "observed",
    parentPid: row.parentPid,
    processGroupId: row.processGroupId,
  },
): ProcessIdentityObservation => ({
  state: "readable",
  identity: value,
  lifecycle: { state: "observed", lifecycle },
  relation,
});

const hostFor = (
  identities: readonly ReadonlyMap<number, ProcessIdentityObservation>[],
  token: ProcessRunTokenObservation = { state: "readable", runId: "run" },
): ProcessOwnershipHost => {
  let identityRead = 0;
  return {
    platform: "linux",
    listProcesses: vi.fn(async () => {
      throw new Error(
        "ownership fact owner must not enumerate the process table",
      );
    }),
    environment: async () => ({}),
    processIdentities: async () => {
      const result = identities[identityRead];
      identityRead += 1;
      return result ?? new Map();
    },
    runTokens: async () => new Map([[row.pid, token]]),
    signalGroup: () => undefined,
  };
};

it("binds owned, missing, and foreign tokens only to the same identity generation", async () => {
  for (const token of [
    { state: "readable", runId: "run" },
    { state: "readable", runId: undefined },
    { state: "readable", runId: "foreign" },
  ] as const) {
    const host = hostFor(
      [
        new Map([[row.pid, identity("start:42")]]),
        new Map([[row.pid, identity("start:42")]]),
      ],
      token,
    );
    const [fact] = await readProcessOwnershipFacts([row], host);
    expect(fact).toMatchObject({
      state: "same-generation",
      token,
      identityBefore: { state: "readable", identity: "start:42" },
      identityAfter: { state: "readable", identity: "start:42" },
    });
  }
});

it("retains a token-matching replacement without authority until same-generation validation", async () => {
  const host = hostFor([
    new Map([[row.pid, identity("start:old")]]),
    new Map([[row.pid, identity("start:new")]]),
  ]);
  const facts = await readProcessOwnershipFacts([row], host);
  expect(facts[0]).toMatchObject({
    state: "replaced",
    token: { state: "readable", runId: "run" },
  });
  const owner = new ProcessOwnershipEvidenceOwner();
  const options = {
    runId: "run",
    listedRows: 1,
    listedPids: new Set([row.pid]),
    leaderPid: row.pid,
    processGroupIds: new Set([row.processGroupId]),
  };
  expect(owner.reconcile(facts, options)).toMatchObject([
    {
      pid: row.pid,
      identity: undefined,
      applicability: "identity-unresolved",
      scopeEvidence: "native-identity-unresolved",
      relation: undefined,
    },
  ]);
  expect(owner.coverage).toMatchObject({
    retainedOwned: 0,
    retainedUnresolved: 1,
    uncertainPids: [row.pid],
  });
  expect(owner.rowsForObservation([])).toEqual([row]);
  const stable = await readProcessOwnershipFacts(
    [row],
    hostFor([
      new Map([[row.pid, identity("start:new")]]),
      new Map([[row.pid, identity("start:new")]]),
    ]),
  );
  expect(owner.reconcile(stable, options)).toMatchObject([
    { pid: row.pid, identity: "start:new", applicability: "token-verified" },
  ]);
});

it.each(["token-verified", "identity-unresolved"] as const)(
  "retains a token-matching replacement after retiring a %s candidate",
  async (applicability) => {
    const owner = new ProcessOwnershipEvidenceOwner();
    const options = {
      runId: "run",
      listedRows: 1,
      listedPids: new Set([row.pid]),
      leaderPid: row.pid,
      processGroupIds: new Set([row.processGroupId]),
    };
    const previousIdentity: ProcessIdentityObservation =
      applicability === "token-verified"
        ? identity("start:old")
        : { state: "unavailable", reason: "native identity denied" };
    const previous = await readProcessOwnershipFacts(
      [row],
      hostFor([
        new Map([[row.pid, previousIdentity]]),
        new Map([[row.pid, previousIdentity]]),
      ]),
    );
    expect(owner.reconcile(previous, options)).toMatchObject([
      { pid: row.pid, applicability },
    ]);

    const replacement = await readProcessOwnershipFacts(
      [row],
      hostFor([
        new Map([[row.pid, identity("start:old")]]),
        new Map([[row.pid, identity("start:new")]]),
      ]),
    );
    expect(owner.reconcile(replacement, options)).toMatchObject([
      {
        pid: row.pid,
        identity: undefined,
        applicability: "identity-unresolved",
        relation: undefined,
      },
    ]);
    expect(owner.rowsForObservation([])).toEqual([row]);
    expect(owner.coverage).toMatchObject({
      retainedOwned: 0,
      retainedUnresolved: 1,
      uncertainPids: [row.pid],
    });
  },
);

it.each(["token-verified", "identity-unresolved"] as const)(
  "retires a %s candidate when its replacement has a foreign token",
  async (applicability) => {
    const owner = new ProcessOwnershipEvidenceOwner();
    const options = {
      runId: "run",
      listedRows: 1,
      listedPids: new Set([row.pid]),
      leaderPid: row.pid,
      processGroupIds: new Set([row.processGroupId]),
    };
    const previousIdentity: ProcessIdentityObservation =
      applicability === "token-verified"
        ? identity("start:old")
        : { state: "unavailable", reason: "native identity denied" };
    const previous = await readProcessOwnershipFacts(
      [row],
      hostFor([
        new Map([[row.pid, previousIdentity]]),
        new Map([[row.pid, previousIdentity]]),
      ]),
    );
    expect(owner.reconcile(previous, options)).toMatchObject([
      { pid: row.pid, applicability },
    ]);
    const replacement = await readProcessOwnershipFacts(
      [row],
      hostFor(
        [
          new Map([[row.pid, identity("start:old")]]),
          new Map([[row.pid, identity("start:foreign")]]),
        ],
        { state: "readable", runId: "foreign" },
      ),
    );

    expect(owner.reconcile(replacement, options)).toEqual([]);
    expect(owner.rowsForObservation([])).toEqual([]);
    expect(
      new ProcessOwnershipEvidenceOwner().reconcile(replacement, options),
    ).toEqual([]);
  },
);

it.each(["absent", "zombie", "dead"] as const)(
  "settles a token-matching replacement when its final native state is %s",
  async (state) => {
    const owner = new ProcessOwnershipEvidenceOwner();
    const options = {
      runId: "run",
      listedRows: 1,
      listedPids: new Set([row.pid]),
      leaderPid: row.pid,
      processGroupIds: new Set([row.processGroupId]),
    };
    const previous = await readProcessOwnershipFacts(
      [row],
      hostFor([
        new Map([[row.pid, identity("start:old")]]),
        new Map([[row.pid, identity("start:old")]]),
      ]),
    );
    owner.reconcile(previous, options);
    const terminalIdentity: ProcessIdentityObservation =
      state === "absent"
        ? { state: "absent", reason: "not-in-snapshot" }
        : identity("start:new", state);
    const replacement = await readProcessOwnershipFacts(
      [row],
      hostFor([
        new Map([[row.pid, identity("start:old")]]),
        new Map([[row.pid, terminalIdentity]]),
      ]),
    );

    expect(owner.reconcile(replacement, options)).toEqual([]);
    expect(owner.rowsForObservation([])).toEqual([]);
    expect(
      new ProcessOwnershipEvidenceOwner().reconcile(replacement, options),
    ).toEqual([]);
  },
);

it("keeps omitted identities uncertain and native absence distinct", async () => {
  const omitted = hostFor([new Map(), new Map()]);
  const [uncertain] = await readProcessOwnershipFacts([row], omitted);
  expect(uncertain).toMatchObject({
    state: "unavailable",
    identityBefore: {
      state: "unavailable",
      reason: "process identity was not returned during before observation",
    },
  });

  const absent: ProcessIdentityObservation = {
    state: "absent",
    reason: "not-in-snapshot",
  };
  const absentHost = hostFor([
    new Map([[row.pid, absent]]),
    new Map([[row.pid, absent]]),
  ]);
  const [gone] = await readProcessOwnershipFacts([row], absentHost);
  expect(gone).toMatchObject({
    state: "absent",
    token: { state: "readable", runId: "run" },
  });
  expect(absentHost.listProcesses).not.toHaveBeenCalled();

  const appeared = hostFor([
    new Map([[row.pid, absent]]),
    new Map([[row.pid, identity("start:appeared")]]),
  ]);
  const [replacement] = await readProcessOwnershipFacts([row], appeared);
  expect(replacement?.state).toBe("replaced");
});

it("keeps zombie lifecycle separate from identity and token diagnostics intact", async () => {
  const zombie = hostFor(
    [
      new Map([[row.pid, identity("start:zombie", "zombie")]]),
      new Map([[row.pid, identity("start:zombie", "zombie")]]),
    ],
    { state: "unavailable", reason: "environment denied" },
  );
  const [fact] = await readProcessOwnershipFacts([row], zombie);
  expect(fact).toMatchObject({
    state: "same-generation",
    token: { state: "unavailable", reason: "environment denied" },
  });
  expect(fact?.identityBefore).toEqual(
    expect.objectContaining({
      identity: "start:zombie",
      lifecycle: { state: "observed", lifecycle: "zombie" },
    }),
  );
});

it("keeps stale table ancestry separate from current native membership", async () => {
  const staleRow: ProcessTableEntry = {
    ...row,
    pid: 101,
    parentPid: 100,
    processGroupId: 100,
  };
  const newGenerationRelation = {
    state: "observed",
    parentPid: 1,
    processGroupId: 102,
  } as const;
  const host = hostFor([
    new Map([
      [
        staleRow.pid,
        identity("start:new", "non-zombie", newGenerationRelation),
      ],
    ]),
    new Map([
      [
        staleRow.pid,
        identity("start:new", "non-zombie", newGenerationRelation),
      ],
    ]),
  ]);

  const [fact] = await readProcessOwnershipFacts([staleRow], host);

  expect(fact).toMatchObject({
    state: "same-generation",
    process: { pid: 101, parentPid: 100, processGroupId: 100 },
    identityBefore: { relation: newGenerationRelation },
    identityAfter: { relation: newGenerationRelation },
  });
  expect(fact?.identityAfter).toMatchObject({
    relation: { parentPid: 1, processGroupId: 102 },
  });
});

it("retains both native relations when group membership changes during the read", async () => {
  const staleRow: ProcessTableEntry = {
    ...row,
    pid: 101,
    parentPid: 100,
    processGroupId: 100,
  };
  const beforeRelation = {
    state: "observed",
    parentPid: 100,
    processGroupId: 100,
  } as const;
  const afterRelation = {
    state: "observed",
    parentPid: 1,
    processGroupId: 102,
  } as const;
  const host = hostFor([
    new Map([
      [staleRow.pid, identity("start:same", "non-zombie", beforeRelation)],
    ]),
    new Map([
      [staleRow.pid, identity("start:same", "non-zombie", afterRelation)],
    ]),
  ]);

  const [fact] = await readProcessOwnershipFacts([staleRow], host);

  expect(fact?.state).toBe("same-generation");
  expect(fact?.process).toEqual(staleRow);
  expect(fact?.identityBefore).toMatchObject({ relation: beforeRelation });
  expect(fact?.identityAfter).toMatchObject({ relation: afterRelation });
});

it("retains owned generations across retries after their token becomes unreadable", () => {
  const owner = new ProcessOwnershipEvidenceOwner();
  const owned: ProcessOwnershipFact = {
    process: row,
    state: "same-generation",
    identityBefore: identity("start:owned"),
    token: { state: "readable", runId: "run" },
    identityAfter: identity("start:owned"),
  };
  owner.reconcile([owned], {
    runId: "run",
    listedRows: 1,
    listedPids: new Set([row.pid]),
    leaderPid: 1,
    processGroupIds: new Set([row.processGroupId]),
  });

  const later = {
    ...owned,
    token: { state: "unavailable", reason: "environment denied" },
    identityBefore: identity("start:owned"),
    identityAfter: identity("start:owned", "non-zombie", {
      state: "observed",
      parentPid: 1,
      processGroupId: 55,
    }),
  } satisfies ProcessOwnershipFact;
  const retained = owner.reconcile([later], {
    runId: "run",
    listedRows: 0,
    listedPids: new Set(),
    leaderPid: 1,
    processGroupIds: new Set([row.processGroupId]),
  });

  expect(retained).toMatchObject([
    {
      pid: row.pid,
      identity: "start:owned",
      applicability: "token-verified",
      relation: { parentPid: 1, processGroupId: 55 },
    },
  ]);
  expect(owner.coverage).toMatchObject({
    listedRows: 0,
    retainedOnlyPids: 1,
    retainedOwned: 1,
    processTableCoverage: "unreported-by-host",
  });
});

it("upgrades an identity-unresolved candidate only after a same-generation token match", () => {
  const owner = new ProcessOwnershipEvidenceOwner();
  const options = {
    runId: "run",
    listedRows: 1,
    listedPids: new Set([row.pid]),
    leaderPid: 42,
    processGroupIds: new Set([row.processGroupId]),
  };
  const unavailable: ProcessIdentityObservation = {
    state: "unavailable",
    reason: "native identity denied",
  };
  const first: ProcessOwnershipFact = {
    process: row,
    state: "unavailable",
    identityBefore: unavailable,
    token: { state: "unavailable", reason: "EPERM" },
    identityAfter: unavailable,
  };
  expect(owner.reconcile([first], options)).toMatchObject([
    {
      pid: row.pid,
      identity: undefined,
      applicability: "identity-unresolved",
    },
  ]);

  const current: ProcessOwnershipFact = {
    process: row,
    state: "same-generation",
    identityBefore: identity("start:current"),
    token: { state: "readable", runId: "run" },
    identityAfter: identity("start:current"),
  };
  expect(owner.reconcile([current], options)).toMatchObject([
    {
      pid: row.pid,
      identity: "start:current",
      applicability: "token-verified",
      scopeEvidence: "run-token",
    },
  ]);
});

it("lets a successful native absence snapshot retire a token-matching old generation", () => {
  const owner = new ProcessOwnershipEvidenceOwner();
  const owned: ProcessOwnershipFact = {
    process: row,
    state: "same-generation",
    identityBefore: identity("start:owned"),
    token: { state: "readable", runId: "run" },
    identityAfter: identity("start:owned"),
  };
  const options = {
    runId: "run",
    listedRows: 1,
    listedPids: new Set([row.pid]),
    leaderPid: 1,
    processGroupIds: new Set([row.processGroupId]),
  };
  owner.reconcile([owned], options);

  const snapshotAbsence: ProcessIdentityObservation = {
    state: "absent",
    reason: "not-in-snapshot",
  };
  const contradictory = {
    ...owned,
    state: "absent" as const,
    identityBefore: snapshotAbsence,
    identityAfter: snapshotAbsence,
  } satisfies ProcessOwnershipFact;

  expect(owner.reconcile([contradictory], options)).toEqual([]);
  expect(owner.coverage.retainedOwned).toBe(0);
});

it("retains a newly verified replacement generation after retiring the old one", () => {
  const owner = new ProcessOwnershipEvidenceOwner();
  const options = {
    runId: "run",
    listedRows: 1,
    listedPids: new Set([row.pid]),
    leaderPid: 1,
    processGroupIds: new Set([row.processGroupId]),
  };
  owner.reconcile(
    [
      {
        process: row,
        state: "same-generation",
        identityBefore: identity("start:old"),
        token: { state: "readable", runId: "run" },
        identityAfter: identity("start:old"),
      },
    ],
    options,
  );

  const replacement: ProcessOwnershipFact = {
    process: row,
    state: "same-generation",
    identityBefore: identity("start:new"),
    token: { state: "readable", runId: "run" },
    identityAfter: identity("start:new"),
  };
  expect(owner.reconcile([replacement], options)).toMatchObject([
    {
      pid: row.pid,
      identity: "start:new",
      applicability: "token-verified",
      scopeEvidence: "run-token",
    },
  ]);
});

it("retains only related unresolved rows and retires them on replacement", () => {
  const owner = new ProcessOwnershipEvidenceOwner();
  const candidate: ProcessTableEntry = {
    ...row,
    pid: 77,
    parentPid: 42,
    processGroupId: 55,
  };
  const unreadable: ProcessOwnershipFact = {
    process: candidate,
    state: "same-generation",
    identityBefore: identity("start:maybe-owned", "non-zombie", {
      state: "observed",
      parentPid: 42,
      processGroupId: 55,
    }),
    token: { state: "unavailable", reason: "permission denied" },
    identityAfter: identity("start:maybe-owned", "non-zombie", {
      state: "observed",
      parentPid: 42,
      processGroupId: 55,
    }),
  };
  const options = {
    runId: "run",
    listedRows: 1,
    listedPids: new Set([77]),
    leaderPid: 42,
    processGroupIds: new Set<number>([42]),
  };
  expect(owner.reconcile([unreadable], options)).toMatchObject([
    {
      pid: 77,
      applicability: "related-ownership-unresolved",
      scopeEvidence: "capture-leader-pid",
    },
  ]);

  const reparented = {
    ...unreadable,
    process: { ...candidate, parentPid: 1, processGroupId: 100 },
    identityBefore: identity("start:maybe-owned", "non-zombie", {
      state: "observed",
      parentPid: 1,
      processGroupId: 100,
    }),
    identityAfter: identity("start:maybe-owned", "non-zombie", {
      state: "observed",
      parentPid: 1,
      processGroupId: 100,
    }),
  } satisfies ProcessOwnershipFact;
  expect(
    owner.reconcile([reparented], {
      ...options,
      listedRows: 0,
      listedPids: new Set(),
    }),
  ).toMatchObject([
    {
      pid: 77,
      applicability: "related-ownership-unresolved",
      scopeEvidence: "previously-related-generation",
      relation: { processGroupId: 100 },
    },
  ]);

  const replacement = {
    ...reparented,
    state: "replaced" as const,
    identityAfter: identity("start:replacement"),
  };
  expect(owner.reconcile([replacement], options)).toEqual([]);
});

it("requires a retained owned parent to be present as the same native generation", () => {
  const owner = new ProcessOwnershipEvidenceOwner();
  const parent: ProcessTableEntry = {
    ...row,
    pid: 70,
    parentPid: 1,
    processGroupId: 70,
  };
  const child: ProcessTableEntry = {
    ...row,
    pid: 71,
    parentPid: 70,
    processGroupId: 71,
  };
  const parentFact: ProcessOwnershipFact = {
    process: parent,
    state: "same-generation",
    identityBefore: identity("start:parent", "non-zombie", {
      state: "observed",
      parentPid: 1,
      processGroupId: 70,
    }),
    token: { state: "readable", runId: "run" },
    identityAfter: identity("start:parent", "non-zombie", {
      state: "observed",
      parentPid: 1,
      processGroupId: 70,
    }),
  };
  const options = {
    runId: "run",
    listedRows: 1,
    listedPids: new Set([parent.pid]),
    leaderPid: 42,
    processGroupIds: new Set<number>([42]),
  };
  owner.reconcile([parentFact], options);

  const unreadableChild: ProcessOwnershipFact = {
    process: child,
    state: "same-generation",
    identityBefore: identity("start:child", "non-zombie", {
      state: "observed",
      parentPid: 70,
      processGroupId: 71,
    }),
    token: { state: "unavailable", reason: "permission denied" },
    identityAfter: identity("start:child", "non-zombie", {
      state: "observed",
      parentPid: parent.pid,
      processGroupId: child.processGroupId,
    }),
  };
  expect(
    owner.reconcile([unreadableChild], {
      ...options,
      listedRows: 1,
      listedPids: new Set([child.pid]),
    }),
  ).toMatchObject([{ pid: parent.pid, applicability: "token-verified" }]);

  const currentParent = {
    ...parentFact,
    token: { state: "unavailable", reason: "permission denied" },
  } satisfies ProcessOwnershipFact;
  expect(
    owner.reconcile([currentParent, unreadableChild], {
      ...options,
      listedRows: 2,
      listedPids: new Set([parent.pid, child.pid]),
    }),
  ).toMatchObject([
    { pid: parent.pid, applicability: "token-verified" },
    {
      pid: child.pid,
      applicability: "related-ownership-unresolved",
      scopeEvidence: "current-token-owned-parent",
    },
  ]);
});

it("does not retain unrelated transient rows and reports table coverage as unknown", () => {
  const owner = new ProcessOwnershipEvidenceOwner();
  const unrelated: ProcessOwnershipFact = {
    process: { ...row, pid: 88, parentPid: 1, processGroupId: 88 },
    state: "same-generation",
    identityBefore: identity("start:unrelated", "non-zombie", {
      state: "observed",
      parentPid: 1,
      processGroupId: 88,
    }),
    token: { state: "unavailable", reason: "temporary permission error" },
    identityAfter: identity("start:unrelated", "non-zombie", {
      state: "observed",
      parentPid: 1,
      processGroupId: 88,
    }),
  };
  expect(
    owner.reconcile([unrelated], {
      runId: "run",
      listedRows: 1,
      listedPids: new Set([88]),
      leaderPid: 42,
      processGroupIds: new Set([42]),
    }),
  ).toEqual([]);
  expect(owner.coverage).toMatchObject({
    listedRows: 1,
    examinedPids: 1,
    retainedUnresolved: 0,
    processTableCoverage: "unreported-by-host",
  });
});

it("preserves the caller's cancellation reason after the final identity read", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped final identity read");
  let identityRead = 0;
  const host: ProcessOwnershipHost = {
    ...hostFor([
      new Map([[row.pid, identity("start:42")]]),
      new Map([[row.pid, identity("start:42")]]),
    ]),
    processIdentities: async () => {
      identityRead += 1;
      if (identityRead === 2) controller.abort(reason);
      return new Map([[row.pid, identity("start:42")]]);
    },
  };
  await expect(
    readProcessOwnershipFacts([row], host, controller.signal),
  ).rejects.toBe(reason);
});
