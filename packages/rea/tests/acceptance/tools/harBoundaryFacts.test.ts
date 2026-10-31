import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { historicalHar } from "../../fixtures/historicalHar.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

cliTest(
  "omits HAR extension payloads from capture previews while retaining complete records",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-har-preview-");
    const fixture = historicalHar();
    const entry = fixture.log.entries[0];
    if (entry === undefined) throw new Error("fixture missing");
    const marker = "nested-extension-payload";
    const scalarMarker = "scalar-extension-value";
    const path = join(root, "capture.har");
    await writeFile(
      path,
      JSON.stringify({
        log: {
          ...fixture.log,
          entries: [
            {
              ...entry,
              name: { payload: marker },
              type: { body: marker },
              request: { ...entry.request, reason: { payload: marker } },
              response: { ...entry.response, method: { payload: marker } },
            },
            {
              ...entry,
              name: scalarMarker,
              type: scalarMarker,
              request: { ...entry.request, reason: scalarMarker },
              response: { ...entry.response, method: scalarMarker },
            },
          ],
        },
      }),
    );
    const capture = await cli.run({
      arguments: ["inspect-web-network-capture", path, "har", "--json"],
    });
    expect(capture.exitCode, capture.stderr).toBe(0);
    const evidence = parseEvidence(capture.json);
    const { call } = await connectLocalToolsMcp();
    for (const detail of ["preview", "complete"] as const) {
      const request = {
        source: { kind: "inline", evidence },
        view: { kind: "capture", detail, offset: 0, limit: 2 },
      };
      const requestPath = join(root, `${detail}.json`);
      await writeFile(requestPath, JSON.stringify(request));
      const output = await cli.run({
        arguments: ["inspect-analysis-view", requestPath, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const result = parseEvidence(output.json).normalized_result;
      const reply = await call("inspect_analysis_view", request);
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      expect(parseEvidence(reply.structuredContent).normalized_result).toEqual(
        result,
      );
      if (detail === "preview") {
        expect(JSON.stringify(result)).not.toContain(marker);
        expect(JSON.stringify(result)).not.toContain(scalarMarker);
        expect(result).toMatchObject({
          items: [
            {
              reported: {
                startedDateTime: entry.startedDateTime,
                request: {
                  method: entry.request.method,
                  url: entry.request.url,
                },
                response: { status: entry.response.status },
              },
            },
            {},
          ],
        });
      } else {
        expect(result).toMatchObject({
          items: [
            {
              reported: {
                name: { payload: marker },
                type: { body: marker },
                request: { reason: { payload: marker } },
                response: { method: { payload: marker } },
              },
            },
            {
              reported: {
                name: scalarMarker,
                type: scalarMarker,
                request: { reason: scalarMarker },
                response: { method: scalarMarker },
              },
            },
          ],
        });
      }
    }
  },
);

cliTest(
  "refuses malformed HAR schema facts before record selection through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-har-timing-facts-");
    const { call } = await connectLocalToolsMcp();
    const fixture = historicalHar();
    const entry = fixture.log.entries[0];
    if (entry === undefined) throw new Error("fixture missing");
    const malformedEntries = [
      { label: "null-timings", fields: { timings: null }, field: "timings" },
      {
        label: "negative-timings",
        fields: { timings: { send: 0, wait: -2, receive: 0 } },
        field: "timings/wait",
      },
      { label: "null-cache", fields: { cache: null }, field: "cache" },
      { label: "negative-time", fields: { time: -1 }, field: "time" },
    ];
    const malformedCaptures = [
      ...malformedEntries.map(({ label, fields, field }) => ({
        label,
        log: { ...fixture.log, entries: [entry, { ...entry, ...fields }] },
        pointer: `/log/entries/1/${field}`,
      })),
      {
        label: "negative-page-time",
        log: {
          ...fixture.log,
          pages: [
            {
              startedDateTime: entry.startedDateTime,
              id: "page_0",
              title: "fixture",
              pageTimings: { onLoad: -0.5 },
            },
          ],
        },
        pointer: "/log/pages/0/pageTimings/onLoad",
      },
    ];
    for (const { label, log, pointer } of malformedCaptures) {
      const text = JSON.stringify({ log });
      const path = join(root, `${label}.har`);
      await writeFile(path, text);
      const invocation = {
        arguments: [
          "inspect-web-network-capture",
          path,
          "har",
          "--record",
          "0",
          "--json",
        ],
      };
      const output =
        label === "null-timings"
          ? await cli.run(invocation)
          : await runFileCli(cli, invocation);
      expect(output.exitCode).toBe(1);
      const expected = {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["capture_path", pointer],
              reason: "invalid_format",
            },
          ],
        },
      };
      expect(output.json).toMatchObject(expected);
      expect(output.json).not.toHaveProperty("evidence_id");
      const reply = await call("inspect_web_network_capture", {
        capture_path: path,
        format: "har",
        record_ordinals: [0],
      });
      expect(reply.isError).toBe(true);
      expect(parseMcpToolError(reply).error).toMatchObject(expected);
      expect(await readFile(path, "utf8")).toBe(text);
    }
  },
);

cliTest(
  "keeps unknown HAR body encodings as evidence without deriving decoded state through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-har-body-facts-");
    const fixture = historicalHar();
    const entry = fixture.log.entries[0];
    if (entry === undefined) throw new Error("fixture missing");
    const bodies = [
      { path: "plain", text: '{"theme":"light"}', encoding: undefined },
      {
        path: "encoded",
        text: Buffer.from('{"theme":"dark"}').toString("base64"),
        encoding: "base64",
      },
      // Unknown encodings remain opaque even if their representation looks like JSON.
      {
        path: "opaque",
        text: '{"theme":"opaque-marker"}',
        encoding: "custom-json",
      },
    ];
    const text = JSON.stringify({
      log: {
        ...fixture.log,
        entries: bodies.map((body) => ({
          ...entry,
          request: {
            ...entry.request,
            url: `https://example.invalid/api/${body.path}`,
          },
          response: {
            ...entry.response,
            content: {
              ...entry.response.content,
              mimeType: "application/json",
              text: body.text,
              ...(body.encoding === undefined
                ? {}
                : { encoding: body.encoding }),
            },
          },
        })),
      },
    });
    const path = join(root, "bodies.har");
    await writeFile(path, text);
    const output = await cli.run({
      arguments: ["inspect-web-network-capture", path, "har", "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const evidence = parseEvidence(output.json);
    const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
    expect(capture.decoder.version).toBe(
      "har-schema@2.0.0;har-schema-corrections@1;jsonc-parser@3.3.1;lossless-json@4.3.1",
    );
    expect(capture.artifact).toMatchObject({
      path,
      sha256: createHash("sha256").update(text).digest("hex"),
    });
    expect(capture.records[2]?.reported).toMatchObject({
      response: { content: { encoding: "custom-json", text: bodies[2]?.text } },
    });
    expect(capture.records[2]?.binary_fields).toEqual([]);
    const { call } = await connectLocalToolsMcp();
    const imported = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "har",
    });
    expect(imported.isError, JSON.stringify(imported)).not.toBe(true);
    expect(parseEvidence(imported.structuredContent).normalized_result).toEqual(
      evidence.normalized_result,
    );
    const request = {
      source: { kind: "inline", evidence },
      view: { kind: "environment-state" },
    };
    const requestPath = join(root, "state.json");
    await writeFile(requestPath, JSON.stringify(request));
    const state = await cli.run({
      arguments: ["inspect-analysis-view", requestPath, "--json"],
    });
    expect(state.exitCode, state.stderr).toBe(0);
    const stateEvidence = parseEvidence(state.json);
    expect(stateEvidence.normalized_result).toMatchObject({
      kind: "environment-state",
      documents: expect.arrayContaining([
        expect.objectContaining({
          path: "/api/encoded",
          value: { theme: "dark" },
        }),
        expect.objectContaining({
          path: "/api/plain",
          value: { theme: "light" },
        }),
      ]),
      views: expect.arrayContaining([
        expect.objectContaining({
          tool: "get_opaque",
          shape: "recorded",
          reason: "body-unusable",
        }),
      ]),
    });
    expect(stateEvidence.normalized_result).toHaveProperty(
      "documents.length",
      2,
    );
    const stateReply = await call("inspect_analysis_view", request);
    expect(stateReply.isError, JSON.stringify(stateReply)).not.toBe(true);
    expect(
      parseEvidence(stateReply.structuredContent).normalized_result,
    ).toEqual(stateEvidence.normalized_result);
    expect(await readFile(path, "utf8")).toBe(text);
  },
);
