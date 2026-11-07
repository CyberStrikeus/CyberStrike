import {
  parseGhidraFunctionInput,
  parseGhidraFunctionResult,
} from "../dist/ghidra/GhidraFunctionValues.js";
import {
  parseGhidraInventoryInput,
  parseGhidraInventoryResult,
} from "../dist/ghidra/GhidraInventoryValues.js";
import { verifyNativeValueE2e } from "./lib/native-value-e2e.mjs";

import {
  assertDenseSwitchDossier,
  assertDossier,
  assertLocalProcedureInfo,
  assertProviderText,
  assertReferenceMetadata,
  dossierSummary,
  findValue,
  matchesSymbol,
  requireProcedure,
} from "./verify-real-ghidra-assertions.mjs";

async function functionCall(client, operation, parameters) {
  return (await functionObservationCall(client, operation, parameters)).value;
}

async function functionObservationCall(client, operation, parameters) {
  const input = parseGhidraFunctionInput(operation, parameters);
  if (!input.ok) throw input.error;
  const called = await client.callTool(operation, input.value);
  if (!called.ok)
    throw new Error(
      `Ghidra ${operation} failed for ${JSON.stringify(input.value)}: ${called.error.message}`,
      { cause: called.error },
    );
  const parsed = parseGhidraFunctionResult(operation, called.value);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

async function inventoryCall(client, operation, parameters) {
  const input = parseGhidraInventoryInput(operation, parameters);
  if (!input.ok) throw input.error;
  const called = await client.callTool(operation, input.value);
  if (!called.ok)
    throw new Error(
      `Ghidra ${operation} failed for ${JSON.stringify(input.value)}: ${called.error.message}`,
      { cause: called.error },
    );
  const parsed = parseGhidraInventoryResult(operation, called.value);
  if (!parsed.ok) throw parsed.error;
  return parsed.value.value;
}

export async function verifyDebugFunctionOperations(
  client,
  { procedures, strings, entry },
) {
  const leaf = requireProcedure(procedures, "rea_ghidra_inventory_leaf");
  const branch = requireProcedure(procedures, "rea_ghidra_inventory_branch");
  const indirect = requireProcedure(
    procedures,
    "rea_ghidra_inventory_indirect",
  );
  const switchProcedure = requireProcedure(
    procedures,
    "rea_ghidra_inventory_switch",
  );
  const denseSwitchProcedure = requireProcedure(
    procedures,
    "rea_ghidra_inventory_dense_switch",
  );
  const main =
    findValue(procedures, "main") ?? requireProcedure(procedures, "entry");
  const entryString = strings.find(
    (item) => item.value === "REA_GHIDRA_INVENTORY_ENTRY",
  );
  if (entryString === undefined)
    throw new Error("Ghidra debug string function probe is unavailable");

  const [
    info,
    assembly,
    instructionWindow,
    pseudocode,
    callees,
    callers,
    outgoing,
    entryXrefs,
  ] = await collectEntryFunctionData(client, entry);
  assertLocalProcedureInfo(info, entry.address);
  const instruction = await functionCall(client, "inspect_native_instruction", {
    document: null,
    address: entry.address,
  });
  if (
    instruction.status !== "decoded" ||
    instruction.length < 1 ||
    instruction.bytes.length !== instruction.length * 2
  )
    throw new Error("Structured native instruction facts drifted");
  const directSite = outgoing.references.find(
    (reference) => reference.kind.call && !reference.kind.computed,
  );
  if (directSite === undefined)
    throw new Error("Direct call fixture site unavailable");
  const direct = await functionCall(client, "resolve_native_call_targets", {
    document: null,
    address: directSite.source_address,
  });
  if (
    direct.status !== "direct" ||
    !direct.targets.some(
      (target) => target.address === directSite.target_address,
    )
  )
    throw new Error("Direct call target resolution drifted");
  const missingType = await functionCall(client, "inspect_native_data_type", {
    document: null,
    type: "/REA_MISSING_TYPE",
  });
  if (missingType.status !== "unavailable")
    throw new Error("Missing native type was not explicit");
  assertProviderText(assembly, pseudocode, entry.address);
  if (
    instructionWindow.procedure?.address !== entry.address ||
    instructionWindow.instructions?.length === 0 ||
    instructionWindow.limitations.length === 0
  )
    throw new Error(
      "Ghidra read_function_instructions failed its complete fast-path contract",
    );
  assertEntryCallGraph({ branch, indirect, main, callees, callers });
  const { xrefOwners, xrefOwnerFailures } = await resolveXrefOwners(
    client,
    entryXrefs,
  );
  assertEntryXrefAttribution({
    entryXrefs,
    callers,
    xrefOwners,
    xrefOwnerFailures,
    main,
  });
  assertReferenceMetadata(outgoing);
  await assertStringXrefs(client, entryString.address);

  const entryDossier = await analyzeEntryDossier(
    client,
    entry,
    branch,
    indirect,
  );
  const branchDossier = await analyzeBranchDossier(client, branch);
  const indirectDossier = await analyzeIndirectDossier(client, indirect);
  const switchDossier = await analyzeSwitchDossier(client, switchProcedure);
  const denseSwitchDossier = await functionCall(client, "analyze_function", {
    procedure: denseSwitchProcedure.address,
  });
  const terminalProcedure = requireProcedure(
    procedures,
    "rea_ghidra_inventory_terminal_call",
  );
  const terminalObservations = await Promise.all(
    [
      "procedure_info",
      "procedure_assembly",
      "read_function_instructions",
      "procedure_pseudo_code",
      "analyze_function",
    ].map((operation) =>
      functionObservationCall(client, operation, {
        ...(operation === "analyze_function" ? {} : { document: null }),
        procedure: terminalProcedure.address,
      }),
    ),
  );
  const terminalLimitations = terminalObservations.map((result) =>
    result.limitations.find(
      (limitation) =>
        /terminal call at 0x[0-9a-f]+/i.test(limitation) &&
        / to 0x[0-9a-f]+/i.test(limitation) &&
        limitation.includes("abort") &&
        limitation.includes("hasNoReturn=true"),
    ),
  );
  if (
    terminalLimitations.some((limitation) => limitation === undefined) ||
    terminalLimitations.some(
      (limitation) =>
        !limitation.includes("external=") ||
        !limitation.includes("thunk=") ||
        !limitation.includes("fallthrough is excluded") ||
        !limitation.includes("not an independent verification"),
    )
  )
    throw new Error(
      `Ghidra no-return boundary evidence was missing callee, address, or flag provenance: ${JSON.stringify(terminalObservations.map(({ limitations }) => limitations))}`,
    );
  const returningObservation = await functionObservationCall(
    client,
    "procedure_info",
    { document: null, procedure: leaf.address },
  );
  if (
    returningObservation.limitations.some((limitation) =>
      limitation.includes("puts"),
    )
  )
    throw new Error("Ghidra marked an ordinary returning call as terminal");
  // The debug fixture is compiled -O0, and GCC 16 and later lower dense
  // switches to compare chains at -O0, so this dossier asserts only its
  // complete shape; the optimized jump-table variant proves dense jump-table
  // completeness through assertDenseSwitchDossier.
  assertDossier(denseSwitchDossier, {
    address: denseSwitchProcedure.address,
    requireAssembly: true,
    requireMultiBlock: true,
  });
  assertIndirectDossier(indirectDossier, leaf.address);

  const { cancellation, timeout } = await verifyRequestCancellationAndTimeout(
    client,
    entry,
  );
  const concurrent = await verifyConcurrentRequests(client, entry, leaf);

  return {
    entry: dossierSummary(entryDossier),
    branch: dossierSummary(branchDossier),
    indirect: dossierSummary(indirectDossier),
    switch: dossierSummary(switchDossier),
    dense_switch: dossierSummary(denseSwitchDossier),
    instruction_window: {
      returned: instructionWindow.instructions.length,
    },
    terminal_call_limitations: terminalLimitations,
    returning_call_limitations: returningObservation.limitations,
    cancellation,
    timeout,
    concurrency: concurrent,
  };
}

async function collectEntryFunctionData(client, entry) {
  return Promise.all([
    functionCall(client, "procedure_info", {
      document: null,
      procedure: entry.value,
    }),
    functionCall(client, "procedure_assembly", {
      document: null,
      procedure: entry.value,
    }),
    functionCall(client, "read_function_instructions", {
      document: null,
      procedure: entry.value,
    }),
    functionCall(client, "procedure_pseudo_code", {
      document: null,
      procedure: entry.value,
    }),
    functionCall(client, "procedure_callees", {
      document: null,
      procedure: entry.value,
    }),
    functionCall(client, "procedure_callers", {
      document: null,
      procedure: entry.value,
    }),
    functionCall(client, "procedure_references", {
      document: null,
      procedure: entry.value,
      direction: "outgoing",
    }),
    functionCall(client, "xrefs", {
      document: null,
      address: entry.address,
    }),
  ]);
}

function assertEntryCallGraph({ branch, indirect, main, callees, callers }) {
  for (const expected of [branch.address, indirect.address])
    if (!callees.includes(expected))
      throw new Error(`Ghidra call graph missed ${expected}`);
  if (!callers.includes(main.address))
    throw new Error("Ghidra caller or xref relation missed main");
}

async function resolveXrefOwners(client, entryXrefs) {
  const xrefOwners = [];
  const xrefOwnerFailures = [];
  for (const address of entryXrefs) {
    try {
      xrefOwners.push(
        await inventoryCall(client, "resolve_containing_procedure", {
          document: null,
          address,
        }),
      );
    } catch (cause) {
      xrefOwnerFailures.push({
        address,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return { xrefOwners, xrefOwnerFailures };
}

function assertEntryXrefAttribution({
  entryXrefs,
  callers,
  xrefOwners,
  xrefOwnerFailures,
  main,
}) {
  if (
    !xrefOwners.some(
      (owner) => owner.found && owner.procedure.address === main.address,
    )
  )
    throw new Error(
      `Ghidra entry xrefs were not attributable to main: ${JSON.stringify({ entryXrefs, callers, xrefOwners, xrefOwnerFailures })}`,
    );
}

async function assertStringXrefs(client, entryStringAddress) {
  const stringXrefs = await functionCall(client, "xrefs", {
    document: null,
    address: entryStringAddress,
  });
  if (stringXrefs.length === 0)
    throw new Error("Ghidra xrefs missed the entry string");
}

async function analyzeEntryDossier(client, entry, branch, indirect) {
  const entryDossier = await functionCall(client, "analyze_function", {
    procedure: entry.address,
  });
  assertDossier(entryDossier, {
    address: entry.address,
    expectedCallees: [branch.address, indirect.address],
    expectedString: "REA_GHIDRA_INVENTORY_ENTRY",
    requireAssembly: true,
  });
  return entryDossier;
}

async function analyzeSwitchDossier(client, switchProcedure) {
  const dossier = await functionCall(client, "analyze_function", {
    procedure: switchProcedure.address,
  });
  assertDossier(dossier, {
    address: switchProcedure.address,
    requireAssembly: true,
    requireMultiBlock: true,
  });
  return dossier;
}

async function analyzeBranchDossier(client, branch) {
  const branchDossier = await functionCall(client, "analyze_function", {
    procedure: branch.address,
  });
  assertDossier(branchDossier, {
    address: branch.address,
    requireMultiBlock: true,
  });
  return branchDossier;
}

async function analyzeIndirectDossier(client, indirect) {
  const indirectDossier = await functionCall(client, "analyze_function", {
    procedure: indirect.address,
  });
  assertDossier(indirectDossier, {
    address: indirect.address,
    requireAssembly: true,
  });
  return indirectDossier;
}

function assertIndirectDossier(indirectDossier, leafAddress) {
  if (indirectDossier.callees.some(({ address }) => address === leafAddress))
    throw new Error(
      "Ghidra dossier falsely resolved a targetless callback as the fixture leaf",
    );
  if (!/\b(?:call|blr|blx)\b/iu.test(indirectDossier.assembly.join("\n")))
    throw new Error(
      "Ghidra indirect-call fixture lost its architecture-specific call instruction",
    );
}

async function verifyRequestCancellationAndTimeout(client, entry) {
  const aborted = new AbortController();
  aborted.abort();
  const cancelled = await client.callTool(
    "procedure_info",
    { document: null, procedure: entry.address },
    { signal: aborted.signal },
  );
  if (cancelled.ok || cancelled.error.kind !== "cancelled")
    throw new Error("Ghidra established-request cancellation drifted");

  const timedOut = await client.ping({ timeoutMs: 0 });
  if (timedOut.ok || timedOut.error.kind !== "timeout")
    throw new Error("Ghidra expired ping deadline drifted");

  return {
    cancellation: "cancelled-before-wire",
    ping_deadline: "expired-before-wire",
  };
}

async function verifyConcurrentRequests(client, entry, leaf) {
  const concurrent = await Promise.all([
    functionCall(client, "procedure_info", {
      document: null,
      procedure: entry.address,
    }),
    functionCall(client, "xrefs", {
      document: null,
      address: leaf.address,
    }),
  ]);
  if (concurrent.length !== 2)
    throw new Error("Ghidra serial request queue lost a concurrent result");
  return "serialized-two-results";
}

/** Prove dense jump-table completeness on the optimized jump-table fixture. */
export async function verifyJumpTableDenseSwitch(client, procedures) {
  const denseSwitchProcedure = requireProcedure(
    procedures,
    "rea_ghidra_inventory_dense_switch",
  );
  const dossier = await functionCall(client, "analyze_function", {
    procedure: denseSwitchProcedure.address,
  });
  assertDenseSwitchDossier(dossier, denseSwitchProcedure.address);
  return { dense_switch: dossierSummary(dossier) };
}

export async function verifyStrippedFunctionOperations(client, entryString) {
  const stringXrefs = await functionCall(client, "xrefs", {
    document: null,
    address: entryString.address,
  });
  if (stringXrefs.length === 0)
    throw new Error("Ghidra stripped string xref probe is unavailable");
  const containing = await inventoryCall(
    client,
    "resolve_containing_procedure",
    {
      document: null,
      address: stringXrefs[0],
    },
  );
  if (!containing.found)
    throw new Error("Ghidra could not recover a stripped containing function");
  const procedure = containing.procedure;
  const pseudocode = await functionCall(client, "procedure_pseudo_code", {
    document: null,
    procedure: procedure.address,
  });
  if (typeof pseudocode !== "string" || pseudocode.trim().length === 0)
    throw new Error("Ghidra did not decompile the stripped function");
  const dossier = await functionCall(client, "analyze_function", {
    procedure: procedure.address,
  });
  assertDossier(dossier, {
    address: procedure.address,
    expectedString: "REA_GHIDRA_INVENTORY_ENTRY",
    requireAssembly: true,
  });
  if (matchesSymbol(dossier.procedure.name, "rea_ghidra_inventory_entry"))
    throw new Error(
      `Ghidra stripped dossier retained a source symbol: ${JSON.stringify(dossier.procedure)}`,
    );
  return dossierSummary(dossier);
}

export async function verifyCrossFormatOperations({
  client,
  variant,
  procedures,
  names,
  strings,
}) {
  const message = strings.find(
    (item) => item.value === "REA_GHIDRA_CROSS_FORMAT",
  );
  if (message === undefined)
    throw new Error(`${variant} string inventory missed the source oracle`);
  const entry =
    procedures.find((item) => matchesSymbol(item.value, "rea_cross_entry")) ??
    names.find((item) => matchesSymbol(item.value, "rea_cross_entry"));
  if (entry === undefined)
    throw new Error(`${variant} did not retain the exported entry symbol`);
  const entryAddress = entry.address;
  const info = await functionCall(client, "procedure_info", {
    document: null,
    procedure: entryAddress,
  });
  assertLocalProcedureInfo(info, entryAddress);
  const [pseudocode, assembly, callees, messageXrefs] = await Promise.all([
    functionCall(client, "procedure_pseudo_code", {
      document: null,
      procedure: entryAddress,
    }),
    functionCall(client, "procedure_assembly", {
      document: null,
      procedure: entryAddress,
    }),
    functionCall(client, "procedure_callees", {
      document: null,
      procedure: entryAddress,
    }),
    functionCall(client, "xrefs", {
      document: null,
      address: message.address,
    }),
  ]);
  assertProviderText(assembly, pseudocode, entryAddress);
  if (callees.length < 2)
    throw new Error(`${variant} call graph missed direct fixture calls`);
  if (messageXrefs.length === 0)
    throw new Error(`${variant} xrefs missed the fixture string`);

  const messageOwner = await findCrossStringOwner(client, messageXrefs);
  const stringDossier = await functionCall(client, "analyze_function", {
    procedure: messageOwner.procedure.address,
  });
  assertDossier(stringDossier, {
    address: messageOwner.procedure.address,
    expectedString: "REA_GHIDRA_CROSS_FORMAT",
  });

  const branchAddress = await findCrossBranchAddress(client, variant, callees);
  const branchDossier = await functionCall(client, "analyze_function", {
    procedure: branchAddress,
  });
  assertDossier(branchDossier, {
    address: branchAddress,
    requireMultiBlock: true,
  });
  return {
    entry: entryAddress,
    exported_symbol: entry.value,
    string_owner: dossierSummary(stringDossier),
    branch: dossierSummary(branchDossier),
  };
}

async function findCrossStringOwner(client, messageXrefs) {
  for (const address of messageXrefs) {
    const candidate = await inventoryCall(
      client,
      "resolve_containing_procedure",
      {
        document: null,
        address,
      },
    );
    if (candidate.found) return candidate;
  }
  throw new Error("Cross-format did not resolve the string-owning function");
}

async function findCrossBranchAddress(client, variant, callees) {
  for (const address of callees) {
    const candidate = await functionCall(client, "procedure_info", {
      document: null,
      procedure: address,
    });
    if (candidate.basicblock_count > 1) return address;
  }
  throw new Error(`${variant} did not recover the multi-block callee`);
}

export async function verifyNativeTypeLayout(client, typeNames) {
  const layoutSymbol = typeNames.find((item) =>
    matchesSymbol(item.value, "rea_ghidra_inventory_layout"),
  );
  if (layoutSymbol === undefined)
    throw new Error("Native layout fixture symbol unavailable");
  const layout = await functionCall(client, "inspect_native_data_type", {
    document: null,
    address: layoutSymbol.address,
  });
  if (
    layout.kind !== "struct" ||
    layout.fields.length !== 3 ||
    layout.size_bytes < 12
  )
    throw new Error(
      `Native struct layout unavailable: ${JSON.stringify(layout)}`,
    );
  const payloadField = layout.fields.find((field) => field.name === "payload");
  const stateField = layout.fields.find((field) => field.name === "state");
  if (payloadField === undefined || stateField === undefined)
    throw new Error(
      `Nested layout field identities unavailable: ${JSON.stringify(layout)}`,
    );
  const payload = await functionCall(client, "inspect_native_data_type", {
    document: null,
    type: payloadField.type_id,
  });
  const state = await functionCall(client, "inspect_native_data_type", {
    document: null,
    type: stateField.type_id,
  });
  if (
    payload.kind !== "union" ||
    payload.fields.length !== 2 ||
    state.kind !== "enum" ||
    !state.members.some(
      (member) => member.name === "REA_FIXTURE_READY" && member.value === "3",
    )
  )
    throw new Error("Nested union or enum layout drifted");
  return { layout, payload, state };
}

export async function verifyRelativeSwitch(client, procedures, entrySize) {
  // Relocatable loaders may choose an assembler-generated alias as the function name.
  const names = await inventoryCall(client, "list_names", {
    document: null,
    address: null,
  });
  const procedure = requireProcedure(names, "rea_relative_switch");
  const dossier = await functionCall(client, "analyze_function", {
    procedure: procedure.address,
  });
  const table = dossier.native_api?.jump_tables.find((item) =>
    item.data_sources.some(
      (source) =>
        source.entry_size_bytes === entrySize && source.entry_count === 4,
    ),
  );
  if (table === undefined)
    throw new Error(
      `Exact ${entrySize}-byte relative table unavailable: ${JSON.stringify(dossier.native_api)}`,
    );
  for (let value = 0; value < 4; value++) {
    const mapping = table.mappings.find((item) => item.case_value === value);
    if (mapping === undefined || mapping.confidence !== "high")
      throw new Error("Relative switch case mapping was not verified");
    const instruction = await functionCall(
      client,
      "inspect_native_instruction",
      { address: mapping.target_address },
    );
    if (
      instruction.status !== "decoded" ||
      !instruction.operands.some((operand) =>
        operand.components.some(
          (component) =>
            component.kind === "immediate" &&
            component.value === `0x${(100 + value).toString(16)}`,
        ),
      )
    )
      throw new Error(
        `Relative switch target does not implement source case ${value}: ${JSON.stringify(instruction)}`,
      );
  }
  return {
    entry_size: entrySize,
    dispatch_address: table.dispatch_address,
    mappings: table.mappings.length,
  };
}

/**
 * Oracle for relative-switch-signed.S: signed halfword byte offsets from a base
 * inside the case bodies, a CBZ route for the zero entry, and a B.CS bound.
 */
const SIGNED_RELATIVE_SWITCH_CASES = [
  { value: 0, immediate: 200 },
  { value: 1, immediate: 201 },
  { value: 2, immediate: 202 },
  { value: 3, immediate: 250 },
  { value: 4, immediate: 204 },
];

export async function verifyRelativeSignedSwitch(client, selectorBias = 0) {
  const names = await inventoryCall(client, "list_names", {
    document: null,
    address: null,
  });
  const procedure = requireProcedure(names, "rea_relative_switch_signed");
  const dossier = await functionCall(client, "analyze_function", {
    procedure: procedure.address,
  });
  const table = dossier.native_api?.jump_tables.find((item) =>
    item.data_sources.some(
      (source) =>
        source.entry_size_bytes === 2 &&
        source.entry_count === SIGNED_RELATIVE_SWITCH_CASES.length,
    ),
  );
  if (table === undefined)
    throw new Error(
      `Exact signed halfword relative table unavailable: ${JSON.stringify(dossier.native_api)}`,
    );
  const expectedValues = SIGNED_RELATIVE_SWITCH_CASES.map(
    ({ value }) => value + selectorBias,
  );
  if (
    table.mappings.some(
      (mapping) =>
        mapping.case_value !== null &&
        !expectedValues.includes(mapping.case_value),
    )
  )
    throw new Error(
      `Signed relative switch emitted an unsupported case label: ${JSON.stringify(table)}`,
    );
  if (table.mappings.length !== SIGNED_RELATIVE_SWITCH_CASES.length)
    throw new Error(
      `Signed relative switch has unexpected mappings: ${JSON.stringify(table)}`,
    );
  if (selectorBias !== 0) {
    if (
      !table.limitations.some((limitation) =>
        limitation.includes("table indices are not proven"),
      ) ||
      !table.mappings.some((mapping) => mapping.case_value === null) ||
      table.mappings.some((mapping) => mapping.case_value === selectorBias + 3)
    )
      throw new Error(
        `Normalized selector must retain unknown case evidence: ${JSON.stringify(table)}`,
      );
  }
  for (const { value: tableIndex, immediate } of SIGNED_RELATIVE_SWITCH_CASES) {
    const value = tableIndex + selectorBias;
    // Without a proven relationship between the machine index and the typed
    // switch selector, the CBZ-only case must stay unknown rather than being
    // assigned the normalized index or Ghidra's unreachable base destination.
    if (selectorBias !== 0 && tableIndex === 3) continue;
    const mapping = table.mappings.find((item) => item.case_value === value);
    if (
      mapping === undefined ||
      mapping.confidence !== "high" ||
      (selectorBias !== 0 &&
        !mapping.evidence.some(
          (evidence) => evidence.source === "ghidra-clang-case-token",
        ))
    )
      throw new Error(
        `Signed relative switch case ${value} was not verified: ${JSON.stringify(table)}`,
      );
    const instruction = await functionCall(
      client,
      "inspect_native_instruction",
      { address: mapping.target_address },
    );
    if (
      instruction.status !== "decoded" ||
      !instruction.operands.some((operand) =>
        operand.components.some(
          (component) =>
            component.kind === "immediate" &&
            component.value === `0x${immediate.toString(16)}`,
        ),
      )
    )
      throw new Error(
        `Signed relative switch target does not implement source case ${value}: ${JSON.stringify(instruction)}`,
      );
  }
  return {
    entry_size: 2,
    signed: true,
    selector_bias: selectorBias,
    dispatch_address: table.dispatch_address,
    mappings: table.mappings.length,
  };
}

export async function verifyNativeValueTrace(client, procedures, target) {
  const entry = requireProcedure(procedures, "rea_ghidra_inventory_entry");
  const names = await inventoryCall(client, "list_names", {
    document: null,
    address: null,
  });
  const global = requireProcedure(names, "rea_ghidra_inventory_global");
  return verifyNativeValueE2e(target, entry.address, global.address);
}

/** Match the source default's -1 assignment in supported native compiler encodings. */
export async function verifyDenseDefaultReturn(client, targetAddress) {
  const instruction = await functionCall(client, "inspect_native_instruction", {
    address: targetAddress,
  });
  if (
    instruction.status !== "decoded" ||
    !isDefaultMinusOneAssignment(instruction)
  )
    throw new Error(
      `Dense default target lacks the source -1 assignment (x86 register/stack MOV or AArch64 W-register MOVN): ${JSON.stringify(instruction)}`,
    );
  return {
    target_address: targetAddress,
    instruction_bytes: instruction.bytes,
  };
}

function isDefaultMinusOneAssignment(instruction) {
  if (instruction.architecture.startsWith("x86:"))
    return (
      instruction.bytes === "b8ffffffff" ||
      /^c745[0-9a-f]{2}ffffffff$/u.test(instruction.bytes)
    );
  if (
    instruction.architecture.startsWith("AARCH64:") &&
    instruction.bytes.length === 8
  ) {
    const word = Buffer.from(instruction.bytes, "hex").readUInt32LE();
    return (word & 0xffffffe0) === 0x12800000;
  }
  return false;
}
