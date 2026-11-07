import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { matchNativeFunctions } from "./NativeFunctionMatchingService.js";
import { nativeFunctionMatchingSchema } from "../../domain/native/functionMatching.js";
import { createEvidence, immutableEvidence } from "../../domain/evidence.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { functionDossierSchema } from "../../domain/native/functionDossier.js";
import { procedureInfoSchema } from "../../domain/native/procedureInfo.js";
import {
  nativeMatchingNamedInventory as nativeMatchingInventory,
  nativeMatchingInventory as unqualifiedInventory,
  nativeMatchingDetails,
  nativeMatchingTarget,
  nativeMatchingProvider,
} from "../../../tests/fixtures/nativeFunctionMatching.js";

const compare = async (input: unknown) => {
  const result = await matchNativeFunctions(input);
  if (!result.ok) throw result.error;
  return {
    ...result.value,
    report: nativeFunctionMatchingSchema.parse(
      result.value.evidence.normalized_result,
    ),
  };
};

it("retains transitive provenance without treating dependencies as native observations and fails closed for a missing ancestor", async () => {
  const ancestor = createEvidence(undefined, nativeMatchingProvider, {
    operation: "fixture_provenance",
    parameters: {},
    result: { provenance: "Synthetic ancestor" },
  });
  const dependency = createEvidence(undefined, nativeMatchingProvider, {
    operation: "fixture_dependency",
    parameters: {},
    result: { provenance: "Synthetic dependency" },
    evidenceLinks: [ancestor.evidence_id],
  });
  const left = nativeMatchingInventory(
    "1",
    [{ address: "0x10", value: "main" }],
    [dependency.evidence_id],
  );
  const right = nativeMatchingInventory(
    "2",
    [{ address: "0x20", value: "main" }],
    [dependency.evidence_id],
  );
  const dependencies = new Map(
    [ancestor, dependency].map((record) => [record.evidence_id, record]),
  );
  const result = await matchNativeFunctions({ left, right }, undefined, (id) =>
    dependencies.get(id),
  );
  if (!result.ok) throw result.error;
  expect(
    new Set(result.value.sources.map((record) => record.evidence_id)),
  ).toEqual(
    new Set(
      [left, right, dependency, ancestor].map((record) => record.evidence_id),
    ),
  );
  expect(new Set(result.value.evidence.evidence_links)).toEqual(
    new Set([left.evidence_id, right.evidence_id]),
  );
  expect(
    nativeFunctionMatchingSchema.parse(result.value.evidence.normalized_result)
      .summary.matched,
  ).toBe(1);
  const missing = await matchNativeFunctions(
    { left, right },
    undefined,
    (id) => (id === dependency.evidence_id ? dependency : undefined),
  );
  expect(missing.ok).toBe(false);
  if (missing.ok) throw new Error("Missing ancestor accepted");
  expect(missing.error).toMatchObject({
    evidenceId: ancestor.evidence_id,
    reason: "missing",
  });
});

it("keeps symbol origin unknown when supplied metadata describes a different same-address alias", async () => {
  const left = unqualifiedInventory("1", [
    { address: "0x10", value: "reported_name" },
  ]);
  const right = unqualifiedInventory("2", [
    { address: "0x20", value: "reported_name" },
  ]);
  const alias = createEvidence(
    nativeMatchingTarget("1"),
    nativeMatchingProvider,
    {
      operation: "list_names",
      parameters: {},
      result: [
        {
          address: "0x10",
          value: "other_alias",
          symbol: {
            primary: false,
            dynamic: false,
            external: false,
            type: "function",
            source: "user_defined",
          },
        },
      ],
    },
  );
  const { report } = await compare({ left, right, left_observations: [alias] });
  expect(report.summary.matched).toBe(0);
  const member = report.matches
    .flatMap((match) => match.left)
    .find((value) => value.address === "0x10");
  expect(member?.limitations).toContain(
    "Symbol origin unavailable; exact-name matching is unavailable. Independent complete body bytes remain eligible.",
  );
  expect(member?.evidence_links).toContain(alias.evidence_id);
});

it("preserves contradictory symbol origins from inventory/name facts or multiple name observations, independently of byte correspondence", async () => {
  const observe = (operation: string, generated: boolean) =>
    createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
      operation,
      parameters: {},
      result: [
        {
          address: "0x10",
          value: "same_name",
          symbol: {
            primary: true,
            dynamic: generated,
            external: false,
            type: "function",
            source: generated ? "default" : "user_defined",
          },
        },
      ],
    });
  const right = nativeMatchingInventory("2", [
    { address: "0x20", value: "same_name" },
  ]);
  for (const [left, names] of [
    [observe("list_procedures", false), [observe("list_names", true)]],
    [observe("list_procedures", true), [observe("list_names", false)]],
    [
      nativeMatchingInventory("1", [{ address: "0x10", value: "same_name" }]),
      [observe("list_names", false), observe("list_names", true)],
    ],
    [
      nativeMatchingInventory("1", [{ address: "0x10", value: "same_name" }]),
      [observe("list_names", true), observe("list_names", false)],
    ],
  ] as const) {
    for (const withBytes of [false, true]) {
      const { report } = await compare({
        left,
        right,
        left_observations: [
          ...names,
          ...(withBytes ? nativeMatchingDetails("1", "0x10", "c3") : []),
        ],
        right_observations: withBytes
          ? nativeMatchingDetails("2", "0x20", "c3")
          : [],
      });
      expect(report.summary.matched).toBe(withBytes ? 1 : 0);
      expect(report.matches[0]!.basis).toBe(
        withBytes ? "identical-bytes" : null,
      );
      const member = report.matches[0]!.left[0]!;
      expect(member.limitations).toContain(
        "Conflicting generated and named symbol-origin observations; exact-name matching is unavailable. Independent complete body bytes remain eligible.",
      );
      expect(member.limitations.join(" ")).not.toContain(
        "Symbol origin unavailable",
      );
      for (const source of names)
        expect(member.evidence_links).toContain(source.evidence_id);
    }
  }
});

it.each(["", "ram:"])(
  "keeps informative %s CFG/call/string fingerprints as unresolved candidates and refuses incomplete structural observations",
  async (space) => {
    const profile = createAnalysisProfile(nativeMatchingProvider, {
      fixture: "structural-candidates-v1",
    });
    const observe = (
      side: "1" | "2",
      operation: string,
      result: Parameters<typeof createEvidence>[2]["result"],
      complete = true,
    ) =>
      createEvidence(nativeMatchingTarget(side), nativeMatchingProvider, {
        operation,
        parameters: {},
        result,
        analysisProfile: profile,
        relationshipCoverage: complete
          ? { status: "complete" }
          : { status: "unknown", reason: "Missing direct call coverage" },
      });
    const left = observe("1", "list_procedures", [
      { address: `${space}0x10`, value: "old_behavior" },
    ]);
    const right = observe("2", "list_procedures", [
      { address: `${space}0x20`, value: "new_behavior" },
    ]);
    const dossier = (side: "1" | "2", address: string) => {
      const value = functionDossierSchema.parse(
        nativeMatchingDetails(side, address, "0102", true)[0]!
          .normalized_result,
      );
      value.basic_blocks = [
        {
          start: address,
          end: `0x${(BigInt(address) + 2n).toString(16)}`,
          successors: [],
        },
      ];
      value.callees = [
        {
          address: "0x500",
          name: "puts",
          symbol: {
            primary: true,
            dynamic: false,
            external: true,
            type: "function",
            source: "imported",
          },
          classification: null,
          body: { available: false, reason: "Synthetic external target" },
        },
      ];
      value.unresolved_calls = [];
      value.referenced_strings = [
        { address: "0x900", value: "marker", source_address: address },
      ];
      value.procedure.address = `${space}${address}`;
      if (value.procedure.body.available)
        value.procedure.body.ranges = value.procedure.body.ranges.map(
          (range) => ({
            start: `${space}${range.start}`,
            end: `${space}${range.end}`,
          }),
        );
      value.basic_blocks = value.basic_blocks.map((block) => ({
        start: `${space}${block.start}`,
        end: `${space}${block.end}`,
        successors: block.successors.map((successor) => `${space}${successor}`),
      }));
      value.referenced_strings[0]!.source_address = `${space}${address}`;
      return value;
    };
    const l = dossier("1", "0x10"),
      r = dossier("2", "0x20");
    const { report } = await compare({
      left,
      right,
      left_observations: [observe("1", "analyze_function", l)],
      right_observations: [observe("2", "analyze_function", r)],
    });
    expect(report.summary).toEqual({
      matched: 0,
      only_left: 0,
      only_right: 0,
      unresolved: 1,
    });
    expect(report.matches[0]?.left[0]?.structural_candidate_sha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(report.matches[0]?.left[0]?.structural_candidate_sha256).toBe(
      report.matches[0]?.right[0]?.structural_candidate_sha256,
    );
    expect(report.matches[0]?.compare_functions_input).toBeNull();
    const unknownOrigin = dossier("1", "0x10");
    if (unknownOrigin.callees[0] === undefined)
      throw new Error("Missing fixture callee");
    unknownOrigin.callees[0].symbol = null;
    const unqualified = await compare({
      left,
      right,
      left_observations: [observe("1", "analyze_function", unknownOrigin)],
      right_observations: [observe("2", "analyze_function", r)],
    });
    expect(unqualified.report.source_coverage.left_structural_candidates).toBe(
      0,
    );
    const incomplete = await compare({
      left,
      right,
      left_observations: [observe("1", "analyze_function", l, false)],
      right_observations: [observe("2", "analyze_function", r)],
    });
    expect(incomplete.report.summary.unresolved).toBe(0);
    expect(incomplete.report.source_coverage.left_structural_candidates).toBe(
      0,
    );
    const legacy = { ...l };
    delete legacy.facet_availability;
    const missingFacets = await compare({
      left,
      right,
      left_observations: [observe("1", "analyze_function", legacy)],
      right_observations: [observe("2", "analyze_function", r)],
    });
    expect(
      missingFacets.report.source_coverage.left_structural_candidates,
    ).toBe(0);
    expect(missingFacets.report.summary.unresolved).toBe(0);
    l.callees = [];
    l.referenced_strings = [];
    r.callees = [];
    r.referenced_strings = [];
    const uninformative = await compare({
      left,
      right,
      left_observations: [observe("1", "analyze_function", l)],
      right_observations: [observe("2", "analyze_function", r)],
    });
    expect(
      uninformative.report.source_coverage.left_structural_candidates,
    ).toBe(0);
    expect(uninformative.report.summary.unresolved).toBe(0);
  },
);

it("matches symbols before bytes, retains exact renamed bytes, changed pairs, unpaired observations and duplicate candidates", async () => {
  const left = nativeMatchingInventory("1", [
    { address: "0x1000", value: "stable" },
    { address: "0x1010", value: "changed" },
    { address: "0x1020", value: "old_name" },
    { address: "0x1030", value: "removed_observation" },
    { address: "0x1040", value: "duplicate" },
    { address: "0x1050", value: "duplicate" },
  ]);
  const right = nativeMatchingInventory("2", [
    { address: "0x2000", value: "stable" },
    { address: "0x2010", value: "changed" },
    { address: "0x2020", value: "renamed" },
    { address: "0x2030", value: "added_observation" },
    { address: "0x2040", value: "duplicate" },
  ]);
  const result = await compare({
    left,
    right,
    left_observations: [
      ...nativeMatchingDetails("1", "0x1010", "0102"),
      ...nativeMatchingDetails("1", "0x1020", "030405", true),
    ],
    right_observations: [
      ...nativeMatchingDetails("2", "0x2010", "aabb"),
      ...nativeMatchingDetails("2", "0x2020", "030405", true),
    ],
  });
  expect(result.report.summary).toEqual({
    matched: 3,
    only_left: 1,
    only_right: 1,
    unresolved: 1,
  });
  const renamed = result.report.matches.find(
    (row) => row.basis === "identical-bytes",
  )!;
  expect(renamed.left[0]).toMatchObject({
    name: "old_name",
    body_bytes: 3,
    body_sha256: createHash("sha256")
      .update(Buffer.from("030405", "hex"))
      .digest("hex"),
  });
  expect(renamed.right[0]?.name).toBe("renamed");
  expect(renamed.compare_functions_input?.left.evidence_id).toBe(
    renamed.left[0]?.dossier_evidence_id,
  );
  expect(
    result.report.matches.find((row) => row.left[0]?.name === "changed"),
  ).toMatchObject({ state: "matched", basis: "exact-symbol" });
  expect(
    result.report.matches.find((row) => row.state === "unresolved"),
  ).toMatchObject({
    left: [expect.anything(), expect.anything()],
    right: [expect.anything()],
  });
  expect(new Set(result.evidence.evidence_links)).toEqual(
    new Set(result.sources.map((x) => x.evidence_id)),
  );
  expect(result.report.limitations.join(" ")).toContain("never prove absence");
});

it("does not force repeated identical-byte candidates after an exact name consumes an alias", async () => {
  const left = nativeMatchingInventory("1", [
    { address: "0x10", value: "known" },
    { address: "0x20", value: "FUN_20" },
  ]);
  const right = nativeMatchingInventory("2", [
    { address: "0x30", value: "known" },
    { address: "0x40", value: "FUN_40" },
  ]);
  const { report } = await compare({
    left,
    right,
    left_observations: [
      ...nativeMatchingDetails("1", "0x10", "c3"),
      ...nativeMatchingDetails("1", "0x20", "c3"),
    ],
    right_observations: [
      ...nativeMatchingDetails("2", "0x30", "c3"),
      ...nativeMatchingDetails("2", "0x40", "c3"),
    ],
  });
  expect(report.summary).toEqual({
    matched: 1,
    unresolved: 1,
    only_left: 0,
    only_right: 0,
  });
  expect(
    report.matches.find((x) => x.state === "unresolved")?.left[0]?.name,
  ).toBe("FUN_20");
});

it("reconstructs discontiguous bodies from adjacent byte reads without next-procedure guesses and keeps address-space/64-bit identity", async () => {
  const address = "ram:0xfffffffffffffff0";
  const left = nativeMatchingInventory("1", [{ address, value: "FUN_f0" }]);
  const right = nativeMatchingInventory("2", [
    { address: "0x20", value: "FUN_20" },
  ]);
  const body = {
    available: true,
    provenance: "synthetic noncontiguous body",
    ranges: [
      { start: address, end: "ram:0xfffffffffffffff1" },
      { start: "ram:0xfffffffffffffff8", end: "ram:0xfffffffffffffff8" },
    ],
    total_bytes: 3,
    span_bytes: 9,
    non_contiguous: true,
    contains_entry: true,
  };
  const info = createEvidence(
    nativeMatchingTarget("1"),
    nativeMatchingProvider,
    {
      operation: "procedure_info",
      parameters: {},
      result: {
        name: "a",
        entrypoint: address,
        basicblock_count: 1,
        length: 3,
        signature: null,
        locals: [],
        classification: null,
        body,
      },
    },
  );
  const read = (address: string, hex: string) =>
    createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
      operation: "read_bytes",
      parameters: {},
      result: {
        address,
        requested_bytes: hex.length / 2,
        returned_bytes: hex.length / 2,
        bytes_hex: hex,
        complete: true,
      },
    });
  const rightDetails = nativeMatchingDetails("2", "0x20", "010203");
  const { report } = await compare({
    left,
    right,
    left_observations: [
      info,
      read(address, "01"),
      read("ram:0xfffffffffffffff1", "02"),
      read("ram:0xfffffffffffffff8", "03"),
    ],
    right_observations: rightDetails,
  });
  // Same concatenated bytes with a different body layout do not become a pair.
  expect(report.summary.matched).toBe(0);
  expect(report.matches[0]?.left[0]).toMatchObject({
    address,
    body_bytes: 3,
    body_sha256: createHash("sha256")
      .update(Buffer.from("010203", "hex"))
      .digest("hex"),
  });
});

it("preserves byte correspondence when consistent dossiers differ only in request identity, without choosing an arbitrary dossier", async () => {
  const left = nativeMatchingInventory("1", [
    { address: "0x10", value: "old_name" },
  ]);
  const right = nativeMatchingInventory("2", [
    { address: "0x20", value: "new_name" },
  ]);
  const leftDetails = nativeMatchingDetails("1", "0x10", "0102", true);
  const another = createEvidence(
    nativeMatchingTarget("1"),
    nativeMatchingProvider,
    {
      operation: "analyze_function",
      parameters: { procedure: "old_name" },
      result: leftDetails[0]!.normalized_result,
      relationshipCoverage: { status: "complete" },
    },
  );
  for (const observations of [
    [...leftDetails, another],
    [another, ...leftDetails],
  ]) {
    const { report } = await compare({
      left,
      right,
      left_observations: observations,
      right_observations: nativeMatchingDetails("2", "0x20", "0102", true),
    });
    expect(report.summary.matched).toBe(1);
    expect(report.matches[0]).toMatchObject({
      basis: "identical-bytes",
      compare_functions_input: null,
      left: [
        {
          dossier_evidence_id: null,
          body_bytes: 2,
          body_sha256: createHash("sha256")
            .update(Buffer.from("0102", "hex"))
            .digest("hex"),
        },
      ],
    });
    expect(report.matches[0]!.left[0]!.evidence_links).toContain(
      another.evidence_id,
    );
  }
  const conflicting = nativeMatchingDetails("1", "0x10", "010203", true)[0]!;
  const { report } = await compare({
    left,
    right,
    left_observations: [...leftDetails, conflicting],
    right_observations: nativeMatchingDetails("2", "0x20", "0102", true),
  });
  expect(report.summary.matched).toBe(0);
  expect(report.matches[0]!.left[0]!.body_sha256).toBeNull();
});

it("rejects repeated per-occurrence source-link expansion within the shared representation budget", async () => {
  const base = nativeMatchingDetails("1", "0x10", "c3")[0]!;
  const observations = Array.from({ length: 250 }, (_, observation) =>
    createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
      operation: "procedure_info",
      parameters: { procedure: "0x10", observation },
      result: base.normalized_result,
    }),
  );
  const result = await matchNativeFunctions({
    left: nativeMatchingInventory(
      "1",
      Array.from({ length: 1000 }, (_, i) => ({
        address: "0x10",
        value: `alias_${i}`,
      })),
    ),
    right: nativeMatchingInventory("2", []),
    left_observations: observations,
  });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.error._tag).toBe("AnalysisResourceConstraintError");
});

it("retains missing bytes and conflicting overlapping observations as unknown instead of exact matches", async () => {
  const left = nativeMatchingInventory("1", [
    { address: "0x10", value: "FUN_10" },
  ]);
  const right = nativeMatchingInventory("2", [
    { address: "0x20", value: "FUN_20" },
  ]);
  const observations = [
    ...nativeMatchingDetails("1", "0x10", "0102"),
    nativeMatchingDetails("1", "0x10", "ffff")[1]!,
  ];
  const { report } = await compare({
    left,
    right,
    left_observations: observations,
    right_observations: nativeMatchingDetails("2", "0x20", "0102"),
  });
  expect(report.summary.matched).toBe(0);
  expect(report.matches[0]?.left[0]?.body_sha256).toBeNull();
});

it("composes consistent overlapping and partial byte reads without losing complete body coverage", async () => {
  const left = nativeMatchingInventory("1", [
    { address: "0x10", value: "FUN_10" },
  ]);
  const right = nativeMatchingInventory("2", [
    { address: "0x20", value: "FUN_20" },
  ]);
  const info = nativeMatchingDetails("1", "0x10", "01020304")[0]!;
  const read = (address: string, hex: string, requested = hex.length / 2) =>
    createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
      operation: "read_bytes",
      parameters: { address, length: requested },
      result: {
        address,
        requested_bytes: requested,
        returned_bytes: hex.length / 2,
        bytes_hex: hex,
        complete: requested === hex.length / 2,
      },
    });
  const { report } = await compare({
    left,
    right,
    left_observations: [
      info,
      read("0x10", "010203", 6),
      read("0x11", "020304"),
    ],
    right_observations: nativeMatchingDetails("2", "0x20", "01020304"),
  });
  expect(report.summary.matched).toBe(1);
  expect(report.source_coverage).toMatchObject({
    status: "complete-within-inputs",
    left_byte_fingerprints: 1,
    right_byte_fingerprints: 1,
    left_inventory_completeness: "unknown",
  });
});

it("does not use generated symbols and preserves literal named FUN_ symbols when producer metadata proves their origin", async () => {
  const entries = [
    { address: "0x10", value: "FUN_10" },
    { address: "0x20", value: "apparently_named" },
  ];
  const names = (side: "1" | "2") =>
    createEvidence(nativeMatchingTarget(side), nativeMatchingProvider, {
      operation: "list_names",
      parameters: {},
      result: entries.map((entry, i) => ({
        ...entry,
        symbol: {
          primary: true,
          dynamic: i === 1,
          external: false,
          type: "function",
          source: i === 0 ? "user_defined" : "default",
        },
      })),
    });
  const { report } = await compare({
    left: unqualifiedInventory("1", entries),
    right: unqualifiedInventory("2", entries),
    left_observations: [names("1")],
    right_observations: [names("2")],
  });
  expect(report.summary.matched).toBe(1);
  expect(report.matches[0]?.left[0]?.name).toBe("FUN_10");
  expect(report.matches[0]?.left[0]?.evidence_links).toContain(
    names("1").evidence_id,
  );
});

it("assigns source authentication, role selection, context, and lookup failures to their owning boundary", async () => {
  const left = nativeMatchingInventory("1", [
    { address: "0x10", value: "main" },
  ]);
  const cases = [
    {
      input: { left: { ...left, normalized_result: [] }, right: left },
      tag: "EvidenceIntegrityError",
    },
    {
      input: { left: nativeMatchingDetails("1", "0x10", "c3")[0], right: left },
      tag: "AnalysisInputError",
      path: ["left"],
    },
    {
      input: {
        left,
        right: left,
        left_observations: nativeMatchingDetails("2", "0x10", "c3"),
      },
      tag: "AnalysisInputError",
      path: ["left_observations", 0],
    },
    {
      input: {
        left: nativeMatchingInventory("1", [
          { address: "not-an-address", value: "main" },
        ]),
        right: left,
      },
      tag: "EvidenceIntegrityError",
    },
    {
      input: { left, right: left, left_observations: [left] },
      tag: "AnalysisInputError",
      path: ["left_observations", 0],
    },
    {
      input: {
        left,
        right: left,
        left_observations: [
          createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
            operation: "procedure_info",
            parameters: { procedure: "0x10" },
            result: {
              ...procedureInfoSchema.parse(
                nativeMatchingDetails("1", "0x10", "c3")[0]!.normalized_result,
              ),
              entrypoint: "not-an-address",
            },
          }),
        ],
      },
      tag: "EvidenceIntegrityError",
    },
    {
      input: {
        left,
        right: left,
        left_observations: [
          { kind: "retained-evidence", evidence_id: `ev_${"a".repeat(64)}` },
        ],
      },
      tag: "EvidenceIntegrityError",
      evidenceId: `ev_${"a".repeat(64)}`,
      reason: "missing",
    },
  ] as const;
  for (const { input, tag, ...expected } of cases) {
    const result = await matchNativeFunctions(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe(tag);
      if ("path" in expected) {
        expect(result.error).toMatchObject({
          issues: expect.arrayContaining([
            expect.objectContaining({ path: expected.path }),
          ]),
        });
      }
      if ("evidenceId" in expected)
        expect(result.error).toMatchObject({
          evidenceId: expected.evidenceId,
          reason: expected.reason,
        });
    }
  }
});

it("cooperatively preserves the exact cancellation reason and rejects expansion before cloning oversized input", async () => {
  const controller = new AbortController(),
    reason = new Error("stop matching");
  const left = nativeMatchingInventory(
    "1",
    Array.from({ length: 2000 }, (_, i) => ({
      address: `0x${i.toString(16)}`,
      value: `item${i}`,
    })),
  );
  const pending = matchNativeFunctions(
    { left, right: left },
    { signal: controller.signal },
  );
  setImmediate(() => controller.abort(reason));
  const cancelled = await pending;
  expect(cancelled.ok).toBe(false);
  if (!cancelled.ok) {
    expect(cancelled.error._tag).toBe("AnalysisCancelledError");
    expect(cancelled.error.cause).toBe(reason);
  }
  const large = await matchNativeFunctions({
    left: { padding: "x".repeat(26 * 1024 * 1024) },
    right: left,
  });
  expect(large.ok).toBe(false);
  if (!large.ok)
    expect(large.error._tag).toBe("AnalysisResourceConstraintError");
});

const retainedInventories = (
  rows: (side: "1" | "2") => readonly Record<string, unknown>[],
) => {
  const [left, right] = (["1", "2"] as const).map((side) =>
    immutableEvidence(
      createEvidence(nativeMatchingTarget(side), nativeMatchingProvider, {
        operation: "list_procedures",
        parameters: {},
        result: rows(side),
      }),
    ),
  );
  const ledger = new Map([left!, right!].map((x) => [x.evidence_id, x]));
  const reference = (record: { evidence_id: string }) => ({
    kind: "retained-evidence" as const,
    evidence_id: record.evidence_id,
  });
  return {
    left: left!,
    right: right!,
    references: { left: reference(left!), right: reference(right!) },
    lookup: (id: string) => ledger.get(id),
  };
};
const ghidraRow = (side: "1" | "2", index: number) => ({
  address: `0x${(0x400000 + index * 16 + (side === "2" ? 8 : 0)).toString(16)}`,
  value: `subsystem_function_${index}`,
  symbol: {
    primary: true,
    dynamic: false,
    external: false,
    type: "Function",
    source: "imported",
  },
  procedure: { external: false, thunk: false, thunk_target: null },
});

it("charges a borrowed retained inventory for its emitted members, not its resident payload", async () => {
  // One shared 40 KB string per row: ~40 KB resident, but a per-occurrence
  // walk would charge 1000 copies of it.
  const resident = "r".repeat(40_000);
  const { left, right, references, lookup } = retainedInventories((side) =>
    Array.from({ length: 1000 }, (_, i) => ({
      ...ghidraRow(side, i),
      provider_note: resident,
    })),
  );
  const borrowed = await matchNativeFunctions(references, undefined, lookup);
  if (!borrowed.ok) throw borrowed.error;
  expect(
    nativeFunctionMatchingSchema.parse(
      borrowed.value.evidence.normalized_result,
    ).summary.matched,
  ).toBe(1000);
  // Inline Evidence is authenticated by cloning, so its whole payload is charged.
  const inline = await matchNativeFunctions({
    left: structuredClone(left),
    right: structuredClone(right),
  });
  expect(inline.ok).toBe(false);
  if (!inline.ok)
    expect(inline.error._tag).toBe("AnalysisResourceConstraintError");
});

it("still charges a borrowed inventory's envelope, which matching copies into its result", async () => {
  // Limitations are prefixed into the report and Evidence; 25 distinct
  // 1 MiB entries are charged above the allowance although rows are few.
  const record = (side: "1" | "2", limitations: readonly string[]) =>
    immutableEvidence(
      createEvidence(nativeMatchingTarget(side), nativeMatchingProvider, {
        operation: "list_procedures",
        parameters: {},
        result: [ghidraRow(side, 0)],
        limitations: [...limitations],
      }),
    );
  const left = record(
      "1",
      Array.from({ length: 25 }, (_, i) => `${"l".repeat(1024 * 1024)}${i}`),
    ),
    right = record("2", []);
  const ledger = new Map([left, right].map((x) => [x.evidence_id, x]));
  const refused = await matchNativeFunctions(
    {
      left: { kind: "retained-evidence", evidence_id: left.evidence_id },
      right: { kind: "retained-evidence", evidence_id: right.evidence_id },
    },
    undefined,
    (id) => ledger.get(id),
  );
  expect(refused.ok).toBe(false);
  if (!refused.ok)
    expect(refused.error._tag).toBe("AnalysisResourceConstraintError");
});

it("matches 20,000 retained Ghidra-shaped rows per side and refuses an oversized side before parsing its rows", async () => {
  const large = retainedInventories((side) =>
    Array.from({ length: 20_000 }, (_, i) => ghidraRow(side, i)),
  );
  const matched = await matchNativeFunctions(
    large.references,
    undefined,
    large.lookup,
  );
  if (!matched.ok) throw matched.error;
  expect(
    nativeFunctionMatchingSchema.parse(matched.value.evidence.normalized_result)
      .summary,
  ).toEqual({ matched: 20_000, only_left: 0, only_right: 0, unresolved: 0 });
  // A malformed final row would be an integrity failure if parsing began.
  const oversized = retainedInventories((side) => [
    ...Array.from({ length: 50_000 }, (_, i) => ghidraRow(side, i)),
    { address: "not an address", value: 1 },
  ]);
  const refused = await matchNativeFunctions(
    oversized.references,
    undefined,
    oversized.lookup,
  );
  expect(refused.ok).toBe(false);
  if (!refused.ok)
    expect(refused.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: { maximum_bytes: 96 * 1024 * 1024 },
      retryable: false,
    });
});

it("enforces the caller-resolved representation allowance and names its setting", async () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      address: `0x${(0x1000 + i * 16).toString(16)}`,
      value: `function_${i}`,
    }));
  const small = {
    left: nativeMatchingInventory("1", rows(100)),
    right: nativeMatchingInventory("2", rows(100)),
  };
  const lowered = await matchNativeFunctions(small, {
    representationAllowance: { maximumBytes: 64 * 1024, source: "runtime" },
  });
  expect(lowered.ok).toBe(false);
  if (lowered.ok) throw new Error("Lowered allowance admitted the request");
  expect(lowered.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    reportedLimits: { maximum_bytes: 64 * 1024 },
    retryable: false,
    limit: {
      setting: "native.matching_representation_bytes",
      effective_value: 64 * 1024,
      source: "runtime",
      unit: "bytes",
      minimum: 1,
      maximum: 1024 * 1024 * 1024,
      applies_at: "next_operation",
      agent_editable: true,
    },
  });
  if (!(lowered.error instanceof AnalysisResourceConstraintError))
    throw lowered.error;
  expect(lowered.error.remediationAction).toContain(
    "update_analysis_settings with setting native.matching_representation_bytes",
  );
  expect(lowered.error.remediationAction).toContain(
    "REA_NATIVE_MATCHING_REPRESENTATION_BYTES",
  );
  expect((await matchNativeFunctions(small)).ok).toBe(true);
  // A request refused by the 96 MiB default fits a raised allowance unchanged.
  const large = {
    left: nativeMatchingInventory("1", rows(15_000)),
    right: nativeMatchingInventory("2", rows(15_000)),
  };
  const refused = await matchNativeFunctions(large);
  expect(refused.ok).toBe(false);
  if (!refused.ok)
    expect(refused.error).toMatchObject({
      limit: { effective_value: 96 * 1024 * 1024, source: "default" },
    });
  const raised = await matchNativeFunctions(large, {
    representationAllowance: {
      maximumBytes: 256 * 1024 * 1024,
      source: "setting",
    },
  });
  if (!raised.ok) throw raised.error;
  expect(
    nativeFunctionMatchingSchema.parse(raised.value.evidence.normalized_result)
      .summary.matched,
  ).toBe(15_000);
});

it("keeps duplicate candidate storage linear and emits every input occurrence exactly once", async () => {
  const entries = Array.from({ length: 1000 }, (_, i) => ({
    address: `0x${i.toString(16)}`,
    value: "same",
  }));
  const { report } = await compare({
    left: nativeMatchingInventory("1", entries),
    right: nativeMatchingInventory("2", entries),
  });
  expect(report.matches).toHaveLength(1);
  expect(report.matches[0]?.left).toHaveLength(1000);
  expect(report.matches[0]?.right).toHaveLength(1000);
  expect(new Set(report.matches[0]?.left.map((x) => x.function_id)).size).toBe(
    1000,
  );
});

it("normalizes accepted body range address spaces before matching byte coverage", async () => {
  const body = {
    available: true as const,
    provenance: "synthetic mixed-space body",
    ranges: [
      { start: "ram:0x10", end: "ram:0x10" },
      { start: "other%ab:0x20", end: "other%ab:0x20" },
    ],
    total_bytes: 2,
    span_bytes: null,
    non_contiguous: true,
    contains_entry: true,
  };
  const info = createEvidence(
    nativeMatchingTarget("1"),
    nativeMatchingProvider,
    {
      operation: "procedure_info",
      parameters: { procedure: "ram:0x10" },
      result: {
        name: "main",
        entrypoint: "ram:0x10",
        basicblock_count: 1,
        length: 2,
        signature: null,
        locals: [],
        classification: null,
        body,
      },
    },
  );
  const read = (address: string, value: string) =>
    createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
      operation: "read_bytes",
      parameters: {},
      result: {
        address,
        requested_bytes: 1,
        returned_bytes: 1,
        bytes_hex: value,
        complete: true,
      },
    });
  const { report } = await compare({
    left: nativeMatchingInventory("1", [
      { address: "ram:0x10", value: "main" },
    ]),
    right: nativeMatchingInventory("2", [{ address: "0x30", value: "main" }]),
    left_observations: [
      info,
      read("ram:0x10", "01"),
      read("other%AB:0x20", "02"),
    ],
  });
  expect(report.matches[0]?.left[0]?.body_sha256).toBe(
    createHash("sha256").update(Buffer.from("0102", "hex")).digest("hex"),
  );
});

it("compares repeated bodies and entry membership after address-space normalization", async () => {
  const procedure = (entrypoint: string, rangeAddress: string) =>
    createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
      operation: "procedure_info",
      parameters: { procedure: entrypoint },
      result: {
        name: "main",
        entrypoint,
        basicblock_count: 1,
        length: 2,
        signature: null,
        locals: [],
        classification: null,
        body: {
          available: true,
          provenance: "synthetic escaped-space body",
          ranges: [
            {
              start: `${rangeAddress}:0x10`,
              end: `${rangeAddress}:0x11`,
            },
          ],
          total_bytes: 2,
          span_bytes: 2,
          non_contiguous: false,
          contains_entry: true,
        },
      },
    });
  const first = procedure("ram%AB:0x10", "ram%ab");
  const equivalent = procedure("ram%ab:0x10", "ram%AB");
  const bytes = createEvidence(
    nativeMatchingTarget("1"),
    nativeMatchingProvider,
    {
      operation: "read_bytes",
      parameters: { address: "ram%AB:0x10", length: 2 },
      result: {
        address: "ram%AB:0x10",
        requested_bytes: 2,
        returned_bytes: 2,
        bytes_hex: "0102",
        complete: true,
      },
    },
  );
  const { report } = await compare({
    left: nativeMatchingInventory("1", [
      { address: "ram%AB:0x10", value: "main" },
    ]),
    right: nativeMatchingInventory("2", [{ address: "0x20", value: "main" }]),
    left_observations: [first, equivalent, bytes],
  });
  const member = report.matches[0]?.left[0];
  expect(member?.body_sha256).toBe(
    createHash("sha256").update(Buffer.from("0102", "hex")).digest("hex"),
  );
  expect(member?.limitations).not.toContain(
    "Conflicting procedure observations; body and dossier remain unknown.",
  );
  expect(member?.evidence_links).toEqual(
    expect.arrayContaining([first.evidence_id, equivalent.evidence_id]),
  );
});

it("retains zero-byte reads with unavailable addresses when no request coordinate exists", async () => {
  const info = createEvidence(
    nativeMatchingTarget("1"),
    nativeMatchingProvider,
    {
      operation: "procedure_info",
      parameters: { procedure: "0x10" },
      result: {
        name: "main",
        entrypoint: "0x10",
        basicblock_count: 1,
        length: 1,
        signature: null,
        locals: [],
        classification: null,
        body: {
          available: true,
          provenance: "synthetic body",
          ranges: [{ start: "0x10", end: "0x10" }],
          total_bytes: 1,
          span_bytes: 1,
          non_contiguous: false,
          contains_entry: true,
        },
      },
    },
  );
  const emptyRead = createEvidence(
    nativeMatchingTarget("1"),
    nativeMatchingProvider,
    {
      operation: "read_bytes",
      parameters: {},
      result: {
        address: "unavailable",
        requested_bytes: 1,
        returned_bytes: 0,
        bytes_hex: "",
        complete: false,
      },
    },
  );
  const left = nativeMatchingInventory("1", [
    { address: "0x10", value: "main" },
  ]);
  const right = nativeMatchingInventory("2", [
    { address: "0x20", value: "main" },
  ]);
  const result = await matchNativeFunctions({
    left,
    right,
    left_observations: [info, emptyRead],
  });
  if (!result.ok) throw result.error;
  const report = nativeFunctionMatchingSchema.parse(
    result.value.evidence.normalized_result,
  );
  expect(report.matches[0]?.left[0]).toMatchObject({
    body_bytes: 1,
    body_sha256: null,
  });
  expect(result.value.evidence.evidence_links).toContain(emptyRead.evidence_id);
  expect(result.value.sources.map((source) => source.evidence_id)).toContain(
    emptyRead.evidence_id,
  );
});

it.each(["left_observations", "right_observations"] as const)(
  "reports authentic mismatched provider/profile/document selections at %s without reauthentication advice",
  async (field) => {
    const inventory = nativeMatchingInventory("1", [
      { address: "0x10", value: "main" },
    ]);
    const detail = nativeMatchingDetails("1", "0x10", "c3")[0]!;
    const variants = [
      createEvidence(
        nativeMatchingTarget("1"),
        { ...nativeMatchingProvider, version: "other" },
        {
          operation: detail.operation,
          parameters: detail.parameters,
          result: detail.normalized_result,
        },
      ),
      createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
        operation: detail.operation,
        parameters: detail.parameters,
        result: detail.normalized_result,
        analysisProfile: createAnalysisProfile(nativeMatchingProvider, {
          loader: "different",
        }),
      }),
      createEvidence(nativeMatchingTarget("1"), nativeMatchingProvider, {
        operation: detail.operation,
        parameters: { ...detail.parameters, document: "another-document" },
        result: detail.normalized_result,
      }),
    ];
    for (const observation of variants) {
      const result = await matchNativeFunctions({
        left: inventory,
        right: inventory,
        [field]: [detail, observation],
      });
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisInputError", issues: [{ path: [field, 1] }] },
      });
    }
    const restored = await compare({
      left: inventory,
      right: inventory,
      [field]: [detail],
    });
    expect(restored.report.summary.matched).toBe(1);
  },
);

it("does not propose exact-symbol correspondence from unqualified EntryPoint labels", async () => {
  const { report } = await compare({
    left: unqualifiedInventory("1", [{ address: "0x10", value: "EntryPoint" }]),
    right: unqualifiedInventory("2", [
      { address: "0x20", value: "EntryPoint" },
    ]),
  });
  expect(report.summary.matched).toBe(0);
  expect(
    report.matches.flatMap((match) => [...match.left, ...match.right]),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "EntryPoint",
        limitations: expect.arrayContaining([
          "Symbol origin unavailable; exact-name matching is unavailable. Independent complete body bytes remain eligible.",
        ]),
      }),
    ]),
  );
});
