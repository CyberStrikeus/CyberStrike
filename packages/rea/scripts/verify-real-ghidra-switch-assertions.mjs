import assert from "node:assert/strict";

/** Verify numeric/default evidence against independent compiler-byte/source oracles. */
export function assertSwitchBoundary(boundary, fixture) {
  assert.equal(boundary.available, true);
  assert.equal(boundary.provenance, "ghidra-high-function");
  assert.ok(
    boundary.limitations.length > 0,
    "Provider observation scope must remain explicit",
  );
  if (!fixture.table) {
    assert.deepEqual(
      boundary.jump_tables,
      [],
      "Comparison-only control fabricated a jump table",
    );
    return { numeric_cases: 0, default_targets: 0, unknowns: 0 };
  }
  assert.equal(
    boundary.jump_tables.length,
    1,
    `Expected one source-owned switch: ${fixture.name}`,
  );
  const table = boundary.jump_tables[0];
  if (fixture.allow_unsigned_32_labels === true) {
    assert.equal(fixture.discriminator_size_bytes, 4);
    assert.equal(boundary.parameters.length, 1);
    assert.equal(boundary.parameters[0].data_type, "undefined4");
    assert.equal(boundary.parameters[0].size_bytes, 4);
    assert.equal(boundary.parameters[0].confidence, "low");
  }
  assert.equal(
    table.dispatch_address,
    fixture.dispatch_address,
    "Dispatch does not identify the independently byte-proven indirect jump",
  );
  const numericCount = assertCaseMappings(table, fixture);
  assert.equal(
    table.default_targets.length,
    1,
    "Default target must be separate from numeric cases/unknowns",
  );
  const defaultTarget = table.default_targets[0];
  assert.equal(
    defaultTarget.target_address,
    fixture.default_address,
    "Default does not enter the independently byte-proven default block",
  );
  assert.equal(defaultTarget.confidence, "high");
  assert.ok(
    hasTypedSwitchEvidence(
      defaultTarget.evidence,
      "Typed default label",
      defaultTarget.target_address,
      table.dispatch_address,
    ),
    "Default omitted typed label/block/dispatch evidence",
  );
  assert.ok(
    table.data_sources.some(
      ({ address, entry_size_bytes: size, entry_count: count }) =>
        address === fixture.table_address &&
        size === 8 &&
        count === fixture.slots.length,
    ),
    "Recovered backing-table observation disagrees with independently decoded bytes",
  );
  return {
    numeric_cases: numericCount,
    default_targets: 1,
    unknowns: fixture.unsafe_integer ? table.mappings.length : 0,
  };
}

function assertCaseMappings(table, fixture) {
  const explicit = fixture.slots.filter(({ explicit_case }) => explicit_case);
  const numeric = table.mappings.filter(
    ({ case_value }) => typeof case_value === "number",
  );
  if (fixture.unsafe_integer) {
    assert.equal(
      numeric.length,
      0,
      "Unsafe integer labels were rounded, truncated or replaced by table indices",
    );
    assert.equal(
      table.mappings.length,
      fixture.blocks.length,
      "Unsafe labels must retain every independently byte-proven target",
    );
    assert.deepEqual(
      table.mappings.map(({ target_address }) => target_address).sort(),
      fixture.blocks.map(({ address }) => address).sort(),
    );
    for (const mapping of table.mappings) {
      assert.equal(mapping.case_value, null);
      assert.ok(
        ["low", "medium"].includes(mapping.confidence),
        "Unknown numeric association must not claim high confidence",
      );
      assertUnknownTargetEvidence(
        mapping.evidence,
        mapping.target_address,
        table.dispatch_address,
      );
    }
  } else {
    assert.equal(
      table.mappings.length,
      numeric.length,
      "Complete public fixture has unresolved/misclassified numeric case rows",
    );
    const matchedValues = new Set();
    for (const mapping of numeric) {
      const expected = fixture.slots.find(
        ({ value }) =>
          value === mapping.case_value ||
          (fixture.allow_unsigned_32_labels === true &&
            Number(BigInt.asUintN(32, BigInt(value))) === mapping.case_value),
      );
      assert.ok(expected, `Fabricated out-of-range case ${mapping.case_value}`);
      assert.ok(
        !matchedValues.has(expected.value),
        "Duplicate discriminator bit pattern",
      );
      matchedValues.add(expected.value);
      assert.equal(
        mapping.target_address,
        expected.target_address,
        `Wrong case→target ${fixture.name}:${mapping.case_value}`,
      );
      assert.equal(mapping.confidence, "high");
      assert.ok(
        hasTypedSwitchEvidence(
          mapping.evidence,
          `Typed case value ${mapping.case_value}`,
          mapping.target_address,
          table.dispatch_address,
        ),
        "Numeric mapping omitted typed case/block/dispatch evidence",
      );
    }
    for (const { value } of explicit)
      assert.ok(
        matchedValues.has(value),
        `Omitted source case ${fixture.name}:${value}`,
      );
  }
  return numeric.length;
}

/** Match typed labels to their explicitly evidenced block and unique dispatch. */
export function hasTypedSwitchEvidence(evidence, label, target, dispatch) {
  return evidence.some(
    ({ kind, source, detail }) =>
      kind === "jump-table" &&
      source === "ghidra-clang-case-token" &&
      typeof detail === "string" &&
      detail.trim().length > 0 &&
      detail.startsWith(
        `${label} belongs to the p-code block starting at recovered target ${target};`,
      ) &&
      detail.includes(
        `its unique indirect dispatch predecessor is ${dispatch}.`,
      ),
  );
}
function assertUnknownTargetEvidence(evidence, target, dispatch) {
  assert.ok(
    evidence.some(
      ({ kind, source, detail }) =>
        kind === "jump-table" &&
        source === "ghidra-high-function" &&
        typeof detail === "string" &&
        detail.trim().length > 0 &&
        detail.startsWith(
          `Ghidra recovered target ${target} at dispatch ${dispatch},`,
        ) &&
        detail.includes(
          "no unambiguous, exactly representable case label or default relationship",
        ),
    ),
    "Unknown mapping omitted recovered target/dispatch and unavailable label evidence",
  );
}

/** Fault-injected guard controls only; these records are not real provider acceptance. */
export function assertSwitchOracleControls(fixtures) {
  const fixture = fixtures.find(({ name }) => name === "holes_shared");
  assert.ok(fixture);
  const boundary = guardBoundary(fixture);
  const evidence = boundary.jump_tables[0].default_targets[0].evidence;
  assertSwitchBoundary(boundary, fixture);
  const faults = {
    consistently_wrong_dispatch: (table) => {
      const previous = table.dispatch_address;
      table.dispatch_address = "0xff";
      for (const row of [...table.mappings, ...table.default_targets])
        for (const evidence of row.evidence)
          evidence.detail = evidence.detail.replace(previous, "0xff");
    },
    wrong_numeric_evidence_source: (table) => {
      table.mappings[0].evidence[0].source = "unrelated-source";
    },
    wrong_default_evidence_source: (table) => {
      table.default_targets[0].evidence[0].source = "ghidra-high-function";
    },
    empty_default_evidence_detail: (table) => {
      table.default_targets[0].evidence[0].detail = "";
    },
    wrong_typed_dispatch: (table) => {
      table.mappings[0].evidence[0].detail =
        table.mappings[0].evidence[0].detail.replace(
          `predecessor is ${fixture.dispatch_address}.`,
          "predecessor is 0xff.",
        );
    },
    missing_default: (table) => {
      table.default_targets = [];
    },
    default_misclassified_as_unknown: (table) => {
      table.default_targets = [];
      table.mappings.push({
        case_value: null,
        target_address: fixture.default_address,
        confidence: "low",
        evidence,
      });
    },
    wrong_shared_target: (table) => {
      table.mappings.find(({ case_value }) => case_value === 3).target_address =
        fixture.blocks[0].address;
    },
    positional_label_guess: (table) => {
      table.mappings.find(({ case_value }) => case_value === 9).case_value = 99;
    },
    omitted_case: (table) => {
      table.mappings = table.mappings.filter(
        ({ case_value }) => case_value !== 2,
      );
    },
    wrong_default_target: (table) => {
      table.default_targets[0].target_address = fixture.blocks[0].address;
    },
    wrong_backing_extent: (table) => {
      table.data_sources[0].entry_count--;
    },
  };
  for (const [name, inject] of Object.entries(faults)) {
    const damaged = structuredClone(boundary);
    inject(damaged.jump_tables[0]);
    assert.throws(
      () => assertSwitchBoundary(damaged, fixture),
      undefined,
      `Oracle failed to reject ${name}`,
    );
  }
  const negative = fixtures.find(({ name }) => name === "negative");
  assert.ok(negative);
  const signed = guardBoundary(negative);
  assertSwitchBoundary(signed, negative);
  signed.jump_tables[0].mappings = signed.jump_tables[0].mappings.map(
    (mapping) => ({ ...mapping, case_value: Math.abs(mapping.case_value) }),
  );
  assert.throws(
    () => assertSwitchBoundary(signed, negative),
    undefined,
    "Lost unary minus in a signed case label",
  );
  const unsignedControls = assertStrippedSignednessControls(negative);
  const comparison = fixtures.find(({ name }) => name === "comparison");
  assert.ok(comparison);
  assertSwitchBoundary({ ...boundary, jump_tables: [] }, comparison);
  assert.throws(
    () => assertSwitchBoundary(boundary, comparison),
    undefined,
    "Fabricated table for comparison-only control",
  );
  return [
    ...assertUnsafeGuardControls(fixtures),
    ...unsignedControls,
    ...Object.keys(faults),
    "signed_label_magnitude",
    "fabricated_comparison_table",
  ];
}

function assertStrippedSignednessControls(fixture) {
  const strippedFixture = { ...fixture, allow_unsigned_32_labels: true };
  const signed = guardBoundary(fixture);
  const unsigned = structuredClone(signed);
  unsigned.parameters = [
    { data_type: "undefined4", size_bytes: 4, confidence: "low" },
  ];
  for (const mapping of unsigned.jump_tables[0].mappings) {
    const previous = mapping.case_value;
    mapping.case_value = Number(BigInt.asUintN(32, BigInt(previous)));
    mapping.evidence[0].detail = mapping.evidence[0].detail.replace(
      `Typed case value ${previous} `,
      `Typed case value ${mapping.case_value} `,
    );
  }
  assertSwitchBoundary(unsigned, strippedFixture);
  assert.throws(
    () => assertSwitchBoundary(unsigned, fixture),
    undefined,
    "Known signed source labels were replaced by unsigned values",
  );
  const faults = {
    stripped_signedness_promoted: (record) => {
      record.parameters[0].confidence = "high";
    },
    stripped_wrong_discriminator_width: (record) => {
      record.parameters[0].size_bytes = 8;
    },
    stripped_wrong_bit_pattern_target: (record) => {
      record.jump_tables[0].mappings[0].target_address =
        fixture.blocks[1].address;
    },
    stripped_duplicate_bit_pattern: (record) => {
      record.jump_tables[0].mappings.push(signed.jump_tables[0].mappings[0]);
    },
  };
  for (const [name, inject] of Object.entries(faults)) {
    const damaged = structuredClone(unsigned);
    inject(damaged);
    assert.throws(
      () => assertSwitchBoundary(damaged, strippedFixture),
      undefined,
      `Oracle failed to reject ${name}`,
    );
  }
  return ["known_signed_labels_must_stay_signed", ...Object.keys(faults)];
}

function assertUnsafeGuardControls(fixtures) {
  const unsafe = fixtures.find(({ name }) => name === "unsafe_integer");
  assert.ok(unsafe);
  const unknown = guardBoundary(unsafe, true);
  assertSwitchBoundary(unknown, unsafe);
  for (const labels of [
    unsafe.slots.map(({ value }) => Number(BigInt(value) & 0xffffffffn)),
    unsafe.slots.map((_, index) => index),
    unsafe.slots.map(({ value }) => Number(value)),
  ]) {
    const fabricated = structuredClone(unknown);
    fabricated.jump_tables[0].mappings = fabricated.jump_tables[0].mappings.map(
      (mapping, index) => ({
        ...mapping,
        case_value: labels[index],
        confidence: "high",
      }),
    );
    assert.throws(
      () => assertSwitchBoundary(fabricated, unsafe),
      undefined,
      "Unsafe label rounding/truncation/index fallback accepted",
    );
  }
  return [
    "unsafe_label_signed32_truncation",
    "unsafe_label_index_fallback",
    "unsafe_label_float_rounding",
  ];
}
function guardBoundary(fixture, unresolved = false) {
  const typedEvidence = (label, target) => [
    {
      kind: "jump-table",
      source: "ghidra-clang-case-token",
      detail: `${label} belongs to the p-code block starting at recovered target ${target}; its unique indirect dispatch predecessor is ${fixture.dispatch_address}.`,
    },
  ];
  const unknownEvidence = (target) => [
    {
      kind: "jump-table",
      source: "ghidra-high-function",
      detail: `Ghidra recovered target ${target} at dispatch ${fixture.dispatch_address}, but no unambiguous, exactly representable case label or default relationship was available.`,
    },
  ];
  return {
    available: true,
    provenance: "ghidra-high-function",
    limitations: ["Guard control only"],
    jump_tables: [
      {
        dispatch_address: fixture.dispatch_address,
        data_sources: [
          {
            address: fixture.table_address,
            entry_size_bytes: 8,
            entry_count: fixture.slots.length,
          },
        ],
        mappings: fixture.slots.map(({ value, target_address }, index) => ({
          case_value: unresolved ? null : value,
          target_address,
          confidence: unresolved
            ? index % 2 === 0
              ? "medium"
              : "low"
            : "high",
          evidence: unresolved
            ? unknownEvidence(target_address)
            : typedEvidence(`Typed case value ${value}`, target_address),
        })),
        default_targets: [
          {
            target_address: fixture.default_address,
            confidence: "high",
            evidence: typedEvidence(
              "Typed default label",
              fixture.default_address,
            ),
          },
        ],
      },
    ],
  };
}
