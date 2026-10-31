import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalHar } from "../../fixtures/historicalHar.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

/** A HAR whose entries copy the fixture entry with each request URL. */
const harWithRequestUrls = (urls: readonly string[]) => {
  const har = historicalHar();
  const [entry] = har.log.entries;
  if (entry === undefined) throw new Error("Expected a fixture HAR entry");
  return {
    log: {
      ...har.log,
      entries: urls.map((url) => ({
        ...entry,
        request: { ...entry.request, url },
      })),
    },
  };
};

const writeHar = async (urls: readonly string[]): Promise<string> => {
  const path = join(
    await createTestTempDirectory("rea-har-request-url-"),
    "capture.har",
  );
  await writeFile(path, JSON.stringify(harWithRequestUrls(urls)));
  return path;
};

// Each URL is exactly what a WHATWG URL serializer emits, as browsers record
// and send it; RFC 3986 alone rejects the unescaped characters.
const BROWSER_SERIALIZED = [
  "https://fonts.googleapis.com/css?family=Roboto:400,700|Open+Sans",
  "https://api.example.test/graphql?variables={%22id%22:1}",
  "https://api.example.test/search?q=`x`^[1]&rate=100%",
  "https://api.example.test/a|b?q=c\\d",
];

cliTest(
  "keeps admitting an RFC 3986 request URL that WHATWG would rewrite",
  async ({ cli }) => {
    const url = "https://EXAMPLE.test/a";
    expect(new URL(url).href).not.toBe(url);
    const har = await writeHar([url]);
    const inspected = await cli.run({
      arguments: ["inspect-web-network-capture", har, "har", "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    expect(inspected.json).toMatchObject({
      normalized_result: { records: [{ reported: { request: { url } } }] },
    });
  },
);

cliTest(
  "inspects and builds HARs whose request URLs are browser serializations",
  async ({ cli }) => {
    for (const url of BROWSER_SERIALIZED)
      expect(new URL(url).href, "fixture must be a WHATWG serialization").toBe(
        url,
      );
    const har = await writeHar(BROWSER_SERIALIZED);
    const inspected = await cli.run({
      arguments: ["inspect-web-network-capture", har, "har", "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    expect(inspected.json).toMatchObject({
      normalized_result: {
        total_records: BROWSER_SERIALIZED.length,
        records: BROWSER_SERIALIZED.map((url) => ({
          reported: { request: { url } },
        })),
      },
    });
    const built = await cli.run({
      arguments: ["environment-build", har, "--dry-run", "--json"],
      timeoutMs: 60_000,
    });
    expect(built.exitCode, built.stdout + built.stderr).toBe(0);
    expect(built.json).toMatchObject({
      status: "planned",
      capture: { records: BROWSER_SERIALIZED.length, input: "har" },
    });
  },
);

cliTest.for([
  // WHATWG rewrites these spellings, so the recorded text and its reading differ.
  { name: "backslash authority", url: "http:\\\\user:pass@host.test/" },
  { name: "tab", url: "https://host.test/a\tb" },
  { name: "space", url: "https://host.test/a b" },
  { name: "relative reference", url: "/a|b" },
])(
  "still rejects a request URL that is neither RFC 3986 nor a WHATWG serialization: $name",
  async ({ url }, { cli }) => {
    const har = await writeHar([url]);
    const result = await cli.run({
      arguments: ["inspect-web-network-capture", har, "har", "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["capture_path", "/log/entries/0/request/url"],
            reason: "invalid_format",
          },
        ],
      },
    });
  },
);
