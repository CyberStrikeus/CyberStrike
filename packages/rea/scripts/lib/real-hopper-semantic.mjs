import assert from "node:assert/strict";

import { requireFunctionDossierOracle } from "./real-hopper-assertions.mjs";

/** Require truthful tri-state permissions from real Hopper memory regions. */
export const requireTruthfulMemoryRegions = (segments) => {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("list_segments returned no real memory regions");
  }
  const regions = segments.flatMap((segment) => [
    segment,
    ...(Array.isArray(segment.sections) ? segment.sections : []),
  ]);
  for (const region of regions) {
    if (
      typeof region?.name !== "string" ||
      region.name.length === 0 ||
      typeof region.start !== "string" ||
      typeof region.end !== "string"
    ) {
      throw new Error(
        "list_segments omitted observed region identity or bounds",
      );
    }
    for (const permission of ["readable", "writable", "executable"]) {
      if (region[permission] !== null) {
        throw new Error(
          `list_segments invented or omitted unknown ${permission}`,
        );
      }
    }
    if (
      region.provenance !== "hopper-public-python-api" ||
      region.permissions?.available !== false ||
      typeof region.permissions.reason !== "string" ||
      region.permissions.reason.length === 0
    ) {
      throw new Error("list_segments omitted permission provenance");
    }
  }
};

/** Require correlated start and terminal progress from the real bridge. */
export function requireBridgeProgress(updates) {
  const messages = updates.map(({ message }) => message);
  if (
    !messages.some(
      (message) =>
        message === "Hopper bridge started request" ||
        message.includes("started on Hopper's serial bridge"),
    ) ||
    !messages.some(
      (message) =>
        message === "Hopper bridge completed request" ||
        message.includes("Hopper bridge completed request"),
    )
  )
    throw new Error(
      `The MCP client did not observe correlated Hopper bridge progress: ${JSON.stringify(updates)}`,
    );
}

/** Require one sanitized invalid-request diagnostic from the real bridge. */
export function requireBridgeDiagnostic(chunks) {
  const diagnostics = chunks
    .join("")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  if (
    !diagnostics.some(
      (diagnostic) =>
        diagnostic.type === "bridge-diagnostic" &&
        diagnostic.category === "invalid_request" &&
        diagnostic.message.includes(
          "Unknown Hopper address or name: __rea_missing_procedure__",
        ),
    )
  )
    throw new Error("The MCP runtime omitted the correlated Hopper diagnostic");
}

/** Verify named positive semantics from the source-owned C fixture. */
export async function verifyRealHopperFixture({
  client,
  options,
  document,
  oracle,
  normalizedResult,
}) {
  const main = await resolveFixtureProcedure(
    client,
    options,
    oracle.mainProcedure,
    normalizedResult,
  );
  const entry = await resolveFixtureProcedure(
    client,
    options,
    oracle.entryProcedure,
    normalizedResult,
  );
  const branch = await resolveFixtureProcedure(
    client,
    options,
    oracle.branchProcedure,
    normalizedResult,
  );
  const leaf = await resolveFixtureProcedure(
    client,
    options,
    oracle.leafProcedure,
    normalizedResult,
  );
  const comment = "REA real-Hopper conformance verifier";
  const commentSet = normalizedResult(
    await client.callTool(
      {
        name: "set_comment",
        arguments: { address: entry.address, comment, document },
      },
      options,
    ),
    "set_comment",
  );
  if (commentSet !== true)
    throw new Error("Hopper did not read back the fixture comment marker");

  const entryDossier = requireFunctionDossierOracle(
    await analyzeFixtureProcedure(client, options, entry, normalizedResult),
    {
      procedure_address: entry.address,
      callee_address: branch.address,
      caller_address: main.address,
      referenced_string: oracle.entryString,
      comment,
      require_assembly: true,
    },
  );
  const calls = entryDossier.outgoing_references.filter(
    (edge) => edge.call?.classification === "direct",
  );
  assert.ok(
    calls.some((edge) => edge.target_address === branch.address),
    "Hopper native direct-call classification was discarded",
  );
  const observed = normalizedResult(
    await client.callTool(
      {
        name: "procedure_references",
        arguments: { procedure: entry.address, direction: "outgoing" },
      },
      options,
    ),
    "procedure_references",
  );
  assert.deepEqual(entryDossier.unresolved_calls, observed.unresolved_calls);
  assert.equal(
    observed.reference_kinds_available,
    false,
    "Hopper's partial CallReference observations do not expose detailed reference kinds",
  );
  assert.ok(
    Array.isArray(observed.unresolved_calls),
    "procedure_references omitted its observed unresolved CallReference results",
  );
  for (const call of calls) {
    assert.equal(call.call.provider_type, 2);
    assert.equal(
      call.call.provenance,
      "hopper-public-python-api:CallReference",
    );
    assert.equal(
      call.kind.available,
      false,
      "partial call metadata invented detailed reference flags",
    );
    assert.deepEqual(
      observed.references.find(
        (edge) =>
          edge.source_address === call.source_address &&
          edge.target_address === call.target_address,
      )?.call,
      call.call,
    );
  }
  const branchDossier = requireFunctionDossierOracle(
    await analyzeFixtureProcedure(client, options, branch, normalizedResult),
    {
      procedure_address: branch.address,
      callee_address: leaf.address,
      caller_address: entry.address,
      require_cfg_successor: true,
      require_assembly: true,
    },
  );
  const leafDossier = requireFunctionDossierOracle(
    await analyzeFixtureProcedure(client, options, leaf, normalizedResult),
    {
      procedure_address: leaf.address,
      caller_address: branch.address,
      referenced_string: oracle.leafString,
      referenced_name: oracle.globalName,
      require_assembly: true,
    },
  );
  return {
    procedures: { main, entry, branch, leaf },
    entryComments: entryDossier.comments.returned,
    entryStrings: entryDossier.referenced_strings.returned,
    entryCallees: entryDossier.callees.returned,
    branchCallees: branchDossier.callees.returned,
    branchBlocks: branchDossier.basic_blocks.returned,
    leafStrings: leafDossier.referenced_strings.returned,
    leafNames: leafDossier.referenced_names.returned,
  };
}

/** Reject malformed, unsafe, or unexpected failure diagnostics from MCP. */
export function requireSafeDiagnostics(
  chunks,
  expectedErrorTools = ["procedure_info"],
  expectedErrorTags = ["HopperRemoteError"],
) {
  const expected = new Set(expectedErrorTools);
  const tags = new Set(expectedErrorTags);
  const lines = chunks
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    let diagnostic;
    try {
      diagnostic = JSON.parse(line);
    } catch {
      throw new Error(`The MCP runtime emitted malformed stderr: ${line}`);
    }
    if (
      diagnostic === null ||
      typeof diagnostic !== "object" ||
      diagnostic.application !== "rea" ||
      typeof diagnostic.level !== "number" ||
      diagnostic.level >= 50 ||
      (diagnostic.level >= 40 &&
        !tags.has(diagnostic.errorTag) &&
        !(expected.has(diagnostic.tool) && diagnostic.status === "error"))
    )
      throw new Error(`The MCP runtime emitted unsafe stderr: ${line}`);
  }
  return lines.length;
}

/** Bind mutations to the active document rather than list ordering. */
export async function requireCurrentDocument(
  client,
  options,
  documents,
  normalizedResult,
) {
  const current = normalizedResult(
    await client.callTool({ name: "current_document", arguments: {} }, options),
    "current_document",
  );
  if (
    typeof current !== "string" ||
    current.length === 0 ||
    !documents.includes(current)
  )
    throw new Error("current_document was not present in list_documents");
  return current;
}

export async function resolveFixtureProcedure(
  client,
  options,
  expectedName,
  normalizedResult,
) {
  const matches = normalizedResult(
    await client.callTool(
      {
        name: "search_procedures",
        arguments: {
          pattern: expectedName,
          mode: "literal",
          case_sensitive: true,
        },
      },
      options,
    ),
    "search_procedures",
  );
  const exactMatches = Array.isArray(matches)
    ? matches.filter(
        (item) =>
          typeof item?.value === "string" &&
          item.value.replace(/^_+/u, "") === expectedName,
      )
    : [];
  if (
    exactMatches.length !== 1 ||
    typeof exactMatches[0]?.address !== "string" ||
    !/^0x[0-9a-f]+$/iu.test(exactMatches[0].address)
  )
    throw new Error(
      `Expected exactly one Hopper procedure named ${expectedName}`,
    );
  return { address: exactMatches[0].address, name: exactMatches[0].value };
}

/** Request the assembly evidence required by the fixture oracle. */
export const analyzeFixtureProcedure = async (
  client,
  options,
  procedure,
  normalizedResult,
) => {
  const reply = await client.callTool(
    {
      name: "analyze_function",
      arguments: { procedure: procedure.address, detail: "complete" },
    },
    options,
  );
  const dossier = normalizedResult(reply, "analyze_function");
  assert.deepEqual(reply.structuredContent.relationship_coverage, {
    status: "complete",
  });
  for (const facet of [
    "pseudocode",
    "assembly",
    "comments",
    "callers",
    "callees",
    "references",
    "strings_names",
    "cfg",
  ])
    assert.deepEqual(dossier.facet_availability[facet], { available: true });
  const comparison = normalizedResult(
    await client.callTool(
      {
        name: "compare_functions",
        arguments: {
          left: reply.structuredContent,
          right: reply.structuredContent,
        },
      },
      options,
    ),
    "compare_functions",
  );
  assert.deepEqual(
    Object.fromEntries(
      comparison.dimensions.map(({ dimension, status }) => [dimension, status]),
    ),
    {
      identity: "unchanged",
      pseudocode: "unchanged",
      assembly: "unchanged",
      comments: "unchanged",
      calls: "unchanged",
      references: "unknown",
      strings_names: "unchanged",
      cfg: "unchanged",
    },
    JSON.stringify(comparison.dimensions),
  );
  return dossier;
};
