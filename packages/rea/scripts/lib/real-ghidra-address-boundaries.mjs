import { requireMcpToolError } from "./mcp-verifier-results.mjs";
import assert from "node:assert/strict";

/** Exercise segmented-address truncation through real CLI/MCP reads and edits. */
export async function verifyGhidraAddressBoundaries(client, entry, cli) {
  const query = async (name, args) => {
    const reply = await client.callTool(
      { name, arguments: args },
      { timeout: 240000 },
    );
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
    return reply.structuredContent.normalized_result;
  };
  const before = await query("analyze_function", {
    procedure: entry,
    detail: "complete",
  });
  // The segmented parser used to discard the high 32 bits and alias this entry.
  const overflow = (0x100000000n + BigInt(entry)).toString(16);
  const representations = [
    `0x${overflow}`,
    `0X${overflow}`,
    overflow,
    `ram:0x${overflow}`,
    `%72am:0x${overflow}`,
  ];
  for (const address of representations) {
    for (const [name, args] of [
      ["read_bytes", { address, length: 1 }],
      ["inspect_native_instruction", { address }],
      ["resolve_containing_procedure", { address }],
      ["procedure_info", { procedure: address }],
      [
        "annotate_native_function",
        {
          procedure: address,
          name: "MUST_NOT_ALIAS",
          comment: "MUST NOT WRITE",
        },
      ],
    ]) {
      const reply = await client.callTool(
        { name, arguments: args },
        { timeout: 240000 },
      );
      assert.equal(reply.isError, true, `${name} accepted ${address}`);
      const error = requireMcpToolError(reply);
      assert.equal(error?.code, "invalid_request", JSON.stringify(reply));
      assert.equal(error.details.operation, name);
      const issues = JSON.stringify(error.details.issues);
      assert.match(issues, /cannot be represented without truncation/u);
      assert.ok(issues.includes(address), issues);
      // A rejected request produces no Evidence; errors carry text only.
      assert.equal(reply.structuredContent, undefined);
    }
  }
  assert.deepEqual(
    await query("analyze_function", { procedure: entry, detail: "complete" }),
    before,
    "Rejected oversized annotations changed the aliased function",
  );
  // Leading zeros and an encoded explicit space preserve the requested offset.
  const padded = `%72am:0x0000${BigInt(entry).toString(16)}`;
  assert.deepEqual(
    await query("read_bytes", { address: padded, length: 1 }),
    await query("read_bytes", { address: entry, length: 1 }),
  );
  const originalName = await query("address_name", { address: entry });
  assert.equal(
    typeof originalName,
    "string",
    "The function entry needs an observed name that can be restored",
  );
  const aliasKeys = [entry, padded];
  let primaryFailure;
  try {
    assert.deepEqual(
      await query("set_addresses_names", {
        names: {
          [entry]: "rea_same_address_alias",
          [padded]: "rea_same_address_alias",
        },
      }),
      Object.fromEntries(aliasKeys.map((address) => [address, true])),
      "Equivalent address spellings with one requested name share one edit",
    );
    const nameBeforeAliasedBatch = await query("address_name", {
      address: entry,
    });
    assert.equal(nameBeforeAliasedBatch, "rea_same_address_alias");
    assert.deepEqual(
      await query("set_addresses_names", {
        names: {
          [entry]: "rea_first_address_alias",
          [padded]: "rea_second_address_alias",
        },
      }),
      Object.fromEntries(aliasKeys.map((address) => [address, false])),
      "Conflicting spellings of one Ghidra address must be rejected together",
    );
    assert.equal(
      await query("address_name", { address: entry }),
      nameBeforeAliasedBatch,
      "A rejected alias collision must leave the preexisting target name unchanged",
    );
  } catch (cause) {
    primaryFailure = cause;
    throw cause;
  } finally {
    try {
      assert.equal(
        await query("set_address_name", { address: entry, name: originalName }),
        true,
        "The temporary alias edit must be restored",
      );
      assert.equal(
        await query("address_name", { address: entry }),
        originalName,
        "The original function-entry name must survive restoration",
      );
    } catch (cleanupCause) {
      if (primaryFailure !== undefined)
        throw new AggregateError(
          [primaryFailure, cleanupCause],
          "Ghidra address-boundary verification and alias restoration failed",
        );
      throw cleanupCause;
    }
  }
  for (const [command, flags, operation] of [
    ["read-bytes", ["--length", "1"], "read_bytes"],
    [
      "annotate-native-function",
      ["--name", "MUST_NOT_ALIAS"],
      "annotate_native_function",
    ],
  ]) {
    let failure;
    try {
      await cli(command, representations[0], flags);
    } catch (error) {
      assert.equal(error.code, 1);
      failure = JSON.parse(error.stdout);
    }
    assert.equal(failure?.code, "invalid_request");
    assert.equal(failure.details.operation, operation);
    assert.match(
      JSON.stringify(failure.details.issues),
      /cannot be represented without truncation/u,
    );
  }
}
