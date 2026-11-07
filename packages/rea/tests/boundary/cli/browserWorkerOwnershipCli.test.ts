import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, expect } from "vitest";

import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { electronPageInspectionSchema } from "../../../src/domain/javascript/electronObservation.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const browsers: FakeCdpBrowser[] = [];
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(browsers.splice(0).map(async (browser) => browser.close()));
  await Promise.all(
    temporary
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

const normalizedResult = (value: unknown): unknown => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("normalized_result" in value)
  )
    throw new Error("Expected CLI Evidence");
  return value.normalized_result;
};

cliTest(
  "keeps missing worker ownership unknown through inspect-web-page",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser({
      commandResult: ({ method }, origin) => {
        if (method !== "Target.getTargets") return undefined;
        const worker = {
          type: "worker",
          title: "Fixture",
          attached: false,
          canAccessOpener: false,
          url: `${origin}/worker.js`,
        };
        return {
          targetInfos: [
            { ...worker, targetId: "related-opener", openerId: "allowed-page" },
            {
              ...worker,
              targetId: "related-parent",
              parentFrameId: "frame-main",
            },
            { ...worker, targetId: "withheld-unknown" },
            { ...worker, targetId: "withheld-empty-url", url: "" },
            { ...worker, targetId: "withheld-foreign", openerId: "other-page" },
            {
              ...worker,
              targetId: "withheld-foreign-parent",
              parentFrameId: "other-frame",
            },
            { ...worker, targetId: "withheld-invalid", openerId: null },
            {
              ...worker,
              targetId: "withheld-disallowed",
              openerId: "allowed-page",
              url: "https://foreign.test/worker.js",
            },
          ],
        };
      },
    });
    browsers.push(browser);
    const evidenceInvocation = await cli.run({
      arguments: [
        "inspect-web-page",
        browser.endpoint,
        "allowed-page",
        "--observation-ms",
        "0",
        "--json",
      ],
      environment: process.env,
    });
    expect(evidenceInvocation.exitCode, evidenceInvocation.stderr).toBe(0);
    expect(evidenceInvocation.signal).toBeNull();
    const evidence = evidenceInvocation.json;
    expect(evidence).toMatchObject({
      operation: "inspect_web_page",
      provider: { id: "rea-cdp-browser" },
    });
    const inspection = webPageInspectionSchema.parse(
      normalizedResult(evidence),
    );
    expect(inspection.workers).toEqual([
      expect.objectContaining({
        target_id: "related-opener",
        opener_target_id: "allowed-page",
        parent_frame_id: null,
      }),
      expect.objectContaining({
        target_id: "related-parent",
        opener_target_id: null,
        parent_frame_id: "frame-main",
      }),
    ]);
    expect(inspection.completeness.unavailable_sections).toContain("workers");
    expect(
      inspection.completeness.excluded.filter(
        ({ section }) => section === "workers",
      ),
    ).toEqual([
      { section: "workers", reason: "disallowed_origin", count: 1 },
      { section: "workers", reason: "invalid_protocol_value", count: 1 },
      { section: "workers", reason: "out_of_target_scope", count: 2 },
      { section: "workers", reason: "unattributed_target", count: 2 },
    ]);
    expect(JSON.stringify(evidence)).not.toContain("withheld-");
    expect(
      browser.commands.some(
        ({ method }) => method === "Target.detachFromTarget",
      ),
    ).toBe(true);
  },
  20_000,
);

cliTest(
  "uses the same ownership facts for passive Electron worker inspection",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-worker-ownership-");
    temporary.push(root);
    await writeFile(join(root, "index.html"), "<html></html>");
    await writeFile(join(root, "worker.js"), "void 0;");
    const browser = await startFakeCdpBrowser({
      electronFileUrl: pathToFileURL(join(root, "index.html")).href,
      commandResult: ({ method }) => {
        if (method !== "Target.getTargets") return undefined;
        const worker = {
          type: "worker",
          title: "Fixture",
          attached: false,
          canAccessOpener: false,
          url: pathToFileURL(join(root, "worker.js")).href,
        };
        return {
          targetInfos: [
            { ...worker, targetId: "related", openerId: "electron-page" },
            { ...worker, targetId: "withheld-unknown" },
            { ...worker, targetId: "withheld-empty-url", url: "" },
            { ...worker, targetId: "withheld-foreign", openerId: "other-page" },
            { ...worker, targetId: "withheld-invalid", parentFrameId: 42 },
          ],
        };
      },
    });
    browsers.push(browser);
    const evidenceInvocation = await cli.run({
      arguments: [
        "inspect-electron-page",
        browser.endpoint,
        "electron-page",
        "--observation-ms",
        "0",
        "--json",
      ],
      environment: process.env,
    });
    expect(evidenceInvocation.exitCode, evidenceInvocation.stderr).toBe(0);
    expect(evidenceInvocation.signal).toBeNull();
    const evidence = evidenceInvocation.json;
    expect(evidence).toMatchObject({
      operation: "inspect_electron_page",
      provider: { id: "rea-cdp-electron" },
    });
    const inspection = electronPageInspectionSchema.parse(
      normalizedResult(evidence),
    );
    expect(inspection.workers).toEqual([
      expect.objectContaining({
        target_id: "related",
        opener_target_id: "electron-page",
        parent_frame_id: null,
      }),
    ]);
    expect(inspection.completeness.unavailable_sections).toContain("workers");
    expect(
      inspection.completeness.excluded.filter(
        ({ section }) => section === "workers",
      ),
    ).toEqual([
      { section: "workers", reason: "invalid_protocol_value", count: 1 },
      { section: "workers", reason: "out_of_target_scope", count: 1 },
      { section: "workers", reason: "unattributed_target", count: 2 },
    ]);
    expect(JSON.stringify(evidence)).not.toContain("withheld-");
    expect(
      browser.commands.some(
        ({ method }) => method === "Target.detachFromTarget",
      ),
    ).toBe(true);
  },
  20_000,
);
