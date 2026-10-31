import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { electronPageInspectionSchema } from "../../../src/domain/javascript/electronObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "Electron resource sizes preserve unknown values and invalid-metadata coverage",
  async ({ cli, onTestFinished }) => {
    const root = await createTestTempDirectory("rea-electron-resource-sizes-");
    const main = join(root, "index.html");
    await writeFile(main, "<html/>");
    const sizes = [-1, 0, 128, undefined, "4", null];
    const resources: Array<{
      url: string;
      type: string;
      mimeType: string;
      contentSize?: unknown;
    }> = [];
    for (const [index, contentSize] of sizes.entries()) {
      const path = join(root, `resource-${index}.js`);
      await writeFile(path, "fixture");
      resources.push({
        url: pathToFileURL(path).href,
        type: "Script",
        mimeType: "text/javascript",
        ...(contentSize === undefined ? {} : { contentSize }),
      });
    }
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(main).href,
      commandResult: ({ method }) =>
        method === "Page.getResourceTree"
          ? {
              frameTree: {
                frame: { id: "main", url: pathToFileURL(main).href },
                resources,
              },
            }
          : undefined,
    });
    onTestFinished(() => browser.close());
    const output = await cli.run({
      arguments: [
        "inspect-electron-page",
        browser.endpoint,
        "electron-page",
        "--observation-ms",
        "0",
        "--json",
      ],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const inspection = electronPageInspectionSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(inspection.resources).toHaveLength(6);
    const byPath = new Map(
      inspection.resources.map((item) => [item.file_path, item]),
    );
    expect(
      sizes.map(
        (_size, index) =>
          byPath.get(join(root, `resource-${index}.js`))?.content_size,
      ),
    ).toEqual([null, 0, 128, null, null, null]);
    expect(
      inspection.resources.every(
        (item) =>
          item.type === "Script" && item.mime_type === "text/javascript",
      ),
    ).toBe(true);
    expect(inspection.completeness.excluded).toContainEqual({
      section: "resources",
      reason: "invalid_protocol_value",
      count: 3,
    });
    expect(
      browser.commands.filter(
        ({ method }) => method === "Target.detachFromTarget",
      ),
    ).toHaveLength(1);
  },
);
