import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const corpus = JSON.parse(
  await readFile(new URL("./corpus.json", import.meta.url), "utf8"),
);
export const SAZ_ARTIFACTS = Object.fromEntries(
  corpus.artifacts
    .filter((entry) => entry.saz_question)
    .map((entry) => [entry.id, entry]),
);

export function sazRequest(artifact, path, selection) {
  const question = Object.hasOwn(SAZ_ARTIFACTS, artifact)
    ? SAZ_ARTIFACTS[artifact].saz_question
    : undefined;
  if (!question) throw new Error("Select a pinned SAZ question");
  return {
    capture_path: path,
    format: "saz",
    ...(selection === "baseline"
      ? {}
      : { record_ordinals: question.record_ordinals }),
    sensitive_values: [],
  };
}

export function verifySazOracleIdentity(artifact, oracle) {
  assert.ok(
    Object.hasOwn(SAZ_ARTIFACTS, artifact),
    "Unknown pinned SAZ question",
  );
  const entry = SAZ_ARTIFACTS[artifact];
  assert.equal(oracle.kind, "saz");
  assert.equal(oracle.artifact, artifact);
  assert.equal(oracle.sha256, entry.sha256, "Wrong immutable corpus");
  assert.equal(oracle.total_records, entry.saz_question.total_records);
  assert.deepEqual(oracle.record_ordinals, entry.saz_question.record_ordinals);
}

export function sazEvidenceParameters(input, totalRecords) {
  return {
    capture_path: input.capture_path,
    format: input.format,
    record_ordinals:
      input.record_ordinals ??
      Array.from({ length: totalRecords }, (_, index) => index),
    sensitive_value_count: input.sensitive_values.length,
  };
}

export function verifySazRecords(records, oracle) {
  assert.equal(oracle.kind, "saz", "Wrong independent question");
  assert.equal(
    records.length,
    oracle.records.length,
    "Selected coverage differs",
  );
  return records.map((record, index) => {
    const raw = oracle.records[index];
    assert.equal(record.ordinal, raw.ordinal, "Caller order/ordinal differs");
    assert.equal(
      record.reported.session_id,
      raw.session_id,
      "Padded source identity differs",
    );
    assert.deepEqual(
      record.location,
      { kind: "archive-members", members: raw.members },
      "Original member coordinates differ",
    );
    for (const side of ["request", "response"]) {
      const expected = raw[side],
        reported = record.reported[side];
      if (expected === null) {
        assert.equal(reported, null, "Absent message invented");
        assert.ok(
          !record.binary_fields.some(
            (field) => field.pointer === `/${side}/body`,
          ),
          "Absent body invented",
        );
        continue;
      }
      assert.equal(reported.member, expected.member);
      for (const field of side === "request"
        ? ["method", "url", "http_version"]
        : ["status", "reason", "http_version"])
        assert.equal(
          reported[field],
          expected[field],
          "Stored HTTP start line differs",
        );
      const contentTypes = (headers) =>
        headers.filter(
          (header) => header.name.toLowerCase() === "content-type",
        );
      assert.deepEqual(
        contentTypes(reported.headers),
        contentTypes(expected.headers),
        "Content-Type order/spelling/values differ",
      );
      const bodies = record.binary_fields.filter(
        (field) => field.pointer === `/${side}/body`,
      );
      assert.equal(bodies.length, 1, "Stored body representation differs");
      const body = bodies[0];
      assert.equal(body.state, "retained", "Stored body unexpectedly unknown");
      assert.equal(
        body.representation,
        "producer-bytes",
        "Encoded source representation differs",
      );
      for (const field of ["bytes", "sha256", "content_base64"])
        assert.equal(
          body[field],
          expected.body[field],
          "Stored encoded body bytes differ",
        );
      assert.equal(
        reported.body,
        expected.body.text,
        "UTF-8 projection or empty body differs",
      );
    }
    const response = raw.response;
    return {
      ordinal: record.ordinal,
      session_id: raw.session_id,
      members: raw.members,
      request:
        raw.request === null
          ? null
          : { method: raw.request.method, url: raw.request.url },
      response:
        response === null
          ? null
          : {
              status: response.status,
              http_version: response.http_version,
              content_types: response.headers.filter(
                (header) => header.name.toLowerCase() === "content-type",
              ),
              body: {
                bytes: response.body.bytes,
                sha256: response.body.sha256,
              },
            },
    };
  });
}

export async function measureSazEntry({ values, call, inputSha }) {
  const runtime = (file) =>
    pathToFileURL(resolve(values["runtime-root"], file)).href;
  const { parseEvidence } = await import(runtime("dist/domain/evidence.js"));
  const { inspectWebNetworkCaptureInputSchema, webNetworkCaptureSchema } =
    await import(runtime("dist/domain/webNetworkCapture.js"));
  const { inspectAnalysisViewInputSchema, analysisViewResultSchema } =
    await import(runtime("dist/domain/analysisView/analysisView.js"));
  const read = await promisify(execFile)(
    "python3",
    [
      fileURLToPath(new URL("./saz-oracle.py", import.meta.url)),
      values.artifact,
      values.path,
    ],
    { maxBuffer: 2 * 1024 * 1024, timeout: 30_000 },
  );
  const oracle = JSON.parse(read.stdout);
  verifySazOracleIdentity(values.artifact, oracle);
  assert.equal(oracle.sha256, inputSha);
  const input = inspectWebNetworkCaptureInputSchema.parse(
    sazRequest(values.artifact, values.path, values["saz-selection"]),
  );
  const observations = [];
  const checked = (evidence, schema) => {
    evidence = parseEvidence(evidence);
    assert.equal(evidence.subject.local_path, values.path);
    assert.equal(evidence.subject.digest.sha256, inputSha);
    const report = schema.parse(evidence.normalized_result);
    observations.push({
      evidence_id: evidence.evidence_id,
      operation: evidence.operation,
      parameters: evidence.parameters,
      limitations: evidence.limitations,
      coverage: report.coverage ?? {
        total_records: report.total_records,
        retained_records: report.records.length,
      },
    });
    return report;
  };
  const readView = async (source, view) => {
    const request = inspectAnalysisViewInputSchema.parse({ source, view });
    const evidence = await call("inspect_analysis_view", request);
    assert.equal(evidence.operation, "inspect_analysis_view");
    assert.deepEqual(evidence.parameters, {
      parent_evidence_id: source.evidence_id,
      view: request.view,
    });
    const result = checked(evidence, analysisViewResultSchema);
    assert.equal(result.kind, request.view.kind);
    assert.equal(result.parent_evidence_id, source.evidence_id);
    assert.equal(result.parent_operation, "inspect_web_network_capture");
    assert.deepEqual(result.view, request.view);
    return result;
  };
  let records, decoder;
  if (values["saz-selection"] !== "retained") {
    let evidence;
    try {
      evidence = await call("inspect_web_network_capture", input);
    } catch (failure) {
      const error = failure.value?.error;
      const limits = error?.details?.reported_limits;
      if (
        values["saz-selection"] !== "baseline" ||
        error?.code !== "resource_constraint" ||
        error.details.operation !== "inspect_web_network_capture" ||
        limits?.boundary !== "mcp-response" ||
        !limits.evidence_reference
      )
        throw failure;
      // Recover only the exact retained reference returned by this failed call.
      // The failed RPC remains in the shared measurement log and task costs.
      const source = limits.evidence_reference;
      assert.equal(source.kind, "retained-evidence");
      const summary = await readView(source, { kind: "summary" });
      assert.equal(summary.summary.format, "saz");
      assert.equal(summary.summary.total_records, oracle.total_records);
      assert.equal(summary.summary.retained_records, oracle.total_records);
      decoder = summary.summary.decoder;
      records = [];
      for (const ordinal of oracle.record_ordinals) {
        const page = await readView(source, {
          kind: "capture",
          detail: "complete",
          offset: ordinal,
          limit: 1,
        });
        assert.equal(page.coverage.total, oracle.total_records);
        assert.equal(page.items.length, 1);
        records.push(page.items[0]);
      }
    }
    if (evidence !== undefined) {
      assert.equal(evidence.operation, "inspect_web_network_capture");
      assert.deepEqual(
        evidence.parameters,
        sazEvidenceParameters(input, oracle.total_records),
      );
      const report = checked(evidence, webNetworkCaptureSchema);
      assert.equal(report.format, "saz");
      assert.equal(report.total_records, oracle.total_records);
      assert.equal(
        report.records.length,
        values["saz-selection"] === "baseline"
          ? oracle.total_records
          : oracle.records.length,
      );
      if (values["saz-selection"] === "baseline")
        assert.deepEqual(
          report.records.map((record) => record.ordinal),
          Array.from({ length: oracle.total_records }, (_, index) => index),
        );
      records =
        values["saz-selection"] === "baseline"
          ? oracle.record_ordinals.map((ordinal) =>
              report.records.find((record) => record.ordinal === ordinal),
            )
          : report.records;
      decoder = report.decoder;
    }
  } else {
    const initial = await call("inspect_web_network_capture", {
      ...input,
      detail: "summary",
    });
    const summary = checked(initial, analysisViewResultSchema);
    assert.equal(summary.kind, "summary");
    assert.equal(initial.operation, "inspect_analysis_view");
    assert.deepEqual(initial.parameters, {
      parent_evidence_id: summary.parent_evidence_id,
      view: { kind: "summary" },
    });
    assert.equal(summary.summary.format, "saz");
    assert.equal(summary.parent_operation, "inspect_web_network_capture");
    assert.equal(summary.summary.total_records, oracle.total_records);
    assert.equal(summary.summary.retained_records, oracle.records.length);
    decoder = summary.summary.decoder;
    const source = {
      kind: "retained-evidence",
      evidence_id: summary.parent_evidence_id,
    };
    const page = async (detail, offset, limit) => {
      return readView(source, { kind: "capture", detail, offset, limit });
    };
    const preview = await page("preview", 0, 3);
    assert.deepEqual(
      preview.items.map((record) => record.ordinal),
      oracle.record_ordinals,
    );
    const first = await page("complete", 0, 2),
      next = await page("complete", 2, 2),
      repeated = await page("complete", 0, 2);
    assert.deepEqual(first.items, repeated.items);
    assert.deepEqual(first.coverage, repeated.coverage);
    assert.equal(first.coverage.next_offset, 2);
    assert.equal(first.coverage.exhausted, false);
    assert.equal(next.coverage.exhausted, true);
    assert.equal(next.coverage.next_offset, null);
    records = [...first.items, ...next.items];
  }
  return {
    artifact_sha256: inputSha,
    total_records: oracle.total_records,
    decoder,
    facts: verifySazRecords(records, oracle),
    delivery_observations: observations,
  };
}
