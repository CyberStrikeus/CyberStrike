import {
  requireMcpToolError,
  mcpTextValue,
  requireMcpOperationResult,
} from "./mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { verifyLegacyGhidraReferenceSnapshot } from "./ghidra-reference-snapshot-e2e.mjs";
import { verifyGhidraSnapshotLifecycle } from "./real-ghidra-snapshot-lifecycle.mjs";
import { verifyGhidraTargetAdmission } from "./real-ghidra-target-admission.mjs";
import { verifyGhidraLargeResults } from "./real-ghidra-large-results.mjs";
import { verifyGhidraEntryAliases } from "./real-ghidra-entry-aliases.mjs";
import { verifyGhidraNamespaceAnnotations } from "./real-ghidra-namespace-annotations.mjs";
import { verifyGhidraBatchIdentity } from "./real-ghidra-batch-identity.mjs";
import { verifyGhidraInstructionFlow } from "./real-ghidra-instruction-flow.mjs";

/** Probe real Ghidra location, annotation and error contracts through public adapters. */
export async function verifyGhidraBoundaries(
  client,
  { target, procedure, entrypoint, env },
) {
  const options = { timeout: 180000 };
  const catalog = await client.listTools();
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validators = new Map();
  for (const tool of catalog.tools) {
    for (const key of ["inputSchema", "outputSchema"])
      assert.ok(
        ajv.validateSchema(tool[key]),
        `${tool.name} ${key}: ${JSON.stringify(ajv.errors)}`,
      );
    validators.set(
      tool.name,
      (tool.outputSchema?.$id && ajv.getSchema(tool.outputSchema.$id)) ||
        ajv.compile(tool.outputSchema),
    );
  }
  let successfulCalls = 0;
  let rejectedCalls = 0;
  const checkedReply = async (name, args = {}) => {
    const reply = await client.callTool({ name, arguments: args }, options);
    const result = requireMcpOperationResult(reply, name);
    const validate = validators.get(name);
    assert.ok(validate, `${name} missing from catalog`);
    assert.ok(
      validate(reply.structuredContent),
      `${name}: ${JSON.stringify(validate.errors)}`,
    );
    assert.deepEqual(reply.structuredContent, JSON.parse(mcpTextValue(reply)));
    if (name === "list_strings" || name === "search_strings")
      assert.ok(
        reply.structuredContent.limitations.some((limitation) =>
          /Only Ghidra-defined string Data.*empty search does not establish/u.test(
            limitation,
          ),
        ),
        `${name} omitted defined-string coverage`,
      );
    successfulCalls++;
    return { reply, result };
  };
  const call = async (name, args = {}) =>
    (await checkedReply(name, args)).result;
  // Validated complete Evidence for checks outside the operation result.
  const evidence = async (name, args = {}) =>
    (await checkedReply(name, args)).reply.structuredContent;
  const invalid = async (name, args, diagnostic) => {
    const reply = await client.callTool({ name, arguments: args }, options);
    assert.equal(
      reply.isError,
      true,
      `${name} accepted ${JSON.stringify(args)}`,
    );
    // SDK input rejections are prose; application errors carry canonical JSON
    // text without publishing data outside the advertised success schema.
    const error = mcpTextValue(reply).startsWith("{")
      ? requireMcpToolError(reply)
      : undefined;
    assert.equal(reply.structuredContent, undefined);
    if (diagnostic !== undefined) {
      assert.equal(error?.code, "invalid_request");
      assert.equal(error?.details?.operation, name);
      assert.match(JSON.stringify(error.details.issues), diagnostic);
    }
    rejectedCalls++;
    return error;
  };
  const cli = async (command, value, flags = []) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        entrypoint,
        command,
        target.path,
        value,
        "--provider",
        "ghidra",
        "--json",
        ...flags,
      ],
      { env, timeout: 240000, maxBuffer: 72 * 1024 * 1024 },
    );
    return JSON.parse(stdout).normalized_result;
  };
  const original = await call("analyze_function", {
    procedure,
    detail: "complete",
  });
  const roots = (await readdir(env.TMPDIR)).filter((name) =>
    name.startsWith("rea-ghidra-"),
  );
  assert.equal(roots.length, 1, "Expected one owned Ghidra runtime");
  const runtimeRoot = join(env.TMPDIR, roots[0]);
  const { endpoint_path: socketPath } = JSON.parse(
    await readFile(join(runtimeRoot, "ownership.json"), "utf8"),
  );
  const socketRoot = dirname(socketPath);
  assert.ok(
    Buffer.byteLength(join(runtimeRoot, "bridge.sock"), "utf8") > 107,
    "Fixture must exceed Unix socket path capacity",
  );
  assert.ok(Buffer.byteLength(socketPath, "utf8") <= 103);
  assert.notEqual(socketRoot, runtimeRoot);
  assert.equal((await stat(socketRoot)).mode & 0o777, 0o700);
  const address = original.procedure.address;
  const name = original.procedure.name;
  const procedures = await call("list_procedures");
  const external = procedures.find((item) => item.procedure.external);
  assert.ok(external, "Source fixture lacks an external function");
  const externalDossier = await call("analyze_function", {
    procedure: external.address,
    detail: "complete",
  });
  assert.equal(externalDossier.pseudocode, "");
  assert.deepEqual(externalDossier.assembly, []);
  assert.deepEqual(externalDossier.callees, []);
  assert.deepEqual(externalDossier.facet_availability.pseudocode, {
    available: false,
    reason: "Ghidra does not decompile external functions.",
  });
  for (const facet of [
    "assembly",
    "comments",
    "callers",
    "callees",
    "references",
    "strings_names",
    "cfg",
  ])
    assert.deepEqual(externalDossier.facet_availability[facet], {
      available: true,
    });
  const externalEntry = await call("resolve_containing_procedure", {
    address: external.address,
  });
  assert.equal(externalEntry.found, true);
  assert.equal(externalEntry.procedure.address, external.address);
  assert.equal(externalEntry.procedure.classification.external, true);
  assert.deepEqual(
    externalEntry.procedure.body,
    externalDossier.procedure.body,
  );
  assert.equal(externalEntry.procedure.body.contains_entry, false);
  assert.deepEqual(externalEntry.procedure.body.ranges, []);
  const externalSpace = external.address.slice(
    0,
    external.address.indexOf(":"),
  );
  const lastExternalOffset = procedures
    .filter((item) => item.procedure.external)
    .map((item) => BigInt(item.address.slice(item.address.indexOf(":") + 1)))
    .reduce((maximum, offset) => (offset > maximum ? offset : maximum), 0n);
  const unknownExternal = `${externalSpace}:0x${(lastExternalOffset + 1n).toString(16)}`;
  assert.deepEqual(
    await call("resolve_containing_procedure", { address: unknownExternal }),
    {
      query_address: unknownExternal,
      found: false,
      procedure: null,
      reason: "outside_segments",
    },
  );
  assert.deepEqual(
    (await cli("function", external.address)).procedure,
    externalDossier.procedure,
    "CLI and MCP must preserve external identity without inventing body bytes",
  );
  await invalid(
    "annotate_native_function",
    { procedure: external.address, name: "rea_external_edit" },
    /Annotations require a local function entry/u,
  );
  const names = await call("list_names");
  const batchIdentity = await verifyGhidraBatchIdentity(call, names);
  const instructionFlow = await verifyGhidraInstructionFlow(call, names, cli);
  const leaf = names.find((item) =>
    item.value.endsWith("rea_ghidra_inventory_leaf"),
  );
  const pointer = names.find((item) =>
    item.value.endsWith("rea_ghidra_interior_pointer"),
  );
  assert.ok(
    leaf && pointer,
    "Source fixture lacks the interior function pointer",
  );
  const interiorTarget = `0x${(BigInt(leaf.address) + 1n).toString(16)}`;
  assert.ok(
    (await call("xrefs", { address: interiorTarget })).includes(
      pointer.address,
    ),
  );
  const incoming = await call("procedure_references", {
    procedure: leaf.address,
    direction: "incoming",
  });
  const interiorEdge = incoming.references.find(
    (edge) =>
      edge.source_address === pointer.address &&
      edge.target_address === interiorTarget,
  );
  assert.ok(
    interiorEdge,
    "Procedure references omitted an observed interior-body edge",
  );
  assert.equal(interiorEdge.target_procedure?.address, leaf.address);
  assert.equal(interiorEdge.source_procedure, null);
  assert.equal(interiorEdge.kind.data, true);
  const leafDossier = await call("analyze_function", {
    procedure: leaf.address,
    detail: "complete",
  });
  assert.ok(
    leafDossier.incoming_references.some(
      (edge) =>
        edge.source_address === pointer.address &&
        edge.target_address === interiorTarget,
    ),
  );
  assert.deepEqual(
    (await cli("function", leaf.value)).incoming_references,
    leafDossier.incoming_references,
    "CLI and MCP must retain the same interior-body references",
  );
  await verifyLegacyGhidraReferenceSnapshot(client, {
    target,
    procedure: leaf.address,
    omittedEdge: interiorEdge,
    entrypoint,
    env,
  });
  const longSelector = "REA_MISSING_" + "x".repeat(32768);
  for (const selected of [
    longSelector,
    `${longSelector}:0x1`,
    `${"%78".repeat(12000)}:0x1`,
    `${longSelector}%GG:0x1`,
  ]) {
    await invalid(
      "procedure_address",
      { procedure: selected },
      /Unknown|invalid/u,
    );
    assert.equal(
      await call("procedure_address", { procedure: address }),
      address,
      "Invalid selectors must preserve the live provider connection",
    );
  }
  const baseline = await call("inspect_native_instruction", { address });
  assert.equal(baseline.status, "decoded");
  const bytes = await call("read_bytes", { address, length: baseline.length });
  assert.equal(bytes.bytes_hex, baseline.bytes);
  assert.equal((await call("read_bytes", { address })).requested_bytes, 256);
  const mapped = await call("address_to_file_offset", { address });
  assert.equal(mapped.address, address);
  assert.equal(
    (await readFile(target.path))
      .subarray(mapped.file_offset, mapped.file_offset + baseline.length)
      .toString("hex"),
    bytes.bytes_hex,
    "Memory-to-file mapping must identify the bytes in the caller's artifact",
  );
  const largeRead = await call("read_bytes", {
    address,
    length: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(largeRead.requested_bytes, Number.MAX_SAFE_INTEGER);
  assert.equal(largeRead.complete, false);
  assert.ok(largeRead.returned_bytes >= baseline.length);
  assert.equal(largeRead.bytes_hex.length, largeRead.returned_bytes * 2);
  for (const spelling of [
    address.toUpperCase(),
    address.slice(2).toUpperCase(),
    `ram:${address.toUpperCase()}`,
  ]) {
    assert.deepEqual(
      await call("inspect_native_instruction", { address: spelling }),
      baseline,
    );
    assert.deepEqual(
      await call("read_bytes", { address: spelling, length: baseline.length }),
      bytes,
    );
    assert.equal(await call("address_name", { address: spelling }), name);
    assert.equal(
      await call("procedure_address", { procedure: spelling }),
      address,
    );
    assert.equal(
      (await call("resolve_containing_procedure", { address: spelling }))
        .procedure.address,
      address,
    );
  }
  assert.deepEqual(
    await cli("inspect-native-instruction", address.toUpperCase()),
    baseline,
  );
  // x86 function entries can begin with a one-byte PUSH. Locate an observed
  // multi-byte instruction instead of assuming entry + 1 is an interior byte.
  let multiByteInstruction;
  for (const range of original.procedure.body.ranges) {
    let cursor = BigInt(range.start);
    while (cursor <= BigInt(range.end)) {
      const instruction = await call("inspect_native_instruction", {
        address: `0x${cursor.toString(16)}`,
      });
      if (instruction.status === "decoded" && instruction.length > 1) {
        multiByteInstruction = instruction;
        break;
      }
      cursor += BigInt(instruction.length ?? 1);
    }
    if (multiByteInstruction !== undefined) break;
  }
  assert.ok(multiByteInstruction, "Fixture lacks a multi-byte instruction");
  const interior = `0x${(BigInt(multiByteInstruction.address) + 1n).toString(16)}`;
  assert.equal(
    (await call("inspect_native_instruction", { address: interior })).status,
    "not-instruction-boundary",
  );
  assert.equal(
    (await call("inspect_native_instruction", { address: "0x0" })).status,
    "outside-memory",
  );
  assert.equal(
    (await call("resolve_native_call_targets", { address })).status,
    "not-call",
  );
  const directEdge = original.outgoing_references.find(
    (edge) => edge.kind.call && !edge.kind.computed,
  );
  assert.ok(directEdge, "Source fixture lacks a direct call");
  const direct = await call("resolve_native_call_targets", {
    address: directEdge.source_address,
  });
  assert.equal(direct.status, "direct");
  assert.ok(
    direct.targets.some(
      (candidate) =>
        candidate.address === directEdge.target_address &&
        candidate.status === "direct",
    ),
  );
  const indirectProcedure = (await call("list_procedures")).find((item) =>
    item.value.endsWith("rea_ghidra_inventory_indirect"),
  );
  assert.ok(indirectProcedure);
  const references = await call("procedure_references", {
    procedure: indirectProcedure.address,
  });
  assert.ok(
    references.unresolved_calls.length > 0,
    "Targetless calls must remain visible",
  );
  for (const site of references.unresolved_calls) {
    const unresolved = await call("resolve_native_call_targets", {
      address: site.address,
    });
    assert.equal(unresolved.status, "unresolved");
    assert.deepEqual(unresolved.targets, []);
    assert.ok(unresolved.limitations.length > 0);
  }
  const strings = await call("list_strings");
  assert.ok(strings.length > 0);
  assert.deepEqual(
    await call("list_strings", { address: strings[0].address }),
    [strings[0]],
  );
  const marker = strings.find(
    (item) => item.value === "REA_GHIDRA_INVENTORY_ENTRY",
  );
  assert.ok(marker);
  assert.ok(
    (
      await call("search_strings", { pattern: marker.value.toLowerCase() })
    ).some((item) => item.address === marker.address),
  );
  assert.equal(
    (
      await call("search_strings", {
        pattern: marker.value.toLowerCase(),
        case_sensitive: true,
      })
    ).some((item) => item.address === marker.address),
    false,
  );
  assert.deepEqual(
    await call("search_strings", {
      pattern: `REA_GHIDRA_ABSENT_${randomUUID()}`,
    }),
    [],
  );
  assert.equal(
    (await call("inspect_native_instruction", { address: strings[0].address }))
      .status,
    "data",
  );

  await invalid(
    "inspect_native_instruction",
    { address: "not-an-address" },
    /hexadecimal/u,
  );
  await invalid(
    "inspect_native_instruction",
    { address: `missing:${address}` },
    /missing:0x/u,
  );
  await invalid(
    "address_name",
    { address: `0x${(BigInt(address) + 2n ** 64n).toString(16)}` },
    /invalid Ghidra address/u,
  );
  await invalid(
    "procedure_address",
    { procedure: "rea_missing_procedure" },
    /rea_missing_procedure/u,
  );
  await invalid(
    "search_procedures",
    { pattern: "[", mode: "regex" },
    /Invalid regex pattern.*index/u,
  );
  await invalid(
    "list_procedures",
    { document: "rea_missing_program" },
    /rea_missing_program.*active program/u,
  );
  // JSON permits escaped lone surrogates. Error replies must preserve them
  // without letting the Java UTF-8 writer terminate the provider session.
  await invalid(
    "procedure_address",
    { procedure: "missing_\ud800" },
    /missing_\\ud800/u,
  );
  await invalid(
    "list_procedures",
    { document: "missing_\udfff" },
    /missing_\\udfff/u,
  );
  for (const [operation, args] of [
    ["read_bytes", { address, length: 0 }],
    ["list_procedures", { limit: 100 }],
    ["list_documents", { extra: true }],
    ["xrefs", {}],
    ["procedure_info", { procedure: address, extra: true }],
  ])
    await invalid(operation, args);
  for (const changes of [
    {},
    { name: "" },
    { comment: null },
    { name: "entry", approve: true },
  ])
    await invalid("annotate_native_function", {
      procedure: address,
      ...changes,
    });

  let cliError;
  try {
    await cli("search", "[", ["--kind", "procedures", "--mode", "regex"]);
  } catch (error) {
    assert.equal(error.code, 1);
    cliError = JSON.parse(error.stdout);
  }
  assert.equal(cliError?.code, "invalid_request");
  assert.equal(cliError?.details?.operation, "search_procedures");
  assert.match(
    JSON.stringify(cliError?.details?.issues),
    /Invalid regex pattern.*index/u,
  );

  // Prime both inventories before editing so stale names cannot hide in caches.
  await call("list_names");
  await call("list_procedures");
  const changes = {
    procedure: address,
    name: "dead",
    comment: "Regular\n註記",
    inline_comment: "Inline\n註記",
  };
  const updated = await call("annotate_native_function", changes);
  assert.deepEqual(updated.annotations, {
    address,
    name: changes.name,
    comment: changes.comment,
    inline_comment: changes.inline_comment,
  });
  const regexPattern = "^(a|aa)*b$";
  const regexFailure = await client.callTool(
    {
      name: "search_strings",
      arguments: { pattern: regexPattern, mode: "regex" },
    },
    options,
  );
  assert.equal(regexFailure.isError, true);
  const regexError = requireMcpToolError(regexFailure);
  assert.equal(regexError.code, "resource_constraint");
  assert.equal(regexError.details.operation, "search_strings");
  assert.equal(regexError.details.resource, "memory");
  assert.match(
    regexError.remediation.action,
    /literal mode or simplify the regex/u,
  );
  // The retry advice lives in the remediation; the reason states that the
  // session survived the overflow.
  assert.match(
    regexError.details.reason,
    /exhausted its stack.*session and annotations remain available/u,
  );
  rejectedCalls++;
  const nestedPattern = "(".repeat(12000) + "a" + ")".repeat(12000);
  const compileFailure = await client.callTool(
    {
      name: "search_procedures",
      arguments: { pattern: nestedPattern, mode: "regex" },
    },
    options,
  );
  assert.equal(compileFailure.isError, true);
  const compileError = requireMcpToolError(compileFailure);
  assert.equal(compileError.code, "resource_constraint");
  assert.equal(compileError.details.operation, "search_procedures");
  assert.match(compileError.details.reason, /stack while compiling pattern/u);
  assert.equal(compileError.remediation.action, regexError.remediation.action);
  rejectedCalls++;
  assert.deepEqual(
    await call("analyze_function", { procedure: address, detail: "complete" }),
    updated.dossier,
    "Regex stack exhaustion must preserve the live annotation database",
  );
  assert.equal(
    (await call("binary_session")).capabilities.find(
      (item) => item.operation === "search_strings",
    ).available,
    true,
  );
  assert.ok(
    (await call("search_procedures", { pattern: changes.name })).some(
      (item) => item.address === address,
    ),
    "Regex compiler exhaustion must preserve edited names and search availability",
  );
  const longLiteral = "a".repeat(3 * 16 ** 3) + "!";
  const longString = strings.find((item) => item.value === longLiteral);
  assert.ok(longString, "The provider must retain the full regression literal");
  const literalMatches = await call("search_strings", { pattern: longLiteral });
  assert.deepEqual(literalMatches, [
    { address: longString.address, value: longLiteral },
  ]);
  assert.deepEqual(await cli("search", longLiteral), literalMatches);
  await assert.rejects(
    cli("search", regexPattern, ["--mode", "regex"]),
    (error) => {
      assert.equal(error.code, 1);
      const rejected = JSON.parse(error.stdout);
      assert.equal(rejected.code, regexError.code);
      assert.equal(rejected.details.reason, regexError.details.reason);
      assert.equal(rejected.remediation.action, regexError.remediation.action);
      return true;
    },
  );
  assert.deepEqual(updated.effects, {
    scope: "session-analysis-database",
    source_bytes_modified: false,
    persists_after_close: false,
  });
  assert.equal(updated.dossier.procedure.name, changes.name);
  assert.equal(
    await call("procedure_address", { procedure: changes.name }),
    address,
  );
  assert.equal(
    (await call("procedure_info", { procedure: changes.name })).entrypoint,
    address,
  );
  assert.equal(
    (await call("read_function_instructions", { procedure: changes.name }))
      .procedure.address,
    address,
  );
  assert.equal(
    (
      await call("analyze_function", {
        procedure: changes.name,
        detail: "complete",
      })
    ).procedure.name,
    changes.name,
  );
  assert.equal(await call("address_name", { address }), changes.name);
  for (const inventory of ["list_names", "list_procedures"])
    assert.ok(
      (await call(inventory)).some(
        (item) => item.address === address && item.value === changes.name,
      ),
    );
  assert.ok(
    (
      await call("search_procedures", { pattern: "dead", case_sensitive: true })
    ).some((item) => item.address === address),
  );

  for (const field of ["name", "comment", "inline_comment"]) {
    for (const text of ["bad\0text", "bad\ud800text", "bad\udffftext"]) {
      await invalid(
        "annotate_native_function",
        {
          procedure: address,
          name: "MUST_ROLL_BACK",
          comment: "MUST ROLL BACK",
          inline_comment: "MUST ROLL BACK",
          [field]: text,
        },
        new RegExp(
          `Annotation ${field}.*(?:NUL|unpaired Unicode surrogate).*index`,
          "u",
        ),
      );
      assert.deepEqual(
        (
          await call("annotate_native_function", {
            procedure: address,
            name: changes.name,
          })
        ).annotations,
        updated.annotations,
        "Invalid native text must leave every annotation unchanged",
      );
    }
  }
  const unicodeText =
    "CRLF\r\nastral 🧪 decomposed e\u0301 control \u0001\b\v\f\u001f noncharacter \ufffe\uffff";
  const unicode = await call("annotate_native_function", {
    procedure: address,
    comment: unicodeText,
    inline_comment: unicodeText,
  });
  assert.equal(unicode.annotations.comment, unicodeText);
  assert.equal(unicode.annotations.inline_comment, unicodeText);
  assert.ok(unicode.dossier.comments.some((item) => item.text === unicodeText));
  await call("annotate_native_function", changes);

  await invalid(
    "annotate_native_function",
    {
      procedure: changes.name,
      name: "invalid name\n",
      comment: "MUST ROLL BACK",
      inline_comment: "MUST ROLL BACK",
    },
    /Invalid function name/u,
  );
  const retained = await call("annotate_native_function", {
    procedure: changes.name,
    name: changes.name,
  });
  assert.deepEqual(retained.annotations, updated.annotations);
  const cleared = await call("annotate_native_function", {
    procedure: changes.name,
    comment: "",
    inline_comment: "",
  });
  assert.equal(cleared.annotations.comment, null);
  assert.equal(cleared.annotations.inline_comment, null);
  assert.equal(cleared.annotations.name, changes.name);
  assert.deepEqual(
    await call("read_bytes", { address, length: baseline.length }),
    bytes,
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(target.path))
      .digest("hex"),
    target.sha256,
  );
  const cliUpdated = await cli("annotate-native-function", name, [
    "--name",
    changes.name,
    "--comment",
    changes.comment,
    "--inline-comment",
    changes.inline_comment,
  ]);
  assert.deepEqual(cliUpdated.annotations, updated.annotations);
  assert.deepEqual(cliUpdated.effects, updated.effects);
  for (const renamed of ["0xordinary", "probe::qualified", "🧪probe"]) {
    await call("annotate_native_function", {
      procedure: address,
      name: renamed,
    });
    assert.equal(
      await call("procedure_address", { procedure: renamed }),
      address,
    );
    assert.equal(await call("address_name", { address }), renamed);
  }
  for (const selected of [address, indirectProcedure.address]) {
    await call("annotate_native_function", {
      procedure: selected,
      name: "rea_ambiguous",
    });
  }
  const ambiguous = await invalid(
    "procedure_address",
    { procedure: "rea_ambiguous" },
    /ambiguous.*select an exact entry address/u,
  );
  for (const selected of [address, indirectProcedure.address]) {
    assert.ok(
      JSON.stringify(ambiguous.details.issues).includes(selected),
      "Ambiguity diagnostics must retain every matching entry address",
    );
    assert.equal(
      await call("procedure_address", { procedure: selected }),
      selected,
    );
  }
  const snapshotLifecycle = await verifyGhidraSnapshotLifecycle(
    client,
    target,
    await call("analyze_function", { procedure: address, detail: "complete" }),
    cli,
  );
  successfulCalls += snapshotLifecycle.successfulCalls;
  rejectedCalls += snapshotLifecycle.rejectedCalls;
  const targetAdmission = await verifyGhidraTargetAdmission({
    call,
    reject: invalid,
    target,
    entry: address,
    runtimeRoot: env.TMPDIR,
  });
  await verifyGhidraNamespaceAnnotations({
    call,
    evidence,
    reject: invalid,
    target,
    entrypoint,
    env,
  });
  await verifyGhidraEntryAliases({
    call,
    reject: invalid,
    target,
    entrypoint,
    env,
  });
  await verifyGhidraLargeResults({
    call,
    reject: invalid,
    target,
    entrypoint,
    env,
  });
  await assert.rejects(access(socketRoot), { code: "ENOENT" });
  await assert.rejects(access(runtimeRoot), { code: "ENOENT" });
  assert.equal(await call("procedure_address", { procedure: name }), address);
  assert.equal(await call("address_name", { address }), name);
  assert.equal(
    await call("procedure_address", { procedure: indirectProcedure.value }),
    indirectProcedure.address,
  );
  assert.deepEqual(
    (await call("analyze_function", { procedure: address, detail: "complete" }))
      .comments,
    original.comments,
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(target.path))
      .digest("hex"),
    target.sha256,
  );
  await verifyStartupCancellation(client, call, target, env, options);
  return {
    mocked: false,
    catalog_tools: catalog.tools.length,
    successful_calls: successfulCalls,
    rejected_calls: rejectedCalls,
    cli_mcp_parity: true,
    mutation_rollback: true,
    annotation_native_text_validation: true,
    lossless_unicode_transport: true,
    exact_external_entry_resolution: true,
    recoverable_regex_stack_exhaustion: true,
    complete_function_body_references: true,
    ambiguity_candidates_inline: true,
    legacy_reference_snapshot_rejected: true,
    mutation_snapshot_lifecycle: true,
    concurrent_annotation_snapshot_close: true,
    changed_source_admission_and_recovery: true,
    source_permission_denial_verified: targetAdmission.permissionDenied,
    missing_and_nonregular_source_rejected: true,
    imported_source_identity_retained: true,
    equivalent_instruction_address_spellings: true,
    batch_procedure_identity: batchIdentity,
    instruction_flow: instructionFlow,
    qualified_annotation_name_roundtrip: true,
    imported_entry_alias_selection: true,
    oversized_result_retention_and_complete_export: true,
    long_selector_rejection_and_provider_recovery: true,
    source_immutable: true,
    reopen_discards_edits: true,
    long_tmpdir_private_socket_cleanup: true,
    real_startup_cancellation_cleanup: true,
  };
}

async function verifyStartupCancellation(client, call, target, env, options) {
  await call("close_binary");
  await call("open_binary", { path: target.path, provider_id: "ghidra" });
  // The composite provider selects the target lazily. Use a fresh search input
  // so persisted immutable snapshots cannot bypass actual provider startup.
  const request = {
    name: "search_procedures",
    arguments: { pattern: `startup-cancellation-${randomUUID()}` },
  };
  const controller = new AbortController();
  let settled = false;
  let outcome;
  const pending = client
    .callTool(request, { ...options, signal: controller.signal })
    .then(
      (reply) => {
        settled = true;
        outcome = reply;
        return { reply };
      },
      (error) => {
        settled = true;
        outcome = String(error);
        return { error };
      },
    );
  const deadline = Date.now() + 30000;
  let launched;
  try {
    while (Date.now() < deadline && !settled) {
      const roots = (await readdir(env.TMPDIR)).filter((name) =>
        name.startsWith("rea-ghidra-"),
      );
      if (roots.length === 1) {
        const root = join(env.TMPDIR, roots[0]);
        try {
          const ownership = JSON.parse(
            await readFile(join(root, "ownership.json"), "utf8"),
          );
          const endpointPath = ownership.endpoint_path;
          // Observe the JVM inside the owned process group before the bridge
          // publishes its socket. A log file can appear after analysis finishes.
          const { stdout } = await promisify(execFile)("ps", [
            "-axo",
            "pid=,pgid=,comm=",
          ]);
          const javaProcess = stdout.split("\n").find((line) => {
            const fields = line.trim().split(/\s+/u);
            return (
              Number(fields[1]) === ownership.process_group_id &&
              /(?:^|\/)java$/u.test(fields.slice(2).join(" "))
            );
          });
          if (javaProcess === undefined) {
            await delay(25);
            continue;
          }
          const javaPid = Number(javaProcess.trim().split(/\s+/u)[0]);
          await assert.rejects(access(endpointPath), { code: "ENOENT" });
          process.kill(ownership.pid, 0);
          launched = {
            root,
            socketRoot: dirname(endpointPath),
            pid: ownership.pid,
            javaPid,
          };
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      await delay(25);
    }
    assert.ok(
      launched,
      `No real headless process was observed before cancellation: ${JSON.stringify(outcome)}`,
    );
    assert.equal(
      settled,
      false,
      "Cancellation must interrupt pending provider work",
    );
  } finally {
    controller.abort();
    await pending;
  }
  const cleanupDeadline = Date.now() + 30000;
  while (Date.now() < cleanupDeadline) {
    const processGone = [launched.pid, launched.javaPid].every((pid) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if (error.code === "ESRCH") return true;
        throw error;
      }
    });
    try {
      await access(launched.root);
    } catch (error) {
      if (error.code === "ENOENT" && processGone) break;
      if (error.code === "ENOENT") {
        await delay(25);
        continue;
      }
      throw error;
    }
    await delay(25);
  }
  await assert.rejects(access(launched.root), { code: "ENOENT" });
  await assert.rejects(access(launched.socketRoot), { code: "ENOENT" });
  assert.throws(() => process.kill(launched.pid, 0), { code: "ESRCH" });
  assert.throws(() => process.kill(launched.javaPid, 0), { code: "ESRCH" });
  assert.equal(
    (await call("binary_session")).open,
    true,
    "Cancellation must preserve the selected target",
  );
  assert.deepEqual(
    await call(request.name, request.arguments),
    [],
    "A cancelled startup must allow a fresh provider query",
  );
}
