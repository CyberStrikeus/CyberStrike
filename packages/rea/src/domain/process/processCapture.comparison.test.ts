import { expect, it } from "vitest";
import { jsonValueSchema } from "../jsonValue.js";
import {
  processScenarioSchema,
  processScenarioCommitment,
  processComparisonContract,
  digestProcessCommitment,
} from "./processScenario.js";
import { parseProcessCapture } from "./processCaptureParsing.js";
import type { FileState } from "./processCapture.js";

import {
  deriveProcessComparisonStatus,
  PROCESS_COMPARISON_DIMENSIONS,
  processCaptureComparisonSchema,
} from "./processComparison.js";

import {
  accountFullyObservedProcessCapture,
  compareUnverifiedProcessCaptures as compareProcessCaptures,
  emptyProcessCapture as emptyCapture,
} from "./processCapture.fixture.js";

const compareFullyObserved = (
  left: Parameters<typeof compareProcessCaptures>[0],
  right: Parameters<typeof compareProcessCaptures>[1],
  options?: Parameters<typeof compareProcessCaptures>[2],
) =>
  compareProcessCaptures(
    accountFullyObservedProcessCapture(left),
    accountFullyObservedProcessCapture(right),
    options,
  );

it("does not turn unresolved filesystem effects into equality or a definite change", () => {
  const capture = emptyCapture();
  const file = {
    path: "root_0:created.txt",
    type: "file" as const,
    mode: 0o644,
    size: 4,
    sha256: "a".repeat(64),
    symlink_target: null,
  };
  const known = {
    path: file.path,
    status: "created" as const,
    before: null,
    after: file,
  };
  const unknown = {
    ...known,
    status: "unknown" as const,
    reason: "Prior scope was not observed.",
  };
  const withEffect = (effect: typeof known | typeof unknown) => ({
    ...capture,
    files_after: [file],
    filesystem_effects: [effect],
    filesystem_checkpoints: capture.filesystem_checkpoints.map((checkpoint) =>
      checkpoint.name === "after_settlement"
        ? { ...checkpoint, files: [file], effects: [effect] }
        : checkpoint,
    ),
  });
  const unknownCapture = withEffect(unknown);
  const knownCapture = withEffect(known);
  for (const [left, right] of [
    [unknownCapture, unknownCapture],
    [unknownCapture, knownCapture],
    [knownCapture, unknownCapture],
  ] as const)
    expect(compareFullyObserved(left, right)).toMatchObject({
      status: "unknown",
      filesystem: "unknown",
      first_divergence: { status: "unknown" },
    });
  expect(compareFullyObserved(knownCapture, knownCapture)).toMatchObject({
    status: "unchanged",
    filesystem: "unchanged",
    first_divergence: { status: "none" },
  });
});

it("preserves independently observed file changes alongside an unknown effect", () => {
  const base = emptyCapture();
  const link = {
    path: "root_0:legacy-link",
    type: "symlink" as const,
    mode: 0o777,
    size: 1,
    sha256: null,
    symlink_target: null,
    symlink_target_hex: "ff",
  };
  const unknown = {
    path: link.path,
    status: "unknown" as const,
    before: link,
    after: link,
    reason: "Target bytes were not retained.",
  };
  const make = (sha256: string) => {
    const file = {
      path: "root_0:known.txt",
      type: "file" as const,
      mode: 0o644,
      size: 4,
      sha256,
      symlink_target: null,
    };
    const files = [link, file];
    return {
      ...base,
      files_before: files,
      files_after: files,
      filesystem_effects: [unknown],
      filesystem_checkpoints: base.filesystem_checkpoints.map((checkpoint) => ({
        ...checkpoint,
        files,
        effects: checkpoint.name === "after_settlement" ? [unknown] : [],
      })),
    };
  };
  const left = make("a".repeat(64));
  const right = make("b".repeat(64));
  const traceSpecification = {
    events: [
      {
        id: "before",
        source: "filesystem" as const,
        exact: jsonValueSchema.parse(left.filesystem_checkpoints[0]),
        cardinality: { kind: "required" as const },
      },
    ],
    language: {
      kind: "finite_traces" as const,
      variants: [{ id: "v", trace: ["before"] }],
    },
  };
  for (const [a, b] of [
    [left, right],
    [right, left],
  ] as const) {
    for (const options of [undefined, { traceSpecification }])
      expect(compareFullyObserved(a, b, options)).toMatchObject({
        filesystem: "changed",
        status: "changed",
        first_divergence: { status: "unknown" },
      });
  }
});

it("compares recoverable symlink bytes across old and current captures", () => {
  const base = emptyCapture();
  const link = {
    path: "root_0:link",
    type: "symlink" as const,
    mode: 0o777,
    size: 1,
    sha256: null,
    symlink_target: null,
    symlink_target_hex: "ff",
  };
  const make = (target: Extract<FileState, { type: "symlink" }>) => {
    const effect = {
      path: link.path,
      status: "unknown" as const,
      before: target,
      after: target,
      reason: "Target bytes were not retained.",
    };
    return {
      ...base,
      filesystem_effects: [effect],
      filesystem_checkpoints: base.filesystem_checkpoints.map((checkpoint) => ({
        ...checkpoint,
        files: [target],
        effects: checkpoint.name === "after_settlement" ? [effect] : [],
      })),
    };
  };
  const modern = make(link);
  const { symlink_target_hex: _hex, ...legacyLink } = link;
  const legacy = make({ ...legacyLink, symlink_target: "a" });
  for (const [left, right] of [
    [modern, legacy],
    [legacy, modern],
  ] as const)
    expect(compareFullyObserved(left, right)).toMatchObject({
      filesystem: "changed",
      first_divergence: { status: "unknown" },
    });
  const ambiguous = make({ ...legacyLink, symlink_target: "\ufffd" });
  expect(compareFullyObserved(modern, ambiguous)).toMatchObject({
    filesystem: "unknown",
    status: "unknown",
  });
});

it("preserves a definite attributed filesystem trace failure beside unknown effects", () => {
  const base = emptyCapture();
  const unknown = {
    path: "root_0:link",
    status: "unknown" as const,
    before: null,
    after: null,
    reason: "Unobserved target.",
  };
  const make = (time: number) => ({
    ...base,
    event_journal: [
      {
        capture_order: 0,
        collection: "filesystem_checkpoints" as const,
        index: 0,
      },
      { capture_order: 1, collection: "lifecycle" as const, index: 0 },
      { capture_order: 2, collection: "lifecycle" as const, index: 1 },
      {
        capture_order: 3,
        collection: "filesystem_checkpoints" as const,
        index: 1,
      },
    ],
    filesystem_effects: [unknown],
    filesystem_checkpoints: base.filesystem_checkpoints.map((checkpoint) =>
      checkpoint.name === "after_settlement"
        ? { ...checkpoint, at_ms: time, effects: [unknown] }
        : checkpoint,
    ),
  });
  const left = make(50);
  const right = make(60);
  const traceSpecification = {
    events: [
      {
        id: "before",
        source: "filesystem" as const,
        exact: jsonValueSchema.parse(left.filesystem_checkpoints[0]),
        cardinality: { kind: "required" as const },
      },
      {
        id: "final",
        source: "filesystem" as const,
        exact: jsonValueSchema.parse(left.filesystem_checkpoints[1]),
        cardinality: { kind: "required" as const },
      },
    ],
    language: {
      kind: "finite_traces" as const,
      variants: [{ id: "v", trace: ["before", "final"] }],
    },
  };
  expect(
    compareFullyObserved(left, right, { traceSpecification }),
  ).toMatchObject({
    status: "changed",
    filesystem: "changed",
    first_divergence: { status: "unknown" },
    trace: { verdict: "different" },
  });
});

it("preserves proven file additions and removals beside an unrelated unknown effect", () => {
  const base = emptyCapture();
  const root = {
    path: "root_0:.",
    type: "directory" as const,
    mode: 0o755,
    size: 0,
    sha256: null,
    symlink_target: null,
  };
  const link = {
    path: "root_0:legacy-link",
    type: "symlink" as const,
    mode: 0o777,
    size: 1,
    sha256: null,
    symlink_target: null,
    symlink_target_hex: "ff",
  };
  const file = {
    path: "root_0:output.txt",
    type: "file" as const,
    mode: 0o644,
    size: 4,
    sha256: "a".repeat(64),
    symlink_target: null,
  };
  const unknown = {
    path: link.path,
    status: "unknown" as const,
    before: link,
    after: link,
    reason: "Target bytes were not retained.",
  };
  const created = {
    path: file.path,
    status: "created" as const,
    before: null,
    after: file,
  };
  const make = (withFile: boolean, unobserved: boolean) => {
    const before = [root, link];
    const after = withFile ? [...before, file] : before;
    const effects = withFile ? [unknown, created] : [unknown];
    return {
      ...base,
      files_before: before,
      files_after: after,
      filesystem_effects: effects,
      filesystem_checkpoints: base.filesystem_checkpoints.map((checkpoint) => ({
        ...checkpoint,
        files: checkpoint.name === "before" ? before : after,
        effects: checkpoint.name === "before" ? [] : effects,
      })),
      truncation_details: {
        ...base.truncation_details,
        filesystem_before: {
          ...base.truncation_details.filesystem_before,
          unobserved_subtrees: [],
        },
        filesystem_after: {
          ...base.truncation_details.filesystem_after,
          unobserved_subtrees: unobserved
            ? [{ path: root.path, reason: "observer_owned" as const }]
            : [],
        },
      },
    };
  };
  const withFile = make(true, false);
  const absent = make(false, false);
  const unobserved = make(false, true);
  const { unobserved_subtrees: _subtrees, ...legacyCoverage } =
    absent.truncation_details.filesystem_after;
  const legacy = {
    ...absent,
    truncation_details: {
      ...absent.truncation_details,
      filesystem_after: legacyCoverage,
    },
  };
  const traceSpecification = {
    events: [
      {
        id: "before",
        source: "filesystem" as const,
        exact: jsonValueSchema.parse(withFile.filesystem_checkpoints[0]),
        cardinality: { kind: "required" as const },
      },
    ],
    language: {
      kind: "finite_traces" as const,
      variants: [{ id: "v", trace: ["before"] }],
    },
  };
  for (const [left, right] of [
    [withFile, absent],
    [absent, withFile],
  ] as const) {
    for (const options of [undefined, { traceSpecification }])
      expect(compareFullyObserved(left, right, options)).toMatchObject({
        filesystem: "changed",
        status: "changed",
        first_divergence: { status: "unknown" },
      });
  }
  for (const [left, right] of [
    [withFile, unobserved],
    [unobserved, withFile],
    [withFile, legacy],
    [legacy, withFile],
  ] as const)
    expect(compareFullyObserved(left, right)).toMatchObject({
      filesystem: "unknown",
      status: "unknown",
    });
});

it.each(PROCESS_COMPARISON_DIMENSIONS)(
  "requires a contradiction aggregate for a contradictory %s dimension",
  (dimension) => {
    const baseline = compareFullyObserved(emptyCapture(), emptyCapture());
    const result = { ...baseline, [dimension]: "contradiction" as const };
    expect(
      deriveProcessComparisonStatus(
        PROCESS_COMPARISON_DIMENSIONS.map((name) => result[name]),
      ),
    ).toBe("contradiction");
    expect(processCaptureComparisonSchema.safeParse(result).success).toBe(
      false,
    );
    expect(
      processCaptureComparisonSchema.parse({
        ...result,
        status: "contradiction",
      }),
    ).toMatchObject({ status: "contradiction", [dimension]: "contradiction" });
  },
);

it.each([
  ["unchanged", "contradiction"],
  ["added", "contradiction"],
  ["removed", "contradiction"],
  ["changed", "contradiction"],
  ["unknown", "contradiction"],
  ["contradiction", "contradiction"],
  ["truncated", "truncated"],
] as const)(
  "combines contradiction with %s as %s independently of dimension order",
  (other, expected) => {
    for (const [terminal, interaction] of [
      ["contradiction", other],
      [other, "contradiction"],
    ] as const) {
      expect(deriveProcessComparisonStatus([terminal, interaction])).toBe(
        expected,
      );
      expect(
        processCaptureComparisonSchema.parse({
          ...compareFullyObserved(emptyCapture(), emptyCapture()),
          terminal,
          interaction,
          status: expected,
        }),
      ).toMatchObject({ status: expected });
    }
  },
);

it("compares normalized terminal facts while retaining different source text for audit", () => {
  const capture = emptyCapture();
  const frame = { sequence: 0, at_ms: 0, data: "listen:<port> score=20" };
  const left = {
    ...capture,
    frames: [{ ...frame, raw_data: "listen:8080 score=20" }],
  };
  const right = {
    ...capture,
    frames: [{ ...frame, raw_data: "listen:9090 score=20" }],
  };
  expect(compareFullyObserved(left, right)).toMatchObject({
    terminal: "unchanged",
  });
  expect(
    compareFullyObserved(left, {
      ...right,
      frames: [{ ...frame, data: "listen:<port> score=21" }],
    }),
  ).toMatchObject({ terminal: "changed" });
});

it("distinguishes added evidence from unknown observations", () => {
  const capture = emptyCapture();
  const added = compareFullyObserved(capture, {
    ...capture,
    frames: [{ sequence: 0, at_ms: 0, data: "new" }],
    rendered_frames: [
      {
        sequence: 0,
        at_ms: 0,
        columns: 3,
        rows: 1,
        cursor_x: 3,
        cursor_y: 0,
        active_buffer: "normal",
        lines: ["new"],
        serialized_state: "new",
      },
    ],
  });
  expect(added).toMatchObject({ terminal: "added", status: "changed" });

  for (const [scope, dimension] of [
    ["process", "process"],
    ["interaction", "interaction"],
  ] as const) {
    expect(
      compareFullyObserved(
        {
          ...capture,
          residual_unknowns: [{ scope, reason: "observation was partial" }],
        },
        capture,
      ),
    ).toMatchObject({
      status: "unknown",
      [dimension]: "unknown",
      terminal: "unchanged",
    });
  }
});

it("compares raw terminal and process observations while honoring normalization shape", () => {
  const capture = emptyCapture();
  expect(
    compareFullyObserved(capture, {
      ...capture,
      normalization: {
        patterns: [],
        time_bucket_ms: 10,
        ports: true,
        pids: true,
        paths: true,
      },
    }),
  ).toMatchObject({
    status: "unchanged",
    first_divergence: { status: "none" },
  });

  const terminal = compareFullyObserved(
    { ...capture, frames: [{ sequence: 0, at_ms: 0, data: "bar" }] },
    { ...capture, frames: [{ sequence: 0, at_ms: 0, data: "foo\rbar" }] },
  );
  expect(terminal).toMatchObject({
    terminal: "changed",
    first_divergence: { status: "found", dimension: "terminal" },
  });

  expect(
    compareFullyObserved(
      {
        ...capture,
        process_samples: [
          {
            at_ms: 10,
            pid: 1,
            parent_pid: 0,
            process_group_id: 1,
            session_id: 1,
            command: "worker",
          },
        ],
      },
      {
        ...capture,
        process_samples: [
          {
            at_ms: 20,
            pid: 1,
            parent_pid: 2,
            process_group_id: 1,
            session_id: 1,
            command: "worker",
          },
        ],
      },
    ),
  ).toMatchObject({ process: "changed", status: "changed" });
});

it("keeps filesystem comparison unknown without coverage and reports observed changes", () => {
  const capture = emptyCapture();
  const incomplete = {
    ...capture,
    residual_unknowns: [
      { scope: "filesystem" as const, reason: "watcher unavailable" },
    ],
  };
  expect(compareFullyObserved(incomplete, incomplete)).toMatchObject({
    filesystem: "unknown",
    status: "unknown",
  });

  const finalFile = {
    path: "root_0:created.txt",
    type: "file" as const,
    mode: 0o644,
    size: 4,
    sha256: "a".repeat(64),
    symlink_target: null,
  };
  expect(
    compareFullyObserved(capture, {
      ...capture,
      filesystem_checkpoints: [
        { name: "before", at_ms: 0, files: [], effects: [], truncated: false },
        {
          name: "after_settlement",
          at_ms: 10,
          files: [finalFile],
          effects: [
            {
              path: finalFile.path,
              status: "created",
              before: null,
              after: finalFile,
            },
          ],
          truncated: false,
        },
      ],
      files_after: [finalFile],
      filesystem_effects: [
        {
          path: finalFile.path,
          status: "created",
          before: null,
          after: finalFile,
        },
      ],
    }),
  ).toMatchObject({ filesystem: "changed", status: "changed" });
});

it.each([
  [500, "interaction", 6],
  [4, "process", 4],
] as const)(
  "orders an interaction difference by its dispatch time (process sample at %i ms)",
  (processTime, dimension, at) => {
    const capture = (side: "left" | "right") => {
      const base = emptyCapture();
      const journal = [
        { collection: "filesystem_checkpoints" as const, index: 0 },
        ...(processTime < 6
          ? [{ collection: "process_samples" as const, index: 0 }]
          : []),
        { collection: "interaction_events" as const, index: 0 },
        ...(processTime >= 6
          ? [{ collection: "process_samples" as const, index: 0 }]
          : []),
        { collection: "lifecycle" as const, index: 0 },
        { collection: "lifecycle" as const, index: 1 },
        { collection: "filesystem_checkpoints" as const, index: 1 },
      ].map((entry, capture_order) => ({ ...entry, capture_order }));
      return {
        ...base,
        manifest: {
          ...base.manifest,
          completed_at: "2026-01-01T00:00:01.000Z",
        },
        settlement: { ...base.settlement, elapsed_ms: 1000 },
        filesystem_checkpoints: base.filesystem_checkpoints.map(
          (checkpoint, index) => ({
            ...checkpoint,
            at_ms: index === 0 ? 0 : 1000,
          }),
        ),
        interaction_events: [
          {
            sequence: 0,
            scheduled_at_ms: 5,
            dispatched_at_ms: 6,
            type: "input" as const,
            data: "hello",
            outcome:
              side === "left" ? ("dispatched" as const) : ("failed" as const),
          },
        ],
        process_samples: [
          {
            at_ms: processTime,
            pid: 2,
            parent_pid: 1,
            command: side === "left" ? "worker-a" : "worker-b",
            process_group_id: 1,
            session_id: 1,
          },
        ],
        event_journal: journal,
      };
    };
    const comparison = compareFullyObserved(capture("left"), capture("right"));
    expect(comparison).toMatchObject({
      interaction: "changed",
      process: "changed",
      first_divergence: {
        status: "found",
        dimension,
        left_at_ms: at,
        right_at_ms: at,
      },
    });
  },
);

it("refuses mixed terminal observation versions even with PID and port rules disabled", () => {
  const base = emptyCapture();
  const scenario = processScenarioSchema.parse({
    executable: "/usr/bin/true",
    normalization: { pids: false, ports: false },
  });
  const committed = processScenarioCommitment(
    scenario,
    base.manifest.selected_executable_sha256 ?? undefined,
  );
  const contract = processComparisonContract(scenario);
  expect(contract).not.toHaveProperty("pid_normalization_version");
  expect(contract).not.toHaveProperty("port_normalization_version");
  expect(contract.terminal_observation_version).toBe(
    "deferred-rendered-journal-v1",
  );
  const capture = parseProcessCapture({
    ...base,
    normalization: scenario.normalization,
    manifest: {
      ...base.manifest,
      scenario: committed,
      full_scenario_sha256: digestProcessCommitment(committed),
      normalization_sha256: digestProcessCommitment(scenario.normalization),
      comparison_contract: contract,
      comparison_contract_sha256: digestProcessCommitment(contract),
    },
  });
  const legacyContract = { ...contract };
  delete legacyContract.terminal_observation_version;
  const legacy = parseProcessCapture({
    ...capture,
    manifest: {
      ...capture.manifest,
      comparison_contract: legacyContract,
      comparison_contract_sha256: digestProcessCommitment(legacyContract),
    },
  });
  expect(() => compareProcessCaptures(capture, legacy)).toThrow(
    expect.objectContaining({
      issues: [
        expect.objectContaining({ expected: ["terminal_observation_version"] }),
      ],
    }),
  );
});
