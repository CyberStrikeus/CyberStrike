import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AnalysisCapabilityUnavailableError,
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../../../src/domain/analysisErrorCore.js";
import type { AnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { EvidenceIntegrityError } from "../../../../src/domain/evidenceErrors.js";
import { nativeCallPartialObservationSchema } from "../../../../src/domain/native/nativeCallPartialObservation.js";
import { nativeCallObservationResultSchema } from "../../../../src/domain/native/nativeCallObservation.js";
import { err, ok, type Result } from "../../../../src/domain/result.js";
import type {
  NativeCallTrace,
  NativeCallTracer,
} from "../../../../src/native/LldbCallTracer.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const LOCATION = {
  load_address: "0x100000928",
  file_address: "0x100000928",
  module: "Fixture",
  module_path: "/tmp/Fixture",
  symbol: "-[Greeter greet:times:]",
};

const run = (
  overrides: Partial<NativeCallTrace["run"]> = {},
): NativeCallTrace["run"] => ({
  status: "traced",
  version: "lldb-2100.0.17.203",
  pid: 4242,
  outcome: "exited",
  resource_limit_reached: false,
  target_output: {
    stdout_bytes: 0,
    stderr_bytes: 0,
    stdout_truncated: false,
    stderr_truncated: false,
    stdout_complete: true,
    stderr_complete: true,
  },
  exit_status: 0,
  exit_description: null,
  killed: false,
  terminated: true,
  target_identity: {
    loaded_image_sha256: null,
    selected_file_sha256: "a".repeat(64),
    file_device: "1",
    file_inode: "2",
    module_path: "/tmp/Fixture",
    module_uuid: "fixture-uuid",
    stable: true,
  },
  elapsed_ms: 12.5,
  breakpoints: [
    { index: 0, location_count: 1, locations: [LOCATION] },
    { index: 1, location_count: 1, locations: [LOCATION] },
  ],
  events: [
    {
      sequence: 0,
      elapsed_ms: 3,
      thread_id: 7,
      breakpoint_index: 0,
      ...LOCATION,
      receiver_class: "Greeter",
      selector: "greet:times:",
      registers: [
        { name: "x0", value: "0x6000" },
        { name: "x1", value: "0x7000" },
      ],
      backtrace: [],
    },
  ],
  other_stops: [],
  ...overrides,
});

/** Records the request and returns a canned run or failure. */
class FixtureTracer implements NativeCallTracer {
  readonly requests: Parameters<NativeCallTracer["trace"]>[0][] = [];

  constructor(
    private readonly outcome: Result<NativeCallTrace, AnalysisError> = ok({
      debugger: {
        path: "/usr/bin/lldb",
        sha256: "a".repeat(64),
        version: "lldb-2100.0.17.203",
      },
      run: run(),
      stdout: { text: "hello\n", bytes: 6, truncated: false, complete: true },
      stderr: { text: "", bytes: 0, truncated: false, complete: true },
      terminated: true,
    }),
  ) {}

  trace(request: Parameters<NativeCallTracer["trace"]>[0]) {
    this.requests.push(request);
    return Promise.resolve(this.outcome);
  }

  close() {
    return Promise.resolve(ok(null));
  }
}

const BREAKPOINTS = [
  { kind: "objc-method", class_name: "Greeter", selector: "greet:times:" },
  { kind: "function", name: "rea_add" },
];

const fixtureTarget = async () => {
  const directory = await createTestTempDirectory("rea-native-calls-");
  const path = join(directory, "Fixture");
  await writeFile(path, "fixture executable");
  return {
    ...nativeMachoTarget(path),
    sha256: createHash("sha256").update("fixture executable").digest("hex"),
  };
};

const observe = async (
  tracer: NativeCallTracer,
  parameters: Record<string, unknown>,
  target?: Awaited<ReturnType<typeof fixtureTarget>>,
  signal?: AbortSignal,
) =>
  new NativeMacOSProvider({}, new NativeFixtureRunner(), "darwin", () => tracer)
    .createClient(target ?? (await fixtureTarget()))
    .execute(
      "observe_native_calls",
      // The provider parses JSON-like parameters itself.
      JSON.parse(JSON.stringify(parameters)),
      signal === undefined ? undefined : { signal },
    );

describe("observe_native_calls projection: projects completed observations", () => {
  it("launches the active Mach-O through the tracer and projects its run", async () => {
    const tracer = new FixtureTracer();
    const target = await fixtureTarget();
    const observed = await observe(
      tracer,
      {
        breakpoints: BREAKPOINTS,
        arguments: ["--flag"],
        environment: { REA_CASE: "selected" },
      },
      target,
    );
    if (!observed.ok) throw observed.error;
    expect(tracer.requests[0]).toMatchObject({
      executable: target.path,
      architecture: "arm64",
      input: {
        arguments: ["--flag"],
        environment: { REA_CASE: "selected" },
        duration_ms: 10_000,
        max_events: 1_000,
        argument_registers: 4,
        backtrace_frames: 0,
      },
    });
    const result = nativeCallObservationResultSchema.parse(
      observed.value.result,
    );
    expect(result.target.environment).toEqual({ REA_CASE: "selected" });
    expect(result.breakpoints.map(({ request }) => request)).toEqual([
      {
        kind: "objc-method",
        class_name: "Greeter",
        selector: "greet:times:",
        method_type: "any",
      },
      { kind: "function", name: "rea_add", module: null },
    ]);
    expect(result.process).toMatchObject({
      pid: 4242,
      outcome: "exited",
      exit_status: 0,
      terminated: true,
      stdout: { text: "hello\n" },
    });
    expect(result.target.launch_identity).toEqual({
      file_device: "1",
      file_inode: "2",
      loaded_image_sha256: null,
      selected_file_sha256: "a".repeat(64),
      module_path: "/tmp/Fixture",
      module_uuid: "fixture-uuid",
      stable: true,
    });
    expect(result.events[0]).toMatchObject({
      receiver_class: "Greeter",
      selector: "greet:times:",
    });
    expect(result.coverage).toEqual({
      status: "complete",
      event_limit_reached: false,
      resource_limit_reached: false,
      unresolved_breakpoints: [],
    });
    expect(observed.value.locations).toEqual([
      { kind: "artifact-path", path: target.path },
    ]);
  });
});

describe("observe_native_calls projection: reports partial observation coverage", () => {
  it("retains normal exit and location counts when breakpoint metadata is bounded", async () => {
    const observed = await observe(
      new FixtureTracer(
        ok({
          debugger: {
            path: "/usr/bin/lldb",
            sha256: "a".repeat(64),
            version: null,
          },
          run: run({
            breakpoint_locations_truncated: true,
            breakpoints: [
              { index: 0, location_count: 64, locations: [LOCATION] },
              { index: 1, location_count: 64, locations: [] },
            ],
          }),
          stdout: { text: "", bytes: 0, truncated: false, complete: true },
          stderr: { text: "", bytes: 0, truncated: false, complete: true },
          terminated: true,
        }),
      ),
      { breakpoints: BREAKPOINTS },
    );
    if (!observed.ok) throw observed.error;
    const result = nativeCallObservationResultSchema.parse(
      observed.value.result,
    );
    expect(result.process).toMatchObject({
      outcome: "exited",
      exit_status: 0,
      terminated: true,
    });
    expect(
      result.breakpoints.map(({ location_count }) => location_count),
    ).toEqual([64, 64]);
    expect(result.coverage).toMatchObject({
      status: "partial",
      breakpoint_locations_truncated: true,
      resource_limit_reached: false,
      unresolved_breakpoints: [],
    });
    expect(result.limitations).toContain(
      "Resolved breakpoint locations exceeded the aggregate 8388608-byte (8 MiB) metadata budget; omitted locations are counted in location_count. This metadata limit does not change the process outcome. This release has no runtime override.",
    );
    expect(result.limitations.join(" ")).not.toContain("process was killed");
  });

  it("marks event limits, unresolved breakpoints and unconfirmed exits", async () => {
    const tracer = new FixtureTracer(
      ok({
        debugger: {
          path: "/usr/bin/lldb",
          sha256: "a".repeat(64),
          version: null,
        },
        run: run({
          outcome: "event-limit",
          exit_status: null,
          killed: true,
          terminated: false,
          breakpoints: [
            { index: 0, location_count: 1, locations: [LOCATION] },
            { index: 1, location_count: 0, locations: [] },
          ],
        }),
        stdout: { text: "", bytes: 0, truncated: false, complete: false },
        stderr: {
          text: "x".repeat(16),
          bytes: 2_000_000,
          truncated: true,
          complete: true,
        },
        terminated: true,
      }),
    );
    const observed = await observe(tracer, {
      breakpoints: BREAKPOINTS,
      max_events: 1,
    });
    if (!observed.ok) throw observed.error;
    const result = nativeCallObservationResultSchema.parse(
      observed.value.result,
    );
    expect(result.coverage).toEqual({
      status: "partial",
      event_limit_reached: true,
      resource_limit_reached: false,
      unresolved_breakpoints: [1],
    });
    expect(result.process.terminated).toBe(false);
    expect(result.limitations.join(" ")).not.toContain("was killed");
    expect(result.limitations).toContain(
      "Target output draining did not complete; reported byte counts are observed lower bounds, not stream totals.",
    );
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Observation stopped at max_events (1); later calls were not recorded and termination was requested but could not be confirmed.",
        "Breakpoints 1 matched no code in any image loaded while observing; their calls could not be observed.",
        "Target output beyond 1048576 bytes (1 MiB) per stream is counted but not kept. This release has no runtime override.",
        "REA could not confirm that process 4242 exited; check for it before relying on host state.",
      ]),
    );
  });

  it("marks duration and aggregate resource limits as partial coverage", async () => {
    for (const outcome of ["duration-elapsed", "resource-limit"] as const) {
      const tracer = new FixtureTracer(
        ok({
          debugger: {
            path: "/usr/bin/lldb",
            sha256: "a".repeat(64),
            version: null,
          },
          run: run({
            outcome,
            resource_limit_reached: outcome === "resource-limit",
          }),
          stdout: { text: "", bytes: 0, truncated: false, complete: true },
          stderr: { text: "", bytes: 0, truncated: false, complete: true },
          terminated: true,
        }),
      );
      const observed = await observe(tracer, { breakpoints: BREAKPOINTS });
      if (!observed.ok) throw observed.error;
      const result = nativeCallObservationResultSchema.parse(
        observed.value.result,
      );
      expect(result.coverage).toMatchObject({
        status: "partial",
        resource_limit_reached: outcome === "resource-limit",
      });
    }
  });
});

describe("observe_native_calls projection: preserves unknown launch identity", () => {
  it("preserves unknown launch identity without claiming digest binding", async () => {
    const tracer = new FixtureTracer(
      ok({
        debugger: {
          path: "/usr/bin/lldb",
          sha256: "a".repeat(64),
          version: null,
        },
        run: run({
          target_identity: {
            loaded_image_sha256: null,
            selected_file_sha256: null,
            file_device: null,
            file_inode: null,
            module_path: null,
            module_uuid: null,
            stable: false,
          },
        }),
        stdout: { text: "", bytes: 0, truncated: false, complete: true },
        stderr: { text: "", bytes: 0, truncated: false, complete: true },
        terminated: true,
      }),
    );
    const observed = await observe(tracer, { breakpoints: BREAKPOINTS });
    if (!observed.ok) throw observed.error;
    const result = nativeCallObservationResultSchema.parse(
      observed.value.result,
    );
    expect(result.target.launch_identity).toEqual({
      file_device: null,
      file_inode: null,
      loaded_image_sha256: null,
      selected_file_sha256: null,
      module_path: null,
      module_uuid: null,
      stable: false,
    });
    expect(result.limitations).toContain(
      "LLDB did not provide enough module identity evidence to confirm pathname and module continuity around launch.",
    );
  });
});

describe("observe_native_calls failures", () => {
  it("rejects malformed input before launching anything", async () => {
    for (const parameters of [
      { breakpoints: [] },
      { breakpoints: [{ kind: "objc-method", selector: "-[A b]" }] },
      { breakpoints: BREAKPOINTS, environment: { "A=B": "x" } },
      { breakpoints: BREAKPOINTS, argument_registers: 9 },
    ]) {
      const tracer = new FixtureTracer();
      const observed = await observe(tracer, parameters);
      expect(observed.ok).toBe(false);
      if (!observed.ok)
        expect(observed.error).toBeInstanceOf(AnalysisInputError);
      expect(tracer.requests).toEqual([]);
    }
  });

  it("refuses a changed or non-Mach-O target", async () => {
    const tracer = new FixtureTracer();
    const target = await fixtureTarget();
    const changed = await observe(
      tracer,
      { breakpoints: BREAKPOINTS },
      { ...target, sha256: "f".repeat(64) },
    );
    expect(!changed.ok && changed.error).toBeInstanceOf(EvidenceIntegrityError);
    const database = await new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => tracer,
    )
      .createClient({
        path: target.path,
        sha256: target.sha256,
        kind: "database",
        format: "analysis-database",
      })
      .execute("observe_native_calls", { breakpoints: [] });
    expect(!database.ok && database.error).toBeInstanceOf(
      AnalysisCapabilityUnavailableError,
    );
    expect(tracer.requests).toEqual([]);
  });

  it("keeps the tracer's failure reason and caller cancellation", async () => {
    const denied = new AnalysisCapabilityUnavailableError(
      "native-macos",
      "observe_native_calls",
      "debugger-attach-denied: attach failed",
    );
    const failed = await observe(new FixtureTracer(err(denied)), {
      breakpoints: BREAKPOINTS,
    });
    expect(!failed.ok && failed.error).toBe(denied);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await observe(
      new FixtureTracer(),
      { breakpoints: BREAKPOINTS },
      undefined,
      controller.signal,
    );
    expect(!cancelled.ok && cancelled.error).toBeInstanceOf(
      AnalysisCancelledError,
    );
  });
});

it("retains completed call facts when cancellation arrives with the tracer result", async () => {
  const controller = new AbortController();
  const reason = { caller: "completed-trace-consumption" };
  const recorded = new FixtureTracer();
  const result = await observe(
    {
      trace: async (request) => {
        const result = await recorded.trace(request);
        controller.abort(reason);
        return result;
      },
      close: () => recorded.close(),
    },
    { breakpoints: BREAKPOINTS },
    undefined,
    controller.signal,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected completion cancellation");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
  });
  const partial = nativeCallPartialObservationSchema.parse(
    result.error.partialObservation,
  );
  expect(partial.events).toHaveLength(1);
  expect(partial.process.stdout?.text).toBe("hello\n");
  expect(partial.process.terminated).toBe(true);
  expect(partial.coverage).toMatchObject({
    status: "partial",
    reason: "cancelled",
  });
});
