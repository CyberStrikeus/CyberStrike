import { expect, it, vi } from "vitest";
import { err, ok } from "../domain/result.js";
import type { HopperClient } from "./HopperClient.js";
import { reconcileHopperCallers } from "./HopperCallerReconciliation.js";
import { AnalysisWorkScope } from "../application/AnalysisWorkScope.js";
import {
  formatHopperCallerScanReason,
  HOPPER_CALLER_SCAN_RETENTION_BYTES,
} from "../domain/native/hopperCallerReconciliation.js";
import {
  hopperCallerScanBudgetForMilliseconds,
  hopperCallerScanRecovery,
} from "../config/hopperCallerScanBudget.js";
import {
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";

const identity = (address: string) => ({
  address,
  name: address,
  symbol: null,
  classification: null,
  body: { available: false as const, reason: "unknown" },
});
const target = identity("0x2000");
const caller = identity("0x3000");
const edge = {
  source_address: "0x3004",
  target_address: "0x2000",
  source_procedure: caller,
  target_procedure: target,
  kind: {
    available: false as const,
    reason:
      "Hopper exposes partial CallReference classification, but not detailed reference flags",
  },
  call: {
    classification: "direct" as const,
    provider_type: 2,
    provenance: "hopper-public-python-api:CallReference",
  },
};
const compactEdge = {
  source_address: edge.source_address,
  target_address: edge.target_address,
  source_procedure: "caller" as const,
  target_procedure: target.address,
  call: edge.call,
};
const page = (start: number) => ({
  start,
  next: start === 0 ? 64 : 65,
  total: 65,
  oversized: false,
  items:
    start === 0
      ? Array.from({ length: 64 }, (_, index) => ({
          caller: identity(`0x${(0x4000 + index).toString(16)}`),
          callees: [],
          references: [],
        }))
      : [{ caller, callees: [target.address], references: [compactEdge] }],
});
const reply = (method: string, start = 0) =>
  method === "rea_caller_scan_target"
    ? { target, instructions: [target.address], instructions_complete: true }
    : page(start);
const base = {
  target,
  instructions: [target.address],
  instructions_complete: true,
  callers: [],
  callers_complete: true,
};
const referenceResult = {
  procedure: target,
  direction: "incoming",
  reference_kinds_available: false,
  unresolved_calls: [],
  references: [],
};

it("builds one forward index for successive queries in a workflow", async () => {
  const callTool = vi
    .fn()
    .mockImplementation((method, args: { start: number }) =>
      Promise.resolve(ok(reply(method, args.start))),
    );
  const client = { callTool } as unknown as HopperClient;
  const scope = new AnalysisWorkScope();
  const options = { workScope: scope };
  const first = await reconcileHopperCallers(
    client,
    "procedure_callers",
    { procedure: "name" },
    base,
    options,
    250,
  );
  const second = await reconcileHopperCallers(
    client,
    "procedure_references",
    { procedure: "name", direction: "incoming" },
    referenceResult,
    options,
    250,
  );
  if (!first.ok) throw first.error;
  expect(first.value.result).toEqual(["0x3000"]);
  expect(first.value.rawResult).toMatchObject({
    native_result: { callers: [] },
    forward_observations: {
      target: { address: "0x2000" },
      callee_inventory_callers: [{ address: "0x3000" }],
      call_references: [
        {
          caller_address: caller.address,
          source_address: compactEdge.source_address,
          target_address: compactEdge.target_address,
          source_procedure: caller.address,
          target_procedure: compactEdge.target_procedure,
          call: compactEdge.call,
        },
      ],
      call_site_callers: [],
    },
  });
  if (
    first.value.rawResult !== null &&
    typeof first.value.rawResult === "object" &&
    !Array.isArray(first.value.rawResult)
  ) {
    const observations = first.value.rawResult.forward_observations;
    const sites =
      observations !== null &&
      typeof observations === "object" &&
      !Array.isArray(observations) &&
      Array.isArray(observations.call_references)
        ? observations.call_references
        : [];
    expect(sites[0]).not.toHaveProperty("name");
    expect(sites[0]).not.toHaveProperty("body");
    expect(first.value.rawResult).not.toHaveProperty(
      "native_result.instructions",
    );
  }
  if (!second.ok) throw second.error;
  expect(second.value.result).toMatchObject({
    references: [edge],
  });
  expect(
    callTool.mock.calls.filter(([method]) => method === "rea_caller_scan_page"),
  ).toHaveLength(2);
  scope.clear();
  await reconcileHopperCallers(
    client,
    "procedure_callers",
    { procedure: "name" },
    base,
    options,
    250,
  );
  expect(
    callTool.mock.calls.filter(([method]) => method === "rea_caller_scan_page"),
  ).toHaveLength(4);
});
it("links each compact call site to its owning caller address", async () => {
  const other = identity("0x5000");
  const otherEdge = {
    ...compactEdge,
    source_address: "0x5004",
    source_procedure: "caller" as const,
  };
  const callTool = vi.fn().mockImplementation((method: string) =>
    Promise.resolve(
      ok(
        method === "rea_caller_scan_target"
          ? reply(method)
          : {
              start: 0,
              next: 2,
              total: 2,
              oversized: false,
              items: [
                { caller, callees: [], references: [compactEdge] },
                {
                  caller: other,
                  callees: [target.address],
                  references: [otherEdge],
                },
              ],
            },
      ),
    ),
  );
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_callers",
    { procedure: "name" },
    base,
    undefined,
    250,
  );
  if (!result.ok) throw result.error;
  expect(result.value.rawResult).toMatchObject({
    forward_observations: {
      callee_inventory_callers: [{ address: other.address }],
      call_site_callers: [{ address: caller.address }],
      call_references: [
        {
          caller_address: caller.address,
          source_address: compactEdge.source_address,
          source_procedure: caller.address,
          target_address: compactEdge.target_address,
        },
        {
          caller_address: other.address,
          source_address: otherEdge.source_address,
          source_procedure: other.address,
          target_address: otherEdge.target_address,
        },
      ],
    },
  });
  expect(result.value.result).toEqual([other.address, caller.address]);
});

it("merges paged call sites and pins the selected target", async () => {
  const callTool = vi
    .fn()
    .mockImplementation((method, args: { start: number }) =>
      Promise.resolve(ok(reply(method, args.start))),
    );
  const client = { callTool } as unknown as HopperClient;
  const result = await reconcileHopperCallers(
    client,
    "procedure_references",
    { procedure: "name", direction: "incoming" },
    referenceResult,
    undefined,
    250,
  );
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({ references: [edge] });
  expect(result.value.scan).toMatchObject({
    examined_procedures: 65,
    procedure_total: 65,
    stop: { code: "complete" },
    instructions_complete: true,
    native_callers_complete: null,
  });
  if (result.value.scan === undefined) throw new Error("missing scan facts");
  expect(result.value.reason).toBe(
    formatHopperCallerScanReason(result.value.scan),
  );
  expect(callTool.mock.calls[2]?.[1]).toMatchObject({ start: 64 });
});
it("does not reuse a previous scan", async () => {
  const callTool = vi
    .fn()
    .mockImplementation((method, args: { start: number }) =>
      Promise.resolve(ok(reply(method, args.start))),
    );
  const client = { callTool } as unknown as HopperClient;
  const result = await reconcileHopperCallers(
    client,
    "procedure_callers",
    { procedure: "name" },
    base,
    undefined,
    250,
  );
  expect(result.ok && result.value.result).toEqual(["0x3000"]);
  callTool.mockImplementation((method, args: { start: number }) =>
    Promise.resolve(
      ok(
        method === "rea_caller_scan_target"
          ? reply(method)
          : {
              ...page(args.start),
              items: page(args.start).items.map((item) => ({
                ...item,
                callees: [],
                references: [],
              })),
            },
      ),
    ),
  );
  const changed = await reconcileHopperCallers(
    client,
    "procedure_callers",
    { procedure: "name" },
    base,
    undefined,
    250,
  );
  if (!changed.ok) throw changed.error;
  expect(changed.value.result).toEqual([]);
});
it("stops between pages on cancellation", async () => {
  const controller = new AbortController();
  const callTool = vi.fn().mockImplementation((method: string) => {
    controller.abort("test cancellation");
    return Promise.resolve(ok(reply(method)));
  });
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_callers",
    {},
    base,
    { signal: controller.signal },
    250,
  );
  if (result.ok) throw new Error("expected the caller scan to fail");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe("test cancellation");
  expect(result.error.partialObservation).toMatchObject({
    kind: "hopper-caller-reconciliation",
    native_result: base,
    coverage: { status: "unknown" },
    scan: {
      examined_procedures: 64,
      procedure_total: 65,
      stop: { code: "cancelled" },
    },
  });
  expect(callTool).toHaveBeenCalledTimes(1);
});
it("preserves cancellation while reporting the last page", async () => {
  const controller = new AbortController();
  const callTool = vi
    .fn()
    .mockImplementation((method: string) =>
      Promise.resolve(
        ok(
          method === "rea_caller_scan_target"
            ? reply(method)
            : { ...page(64), start: 0, next: 1, total: 1 },
        ),
      ),
    );
  const progress = {
    report: async () => {
      controller.abort("cancelled in progress");
    },
  };
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_callers",
    {},
    base,
    { signal: controller.signal, progress },
    250,
  );
  if (result.ok) throw new Error("expected the caller scan to fail");
  expect(result.error.cause).toBe("cancelled in progress");
  expect(result.error.partialObservation).toMatchObject({
    kind: "hopper-caller-reconciliation",
    native_result: base,
    coverage: { status: "unknown" },
    scan: {
      examined_procedures: 1,
      procedure_total: 1,
      stop: { code: "cancelled" },
    },
    forward_destinations: {
      identities: [expect.objectContaining({ address: caller.address })],
      destinations: [
        expect.objectContaining({
          address: target.address,
          caller_addresses: [caller.address],
        }),
      ],
    },
  });
});
it("retains completed pages when a later scan page fails", async () => {
  let pages = 0;
  const callTool = vi.fn().mockImplementation((method: string) => {
    if (method === "rea_caller_scan_target")
      return Promise.resolve(ok(reply(method)));
    pages += 1;
    if (pages === 1) return Promise.resolve(ok(page(0)));
    return Promise.resolve(
      err(
        new AnalysisOutputError("rea_caller_scan_page", "bridge page failed"),
      ),
    );
  });
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_callers",
    {},
    base,
    undefined,
    250,
  );
  if (result.ok) throw new Error("expected the caller scan to fail");
  expect(result.error).toMatchObject({ _tag: "AnalysisOutputError" });
  expect(result.error.partialObservation).toMatchObject({
    kind: "hopper-caller-reconciliation",
    native_result: base,
    coverage: { status: "unknown" },
    scan: {
      examined_procedures: 64,
      procedure_total: 65,
      stop: { code: "page_failure" },
    },
  });
});
it("reports a changing inventory as incomplete", async () => {
  const callTool = vi
    .fn()
    .mockImplementation((method, args: { start: number }) =>
      Promise.resolve(
        ok(
          method === "rea_caller_scan_target"
            ? reply(method)
            : { ...page(args.start), total: args.start === 0 ? 65 : 66 },
        ),
      ),
    );
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_callers",
    {},
    base,
    undefined,
    250,
  );
  if (!result.ok) throw result.error;
  expect(result.value.scan).toMatchObject({
    examined_procedures: 64,
    procedure_total: 65,
    stop: { code: "inventory_changed" },
  });
  if (result.value.scan === undefined) throw new Error("missing scan facts");
  expect(result.value.reason).toBe(
    formatHopperCallerScanReason(result.value.scan),
  );
});

it("retains original callers and reports a procedure that exceeds the page allowance", async () => {
  const callTool = vi
    .fn()
    .mockResolvedValue(
      ok({ start: 0, next: 0, total: 65, oversized: true, items: [] }),
    );
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_callers",
    {},
    { ...base, callers: ["0x1000"] },
    undefined,
    250,
  );
  if (!result.ok) throw result.error;
  expect(result.value.result).toEqual(["0x1000"]);
  expect(result.value.scan).toMatchObject({
    examined_procedures: 0,
    procedure_total: 65,
    stop: {
      code: "page_allowance",
      allowance_bytes: 512 * 1024,
    },
  });
  if (result.value.scan === undefined) throw new Error("missing scan facts");
  expect(result.value.reason).toBe(
    `${formatHopperCallerScanReason(result.value.scan)} ${hopperCallerScanRecovery(result.value.scan, hopperCallerScanBudgetForMilliseconds(250))}`,
  );
});

it("refuses expanded reference copies that exceed the retained scan budget", async () => {
  const huge = "n".repeat(HOPPER_CALLER_SCAN_RETENTION_BYTES);
  const heavy = { ...target, name: huge };
  const callTool = vi.fn().mockImplementation((method: string) =>
    Promise.resolve(
      ok(
        method === "rea_caller_scan_target"
          ? {
              target: heavy,
              instructions: [target.address],
              instructions_complete: true,
            }
          : {
              start: 0,
              next: 1,
              total: 1,
              oversized: false,
              items: [
                {
                  caller,
                  callees: [target.address],
                  references: [
                    compactEdge,
                    { ...compactEdge, source_address: "0x3008" },
                  ],
                },
              ],
            },
      ),
    ),
  );
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_references",
    { procedure: "name", direction: "incoming" },
    referenceResult,
    undefined,
    250,
  );
  if (result.ok) throw new Error("expected the caller scan to fail");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(result.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    reportedLimits: {
      allowance_bytes: HOPPER_CALLER_SCAN_RETENTION_BYTES,
    },
    partialObservation: {
      kind: "hopper-caller-reconciliation",
      scan: {
        stop: {
          code: "retention_budget",
          allowance_bytes: HOPPER_CALLER_SCAN_RETENTION_BYTES,
        },
      },
    },
  });
  expect(JSON.stringify(result.error.partialObservation)).not.toContain(huge);
});

it("reports truncated target instructions and native callers", async () => {
  const callTool = vi
    .fn()
    .mockResolvedValue(
      ok({ start: 0, next: 0, total: 0, oversized: false, items: [] }),
    );
  const result = await reconcileHopperCallers(
    { callTool } as unknown as HopperClient,
    "procedure_callers",
    {},
    { ...base, instructions_complete: false, callers_complete: false },
    undefined,
    250,
  );
  if (!result.ok) throw result.error;
  expect(result.value.scan).toMatchObject({
    examined_procedures: 0,
    procedure_total: 0,
    stop: { code: "complete" },
    instructions_complete: false,
    native_callers_complete: false,
  });
  if (result.value.scan === undefined) throw new Error("missing scan facts");
  expect(result.value.reason).toBe(
    `${formatHopperCallerScanReason(result.value.scan)} ${hopperCallerScanRecovery(result.value.scan, hopperCallerScanBudgetForMilliseconds(250))}`,
  );
});
