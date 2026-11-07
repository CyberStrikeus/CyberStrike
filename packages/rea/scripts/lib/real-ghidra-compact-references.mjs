import assert from "node:assert/strict";

/** Verify actual reference facts on the source-owned Windows PE fixture. */
export async function verifyGhidraCompactReferences(call, x86, cli) {
  const base = x86 ? 0x400000n : 0x1_4000_0000n;
  const address = (offset) => `0x${(base + BigInt(offset)).toString(16)}`;
  const cases = [
    ["data", 0x1020, 0x2000],
    ["read", x86 ? 0x1025 : 0x1027, 0x2000],
    ["write", x86 ? 0x102a : 0x102d, 0x2004],
  ];
  const full = await call("procedure_references", {
    procedure: address(0x1020),
  });
  const inspected = {};
  const incomingByTarget = new Map();
  for (const [kind, offset, target] of cases) {
    const instruction = await call("inspect_native_instruction", {
      address: address(offset),
    });
    inspected[kind] = instruction;
    const reference = instruction.references.find(
      (item) => item.target_address === address(target),
    );
    assert.ok(reference, `Missing ${kind} fixture reference`);
    assertReference(reference, instruction.address, full.references);
    assert.equal(reference.data, true);
    assert.equal(reference.read, kind === "read");
    assert.equal(reference.write, kind === "write");
    const incoming = await call("inspect_native_instruction", {
      address: address(target),
    });
    assert.notEqual(incoming.status, "decoded");
    assertIncomingReference(incoming, reference);
    incomingByTarget.set(incoming.address, incoming);
  }
  const indexed = await call("inspect_native_instruction", {
    address: address(x86 ? 0x103d : 0x1045),
  });
  for (const reference of indexed.references)
    assertReference(reference, indexed.address, full.references);
  assert.ok(
    indexed.references.some(
      (reference) =>
        reference.primary === false && reference.source === "analysis",
    ),
    "Indexed fixture lacks a non-primary analyzer reference",
  );
  for (const reference of indexed.references) {
    const incoming = await call("inspect_native_instruction", {
      address: reference.target_address,
    });
    assertIncomingReference(incoming, reference);
    incomingByTarget.set(incoming.address, incoming);
  }
  for (const incoming of incomingByTarget.values())
    await verifyIncomingReferences(call, incoming);

  const { direct, targets } = await verifyDirectCall(
    call,
    address(0x1000),
    address(0x1010),
  );

  const indirectAddress = address(x86 ? 0x1041 : 0x1049);
  const indirect = await call("inspect_native_instruction", {
    address: indirectAddress,
  });
  const unresolved = await call("resolve_native_call_targets", {
    address: indirectAddress,
  });
  assert.equal(indirect.flow.kind, "call");
  assert.deepEqual(indirect.references, []);
  assert.equal(unresolved.status, "unresolved");
  assert.deepEqual(unresolved.targets, []);

  const returned = await verifyEmptyReferences(
    call,
    address(x86 ? 0x1043 : 0x104c),
  );

  if (cli !== undefined) {
    for (const instruction of [
      inspected.write,
      indexed,
      direct,
      returned,
      ...incomingByTarget.values(),
    ])
      assert.deepEqual(
        await cli("inspect-native-instruction", instruction.address),
        instruction,
      );
    assert.deepEqual(
      await cli("resolve-native-call-targets", direct.address),
      targets,
    );
    assert.deepEqual(
      await cli("resolve-native-call-targets", indirectAddress),
      unresolved,
    );
  }
  return {
    data_read_write: true,
    source_primary_provenance: true,
    full_reference_parity: true,
    typed_incoming_reference_parity: true,
    incoming_reference_ordering: true,
    incoming_xrefs_parity: true,
    synthetic_entry_reference_excluded: true,
    direct_call_reference_parity: true,
    indexed_reference_count: indexed.references.length,
    indexed_non_primary_count: indexed.references.filter(
      (reference) => reference.primary === false,
    ).length,
    indexed_non_primary_analyzer_reference: true,
    indexed_reference_kinds: indexed.references.map(
      ({ type, read, write, primary, source }) => ({
        type,
        read,
        write,
        primary,
        source,
      }),
    ),
    targetless_indirect: true,
    empty_and_unavailable: true,
    cli_mcp_parity: cli !== undefined,
  };
}

async function verifyDirectCall(call, entry, callee) {
  const direct = await call("inspect_native_instruction", { address: entry });
  const targets = await call("resolve_native_call_targets", { address: entry });
  assert.equal(targets.status, "direct");
  assert.equal(targets.targets[0].address, callee);
  assert.deepEqual(
    targets.targets[0].references,
    direct.references.filter((item) => item.call),
  );
  const full = await call("procedure_references", { procedure: entry });
  for (const reference of direct.references)
    assertReference(reference, entry, full.references);
  const incoming = await call("inspect_native_instruction", {
    address: callee,
  });
  const callReference = direct.references.find(
    (reference) => reference.target_address === callee && reference.call,
  );
  assert.ok(callReference, "Direct fixture call lacks its reference");
  assertIncomingReference(incoming, callReference);
  await verifyIncomingReferences(call, incoming);
  // PE header pointers are real incoming data references; synthetic loader
  // entry-point references must not be presented as callers.
  await verifyIncomingReferences(call, direct);
  for (const reference of direct.incoming_references) {
    assert.equal(reference.type, "DATA");
    assert.equal(reference.data, true);
    assert.equal(reference.source, "default");
  }
  return { direct, targets };
}

function assertIncomingReference(instruction, reference) {
  const incoming = instruction.incoming_references.find(
    (item) =>
      item.source_address === reference.source_address &&
      item.target_address === reference.target_address &&
      item.type === reference.type &&
      item.operand_index === reference.operand_index &&
      item.primary === reference.primary,
  );
  assert.ok(
    incoming,
    "Outgoing reference lacks its typed incoming counterpart",
  );
  assert.deepEqual(incoming, reference);
}

async function verifyIncomingReferences(call, instruction) {
  const repeated = await call("inspect_native_instruction", {
    address: instruction.address,
  });
  assert.deepEqual(
    repeated.incoming_references,
    instruction.incoming_references,
    "Repeated incoming reference queries changed order or provider facts",
  );
  assert.deepEqual(
    [
      ...new Set(
        instruction.incoming_references.map(
          (reference) => reference.source_address,
        ),
      ),
    ],
    await call("xrefs", { address: instruction.address }),
    "Incoming references differ from xrefs source addresses or their order",
  );
}

async function verifyEmptyReferences(call, address) {
  const returned = await call("inspect_native_instruction", { address });
  assert.equal(returned.flow.kind, "return");
  assert.deepEqual(returned.references, []);
  assert.equal(
    (await call("resolve_native_call_targets", { address })).status,
    "not-call",
  );
  const outside = await call("inspect_native_instruction", { address: "0x0" });
  assert.equal(outside.status, "outside-memory");
  assert.deepEqual(outside.references, []);
  assert.deepEqual(outside.incoming_references, []);
  assert.equal(
    (await call("resolve_native_call_targets", { address: "0x0" })).status,
    "unavailable",
  );
  return returned;
}

function assertReference(reference, source, full) {
  assert.equal(reference.source_address, source);
  assert.equal(reference.provenance, "ghidra-reference-manager");
  assert.equal(typeof reference.primary, "boolean");
  assert.equal(typeof reference.source, "string");
  assert.ok(reference.source.length > 0);
  const edge = full.find(
    (item) =>
      item.source_address === source &&
      item.target_address === reference.target_address &&
      item.kind.operand_index === reference.operand_index,
  );
  assert.ok(edge, "Compact reference lacks its matching full reference");
  for (const field of [
    "type",
    "call",
    "jump",
    "indirect",
    "computed",
    "operand_index",
    "data",
    "read",
    "write",
    "primary",
    "provenance",
  ])
    assert.equal(
      reference[field],
      edge.kind[field],
      `Reference ${field} differs from its full representation`,
    );
}
