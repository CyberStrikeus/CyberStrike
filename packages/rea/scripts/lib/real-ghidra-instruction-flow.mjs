import assert from "node:assert/strict";

/** Verify decoded return evidence and distinct non-return flows on owned fixtures. */
export async function verifyGhidraInstructionFlow(call, names, cli) {
  const leaf = names.find((item) =>
    item.value.endsWith("rea_ghidra_inventory_leaf"),
  );
  assert.ok(leaf, "Source fixture lacks its returning leaf");
  const leafInstructions = await inspectFunction(call, leaf.address);
  const returned = leafInstructions.find(
    (instruction) => instruction.flow.kind === "return",
  );
  assert.ok(returned, "Returning source leaf lacks decoded RETURN evidence");
  assertReturnEvidence(returned);
  assert.equal(
    (await call("resolve_native_call_targets", { address: returned.address }))
      .status,
    "not-call",
  );
  assert.deepEqual(
    await cli("inspect-native-instruction", returned.address),
    returned,
  );

  const controls = [
    ["rea_ghidra_flow_return", "RET", "c3"],
    ["rea_ghidra_flow_cleanup_return", "RET", "c21000"],
    ["rea_ghidra_flow_shared_tail", "JMP", null],
    ["rea_ghidra_flow_trap", "UD2", "0f0b"],
  ];
  let checked = 0;
  for (const [symbol, mnemonic, bytes] of controls) {
    const procedure = names.find((item) => item.value === symbol);
    if (procedure === undefined) continue;
    const before = await call("resolve_containing_procedure", {
      address: procedure.address,
    });
    const instructions = await inspectFunction(call, procedure.address);
    const instruction = instructions.find((item) => item.mnemonic === mnemonic);
    assert.ok(instruction, `Source fixture lacks ${symbol}'s ${mnemonic}`);
    if (bytes !== null) assert.equal(instruction.bytes, bytes);
    if (mnemonic === "RET") {
      assertReturnEvidence(instruction);
      assert.equal(instruction.flow.kind, "return");
      if (bytes === "c21000")
        assert.equal(instruction.operands[0]?.raw, "0x10");
    } else {
      assert.notEqual(instruction.flow.kind, "return");
      assert.ok(
        instruction.flow.classification_evidence.some(
          (item) => item.source === "ghidra-listing-flow-type",
        ),
      );
    }
    assert.deepEqual(
      await call("resolve_containing_procedure", {
        address: procedure.address,
      }),
      before,
    );
    checked++;
  }
  const unavailable = await call("inspect_native_instruction", {
    address: "0x0",
  });
  assert.equal(unavailable.status, "outside-memory");
  assert.equal(unavailable.flow.kind, "unavailable");
  assert.deepEqual(unavailable.flow.classification_evidence, []);
  return {
    return_instruction: returned.address,
    decoded_pcode_return: true,
    return_cli_mcp_parity: true,
    explicit_x86_elf_controls: checked,
    explicit_control_scope:
      checked === 0
        ? "Not present on this host-native fixture format/architecture"
        : "x86-64 ELF",
    generic_unknown_preserved: true,
  };
}

async function inspectFunction(call, procedure) {
  const listing = await call("read_function_instructions", { procedure });
  const instructions = [];
  for (const line of listing.instructions) {
    const delimiter = line.indexOf(": ");
    assert.ok(delimiter > 0, `Malformed provider instruction listing: ${line}`);
    instructions.push(
      await call("inspect_native_instruction", {
        address: line.slice(0, delimiter),
      }),
    );
  }
  return instructions;
}

function assertReturnEvidence(instruction) {
  assert.equal(instruction.status, "decoded");
  assert.ok(
    instruction.flow.classification_evidence.some(
      (item) =>
        item.source === "ghidra-instruction-pcode" && item.value === "RETURN",
    ),
  );
  assert.ok(
    !instruction.limitations.some((text) =>
      text.includes("not classified as a return"),
    ),
  );
}
