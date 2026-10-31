import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, onTestFinished } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
const entrypoint = fileURLToPath(
  new URL("../../../scripts/rea.mjs", import.meta.url),
);
const cli = async (
  path: string,
  format: string,
  extra: readonly string[] = [],
) => {
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        entrypoint,
        "inspect-web-network-capture",
        path,
        format,
        "--json",
        ...extra,
      ],
      { env: { ...process.env, REA_MITMDUMP_COMMAND: "" }, timeout: 40_000 },
    );
    return { ok: true, stdout: result.stdout };
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
import {
  historicalHar,
  harWithContainerLookalikes,
} from "../../fixtures/historicalHar.js";

it("preserves opaque HAR container fields through CLI and MCP", async () => {
  const root = await createTestTempDirectory("rea-har-container-fields-");
  const path = join(root, "capture.har");
  const fixture = harWithContainerLookalikes();
  const original = JSON.stringify(fixture);
  await writeFile(path, original);
  const { call } = await connectLocalToolsMcp();
  for (const marked of [false, true]) {
    const sensitive = marked ? ["ordinary-root-evidence"] : [];
    const fromCli = await cli(
      path,
      "har",
      marked ? ["--sensitive-value", sensitive[0]!] : [],
    );
    expect(fromCli.ok, fromCli.stdout).toBe(true);
    const cliEvidence = parseEvidence(JSON.parse(fromCli.stdout));
    const response = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
      sensitive_values: sensitive,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const evidence = parseEvidence(response.structuredContent);
    expect(evidence.evidence_id).toBe(cliEvidence.evidence_id);
    expect(evidence.normalized_result).toEqual(cliEvidence.normalized_result);
    const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
    expect(capture.container.reported).toMatchObject({
      request: {
        url: fixture.request.url,
        headers: [{ value: marked ? null : "ordinary-root-evidence" }],
        cookies: [{ value: marked ? null : "ordinary-root-evidence" }],
      },
      response: {
        redirectURL: fixture.response.redirectURL,
        headers: [{ value: marked ? null : "ordinary-root-evidence" }],
        content: { text: marked ? null : "ordinary-root-evidence" },
      },
    });
    expect(capture.records[0]).toMatchObject({
      reported: {
        request: {
          url: "https://example.test/opaque",
          headers: [{ value: null }],
          cookies: [{ value: null }],
        },
        response: {
          redirectURL: "https://example.test/redirect",
          headers: [{ value: null }],
        },
      },
      binary_fields: [
        { pointer: "/response/content/text", content_base64: "QUJD", bytes: 3 },
      ],
    });
  }
  expect(await readFile(path, "utf8")).toBe(original);
});

it("excludes normalized HAR numbers through CLI and MCP", async () => {
  const encoded = "1e3";
  const literal = "1000";
  const root = await createTestTempDirectory("rea-har-normalized-number-");
  const path = join(root, "capture.har");
  const original = JSON.stringify(historicalHar())
    .replace('"log":{', `"_number":${encoded},"log":{`)
    .replace('"cache":{}', `"cache":{},"_number":${encoded}`);
  await writeFile(path, original);
  const { call } = await connectLocalToolsMcp();
  for (const marked of [false, true]) {
    const fromCli = await cli(
      path,
      "har",
      marked ? ["--sensitive-value", literal] : [],
    );
    expect(fromCli.ok, fromCli.stdout).toBe(true);
    const evidence = parseEvidence(JSON.parse(fromCli.stdout));
    const response = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
      ...(marked ? { sensitive_values: [literal] } : {}),
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const mcp = parseEvidence(response.structuredContent);
    expect(mcp.evidence_id).toBe(evidence.evidence_id);
    expect(mcp.normalized_result).toEqual(evidence.normalized_result);
    const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
    for (const projection of [capture.container, ...capture.records]) {
      expect(projection.reported).toMatchObject({
        _number: marked ? null : Number(encoded),
      });
      const numbers = projection.numeric_literals.filter(
        (number) => number.pointer === "/_number",
      );
      expect(numbers).toEqual(
        marked
          ? []
          : [
              {
                pointer: "/_number",
                producer_type: "json-number",
                literal: encoded,
              },
            ],
      );
      if (marked)
        expect(projection.redactions).toContainEqual({
          pointer: "/_number",
          reason: "explicit-sensitive-value",
        });
    }
  }
  expect(await readFile(path, "utf8")).toBe(original);
});

it("retains Playwright IPv6 spelling through public CLI and MCP workflows", async () => {
  const root = await createTestTempDirectory("rea-har-ipv6-");
  const path = join(root, "capture.har");
  const original = JSON.stringify(historicalHar())
    .replace(
      '"name":"rea-source-owned-fixture","version":"1"',
      '"name":"Playwright","version":"1.58.2"',
    )
    .replace(
      '"startedDateTime":',
      '"serverIPAddress":"[2001:db8::1]","startedDateTime":',
    );
  await writeFile(path, original);
  const { call } = await connectLocalToolsMcp();
  const fromCli = await cli(path, "har");
  expect(fromCli.ok, fromCli.stdout).toBe(true);
  const cliEvidence = parseEvidence(JSON.parse(fromCli.stdout));
  const response = await call("inspect_web_network_capture", {
    capture_path: path,
    format: "har",
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const mcpEvidence = parseEvidence(response.structuredContent);
  expect(mcpEvidence.evidence_id).toBe(cliEvidence.evidence_id);
  expect(mcpEvidence.normalized_result).toEqual(cliEvidence.normalized_result);
  const capture = webNetworkCaptureSchema.parse(cliEvidence.normalized_result);
  expect(capture.records[0]).toMatchObject({
    reported: {
      serverIPAddress: "[2001:db8::1]",
    },
  });
  expect(
    capture.records[0]?.limitations.some((limitation) =>
      limitation.includes("bracketed IPv6 serverIPAddress"),
    ),
  ).toBe(true);
  expect(await readFile(path, "utf8")).toBe(original);
});

it("excludes declared binary lengths through CLI, MCP and retained capture pages", async () => {
  const root = await createTestTempDirectory("rea-har-byte-length-");
  const path = join(root, "capture.har");
  const fixture = historicalHar();
  const entry = fixture.log.entries[0];
  if (entry === undefined) throw new Error("fixture missing");
  const body = Buffer.alloc(12_345, "A");
  const content = body.toString("base64");
  const digest = createHash("sha256").update(body).digest("hex");
  await writeFile(
    path,
    JSON.stringify({
      log: {
        ...fixture.log,
        entries: [
          {
            ...entry,
            response: {
              ...entry.response,
              content: {
                size: 99,
                mimeType: "text/plain",
                encoding: "base64",
                text: content,
              },
            },
          },
        ],
      },
    }),
  );
  const { call } = await connectLocalToolsMcp();
  const args = { capture_path: path, format: "har" };
  const control = await call("inspect_web_network_capture", args);
  expect(control.isError).not.toBe(true);
  const retained = parseEvidence(control.structuredContent);
  const controlCapture = webNetworkCaptureSchema.parse(
    retained.normalized_result,
  );
  expect(controlCapture.records[0]?.binary_fields[0]).toMatchObject({
    state: "retained",
    bytes: body.length,
    content_base64: content,
    sha256: digest,
  });
  for (const literal of ["12345", "2345"]) {
    // Only the derived count matches, so this cannot pass via another exclusion.
    expect(content).not.toContain(literal);
    expect(digest).not.toContain(literal);
    const fromCli = await cli(path, "har", ["--sensitive-value", literal]);
    expect(fromCli.ok, fromCli.stdout).toBe(true);
    const evidence = parseEvidence(JSON.parse(fromCli.stdout));
    const response = await call("inspect_web_network_capture", {
      ...args,
      sensitive_values: [literal],
    });
    expect(response.isError).not.toBe(true);
    const fromMcp = parseEvidence(response.structuredContent);
    expect(fromMcp.normalized_result).toEqual(evidence.normalized_result);
    const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
    expect(capture.records[0]?.reported).toMatchObject({
      response: { content: { size: 99, text: null } },
    });
    expect(capture.records[0]?.binary_fields[0]).toEqual({
      pointer: "/response/content/text",
      representation: "har-base64-content",
      state: "redacted",
      bytes: null,
      content_base64: null,
      sha256: null,
    });
    for (const detail of ["preview", "complete"]) {
      const page = await call("inspect_analysis_view", {
        source: { kind: "retained-evidence", evidence_id: fromMcp.evidence_id },
        view: { kind: "capture", detail },
      });
      expect(page.isError).not.toBe(true);
      const result = parseEvidence(page.structuredContent);
      expect(result.normalized_result).toMatchObject({
        items: [{ binary_fields: [{ state: "redacted", bytes: null }] }],
      });
    }
  }
}, 60_000);

it("reads actual upstream HAR packages in an owned process and retains selected producer order", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-history-har-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const fixture = historicalHar();
  const first = fixture.log.entries[0];
  if (first === undefined) throw new Error("fixture missing");
  const second = structuredClone(first);
  second.request.url = "https://example.test/b";
  fixture.log.entries.push(second);
  const text = JSON.stringify(fixture);
  const path = join(root, "capture.har");
  await writeFile(path, text);
  const called = await cli(path, "har", ["--record", "1", "--record", "0"]);
  expect(called.ok, called.stdout).toBe(true);
  const result = { value: parseEvidence(JSON.parse(called.stdout)) };
  expect(result.value.subject?.digest).toMatchObject({
    sha256: createHash("sha256").update(text).digest("hex"),
  });
  expect(result.value.normalized_result).toMatchObject({
    total_records: 2,
    records: [
      { ordinal: 1, reported: { request: { url: second.request.url } } },
      { ordinal: 0, reported: { request: { url: first.request.url } } },
    ],
    runtime_attribution: "unknown",
  });
});

it("keeps malformed JSON separate from absent external mitmproxy capability", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-history-errors-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "capture.har");
  await writeFile(path, "{malformed-private-json");
  const malformed = await cli(path, "har");
  expect(malformed.ok).toBe(false);
  expect(JSON.parse(malformed.stdout)).toMatchObject({
    category: "invalid_input",
  });
  expect(malformed.stdout).not.toContain("malformed-private-json");
  const missing = await cli(path, "mitmproxy");
  expect(missing.ok).toBe(false);
  expect(JSON.parse(missing.stdout)).toMatchObject({
    category: "unsupported_provider",
    message: expect.stringContaining("REA_MITMDUMP_COMMAND"),
  });
});

it("reports the actual HAR decoder nesting constraint as a typed selected-input issue", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-history-depth-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  let extension: unknown = "leaf";
  for (let depth = 0; depth < 66; depth++) extension = { child: extension };
  const path = join(root, "deep.har");
  await writeFile(
    path,
    JSON.stringify({ ...historicalHar(), _extension: extension }),
  );
  const result = await cli(path, "har");
  expect(result.ok).toBe(false);
  expect(JSON.parse(result.stdout)).toMatchObject({
    category: "invalid_input",
    details: {
      issues: [
        {
          path: ["capture_path", expect.stringMatching(/^\/_extension\/child/)],
          reason: "out_of_range",
          expected: { maximum_capture_nesting: 64 },
        },
      ],
    },
  });
});
