import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { historicalHar } from "../../fixtures/historicalHar.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// Chrome 156 / Playwright 1.58.2 follows a real HTTP 302 with this Location
// to /next@name and retains the exact header in its exported HAR.
// SAZ equivalents below are authored HTTP-message goldens, not Fiddler exports.
const redirects = [
  {
    request: "http://example.test/start",
    location: "http:next@name",
    retained: "http:next@name",
    resolved: "http://example.test/next@name",
    retainedRedirect: "http://example.test/next@name",
  },
  {
    request: "http://source-user:source-pass@example.test/start",
    location: "http:next@name",
    retained: "http:next@name",
    // Some producers retain the Location spelling in redirectURL as well.
    resolved: "http:next@name",
    retainedRedirect: "http:next@name",
  },
  {
    request: "http://example.test/start",
    location: "http://redirect-user:redirect-pass@example.test/final",
    retained: "http://example.test/final",
    resolved: "http://redirect-user:redirect-pass@example.test/final",
    retainedRedirect: "http://example.test/final",
  },
  {
    request: "http://example.test/start",
    location: "//redirect-user:redirect-pass@example.test/final",
    retained: "//example.test/final",
    resolved: "http://redirect-user:redirect-pass@example.test/final",
    retainedRedirect: "http://example.test/final",
  },
];

const harBytes = () => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0]!;
  return Buffer.from(
    JSON.stringify({
      log: {
        ...fixture.log,
        entries: redirects.map(({ request, location, resolved }) => ({
          ...entry,
          request: { ...entry.request, url: request },
          response: {
            ...entry.response,
            status: 302,
            statusText: "Found",
            headers: [
              { name: "Location", value: location },
              { name: "X-Observed", value: "next@name" },
            ],
            redirectURL: resolved,
          },
        })),
      },
    }),
  );
};

const sazBytes = async () => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  for (const [ordinal, { request, location }] of redirects.entries()) {
    const messages = [
      ["c", `GET ${request} HTTP/1.1\r\n\r\n`],
      [
        "s",
        `HTTP/1.1 302 Found\r\nLocation:${location}\r\nX-Observed:next@name\r\n\r\n`,
      ],
    ] as const;
    for (const [side, text] of messages)
      await writer.add(
        `raw/${ordinal + 1}_${side}.txt`,
        new Uint8ArrayReader(Buffer.from(text)),
      );
  }
  return Buffer.from(await writer.close());
};

cliTest(
  "preserves same-scheme Location paths and excludes actual redirect credentials through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-history-redirects-");
    const { call } = await connectLocalToolsMcp();
    for (const format of ["har", "saz"] as const) {
      const path = join(root, `redirects.${format}`);
      await writeFile(path, format === "har" ? harBytes() : await sazBytes());
      const output = await cli.run({
        arguments: ["inspect-web-network-capture", path, format, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const evidence = parseEvidence(output.json);
      const capture = webNetworkCaptureSchema.parse(evidence.normalized_result);
      expect(capture.total_records).toBe(redirects.length);
      for (const [
        ordinal,
        { retained, retainedRedirect },
      ] of redirects.entries()) {
        const record = capture.records[ordinal]!;
        expect(record.reported).toMatchObject({
          request: { url: "http://example.test/start" },
          response: {
            ...(format === "har" ? { redirectURL: retainedRedirect } : {}),
            headers: [
              { name: "Location", value: retained },
              { name: "X-Observed", value: "next@name" },
            ],
          },
        });
        if (ordinal < 2)
          expect(record.redactions).not.toContainEqual({
            pointer: "/response/headers/0/value",
            reason: "transport-credential",
          });
      }
      expect(JSON.stringify(capture)).not.toMatch(/source-pass|redirect-pass/u);
      const reply = await call("inspect_web_network_capture", {
        capture_path: path,
        format,
      });
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      expect(parseEvidence(reply.structuredContent).evidence_id).toBe(
        evidence.evidence_id,
      );
    }
  },
);
