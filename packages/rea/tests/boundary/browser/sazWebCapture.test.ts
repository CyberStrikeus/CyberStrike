import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  afterAll,
  expect,
  it as runtimeTest,
  onTestFinished,
  vi,
} from "vitest";
import { z } from "zod";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  webNetworkCaptureSchema,
} from "../../../src/domain/webNetworkCapture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { protobufFrame } from "../../fixtures/protobufCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  NODE_CAPTURE_HEAP_ENFORCED,
  NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES,
} from "../../../src/browser/history/CaptureRelease.js";
const hasMemoryBound =
  NODE_CAPTURE_HEAP_ENFORCED ||
  NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES !== null;

const it = runtimeTest.skipIf(!hasMemoryBound);

// Share schema compilation, not sessions or their retained Evidence.
const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());
const connectSazMcp = () =>
  connectLocalToolsMcp({}, undefined, {}, schemaValidation);

// Synthetic member fixtures based on Telerik's SAZ layout; not a real-producer golden.
const compressedBody = gzipSync(Buffer.from("stored compressed body"));
const members = (): [string, Buffer][] => [
  [
    "raw/0042_s.txt",
    Buffer.concat([
      Buffer.from(
        "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nSet-Cookie: server-credential\r\n\r\n",
      ),
      compressedBody,
    ]),
  ],
  [
    "raw/7_c.txt",
    Buffer.concat([
      Buffer.from("POST /bytes HTTP/2.0\r\n:authority: example.test\r\n\r\n"),
      Buffer.from([0xff, 0, 0x80]),
    ]),
  ],
  [
    "raw/0042_c.txt",
    Buffer.from(
      "GET https://user:password@example.test/a HTTP/1.1\r\nAuthorization: Bearer client-credential\r\nCookie: cookie-credential\r\nX-Duplicate: one\r\nX-Duplicate: two\r\nX-Text: unicode-\u03b2\r\n\r\n",
    ),
  ],
  [
    "raw/0042_m.xml",
    Buffer.from(
      '<Session SID="0042"><SessionTimers ClientConnected="2026-10-13T00:00:00Z"/><SessionFlags><SessionFlag N="x-processinfo" V="fixture:1"/></SessionFlags><Unknown value="01"><![CDATA[retained metadata]]></Unknown></Session>',
    ),
  ],
  ["raw/0042_w.txt", Buffer.from("opaque websocket message file")],
  ["raw/7_g.txt", Buffer.from([0, 1, 2])],
  ["[Content_Types].xml", Buffer.from("<Types/>")],
];
const archive = async (entries = members(), password?: string, level = 6) => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    level,
    ...(password === undefined ? {} : { password }),
  });
  for (const [name, bytes] of entries)
    await writer.add(name, new Uint8ArrayReader(bytes));
  return Buffer.from(await writer.close());
};
const fixture = async (bytes: Buffer) => {
  const root = await createTestTempDirectory("rea-saz-capture-");
  const path = join(root, "capture.saz");
  await writeFile(path, bytes);
  return path;
};
const entrypoint = fileURLToPath(
  new URL("../../../scripts/rea.mjs", import.meta.url),
);
const cliResponse = async (path: string, extra: string[] = []) => {
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        entrypoint,
        "inspect-web-network-capture",
        path,
        "saz",
        "--json",
        ...extra,
      ],
      { timeout: 40_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return { ok: true, stdout };
  } catch (cause: unknown) {
    if (
      cause instanceof Error &&
      "stdout" in cause &&
      typeof cause.stdout === "string"
    )
      return { ok: false, stdout: cause.stdout };
    throw cause;
  }
};
const cli = async (path: string, extra: string[] = []) => {
  const result = await cliResponse(path, extra);
  expect(result.ok, result.stdout).toBe(true);
  return parseEvidence(JSON.parse(result.stdout));
};

it("uses HTTP optional whitespace for SAZ identity codings without changing raw headers", async () => {
  const body = Buffer.from([0, 0, 0, 0, 2, 8, 1]);
  const codings = [
    " \tidentity\t ",
    "\tIdEnTiTy ",
    " gzip ",
    " \u00a0identity",
  ];
  const entries: [string, Buffer][] = codings.map((coding, index) => [
    `raw/${index + 1}_s.txt`,
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 200 OK\r\nContent-Type: application/grpc\r\nContent-Encoding:${coding}\r\nContent-Length: ${body.length}\r\n\r\n`,
        "latin1",
      ),
      body,
    ]),
  ]);
  const path = await fixture(await archive(entries));
  const evidence = await cli(path, [
    "--record",
    "0",
    "--record",
    "1",
    "--record",
    "2",
    "--record",
    "3",
    "--protobuf-framing",
    "grpc",
  ]);
  const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
  for (const [index, coding] of codings.entries()) {
    expect(capture.records[index]?.reported).toMatchObject({
      response: {
        headers: expect.arrayContaining([
          { name: "Content-Encoding", value: coding },
        ]),
      },
    });
    if (index < 2)
      expect(capture.records[index]?.protobuf).toMatchObject([
        {
          pointer: "/response/body",
          status: "complete",
          fields: [{ number: 1, value: "1" }],
        },
      ]);
    else expect(capture.records[index]?.protobuf).toBeUndefined();
  }
  const { call } = await connectSazMcp();
  const response = await call("inspect_web_network_capture", {
    capture_path: path,
    format: "saz",
    record_ordinals: [0, 1, 2, 3],
    protobuf: { framing: "grpc" },
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(parseEvidence(response.structuredContent).evidence_id).toBe(
    evidence.evidence_id,
  );
  for (const sensitive of ["gzip", "Content-Encoding"]) {
    const excluded = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "saz",
      record_ordinals: [0, 1, 2, 3],
      protobuf: { framing: "grpc" },
      sensitive_values: [sensitive],
    });
    expect(excluded.isError, JSON.stringify(excluded)).not.toBe(true);
    const report = webNetworkCaptureSchema.parse(
      parseEvidence(excluded.structuredContent).normalized_result,
    );
    expect(report.protobuf_coverage).toMatchObject({
      status: "partial",
      inspected_records: 4,
    });
    expect(report.records.map(({ ordinal }) => ordinal)).toEqual([0, 1, 2, 3]);
    if (sensitive === "gzip")
      expect(report.records[2]?.protobuf).toBeUndefined();
    else
      expect(
        report.records.every((record) => record.protobuf === undefined),
      ).toBe(true);
    for (const record of report.records)
      expect(record.binary_fields).toContainEqual(
        expect.objectContaining({
          pointer: "/response/body",
          state: "retained",
        }),
      );
  }
});

it("checks trailer credentials before hidden metadata blocks analysis and withholds unchecked source", async () => {
  const credential = Buffer.concat([
    protobufFrame(Buffer.from([8, 1])),
    protobufFrame(Buffer.from("authorization: Bearer fixture-only\r\n"), 128),
  ]);
  const responseBytes = (body: Buffer, contentType: string, extra = "") =>
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 200 OK\r\nContent-Type: ${contentType}\r\nX-Debug: harmless\r\n${extra}\r\n`,
      ),
      body,
    ]);
  const bytes = await archive([
    ["raw/1_s.txt", responseBytes(credential, "application/grpc-web+proto")],
    [
      "raw/2_s.txt",
      responseBytes(Buffer.from([0, 0, 0]), "application/grpc-web+proto"),
    ],
    [
      "raw/3_s.txt",
      responseBytes(
        gzipSync(credential),
        "application/grpc-web+proto",
        "Content-Encoding: gzip\r\n",
      ),
    ],
    [
      "raw/4_s.txt",
      responseBytes(Buffer.from("invalid*base64"), "application/grpc-web-text"),
    ],
  ]);
  const path = await fixture(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { call } = await connectSazMcp();
  const base = {
    capture_path: path,
    format: "saz",
    sensitive_values: ["X-Debug"],
  };
  const protectedReply = await call("inspect_web_network_capture", {
    ...base,
    record_ordinals: [0],
  });
  expect(protectedReply.isError, JSON.stringify(protectedReply)).not.toBe(true);
  const protectedCapture = webNetworkCaptureSchema.parse(
    parseEvidence(protectedReply.structuredContent).normalized_result,
  );
  expect(protectedCapture.records[0]?.binary_fields).toContainEqual(
    expect.objectContaining({
      pointer: "/response/body",
      state: "redacted",
      content_base64: null,
      sha256: null,
    }),
  );
  expect(protectedCapture.records[0]?.protobuf).toBeUndefined();
  for (const ordinals of [[0, 1], [2], [3]]) {
    const response = await call("inspect_web_network_capture", {
      ...base,
      record_ordinals: ordinals,
    });
    const failure = parseMcpToolError(response);
    const error = failure.error;
    expect(error.code).toBe("capability_unavailable");
    expect(JSON.stringify(response)).not.toContain("content_base64");
    expect(error.details?.partial_observation).toEqual({
      kind: "file-snapshot-hash",
      path,
      sha256,
      bytes: bytes.length,
    });
    expect(failure).not.toHaveProperty("normalized_result");
  }
  const excludedResponse = await call("inspect_web_network_capture", {
    ...base,
    record_ordinals: [0, 1],
    sensitive_values: ["X-Debug", path, sha256],
  });
  const excludedFailure = parseMcpToolError(excludedResponse);
  const excludedError = excludedFailure.error;
  expect(excludedError.code).toBe("capability_unavailable");
  expect(excludedError.details?.partial_observation).toEqual({
    kind: "file-snapshot-hash",
    path: null,
    sha256: null,
    bytes: bytes.length,
  });
  expect(excludedFailure).not.toHaveProperty("normalized_result");
  for (const excluded of [path, sha256, "content_base64", "fixture-only"])
    expect(JSON.stringify(excludedResponse)).not.toContain(excluded);
  const opaqueReply = await call("inspect_web_network_capture", {
    capture_path: path,
    format: "saz",
    record_ordinals: [2],
  });
  expect(opaqueReply.isError, JSON.stringify(opaqueReply)).not.toBe(true);
  const opaque = webNetworkCaptureSchema.parse(
    parseEvidence(opaqueReply.structuredContent).normalized_result,
  );
  expect(opaque.records[0]?.binary_fields).toContainEqual(
    expect.objectContaining({ pointer: "/response/body", state: "retained" }),
  );
  expect(opaque.records[0]?.protobuf).toBeUndefined();
  expect(opaque.protobuf_coverage?.status).toBe("partial");
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

it("keeps automatic framing applicability unknown when SAZ Content-Type is excluded or conflicting", async () => {
  const body = protobufFrame(Buffer.from([8, 1]));
  const response = (headers: string) =>
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 200 OK\r\n${headers}Content-Length: ${body.length}\r\n\r\n`,
      ),
      body,
    ]);
  const bytes = await archive([
    ["raw/1_s.txt", response("Content-Type: application/grpc\r\n")],
    [
      "raw/2_s.txt",
      response(
        "Content-Type: application/grpc\r\nContent-Type: text/plain\r\n",
      ),
    ],
    ["raw/3_s.txt", response("")],
    ["raw/4_s.txt", response("Content-Type: application/octet-stream\r\n")],
    [
      "raw/5_s.txt",
      response(
        "Content-Type: application/grpc\r\nContent-Type: Application/GRPC ; x=1\r\n",
      ),
    ],
  ]);
  const path = await fixture(bytes);
  const inspect = async (extra: string[]) =>
    webNetworkCaptureSchema.parse((await cli(path, extra)).normalized_result);
  const unknown = expect.stringMatching(
    /^Selected body's MIME metadata is excluded, conflicting or unavailable/,
  );
  const retainedBody = expect.objectContaining({
    pointer: "/response/body",
    state: "retained",
    sha256: createHash("sha256").update(body).digest("hex"),
  });

  // Repeated declarations with one media-type essence agree; distinct essences conflict.
  const visible = await inspect([
    "--record",
    "0",
    "--record",
    "1",
    "--record",
    "4",
  ]);
  const record = (ordinal: number) =>
    visible.records.find((item) => item.ordinal === ordinal);
  for (const ordinal of [0, 4]) {
    expect(record(ordinal)?.protobuf).toMatchObject([
      { status: "complete", fields: [{ number: 1, value: "1" }] },
    ]);
    expect(record(ordinal)?.limitations).toEqual([]);
  }
  // The first raw declaration, including its SAZ leading space, remains the reported value.
  expect(record(4)?.protobuf?.[0]?.content_type).toBe(" application/grpc");
  expect(record(1)?.protobuf).toBeUndefined();
  expect(record(1)?.limitations).toEqual([unknown]);
  expect(visible.protobuf_coverage).toEqual({
    status: "partial",
    selected_records: 3,
    inspected_records: 3,
  });

  const known = await inspect(["--record", "2", "--record", "3"]);
  expect(known.protobuf_coverage?.status).toBe("complete");
  expect(known.records.map(({ ordinal }) => ordinal)).toEqual([2, 3]);
  for (const record of known.records) {
    expect(record.protobuf).toBeUndefined();
    expect(record.limitations).toEqual([]);
  }

  for (const sensitive of ["application/grpc", "Content-Type"]) {
    const excluded = await inspect([
      "--record",
      "0",
      "--sensitive-value",
      sensitive,
    ]);
    expect(excluded.protobuf_coverage, sensitive).toEqual({
      status: "partial",
      selected_records: 1,
      inspected_records: 1,
    });
    expect(excluded.records[0]?.protobuf).toBeUndefined();
    expect(excluded.records[0]?.limitations).toEqual([unknown]);
    expect(excluded.records[0]?.binary_fields).toContainEqual(retainedBody);
    expect(excluded.records[0]?.redactions).toContainEqual({
      pointer: `/response/headers/0/${sensitive === "Content-Type" ? "name" : "value"}`,
      reason: "explicit-sensitive-value",
    });
  }

  const explicit = await inspect([
    "--record",
    "0",
    "--sensitive-value",
    "application/grpc",
    "--protobuf-framing",
    "grpc",
  ]);
  expect(explicit.protobuf_coverage?.status).toBe("complete");
  expect(explicit.records[0]?.protobuf).toMatchObject([
    { status: "complete", fields: [{ number: 1, value: "1" }] },
  ]);
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

it("inspects native SAZ through the public CLI and MCP with equal evidence, bytes and archive coordinates", async () => {
  const bytes = await archive();
  const path = await fixture(bytes);
  const evidence = await cli(path, ["--record", "1", "--record", "0"]);
  const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
  expect(capture).toMatchObject({
    format: "saz",
    total_records: 2,
    runtime_attribution: "unknown",
    records: [
      { ordinal: 1, reported: { session_id: "7", response: null } },
      {
        ordinal: 0,
        reported: {
          session_id: "0042",
          request: { url: "https://example.test/a" },
          response: { status: "200" },
        },
      },
    ],
  });
  expect(capture.records[1]?.location).toEqual({
    kind: "archive-members",
    members: [
      "raw/0042_s.txt",
      "raw/0042_c.txt",
      "raw/0042_m.xml",
      "raw/0042_w.txt",
    ],
  });
  expect(capture.records[1]?.binary_fields).toContainEqual({
    pointer: "/response/body",
    representation: "producer-bytes",
    state: "retained",
    content_base64: compressedBody.toString("base64"),
    bytes: compressedBody.length,
    sha256: createHash("sha256").update(compressedBody).digest("hex"),
  });
  expect(capture.records[0]?.binary_fields).toContainEqual(
    expect.objectContaining({
      pointer: "/request/body",
      content_base64: "/wCA",
    }),
  );
  expect(capture.records[1]?.binary_fields).toContainEqual(
    expect.objectContaining({
      pointer: "/request/body",
      bytes: 0,
      content_base64: "",
    }),
  );
  expect(capture.records[1]?.reported).toMatchObject({
    request: {
      headers: [
        { name: "Authorization", value: null },
        { name: "Cookie", value: null },
        { name: "X-Duplicate", value: " one" },
        { name: "X-Duplicate", value: " two" },
        { name: "X-Text" },
      ],
    },
  });
  expect(JSON.stringify(capture)).toContain("retained metadata");
  for (const secret of [
    "user:password",
    "client-credential",
    "server-credential",
    "cookie-credential",
  ])
    expect(JSON.stringify(capture)).not.toContain(secret);
  expect(capture.artifact.sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);

  const getValidator = vi.spyOn(schemaValidation, "getValidator");
  onTestFinished(() => getValidator.mockRestore());
  const { client, call } = await connectSazMcp();
  const tool = (await client.listTools()).tools.find(
    (item) => item.name === "inspect_web_network_capture",
  );
  if (tool?.outputSchema === undefined)
    throw new Error("Missing capture schema");
  const args = { capture_path: path, format: "saz", record_ordinals: [1, 0] };
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validate(tool.inputSchema, args)).toBe(true);
  const response = await call("inspect_web_network_capture", args);
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(getValidator).toHaveBeenCalled();
  const expectedSchema = JSON.stringify(tool.outputSchema);
  expect(
    getValidator.mock.calls.some(
      ([schema]) => JSON.stringify(schema) === expectedSchema,
    ),
  ).toBe(true);
  const fromMcp = parseEvidence(response.structuredContent);
  expect(fromMcp.normalized_result).toEqual(evidence.normalized_result);
  const bundle = await call("get_evidence_bundle", { detail: "complete" });
  const records = z
    .object({ result: z.object({ records: z.array(z.unknown()) }) })
    .parse(bundle.structuredContent)
    .result.records.map(parseEvidence);
  expect(
    records.find((record) => record.evidence_id === fromMcp.evidence_id),
  ).toEqual(fromMcp);
}, 60_000);

it("pages retained SAZ Evidence through public MCP and portable CLI after source deletion", async () => {
  const path = await fixture(await archive());
  const { call } = await connectSazMcp();
  const args = { capture_path: path, format: "saz", record_ordinals: [1, 0] };
  const full = await call("inspect_web_network_capture", args);
  const fromMcp = parseEvidence(full.structuredContent);
  const capture = webNetworkCaptureSchema.parse(fromMcp.normalized_result);
  const summaryArgs = { ...args, detail: "summary" };
  const summaryResponse = await call(
    "inspect_web_network_capture",
    summaryArgs,
  );
  expect(summaryResponse.isError, JSON.stringify(summaryResponse)).not.toBe(
    true,
  );
  const summary = parseEvidence(summaryResponse.structuredContent);
  expect(summary.normalized_result).toMatchObject({
    kind: "summary",
    parent_evidence_id: fromMcp.evidence_id,
    summary: { format: "saz", total_records: 2, retained_records: 2 },
  });
  expect(JSON.stringify(summary)).not.toContain(
    compressedBody.toString("base64"),
  );

  // Retained pages must keep their snapshot semantics after the input disappears.
  await unlink(path);
  const source = {
    kind: "retained-evidence",
    evidence_id: fromMcp.evidence_id,
  };
  const previewArgs = {
    source,
    view: { kind: "capture", offset: 0, limit: 1 },
  };
  const previewResponse = await call("inspect_analysis_view", previewArgs);
  expect(previewResponse.isError, JSON.stringify(previewResponse)).not.toBe(
    true,
  );
  const preview = parseEvidence(previewResponse.structuredContent);
  expect(preview.normalized_result).toMatchObject({
    items: [
      {
        ordinal: 1,
        reported: {
          session_id: "7",
          request: { method: "POST", url: "/bytes" },
        },
      },
    ],
    coverage: { examined: 1, total: 2, next_offset: 1, exhausted: false },
  });
  expect(JSON.stringify(preview)).not.toContain("content_base64");
  const completeResponse = await call("inspect_analysis_view", {
    source,
    view: { kind: "capture", detail: "complete", offset: 1, limit: 1 },
  });
  expect(completeResponse.isError, JSON.stringify(completeResponse)).not.toBe(
    true,
  );
  const complete = parseEvidence(completeResponse.structuredContent);
  expect(complete.normalized_result).toMatchObject({
    items: [capture.records[1]],
    coverage: { next_offset: null, exhausted: true },
  });

  const workflow = join(path, "..", "summary-view.json");
  await writeFile(
    workflow,
    JSON.stringify({
      source: { kind: "inline", evidence: fromMcp },
      view: { kind: "summary" },
    }),
  );
  const standalone = await promisify(execFile)(process.execPath, [
    entrypoint,
    "inspect-analysis-view",
    workflow,
    "--json",
  ]);
  expect(
    parseEvidence(JSON.parse(standalone.stdout)).normalized_result,
  ).toEqual(summary.normalized_result);
}, 60_000);

it("keeps CRLF separators inside a body after LF-only HTTP headers", async () => {
  const body = Buffer.from("\ufefffirst\r\n\r\nsecond\n\nthird");
  const bytes = await archive([
    [
      "raw/1_c.txt",
      Buffer.concat([
        Buffer.from("POST https://example.test/ HTTP/1.1\nX-Test: request\n\n"),
        body,
      ]),
    ],
    [
      "raw/1_s.txt",
      Buffer.concat([
        Buffer.from("HTTP/1.1 200 OK\nX-Test: response\n\n"),
        body,
      ]),
    ],
  ]);
  const path = await fixture(bytes);
  const capture = webNetworkCaptureSchema.parse(
    (await cli(path)).normalized_result,
  );
  expect(capture.records[0]?.reported).toMatchObject({
    request: {
      headers: [{ name: "X-Test", value: " request" }],
      body: body.toString("utf8"),
    },
    response: {
      headers: [{ name: "X-Test", value: " response" }],
      body: body.toString("utf8"),
    },
  });
  for (const pointer of ["/request/body", "/response/body"])
    expect(capture.records[0]?.binary_fields).toContainEqual({
      pointer,
      representation: "producer-bytes",
      state: "retained",
      content_base64: body.toString("base64"),
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

it("reports zero-byte SAZ HTTP members as null instead of rejecting the archive", async () => {
  const bytes = await archive([
    ["raw/1_c.txt", Buffer.from("GET https://example.test/ HTTP/1.1\r\n\r\n")],
    ["raw/1_s.txt", Buffer.alloc(0)],
    ["raw/2_c.txt", Buffer.alloc(0)],
    ["raw/2_s.txt", Buffer.from("HTTP/1.1 204 No Content\r\n\r\n")],
    ["raw/2_w.txt", Buffer.alloc(0)],
  ]);
  const path = await fixture(bytes);
  const capture = webNetworkCaptureSchema.parse(
    (await cli(path)).normalized_result,
  );
  expect(capture.total_records).toBe(2);
  expect(capture.limitations).toContainEqual(
    expect.stringMatching(
      /\babsent\b[^.]*\bzero-byte\b[^.]*\bHTTP members\b[^.]*\bnull\b/iu,
    ),
  );
  expect(capture.records[0]?.reported).toMatchObject({
    request: { method: "GET", body: "" },
    response: null,
  });
  expect(capture.records[1]?.reported).toMatchObject({
    request: null,
    response: { status: "204", body: "" },
    websocket: { member: "raw/2_w.txt" },
  });
  expect(capture.records[0]?.location).toEqual({
    kind: "archive-members",
    members: ["raw/1_c.txt", "raw/1_s.txt"],
  });
  expect(capture.records[0]?.limitations).toEqual([
    "The stored response member is empty (zero bytes); the response is reported as null.",
  ]);
  expect(capture.records[1]?.limitations).toEqual([
    "The stored request member is empty (zero bytes); the request is reported as null.",
  ]);
  const selected = webNetworkCaptureSchema.parse(
    (await cli(path, ["--record", "0"])).normalized_result,
  );
  expect(selected.records).toMatchObject([
    { ordinal: 0, reported: { response: null } },
  ]);
});

it("validates SAZ XML declarations against archive member bytes at the CLI boundary", async () => {
  const withMetadata = (metadata: Buffer): [string, Buffer][] =>
    members().map(([name, bytes]) =>
      name === "raw/0042_m.xml" ? [name, metadata] : [name, bytes],
    );
  const utf8 = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><Session SID="0042"/>',
  );
  const utf16le = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-16"?><Session SID="0042"/>',
      "utf16le",
    ),
  ]);
  for (const metadata of [utf8, utf16le]) {
    const result = await cli(
      await fixture(await archive(withMetadata(metadata))),
    );
    expect(
      webNetworkCaptureSchema.parse(result.normalized_result).records,
    ).toHaveLength(2);
  }
  const mismatch = Buffer.from(
    '<?xml version="1.0" encoding="UTF-16"?><Session SID="0042"/>',
  );
  const rejected = await cliResponse(
    await fixture(await archive(withMetadata(mismatch))),
    ["--record", "1"],
  );
  expect(rejected.ok).toBe(false);
  expect(JSON.parse(rejected.stdout)).toMatchObject({
    category: "invalid_input",
    details: {
      issues: [
        expect.objectContaining({
          message: expect.stringContaining(
            "SAZ metadata encoding declaration disagrees with its bytes",
          ),
        }),
      ],
    },
  });
});

it("excludes explicit literals from XML, HTTP byte views, member coordinates and binary sidecars", async () => {
  const path = await fixture(await archive());
  const result = await cli(path, [
    "--sensitive-value",
    "0042",
    "--sensitive-value",
    "unicode-\u03b2",
    "--sensitive-value",
    compressedBody.toString("base64"),
    "--sensitive-value",
    "retained metadata",
  ]);
  const capture = webNetworkCaptureSchema.parse(result.normalized_result);
  expect(capture.records[0]?.location).toEqual({
    kind: "unknown",
    reason: "explicit-sensitive-value",
  });
  expect(capture.records[0]?.binary_fields).toContainEqual({
    pointer: "/response/body",
    representation: "producer-bytes",
    state: "redacted",
    bytes: null,
    sha256: null,
    content_base64: null,
  });
  const text = JSON.stringify(result);
  for (const secret of [
    "0042",
    "unicode-",
    "retained metadata",
    compressedBody.toString("base64"),
    createHash("sha256").update(compressedBody).digest("hex"),
  ])
    expect(text).not.toContain(secret);
});

it("retains folded headers, stored chunk framing and BOM-marked UTF-16 metadata", async () => {
  const body = "3\r\none\r\n0\r\n\r\n";
  const path = await fixture(
    await archive([
      [
        "raw/1_s.txt",
        Buffer.from(
          `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nX-Folded: first\r\n second\r\n\r\n${body}`,
        ),
      ],
      [
        "raw/1_m.xml",
        Buffer.from(
          '\ufeff<?xml version="1.0" encoding="utf-16"?><Session><Note>\u03b2</Note><Source><![CDATA[<!DOCTYPE html>]]></Source></Session>',
          "utf16le",
        ),
      ],
      [
        "raw/2_c.txt",
        Buffer.from(
          "CONNECT example.test:443 HTTP/1.1\nHost: example.test:443\n\n",
        ),
      ],
    ]),
  );
  const evidence = await cli(path);
  const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
  expect(capture.records[0]?.reported).toMatchObject({
    request: null,
    response: {
      body,
      headers: [
        { name: "Transfer-Encoding", value: " chunked" },
        { name: "X-Folded", value: " first\r\n second" },
      ],
    },
  });
  expect(capture.records[0]?.binary_fields).toContainEqual(
    expect.objectContaining({
      pointer: "/response/body",
      content_base64: Buffer.from(body).toString("base64"),
    }),
  );
  expect(JSON.stringify(capture.records[0]?.reported)).toContain("\u03b2");
  expect(capture.records[1]?.reported).toMatchObject({
    request: { method: "CONNECT", url: "example.test:443", body: "" },
  });
});

it.each([
  "bad-http",
  "bad-xml",
  "dtd",
  "unknown-member",
  "encrypted",
  "duplicate",
  "crc",
  "expanded-limit",
])("rejects %s before returning a selected subset", async (variant) => {
  let entries = members();
  if (variant === "bad-http")
    entries.push(["raw/8_c.txt", Buffer.from("malformed-private-input")]);
  if (variant === "bad-xml")
    entries.push(["raw/8_m.xml", Buffer.from("<Session><Broken></Session>")]);
  if (variant === "dtd")
    entries.push([
      "raw/8_m.xml",
      Buffer.from(
        '<!DOCTYPE Session [<!ENTITY external SYSTEM "file:///private-input">]><Session>&external;</Session>',
      ),
    ]);
  if (variant === "unknown-member")
    entries.push(["raw/8_unknown.txt", Buffer.from("unknown extension")]);
  if (variant === "duplicate")
    entries = [
      ["raw/8_c.txt", Buffer.from("GET /a HTTP/1.1\r\n\r\n")],
      ["raw/9_c.txt", Buffer.from("GET /b HTTP/1.1\r\n\r\n")],
    ];
  let bytes = await archive(
    entries,
    variant === "encrypted" ? "fixture-password" : undefined,
    variant === "crc" ? 0 : 6,
  );
  if (variant === "duplicate")
    bytes = Buffer.from(
      bytes.toString("latin1").replaceAll("raw/9_c.txt", "raw/8_c.txt"),
      "latin1",
    );
  if (variant === "crc") {
    const offset = bytes.indexOf(Buffer.from("HTTP/1.1 200 OK"));
    expect(offset).toBeGreaterThan(0);
    bytes[offset + 9] = 0x35;
  }
  if (variant === "expanded-limit") {
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(33 * 1024 * 1024, central + 24);
  }
  const path = await fixture(bytes);
  const result = await cliResponse(path, ["--record", "0"]);
  expect(result.ok, result.stdout).toBe(false);
  expect(JSON.parse(result.stdout).category).toBe(
    ["encrypted", "unknown-member", "dtd"].includes(variant)
      ? "unsupported_provider"
      : "invalid_input",
  );
  // Expanded size is a caller-correctable input bound, not a decoder failure.
  if (variant === "expanded-limit") {
    const error = JSON.parse(result.stdout);
    expect(error.code).toBe("invalid_request");
    expect(error.details.issues).toEqual([
      expect.objectContaining({
        path: ["capture_path", ""],
        reason: "out_of_range",
        expected: {
          maximum_expanded_capture_bytes: WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
        },
      }),
    ]);
    const { call } = await connectSazMcp();
    const response = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "saz",
      record_ordinals: [0],
    });
    expect(response.isError).toBe(true);
    const mcpFailure = parseMcpToolError(response);
    expect(mcpFailure).toMatchObject({
      error: {
        code: error.code,
        category: error.category,
        details: error.details,
      },
    });
    expect(error).not.toHaveProperty("normalized_result");
    const sourceObservation = {
      kind: "file-snapshot-hash",
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
    expect(error.details.partial_observation).toEqual(sourceObservation);
    expect(mcpFailure).not.toHaveProperty("normalized_result");
    expect(mcpFailure.error.details?.partial_observation).toEqual(
      sourceObservation,
    );
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  }
  expect(JSON.stringify(result)).not.toContain("malformed-private-input");
});

runtimeTest.runIf(!hasMemoryBound)(
  "reports SAZ unavailable when its runtime cannot enforce decoder memory",
  async () => {
    const response = await cliResponse(await fixture(await archive()));
    expect(response.ok).toBe(false);
    expect(JSON.parse(response.stdout)).toMatchObject({
      code: "capability_unavailable",
    });
  },
);
