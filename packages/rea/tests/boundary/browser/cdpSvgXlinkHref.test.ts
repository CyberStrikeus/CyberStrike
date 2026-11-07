import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { expect } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { waitForBrowserDevtoolsPort } from "../../../scripts/lib/browser-process-startup.mjs";
import {
  inspectWebPageInputSchema,
  listBrowserTargetsInputSchema,
} from "../../../src/domain/browserObservation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  processTest as it,
  waitForExit,
  type TestProcesses,
} from "../../support/process/processFixture.js";

const chromeExecutable = [
  process.env.REA_BROWSER_EXECUTABLE,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(
  (candidate): candidate is string =>
    typeof candidate === "string" &&
    candidate.length > 0 &&
    existsSync(candidate),
);

// Match the real-browser verifier: a cold Chrome launch on a loaded coverage
// runner can exceed 20 seconds before publishing DevToolsActivePort.
const CHROME_STARTUP_TIMEOUT_MS = 60_000;
const CHROME_TEST_TIMEOUT_MS = CHROME_STARTUP_TIMEOUT_MS + 30_000;

const inspectChromePage = async ({
  processes,
  executable,
  profilePrefix,
  page,
  contentType,
  pathname,
}: {
  processes: TestProcesses;
  executable: string;
  profilePrefix: string;
  page: string;
  contentType: string;
  pathname: string;
}) => {
  const profile = await createTestTempDirectory(profilePrefix);
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": `${contentType}; charset=utf-8`,
    });
    response.end(page);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("SVG fixture server did not bind a TCP port");
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const pageUrl = `${origin}${pathname}`;
  let stderr = "";
  const child = processes.spawn(executable, [
    "--headless=new",
    ...(process.env.REA_BROWSER_NO_SANDBOX === "true" ? ["--no-sandbox"] : []),
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-dev-shm-usage",
    "--disable-sync",
    "--metrics-recording-only",
    pageUrl,
  ]);
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 8_192) stderr += chunk.toString("utf8");
  });
  try {
    const port = await waitForBrowserDevtoolsPort({
      child,
      executable,
      activePortPath: join(profile, "DevToolsActivePort"),
      stderr: () => stderr,
      timeoutMs: CHROME_STARTUP_TIMEOUT_MS,
    });
    const endpoint = `http://127.0.0.1:${String(port)}`;
    const provider = new CdpBrowserProvider();
    const targetId = await pageTarget(provider, endpoint, origin, pageUrl);
    const result = await provider.inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: endpoint,
        allowed_origins: [origin],
        target_id: targetId,
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    return { origin, pageUrl, inspection: result.value };
  } finally {
    child.kill("SIGTERM");
    if (!(await waitForExit(child, 2_000))) child.kill("SIGKILL");
    await waitForExit(child, 2_000);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
};

// Issue 1586's page, plus the HTML, image, use, and foreign-origin cases the
// real snapshot must distinguish. The XHTML page is the prefixed-svg gap
// reported on PR 1602. The tests are skipped when no Chrome-family executable
// is installed.
const pageHtml = `<!doctype html><title>x</title>
<svg width="10" height="10">
  <a id="s2" xlink:href="/xl-s2h"><text>s2</text></a>
  <a id="both" xlink:href="/xlink-loses" href="/href-wins"><text>both</text></a>
  <image id="img" xlink:href="/xl-image" />
  <use id="use" xlink:href="/xl-use" />
  <a id="out" xlink:href="https://cdn.example.test/out"><text>out</text></a>
  <a id="move-desc" xlink:href="/xl-moved-desc"><text>move desc</text></a>
  <a id="move-title" xlink:href="/xl-moved-title"><text>move title</text></a>
  <desc id="desc-container">
    <a xlink:href="/xl-html-desc">not an SVG link</a>
    <a href="/html-desc">HTML link</a>
    <svg><a xlink:href="/xl-nested-desc"><text>nested</text></a></svg>
  </desc>
  <title id="title-container">
    <a xlink:href="/xl-html-title">not an SVG link</a>
    <a href="/html-title">HTML link</a>
    <svg><a xlink:href="/xl-nested-title"><text>nested</text></a></svg>
  </title>
</svg>
<a id="html" xlink:href="/xl-html">html</a>
<script>
for (const kind of ['desc', 'title']) {
  const container = document.getElementById(kind + '-container');
  container.append(document.getElementById('move-' + kind));
  for (const nested of [false, true]) {
    const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    anchor.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href',
      '/xl-created-' + (nested ? 'nested-' : '') + kind);
    const parent = nested
      ? container.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'))
      : container;
    parent.append(anchor);
  }
  const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'a');
  math.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '/xl-math-' + kind);
  container.append(math);
}
</script>
`;

it.skipIf(chromeExecutable === undefined)(
  "reports the issue page SVG xlink:href links through headless Chrome",
  async ({ processes }) => {
    const executable = chromeExecutable;
    if (executable === undefined) return;
    const { origin, inspection } = await inspectChromePage({
      processes,
      executable,
      profilePrefix: "rea-svg-xlink-",
      page: pageHtml,
      contentType: "text/html",
      pathname: "/x.html",
    });
    const urls = inspection.metadata.dom_urls;
    const html = inspection.dom.nodes.find(
      (node) =>
        node.node_name === "A" && node.attribute_names.includes("xlink:href"),
    );
    expect(html).toBeDefined();
    expect(urls.some((url) => url.node_index === html?.index)).toBe(false);
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attribute: "href",
          url: `${origin}/xl-s2h`,
          destination_scope: "approved",
        }),
        expect.objectContaining({
          attribute: "href",
          url: `${origin}/href-wins`,
          destination_scope: "approved",
        }),
        expect.objectContaining({
          attribute: "href",
          url: `${origin}/xl-image`,
          destination_scope: "approved",
        }),
        expect.objectContaining({
          attribute: "href",
          url: `${origin}/xl-use`,
          destination_scope: "approved",
        }),
        expect.objectContaining({
          attribute: "href",
          url: null,
          destination_scope: "outside_policy",
        }),
        ...[
          "/html-desc",
          "/html-title",
          "/xl-nested-desc",
          "/xl-nested-title",
          "/xl-moved-desc",
          "/xl-moved-title",
          "/xl-created-desc",
          "/xl-created-title",
          "/xl-created-nested-desc",
          "/xl-created-nested-title",
        ].map((path) =>
          expect.objectContaining({
            attribute: "href",
            url: `${origin}${path}`,
            destination_scope: "approved",
          }),
        ),
      ]),
    );
    expect(
      urls.some(
        (url) =>
          url.url?.includes("/xl-html") === true ||
          url.url?.includes("/xl-math") === true ||
          url.url?.endsWith("/xlink-loses") === true,
      ),
    ).toBe(false);
    expect(urls.every((url) => url.attribute === "href")).toBe(true);
    expect(urls).toHaveLength(15);
  },
  CHROME_TEST_TIMEOUT_MS,
);

const xhtmlPage = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<head><title>x</title></head>
<body>
<svg:svg width="10" height="10">
  <svg:a id="pa1" xlink:href="/xl-pa1"><svg:text>p</svg:text></svg:a>
  <svg:image id="img" xlink:href="/xl-image"/>
  <svg:desc><svg:a xlink:href="/xl-xml-desc"><svg:text>desc</svg:text></svg:a></svg:desc>
  <svg:title><svg:a xlink:href="/xl-xml-title"><svg:text>title</svg:text></svg:a></svg:title>
  <svg:foreignObject width="10" height="10">
    <a id="fo-a" xlink:href="/xl-html-fo">no</a>
    <h:a xmlns:h="http://www.w3.org/1999/xhtml" id="fo-h" xlink:href="/xl-h">no</h:a>
    <svg:a id="fo-svg" xlink:href="/xl-fo-svg"><svg:text>y</svg:text></svg:a>
  </svg:foreignObject>
</svg:svg>
<svg:a id="orphan" xlink:href="/xl-orphan"><svg:text>o</svg:text></svg:a>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink" width="10" height="10">
  <a id="custom" x:href="/xl-custom"><text>c</text></a>
  <a id="both" href="/href-wins" x:href="/xlink-loses"><text>b</text></a>
  <a id="empty" href="" x:href="/xlink-empty"><text>e</text></a>
</svg>
<svg:a id="out" xlink:href="https://cdn.example.test/out"><svg:text>out</svg:text></svg:a>
<bogus:svg xmlns:bogus="http://example.com/not-svg" id="bogus" xlink:href="/xl-bogus"/>
<a id="xhtml-a" xlink:href="/xl-xhtml-a">no</a>
</body>
</html>
`;

for (const { format, page, contentType, nodeNames, link, destinations } of [
  {
    format: "XHTML",
    page: xhtmlPage,
    contentType: "application/xhtml+xml",
    nodeNames: ["html", "svg:a", "bogus:svg"],
    link: { name: "svg:a", attribute: "xlink:href" },
    destinations: [
      "/xl-pa1",
      "/xl-image",
      "/xl-xml-desc",
      "/xl-xml-title",
      "/xl-fo-svg",
      "/xl-orphan",
      "/xl-custom",
      "/href-wins",
      "",
      null,
    ],
  },
  {
    format: "SVG",
    page: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:p="http://www.w3.org/1999/xlink"><a p:href="/linked"><text>link</text></a></svg>`,
    contentType: "image/svg+xml",
    nodeNames: ["svg", "a"],
    link: { name: "a", attribute: "p:href" },
    destinations: ["/linked"],
  },
]) {
  it.skipIf(chromeExecutable === undefined)(
    `reports namespaced SVG links from a standalone ${format} document through headless Chrome`,
    async ({ processes }) => {
      const executable = chromeExecutable;
      if (executable === undefined) return;
      const { origin, pageUrl, inspection } = await inspectChromePage({
        processes,
        executable,
        profilePrefix: "rea-svg-xhtml-",
        page,
        contentType,
        pathname: "/page.xhtml",
      });
      const urls = inspection.metadata.dom_urls;
      for (const name of nodeNames) {
        expect(
          inspection.dom.nodes.some((node) => node.node_name === name),
        ).toBe(true);
      }
      expect(
        inspection.dom.nodes.some(
          (node) =>
            node.node_name === link.name &&
            node.attribute_names.includes(link.attribute),
        ),
      ).toBe(true);
      expect(urls).toEqual(
        destinations.map((destination) =>
          expect.objectContaining({
            attribute: "href",
            url:
              destination === null
                ? null
                : destination === ""
                  ? pageUrl
                  : `${origin}${destination}`,
            destination_scope:
              destination === null ? "outside_policy" : "approved",
          }),
        ),
      );
    },
    CHROME_TEST_TIMEOUT_MS,
  );
}

const pageTarget = async (
  provider: CdpBrowserProvider,
  endpoint: string,
  origin: string,
  pageUrl: string,
): Promise<string> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const listed = await provider.listTargets(
      listBrowserTargetsInputSchema.parse({
        cdp_endpoint: endpoint,
        allowed_origins: [origin],
      }),
    );
    if (!listed.ok) throw listed.error;
    const match = listed.value.targets.find((target) =>
      target.url.startsWith(pageUrl),
    );
    if (match !== undefined) return match.target_id;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Headless Chrome did not expose the SVG fixture page");
};
