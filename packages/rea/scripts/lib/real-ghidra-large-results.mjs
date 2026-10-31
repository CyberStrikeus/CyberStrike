import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { parseEvidenceBundle } from "../../dist/domain/evidenceBundle.js";

/** Exercise complete oversized results and recovery through real CLI/MCP adapters. */
export async function verifyGhidraLargeResults({
  call,
  reject,
  target,
  entrypoint,
  env,
}) {
  const exec = promisify(execFile);
  const compiler = process.env.REA_CC ?? "cc";
  try {
    await exec(compiler, ["--version"], { env, timeout: 30000 });
  } catch (cause) {
    throw new Error(
      `Ghidra large-result verification requires a working host C compiler '${compiler}'.`,
      { cause },
    );
  }
  // Hex encoding, Evidence projection and the two MCP representations multiply
  // the source size. Derive the fixture from the pinned SDK's receive budget.
  const length = Math.ceil(STDIO_DEFAULT_MAX_BUFFER_SIZE / 4);
  const workspace = await mkdtemp(join(tmpdir(), "rea-ghidra-large-results-"));
  const path = join(workspace, "large-results");
  const source = fileURLToPath(
    new URL("../../tests/conformance/ghidra/large-results.c", import.meta.url),
  );
  try {
    await exec(
      compiler,
      ["-O0", `-DREA_PAYLOAD_BYTES=${length}`, source, "-o", path],
      { env, timeout: 30000 },
    );
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await call("close_binary");
    await call("open_binary", { path, provider_id: "ghidra" });
    const names = await call("list_names");
    const payload = names.find(({ value }) =>
      /(?:^|_)rea_large_payload$/u.test(value),
    );
    const entry = names.find(({ value }) =>
      /(?:^|_)rea_large_entry$/u.test(value),
    );
    assert.ok(payload);
    assert.ok(entry);
    const mapping = await call("address_to_file_offset", {
      address: payload.address,
    });
    const expected = bytes.subarray(
      mapping.file_offset,
      mapping.file_offset + length,
    );
    assert.equal(expected.length, length);
    assert.equal(expected[0], 0x5a);
    assert.equal(expected.at(-1), 0xa5);
    const before = await call("binary_session");
    // An error reaches the wire once, as escaped JSON text. Each quote costs
    // two request bytes but four response bytes once the echoed diagnostic is
    // escaped again as text, so this request fits the SDK receive limit while
    // the error response cannot.
    const missingSelector =
      "REA_MISSING_" +
      '"'.repeat(Math.ceil(STDIO_DEFAULT_MAX_BUFFER_SIZE / 4) + 64 * 1024);
    const lookupError = await reject("procedure_address", {
      procedure: missingSelector,
    });
    const lookupId = retainedReference(lookupError, "procedure_address");
    assert.equal(
      lookupError.details.reported_limits.original_error_code,
      "invalid_request",
    );
    assert.equal(
      await call("procedure_address", { procedure: entry.address }),
      entry.address,
    );

    const readError = await reject("read_bytes", {
      address: payload.address,
      length,
    });
    const readId = retainedReference(readError, "read_bytes");
    // Two annotation strings repeated in text and structured content must
    // exceed the receive budget even without obsolete Evidence envelopes.
    // The request contains only the two strings and remains below that budget.
    const comment =
      "REA_BIG_COMMENT:" +
      "x".repeat(Math.ceil(STDIO_DEFAULT_MAX_BUFFER_SIZE / 4));
    const annotationError = await reject("annotate_native_function", {
      procedure: entry.address,
      name: "rea_frame_probe",
      comment,
      inline_comment: comment,
    });
    const annotationId = retainedReference(
      annotationError,
      "annotate_native_function",
    );
    assert.equal(
      await call("procedure_address", { procedure: "rea_frame_probe" }),
      entry.address,
      "A delivery constraint must preserve the successfully committed edit",
    );
    // The default summary fits the receive budget; only the complete dossier
    // exercises the oversized-delivery path with a retained reference.
    const dossierError = await reject("analyze_function", {
      procedure: "rea_frame_probe",
      detail: "complete",
    });
    const dossierId = retainedReference(dossierError, "analyze_function");
    const after = await call("binary_session");
    assert.equal(after.analysis_run.run_id, before.analysis_run.run_id);
    assert.equal(after.sha256, sha256);
    assert.equal(
      (await call("read_bytes", { address: payload.address, length: 1 }))
        .bytes_hex,
      "5a",
    );
    const lastAddress = `0x${(BigInt(payload.address) + BigInt(length - 1)).toString(16)}`;
    assert.equal(
      (await call("read_bytes", { address: lastAddress, length: 1 })).bytes_hex,
      "a5",
    );
    const bundlePath = join(workspace, "bundle.json");
    await call("export_evidence_bundle", { path: bundlePath });
    const bundle = parseEvidenceBundle(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    const retained = (id) => {
      const record = bundle.records.find(
        ({ evidence_id }) => evidence_id === id,
      );
      assert.ok(record, `Missing exported retained record ${id}`);
      assert.equal(record.provider.id, "ghidra");
      assert.equal(record.subject.digest.sha256, sha256);
      return record;
    };
    const originalError = bundle.records.find(
      ({ evidence_id }) => evidence_id === lookupId,
    );
    assert.ok(originalError);
    assert.equal(originalError.operation, "mcp_tool_error");
    assert.equal(originalError.provider.id, "rea-mcp");
    assert.equal(originalError.subject, null);
    assert.equal(originalError.parameters.tool_name, "procedure_address");
    assert.equal(originalError.normalized_result.error.code, "invalid_request");
    assert.equal(originalError.raw_result.isError, true);
    assert.deepEqual(
      originalError.raw_result.structuredContent,
      originalError.normalized_result,
    );
    assert.equal(
      originalError.normalized_result.error.details.operation,
      "procedure_address",
    );
    assert.equal(
      originalError.normalized_result.error.details.issues[0].message,
      `Unknown Ghidra procedure name or address: ${missingSelector}`,
    );
    const readRecord = retained(readId);
    const read = readRecord.normalized_result;
    assert.equal(read.requested_bytes, length);
    assert.equal(read.returned_bytes, length);
    assert.equal(read.complete, true);
    assert.equal(read.bytes_hex, expected.toString("hex"));
    assert.equal(readRecord.raw_result, null);
    const annotationRecord = retained(annotationId);
    const annotation = annotationRecord.normalized_result;
    assert.equal(annotation.annotations.name, "rea_frame_probe");
    assert.equal(annotation.annotations.comment, comment);
    assert.equal(annotation.annotations.inline_comment, comment);
    assert.equal(annotationRecord.raw_result, null);
    const dossierRecord = retained(dossierId);
    const dossier = dossierRecord.normalized_result;
    assert.equal(dossier.procedure.name, "rea_frame_probe");
    assert.ok(dossier.comments.some(({ text }) => text === comment));
    assert.equal(dossierRecord.raw_result, null);
    const { stdout } = await exec(
      process.execPath,
      [
        entrypoint,
        "read-bytes",
        path,
        payload.address,
        "--length",
        String(length),
        "--provider",
        "ghidra",
        "--json",
      ],
      { env, timeout: 240000, maxBuffer: 72 * 1024 * 1024 },
    );
    const cliRead = JSON.parse(stdout);
    assert.deepEqual(cliRead.normalized_result, read);
    assert.equal(cliRead.raw_result, null);
    assert.deepEqual(await readFile(path), bytes);
    await call("close_binary");
    await call("open_binary", { path: target.path, provider_id: "ghidra" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function retainedReference(error, operation) {
  assert.equal(error.code, "resource_constraint");
  assert.equal(error.details.operation, operation);
  assert.equal(error.details.resource, "transport");
  const limits = error.details.reported_limits;
  assert.equal(limits.boundary, "mcp-response");
  assert.equal(limits.constraint, "receive-buffer");
  assert.ok(limits.response_bytes_at_least > limits.result_budget_bytes);
  assert.equal(limits.evidence_reference.kind, "retained-evidence");
  assert.match(limits.evidence_reference.evidence_id, /^ev_[a-f0-9]{64}$/u);
  return limits.evidence_reference.evidence_id;
}
