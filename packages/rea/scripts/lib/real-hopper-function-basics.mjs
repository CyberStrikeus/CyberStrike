import assert from "node:assert/strict";
import { requireMcpEvidenceResult } from "./mcp-verifier-results.mjs";

export const verifyHopperFunctionBasics = async (
  client,
  options,
  procedure,
) => {
  const containment = requireMcpEvidenceResult(
    await client.callTool(
      {
        name: "resolve_containing_procedure",
        arguments: { address: procedure },
      },
      options,
    ),
    "resolve_containing_procedure",
  );
  if (
    containment?.found !== true ||
    containment.procedure?.address !== procedure
  ) {
    throw new Error(
      "resolve_containing_procedure returned the wrong procedure",
    );
  }

  const references = requireMcpEvidenceResult(
    await client.callTool(
      {
        name: "procedure_references",
        arguments: {
          procedure,
          direction: "outgoing",
        },
      },
      options,
    ),
    "procedure_references",
  );
  if (!Array.isArray(references?.references)) {
    throw new Error("procedure_references returned an invalid result");
  }

  const instructions = requireMcpEvidenceResult(
    await client.callTool(
      {
        name: "read_function_instructions",
        arguments: { procedure },
      },
      options,
    ),
    "read_function_instructions",
  );
  if (
    instructions?.procedure?.address !== procedure ||
    !Array.isArray(instructions.instructions) ||
    instructions.instructions.length === 0
  ) {
    throw new Error("read_function_instructions returned an invalid result");
  }

  return {
    outgoingReferenceCount: references.references.length,
    instructionWindowCount: instructions.instructions.length,
  };
};

/** Check native terminal call sites across instruction, reference and dossier projections. */
export async function verifyHopperTerminalInstructions(call) {
  const procedures = await call("list_procedures");
  const selected = procedures.filter(
    ({ value }) =>
      value === "-[REAWidget delegate]" ||
      value.startsWith("imp___stubs__") ||
      value.startsWith("_objc_msgSend$"),
  );
  if (selected.length === 0)
    throw new Error("Objective-C fixture omitted terminal-call procedures");
  let terminalCalls = 0;
  for (const { address } of selected) {
    const references = await call("procedure_references", {
      procedure: address,
      direction: "outgoing",
    });
    const nativeCalls = references.references.filter(
      (edge) => edge.call !== undefined,
    );
    if (nativeCalls.length === 0)
      throw new Error(
        `Native fixture procedure ${address} omitted its terminal call`,
      );
    const dossier = await call("analyze_function", {
      procedure: address,
      detail: "complete",
    });
    const instructions = await call("read_function_instructions", {
      procedure: address,
    });
    const assembly = await call("procedure_assembly", { procedure: address });
    const info = await call("procedure_info", { procedure: address });
    for (const edge of nativeCalls) {
      const observed = dossier.outgoing_references.find(
        (item) =>
          item.source_address === edge.source_address &&
          item.target_address === edge.target_address,
      );
      assert.ok(
        observed,
        `Dossier discarded native call ${edge.source_address} -> ${edge.target_address}`,
      );
      assert.deepEqual(observed.call, edge.call);
      assert.ok(
        instructions.instructions.some((line) =>
          line.startsWith(`${edge.source_address}:`),
        ),
        `Instruction inventory discarded native call site ${edge.source_address}`,
      );
      assert.ok(
        dossier.basic_blocks.some(
          ({ start, end }) =>
            BigInt(start) <= BigInt(edge.source_address) &&
            BigInt(edge.source_address) < BigInt(end),
        ),
        `Normalized block excluded native call site ${edge.source_address}`,
      );
      terminalCalls++;
    }
    assert.equal(assembly, instructions.instructions.join("\n"));
    assert.deepEqual(dossier.assembly, instructions.instructions);
    if (address === selected[0].address)
      await verifyHopperTerminalComment(
        call,
        address,
        nativeCalls.at(-1).source_address,
      );
    const expectedLength = dossier.basic_blocks.reduce(
      (total, { start, end }) => total + Number(BigInt(end) - BigInt(start)),
      0,
    );
    assert.equal(
      info.length,
      expectedLength,
      "Procedure length disagrees with normalized native blocks",
    );
  }
  if (terminalCalls === 0)
    throw new Error("Objective-C fixture omitted native terminal calls");
  return {
    procedures: selected.length,
    terminalCalls,
    normalizedBlockEndpoints: true,
    terminalCommentPreserved: true,
  };
}

async function verifyHopperTerminalComment(call, address, terminal) {
  const original = await call("comment", { address: terminal });
  try {
    await call("set_comment", {
      address: terminal,
      comment: "REA terminal instruction comment",
    });
    const annotated = await call("analyze_function", {
      procedure: address,
      detail: "complete",
    });
    if (
      !annotated.comments.some(
        (item) =>
          item.address === terminal &&
          item.kind === "comment" &&
          item.text === "REA terminal instruction comment",
      )
    )
      throw new Error(
        "Dossier discarded a comment on the native terminal instruction",
      );
  } finally {
    await call("set_comment", {
      address: terminal,
      comment: original ?? "",
    });
  }
}
