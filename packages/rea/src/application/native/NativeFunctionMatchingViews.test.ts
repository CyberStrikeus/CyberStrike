import {
  projectAnalysisView,
  analysisViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import { nativeFunctionMatchingSchema } from "../../domain/native/functionMatching.js";
import { expect, it } from "vitest";
import { matchNativeFunctions } from "./NativeFunctionMatchingService.js";
import { inspectAnalysisView } from "../analysisView/AnalysisViewService.js";
import { nativeMatchingNamedInventory as nativeMatchingInventory } from "../../../tests/fixtures/nativeFunctionMatching.js";

it("pages individual function facts without transferring an entire ambiguous alias group, preserving mandatory identity and source coverage", async () => {
  const entries = Array.from({ length: 500 }, (_, i) => ({
    address: `0x${i.toString(16)}`,
    value: "same",
  }));
  const matched = await matchNativeFunctions({
    left: nativeMatchingInventory("1", entries),
    right: nativeMatchingInventory("2", entries),
  });
  if (!matched.ok) throw matched.error;
  const source = { kind: "inline", evidence: matched.value.evidence };
  const view = async (query: unknown) => {
    const result = await inspectAnalysisView({ source, view: query });
    if (!result.ok) throw result.error;
    return analysisViewResultSchema.parse(result.value.normalized_result);
  };
  const groups = await view({
    kind: "function-matches",
    collection: "matches",
    fields: ["basis"],
    limit: 1,
  });
  expect(groups).toMatchObject({
    kind: "function-matches",
    coverage: { examined: 1, total: 1, exhausted: true },
    items: [
      { state: "unresolved", basis: null, left_count: 500, right_count: 500 },
    ],
  });
  if (groups.kind !== "function-matches") throw new Error("Wrong view");
  expect(groups.items[0]).not.toHaveProperty("left");
  const member = `${matched.value.sources[0]!.evidence_id}/123`;
  const functions = await view({
    kind: "function-matches",
    collection: "functions",
    function_ids: [member],
    fields: ["name"],
    limit: 1,
  });
  expect(functions).toMatchObject({
    kind: "function-matches",
    coverage: { examined: 1, total: 1, exhausted: true },
    items: [
      {
        function_id: member,
        source_index: 123,
        address: "0x7b",
        name: "same",
        side: "left",
        state: "unresolved",
        evidence_links: [matched.value.sources[0]!.evidence_id],
      },
    ],
  });
  expect(JSON.stringify(functions).length).toBeLessThan(6000);
  expect(
    await view({
      kind: "function-matches",
      collection: "functions",
      names: [],
      limit: 1,
    }),
  ).toMatchObject({ coverage: { total: 0 } });
  expect(
    await view({
      kind: "function-matches",
      collection: "functions",
      names: ["same"],
      sides: ["left"],
      limit: 1,
    }),
  ).toMatchObject({ coverage: { total: 500, next_offset: 1 } });
  expect(
    await view({
      kind: "function-matches",
      collection: "functions",
      sides: ["right"],
      offset: 499,
      limit: 2,
    }),
  ).toMatchObject({
    coverage: { examined: 1, total: 500, exhausted: true, next_offset: null },
  });
  expect(
    await view({
      kind: "function-matches",
      collection: "functions",
      states: [],
    }),
  ).toMatchObject({ coverage: { total: 0, exhausted: true } });
  expect(await view({ kind: "summary" })).toMatchObject({
    summary: {
      scope: "provider-observed-inputs",
      summary: { unresolved: 1 },
      left: { functions: 500 },
      right: { functions: 500 },
    },
  });
});

it("rebuilds native row selection when a caller's sealed flag covers only a shallow freeze", async () => {
  const matched = await matchNativeFunctions({
    left: nativeMatchingInventory("1", [{ address: "0x100", value: "same" }]),
    right: nativeMatchingInventory("2", [{ address: "0x200", value: "same" }]),
  });
  if (!matched.ok) throw matched.error;
  const report = nativeFunctionMatchingSchema.parse(
    matched.value.evidence.normalized_result,
  );
  Object.freeze(report);
  const parent = {
    evidenceId: matched.value.evidence.evidence_id,
    operation: matched.value.evidence.operation,
    normalizedResult: report,
    sealedResult: true,
    limitations: [],
  };
  const request: Parameters<typeof projectAnalysisView>[1] = {
    kind: "function-matches",
    collection: "functions",
    names: ["same"],
    sides: ["left"],
    fields: ["name"],
    offset: 0,
    limit: 1,
  };
  const first = projectAnalysisView(parent, request);
  expect(first).toMatchObject({ ok: true, value: { coverage: { total: 1 } } });
  const member = report.matches[0]?.left[0];
  if (member === undefined) throw new Error("Expected matched left member");
  member.name = "changed";
  const second = projectAnalysisView(parent, request);
  expect(second).toMatchObject({ ok: true, value: { coverage: { total: 0 } } });
});
