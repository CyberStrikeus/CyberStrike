import { createServer } from "node:http";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { asarHeaderBytes } from "../../tests/fixtures/asarHeader.js";
import { CdpElectronProvider } from "./CdpElectronProvider.js";

it("lists only ASAR members with regular-file declarations while preserving unrelated metadata", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rea-asar-node-")));
  const archive = join(root, "app.asar");
  const files = {
    "empty.html": { size: 0, offset: "0" },
    "unpacked.html": { size: 1, unpacked: true },
    // Authorization does not interpret optional artifact-analysis metadata.
    "metadata.html": { size: 1, integrity: "uninterpreted", executable: null },
    "negative.html": { size: -1 },
    "fractional.html": { size: 0.5 },
    "unsafe.html": { size: Number.MAX_SAFE_INTEGER + 1 },
    "missing.html": {},
    "null.html": { size: null },
    "directory.html": { size: 0, files: {} },
    "symlink.html": { size: 0, link: "empty.html" },
    directory: {
      size: 0,
      files: { "nested.html": { size: 0, offset: "0" } },
    },
    linked: {
      link: "elsewhere",
      files: { "nested.html": { size: 0, offset: "0" } },
    },
    malformedLink: {
      link: null,
      files: { "nested.html": { size: 0, offset: "0" } },
    },
  };
  const names = [
    ...Object.keys(files),
    "directory/nested.html",
    "linked/nested.html",
    "malformedLink/nested.html",
  ];
  let endpoint = "";
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/json/version"
          ? {
              Browser: "Electron/fixture",
              "Protocol-Version": "1.3",
              "WebKit-Version": "revision",
              "User-Agent": "fixture",
              "V8-Version": "V8",
              webSocketDebuggerUrl:
                endpoint.replace("http:", "ws:") + "/devtools/browser/fixture",
            }
          : names.map((name) => ({
              id: name,
              type: "page",
              title: name,
              url: pathToFileURL(join(archive, name)).href,
              attached: false,
            })),
      ),
    );
  });
  const provider = new CdpElectronProvider();
  try {
    await writeFile(archive, asarHeaderBytes(JSON.stringify({ files })));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing port");
    endpoint = `http://127.0.0.1:${address.port}`;
    const result = await provider.listTargets({ cdp_endpoint: endpoint }, {});
    if (!result.ok) throw result.error;
    expect(result.value.targets.map(({ target_id }) => target_id)).toEqual([
      "directory/nested.html",
      "empty.html",
      "metadata.html",
      "unpacked.html",
    ]);
    expect(result.value.targets.map(({ file_path }) => file_path)).toEqual([
      join(archive, "directory", "nested.html"),
      join(archive, "empty.html"),
      join(archive, "metadata.html"),
      join(archive, "unpacked.html"),
    ]);
  } finally {
    await provider.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
    await rm(root, { recursive: true, force: true });
  }
});
