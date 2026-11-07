import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  mcpTextValue,
  requireMcpEvidenceResult,
  requireMcpOperationResult,
  requireMcpLifecycleResult,
} from "./mcp-verifier-results.mjs";
import { verifyHopperCliSelectors } from "./real-hopper-cli-selectors.mjs";
import { verifyLinuxHopperLaunchIsolation } from "./real-hopper-session-isolation.mjs";
import { verifyHopperNavigationAndText } from "./real-hopper-navigation.mjs";
import { verifyHopperWorkflows } from "./real-hopper-workflows.mjs";
import {
  verifyHopperSearch,
  verifyHopperRegexIsolation,
} from "./real-hopper-search.mjs";

const dispatcher = fileURLToPath(new URL("../rea.mjs", import.meta.url));

/** Exercise real Hopper annotation and malformed-input boundaries over MCP. */
export async function verifyHopperBoundaryContracts(
  client,
  options,
  procedure,
  targetPath,
) {
  const catalog = await client.listTools();
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validators = new Map();
  for (const tool of catalog.tools) {
    assert.ok(
      ajv.validateSchema(tool.inputSchema),
      `${tool.name} input schema`,
    );
    assert.ok(tool.outputSchema, `${tool.name} omitted its output schema`);
    assert.ok(
      ajv.validateSchema(tool.outputSchema),
      `${tool.name} output schema`,
    );
    validators.set(
      tool.name,
      (tool.outputSchema?.$id && ajv.getSchema(tool.outputSchema.$id)) ||
        ajv.compile(tool.outputSchema),
    );
  }
  let successfulCalls = 0;
  let rejectedCalls = 0;
  const rejectedOperations = new Set();
  const call = async (name, args = {}) => {
    const reply = await client.callTool({ name, arguments: args }, options);
    const result = requireMcpOperationResult(reply, name);
    const validate = validators.get(name);
    assert.ok(validate, `${name} is missing from tools/list`);
    assert.ok(
      validate(reply.structuredContent),
      `${name}: ${JSON.stringify(validate.errors)}`,
    );
    assert.deepEqual(reply.structuredContent, JSON.parse(mcpTextValue(reply)));
    successfulCalls += 1;
    return result;
  };
  const invalid = async (name, args, reason, failedOperation = name) => {
    const reply = await client.callTool({ name, arguments: args }, options);
    assert.equal(reply.isError, true, `${name} accepted invalid input`);
    const { error } = JSON.parse(mcpTextValue(reply));
    assert.equal(error.code, "invalid_request");
    assert.equal(error.category, "invalid_input");
    assert.equal(error.details.operation, failedOperation);
    assert.match(error.message, reason);
    rejectedCalls += 1;
    rejectedOperations.add(name);
  };
  const address = procedure.address;
  const originalName = await call("address_name", { address });
  const originalComment = await call("comment", { address });
  const originalInlineComment = await call("inline_comment", { address });
  const activeDocument = await call("current_document");
  const foreignDocument = (await call("list_documents")).find(
    (name) => name !== activeDocument,
  );
  const navigationAndText = await verifyHopperNavigationAndText(
    call,
    invalid,
    address,
  );
  const workflows = await verifyHopperWorkflows(call, invalid, procedure);
  const search = {
    ...(await verifyHopperSearch(call, invalid, procedure)),
    ...(await verifyHopperRegexIsolation(client, options, call, address)),
  };
  const originalBookmark = (await call("list_bookmarks")).find(
    (item) => item.address === address,
  );
  let bookmarkReplacement;
  const boundaryFailures = [];
  try {
    if (originalBookmark !== undefined)
      assert.equal(await call("unset_bookmark", { address }), true);
    if (foreignDocument !== undefined) {
      await invalid(
        "read_bytes",
        { address, length: 8, document: foreignDocument },
        /belongs to another target/u,
      );
      assert.equal(await call("current_document"), activeDocument);
    }
    for (const label of [undefined, "", "REA boundary bookmark 测试"]) {
      assert.equal(
        await call("set_bookmark", {
          address,
          ...(label === undefined ? {} : { name: label }),
        }),
        true,
      );
      const bookmarks = await call("list_bookmarks");
      const bookmark = bookmarks.find((item) => item.address === address);
      assert.ok(bookmark, "set_bookmark did not create a bookmark");
      assert.equal(bookmark.name, label || null);
      const context = await call("inspect_address_context", { address });
      assert.equal(context.bookmarks.state, "available");
      assert.deepEqual(context.bookmarks.value, [bookmark]);
      assert.equal(await call("unset_bookmark", { address }), true);
      assert.ok(
        !(await call("list_bookmarks")).some(
          (item) => item.address === address,
        ),
      );
    }

    assert.equal(
      await call("set_bookmark", {
        address,
        name: "REA boundary bookmark before clear",
      }),
      true,
    );
    const beforeClear = (await call("list_bookmarks")).find(
      (item) => item.address === address,
    );
    assert.deepEqual(beforeClear, {
      address,
      name: "REA boundary bookmark before clear",
    });
    assert.equal(await call("set_bookmark", { address, name: "" }), true);
    const afterClear = (await call("list_bookmarks")).find(
      (item) => item.address === address,
    );
    assert.deepEqual(afterClear, { address, name: null });

    const replacementName = "REA boundary bookmark replacement";
    assert.equal(
      await call("set_bookmark", { address, name: replacementName }),
      true,
    );
    const afterReplacement = (await call("list_bookmarks")).find(
      (item) => item.address === address,
    );
    assert.deepEqual(afterReplacement, { address, name: replacementName });
    assert.equal(await call("set_bookmark", { address }), true);
    const afterOmittedName = (await call("list_bookmarks")).find(
      (item) => item.address === address,
    );
    assert.deepEqual(afterOmittedName, {
      address,
      name: replacementName,
    });
    bookmarkReplacement = {
      existingNameCleared: afterClear?.name === null,
      nonemptyNameReplaced: afterReplacement?.name === replacementName,
      omittedNamePreserved: afterOmittedName?.name === replacementName,
    };

    for (const [setter, getter] of [
      ["set_comment", "comment"],
      ["set_inline_comment", "inline_comment"],
    ]) {
      const comment = "REA boundary comment 测试";
      assert.equal(await call(setter, { address, comment }), true);
      assert.equal(await call(getter, { address }), comment);
      assert.equal(await call(setter, { address, comment: "" }), true);
      assert.equal(await call(getter, { address }), null);
    }
    const inline = "REA inline\nsecond line";
    const exact = await call("set_inline_comment", {
      address,
      comment: inline,
    });
    const observed = await call("inline_comment", { address });
    assert.equal(
      exact,
      observed === inline,
      "inline normalization must remain visible",
    );

    await invalid(
      "set_addresses_names",
      {
        names: {
          [address]: "rea_boundary_should_not_be_applied",
          __rea_missing_batch_address__: "missing",
        },
      },
      /Unknown Hopper address or name: __rea_missing_batch_address__/u,
    );
    assert.equal(await call("address_name", { address }), originalName);
    assert.equal(
      (await call("procedure_info", { procedure: address })).name,
      originalName,
    );

    const renamed = "rea_boundary_renamed";
    assert.equal(
      await call("set_addresses_names", { names: { [address]: renamed } }).then(
        (value) => value[address],
      ),
      true,
    );
    assert.equal(await call("address_name", { address }), renamed);
    const matches = await call("search_procedures", {
      pattern: renamed,
      case_sensitive: true,
    });
    assert.ok(
      matches.some(
        (item) => item.address === address && item.value === renamed,
      ),
    );
    assert.equal(
      (
        await call("analyze_function", {
          procedure: address,
          detail: "complete",
        })
      ).procedure.name,
      renamed,
    );
    assert.equal(
      await call("set_address_name", { address, name: "add" }),
      true,
    );
    assert.equal(
      await call("procedure_address", { procedure: "add" }),
      address,
    );
    assert.equal(
      (await call("procedure_info", { procedure: "add" })).entrypoint,
      address,
    );
    assert.equal(
      (await call("read_bytes", { address: "add", length: 8 })).address,
      address,
    );
    assert.equal(
      await call("procedure_address", { procedure: address.slice(2) }),
      address,
    );

    for (const query of ["-1", "0x10000000000000000", "0xffffffffffffffff"]) {
      for (const name of [
        "read_bytes",
        "address_to_file_offset",
        "resolve_containing_procedure",
        "procedure_info",
      ]) {
        await invalid(
          name,
          name === "procedure_info"
            ? { procedure: query }
            : {
                address: query,
                ...(name === "read_bytes" ? { length: 8 } : {}),
              },
          /usable unsigned 64-bit range/u,
        );
      }
    }
    await invalid(
      "read_bytes",
      { address: "0x0", length: 8 },
      /Address is outside every segment/u,
    );
    await invalid(
      "procedure_info",
      { procedure: address, document: "__rea_missing_document__" },
      /Unknown Hopper document/u,
    );
    await invalid(
      "search_procedures",
      { pattern: "[", mode: "regex" },
      /Invalid regex pattern/u,
    );
    // Invalid calls must leave the same authenticated bridge usable.
    assert.equal(
      (await call("read_bytes", { address, length: 8 })).returned_bytes,
      8,
    );
    const mapping = await call("address_to_file_offset", { address });
    const bytes = await call("read_bytes", { address, length: 8 });
    const file = await readFile(targetPath);
    assert.equal(
      bytes.bytes_hex,
      file
        .subarray(mapping.file_offset, mapping.file_offset + 8)
        .toString("hex"),
    );
    const segments = await call("list_segments");
    const containing = segments.find(
      (segment) =>
        BigInt(segment.start) <= BigInt(address) &&
        BigInt(address) < BigInt(segment.end),
    );
    assert.ok(containing, "fixture procedure has no containing segment");
    const lastByte = `0x${(BigInt(containing.end) - 1n).toString(16)}`;
    const prefix = await call("read_bytes", { address: lastByte, length: 8 });
    assert.equal(prefix.returned_bytes, 1);
    assert.equal(prefix.bytes_hex.length, 2);
    assert.equal(prefix.complete, false);
    const synthetic = segments.find(
      (segment) => segment.name === "External Symbols",
    );
    assert.ok(synthetic, "fixture omitted synthetic external-symbol memory");
    await invalid(
      "address_to_file_offset",
      { address: synthetic.start },
      /no authoritative file-offset mapping/u,
    );
    const health = (await call("binary_session")).provider_operation_health;
    assert.equal(
      health.state,
      "idle",
      "a live GUI bridge must remain healthy after its launcher helper exits",
    );
  } catch (error) {
    boundaryFailures.push(error);
    throw error;
  } finally {
    const restorations = [
      () => call("set_address_name", { address, name: originalName ?? "" }),
      () => call("set_comment", { address, comment: originalComment ?? "" }),
      () =>
        call("set_inline_comment", {
          address,
          comment: originalInlineComment ?? "",
        }),
      async () => {
        await call("unset_bookmark", { address });
        if (originalBookmark === undefined) return;
        assert.equal(
          await call("set_bookmark", {
            address,
            ...(originalBookmark.name === null
              ? {}
              : { name: originalBookmark.name }),
          }),
          true,
          "Could not restore the original disposable-target bookmark",
        );
        const restored = (await call("list_bookmarks")).find(
          (item) => item.address === address,
        );
        assert.deepEqual(restored, originalBookmark);
      },
    ];
    const restorationErrors = [];
    for (const restore of restorations) {
      try {
        await restore();
      } catch (error) {
        restorationErrors.push(error);
      }
    }
    if (restorationErrors.length > 0) {
      throw new AggregateError(
        [...boundaryFailures, ...restorationErrors],
        "Could not restore all disposable Hopper boundary state",
      );
    }
  }
  return {
    schemaCount: catalog.tools.length,
    successfulCalls,
    rejectedCalls,
    rejectedOperations: [...rejectedOperations],
    foreignDocumentVerified: foreignDocument !== undefined,
    navigationAndText,
    workflows,
    search,
    bookmarkReplacement,
  };
}

/** Prove actual document disposal and shared CLI/MCP behavior on disposable copies. */
export async function verifyHopperLifecycleAndCli(client, options, targets) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "hopper-boundary-")),
  );
  const suffix = basename(directory);
  const primary = join(directory, `primary-${suffix}`);
  const secondary = join(directory, `secondary-${suffix}`);
  const call = async (name, args = {}) =>
    requireMcpOperationResult(
      await client.callTool({ name, arguments: args }, options),
      name,
    );
  const cli = promisify(execFile);
  const runCli = (args) => {
    const pending = cli(process.execPath, args, {
      timeout: 180_000,
      maxBuffer: 1_048_576,
    });
    if (pending.child.pid !== undefined)
      targets.ownedProcessIds.add(pending.child.pid);
    return pending;
  };
  try {
    await copyFile(targets.primary, primary);
    await copyFile(targets.secondary, secondary);
    await call("open_binary", { path: primary });
    const primaryProcedures = await call("list_procedures");
    const entry = primaryProcedures.find((item) =>
      item.value.endsWith("rea_entry"),
    );
    assert.ok(entry, "primary fixture omitted its entry procedure");
    const expectedFunction = await call("analyze_function", {
      procedure: entry.value,
      detail: "complete",
    });
    const firstDocument = await call("current_document");
    const linuxApplicationIsolation =
      process.platform === "linux"
        ? await verifyLinuxHopperLaunchIsolation({
            call,
            runCli,
            dispatcher,
            primary,
            secondary,
          })
        : null;
    await call("open_binary", { path: secondary });
    const secondDocument = await call("current_document");
    assert.notEqual(firstDocument, secondDocument);
    assert.ok(
      !(await call("list_documents")).includes(firstDocument),
      "target switching retained the old native document",
    );
    const procedures = await call("list_procedures");
    await verifyBatchCancellation(client, options, procedures);
    const address = procedures[0].address;
    const expected = await call("read_bytes", {
      address,
      length: 8,
      document: secondDocument,
    });
    await call("open_binary", { path: primary });
    const query = "REA_C_LEAF __rea_missing_phrase__";
    const expectedTrace = await call("trace_feature", { query });
    assert.deepEqual(expectedTrace.matches, []);
    await call("close_binary");

    const common = [
      "--length",
      "8",
      "--provider",
      "hopper",
      "--format",
      "json",
    ];
    const { stdout } = await runCli([
      dispatcher,
      "read-bytes",
      secondary,
      address,
      ...common,
    ]);
    const evidence = JSON.parse(stdout);
    assert.equal(evidence.provider.id, "hopper");
    assert.equal(evidence.subject.local_path, secondary);
    assert.deepEqual(evidence.normalized_result, expected);
    const traced = await runCli([
      dispatcher,
      "trace",
      primary,
      query,
      "--provider",
      "hopper",
      "--format",
      "json",
    ]);
    const traceEvidence = JSON.parse(traced.stdout);
    assert.equal(traceEvidence.subject.local_path, primary);
    assert.deepEqual(traceEvidence.normalized_result, expectedTrace);
    const analyzed = await runCli([
      dispatcher,
      "function",
      primary,
      entry.value,
      "--provider",
      "hopper",
      "--format",
      "json",
    ]);
    assert.deepEqual(
      JSON.parse(analyzed.stdout).normalized_result,
      expectedFunction,
    );
    let cliTerminalFunctionParity = null;
    let cliNamedSelectorParity = null;
    if (targets.unicode !== undefined) {
      const objc = join(directory, `objc-${suffix}`);
      await copyFile(targets.unicode, objc);
      await call("open_binary", { path: objc });
      const procedures = await call("list_procedures");
      const delegate = procedures.find(
        (item) => item.value === "-[REAWidget delegate]",
      );
      assert.ok(delegate, "Objective-C fixture omitted its tail-call method");
      const expected = await call("analyze_function", {
        procedure: delegate.address,
        detail: "complete",
      });
      await call("close_binary");
      const analyzed = await runCli([
        dispatcher,
        "function",
        objc,
        delegate.address,
        "--provider",
        "hopper",
        "--format",
        "json",
      ]);
      assert.deepEqual(JSON.parse(analyzed.stdout).normalized_result, expected);
      cliTerminalFunctionParity = true;
      await call("open_binary", { path: objc });
      cliNamedSelectorParity = await verifyHopperCliSelectors(
        call,
        runCli,
        dispatcher,
        objc,
      );
    }
    let failure;
    try {
      await runCli([
        dispatcher,
        "read-bytes",
        secondary,
        "0x10000000000000000",
        ...common,
      ]);
    } catch (error) {
      assert.equal(error.code, 1);
      failure = JSON.parse(error.stdout);
    }
    assert.ok(failure, "CLI accepted an overflowing address");
    assert.equal(failure.code, "invalid_request");
    assert.equal(failure.category, "invalid_input");
    assert.match(failure.message, /usable unsigned 64-bit range/u);

    await call("open_binary", { path: primary });
    assert.ok(
      !(await call("list_documents")).includes(secondDocument),
      "MCP or CLI cleanup retained the closed native document",
    );
    await call("close_binary");
    return {
      targetSwitchDisposedDocument: true,
      cliByteParity: true,
      cliInvalidAddress: true,
      cliLiteralTraceParity: true,
      cliFunctionDossierParity: true,
      cliTerminalFunctionParity,
      cliNamedSelectorParity,
      callerCancellationRecovered: true,
      closedDocumentAbsent: true,
      linuxApplicationIsolation,
    };
  } finally {
    await call("close_binary");
    await rm(directory, { recursive: true, force: true });
  }
}

const verifyBatchCancellation = async (client, options, procedures) => {
  const controller = new AbortController();
  let cancelled = false;
  await assert.rejects(
    client.callTool(
      {
        name: "batch_decompile",
        arguments: { addresses: procedures.map((item) => item.address) },
      },
      {
        ...options,
        signal: controller.signal,
        onprogress: (update) => {
          options.onprogress?.(update);
          // Cancel between real decompilations, after Hopper served one item.
          if (update.message?.includes("Hopper bridge completed request")) {
            cancelled = true;
            controller.abort();
          }
        },
      },
    ),
    /aborted/u,
  );
  assert.ok(cancelled, "cancellation did not follow a real Hopper response");
  const recovered = requireMcpEvidenceResult(
    await client.callTool({ name: "list_procedures", arguments: {} }, options),
    "list_procedures",
  );
  assert.deepEqual(recovered, procedures);
  const status = requireMcpLifecycleResult(
    await client.callTool({ name: "binary_session", arguments: {} }, options),
    "binary_session",
  );
  assert.equal(status.provider_operation_health.state, "idle");
};
