import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import {
  webPageInspectionSchema,
  type WebPageInspection,
} from "../../../src/domain/browserObservationSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { compareWebCaptures } from "../../../src/domain/webCaptureDiff.js";
import { compareWebCapturesInputSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

type ResourceMode =
  | "valid"
  | "missing"
  | "null"
  | "wrong-type"
  | "invalid-entry"
  | "child-missing"
  | "child-invalid-entry"
  | "child-wrong-type"
  | "empty";

const startBrowser = async () => {
  const state = {
    mode: "valid" as ResourceMode,
    peerFields: undefined as Record<string, unknown> | undefined,
  };
  const browser = await startFakeCdpBrowser({
    commandResult(command, origin) {
      const malformedChildren =
        state.mode === "child-invalid-entry" ||
        state.mode === "child-wrong-type";
      if (command.method === "Page.getFrameTree" && malformedChildren)
        return {
          frameTree: {
            frame: { id: "frame-main", url: origin + "/app" },
            childFrames:
              state.mode === "child-wrong-type"
                ? {}
                : [
                    {
                      frame: {
                        id: "child",
                        parentId: "frame-main",
                        url: origin + "/child",
                      },
                    },
                    null,
                  ],
          },
        };
      if (command.method !== "Page.getResourceTree") return undefined;
      const resource = (name: string) => ({
        url: origin + "/" + name,
        type: "Script",
        mimeType: "text/javascript",
        contentSize: 128,
        ...(name === "peer.js" ? state.peerFields : undefined),
      });
      let resources: unknown = [resource("keep.js"), resource("peer.js")];
      if (state.mode === "missing") resources = undefined;
      if (state.mode === "null") resources = null;
      if (state.mode === "wrong-type") resources = {};
      if (state.mode === "invalid-entry")
        resources = [resource("keep.js"), null];
      if (state.mode === "empty") resources = [];
      const malformedChildFrames =
        state.mode === "child-wrong-type"
          ? {}
          : state.mode === "child-invalid-entry"
            ? [
                {
                  frame: {
                    id: "child",
                    parentId: "frame-main",
                    url: origin + "/child",
                  },
                  resources: [resource("child.js")],
                },
                null,
              ]
            : undefined;
      return {
        frameTree: {
          frame: { id: "frame-main", url: origin + "/app" },
          resources,
          ...(malformedChildFrames === undefined
            ? {}
            : { childFrames: malformedChildFrames }),
          ...(state.mode === "child-missing"
            ? {
                childFrames: [
                  {
                    frame: {
                      id: "child",
                      parentId: "frame-main",
                      url: origin + "/child",
                    },
                  },
                ],
              }
            : {}),
        },
      };
    },
  });
  trackBrowser(browser);
  const inspect = async () => {
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    if (!result.ok) throw result.error;
    return result.value;
  };
  return {
    state,
    inspect,
    origin: browser.allowedOrigin,
    endpoint: browser.endpoint,
  };
};

const compareResources = (
  before: WebPageInspection,
  after: WebPageInspection,
) =>
  compareWebCaptures(
    compareWebCapturesInputSchema.parse({
      before: { inspection: before },
      after: { inspection: after },
    }),
  ).dimensions.resources;

describe("resource metadata through CDP", () => {
  it.each([
    { fields: { type: undefined }, retained: false },
    { fields: { type: null }, retained: false },
    { fields: { type: 17 }, retained: false },
    { fields: { type: "" }, retained: false },
    { fields: { mimeType: undefined }, retained: false },
    { fields: { mimeType: null }, retained: false },
    { fields: { mimeType: 17 }, retained: false },
    { fields: { contentSize: -1 }, retained: true },
    { fields: { contentSize: null }, retained: true },
    { fields: { contentSize: "128" }, retained: true },
  ])(
    "keeps malformed resource fields uncertain: $fields",
    async ({ fields, retained }) => {
      const { state, inspect, origin } = await startBrowser();
      const before = await inspect();
      state.peerFields = fields;
      const after = await inspect();
      for (const [left, right] of [
        [before, after],
        [after, before],
        [after, after],
      ] as const)
        expect(compareResources(left, right)).toMatchObject({
          status: "unknown",
          total_changes: 0,
          changes: [],
        });
      expect(after.completeness.excluded).toContainEqual({
        section: "resources",
        reason: "invalid_protocol_value",
        count: 1,
      });
      expect(after.resources.map(({ url }) => url).sort()).toEqual(
        retained
          ? [origin + "/keep.js", origin + "/peer.js"]
          : [origin + "/keep.js"],
      );
      if (retained)
        expect(
          after.resources.find(({ url }) => url.endsWith("/peer.js")),
        ).toMatchObject({
          type: "Script",
          mime_type: "text/javascript",
          content_size: null,
        });
    },
  );

  it.each([
    {
      fields: { type: "Other", mimeType: "", contentSize: undefined },
      size: null,
    },
    { fields: { contentSize: 0 }, size: 0 },
    { fields: { contentSize: 1.5 }, size: 1.5 },
  ])(
    "accepts valid optional and empty fields: $fields",
    async ({ fields, size }) => {
      const { state, inspect } = await startBrowser();
      state.peerFields = fields;
      const capture = await inspect();
      expect(capture.resources).toHaveLength(2);
      expect(
        capture.resources.find(({ url }) => url.endsWith("/peer.js"))
          ?.content_size,
      ).toBe(size);
      expect(capture.completeness.unavailable_sections).not.toContain(
        "resources",
      );
      // Omitted contentSize is valid metadata, but cannot prove equal resource size.
      expect(compareResources(capture, capture).status).toBe(
        size === null ? "unknown" : "unchanged",
      );
    },
  );
});

describe("resource inventory omissions through CDP", () => {
  it.each([
    "missing",
    "null",
    "wrong-type",
    "invalid-entry",
    "child-missing",
    "child-invalid-entry",
    "child-wrong-type",
  ] as const)(
    "does not claim a resource removal or equality for %s",
    async (mode) => {
      const { state, inspect, origin } = await startBrowser();
      const before = await inspect();
      expect(before.resources).toHaveLength(2);
      expect(before.completeness.unavailable_sections).not.toContain(
        "resources",
      );
      state.mode = mode;
      const after = await inspect();
      for (const [left, right] of [
        [before, after],
        [after, before],
        [after, after],
      ] as const)
        expect(compareResources(left, right)).toMatchObject({
          status: "unknown",
          total_changes: 0,
          changes: [],
        });
      expect(after.completeness.unavailable_sections).toContain("resources");
      expect(after.completeness.excluded).toContainEqual({
        section: "resources",
        reason: "invalid_protocol_value",
        count: mode === "invalid-entry" ? 1 : null,
      });
      if (mode === "child-invalid-entry" || mode === "child-wrong-type") {
        expect(after.completeness.excluded).toContainEqual({
          section: "frames",
          reason: "invalid_protocol_value",
          count: null,
        });
        expect(after.frames.map(({ frame_id }) => frame_id)).toContain(
          "frame-main",
        );
        if (mode === "child-invalid-entry")
          expect(after.frames.map(({ frame_id }) => frame_id)).toContain(
            "child",
          );
      }
      const expected =
        mode === "invalid-entry"
          ? [origin + "/keep.js"]
          : mode === "child-invalid-entry"
            ? [origin + "/child.js", origin + "/keep.js", origin + "/peer.js"]
            : mode === "child-missing"
              ? [origin + "/keep.js", origin + "/peer.js"]
              : mode === "child-wrong-type"
                ? [origin + "/keep.js", origin + "/peer.js"]
                : [];
      expect(after.resources.map(({ url }) => url).sort()).toEqual(expected);
    },
  );

  it("distinguishes a complete empty inventory from an unavailable collection", async () => {
    const { state, inspect } = await startBrowser();
    const before = await inspect();
    state.mode = "empty";
    const after = await inspect();
    expect(after.resources).toEqual([]);
    expect(after.completeness.unavailable_sections).not.toContain("resources");
    expect(compareResources(before, after)).toMatchObject({
      status: "changed",
      total_changes: 2,
      changes: [{ change: "removed" }, { change: "removed" }],
    });
    expect(compareResources(after, after).status).toBe("unchanged");
  });
});

describe("resource uncertainty in production MCP registration", () => {
  it("delivers partial resources and preserves comparison uncertainty through the SDK", async () => {
    const { state, origin, endpoint } = await startBrowser();
    const harness = await createApplicationMcpHarness({
      serverOptions: { browserObservation: new CdpBrowserProvider() },
    });
    onTestFinished(harness.close);
    const capture = async () => {
      const reply = await harness.client.callTool({
        name: "inspect_web_page",
        arguments: {
          cdp_endpoint: endpoint,
          allowed_origins: [origin],
          target_id: "allowed-page",
          observation_ms: 0,
        },
      });
      expect(reply.isError).not.toBe(true);
      expect(reply.structuredContent).toMatchObject({
        operation: "inspect_web_page",
      });
      return webPageInspectionSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
    };
    const expectedResource = (
      name: string,
      contentSize: number | null = 128,
    ) => ({
      resource_key: expect.any(String),
      url: `${origin}/${name}`,
      origin,
      type: "Script",
      mime_type: "text/javascript",
      content_size: contentSize,
    });
    const resourceExclusions = (inspection: WebPageInspection) =>
      inspection.completeness.excluded.filter(
        ({ section }) => section === "resources",
      );
    const before = await capture();
    expect(
      before.resources.toSorted((left, right) =>
        left.url.localeCompare(right.url),
      ),
    ).toEqual([expectedResource("keep.js"), expectedResource("peer.js")]);
    expect(before.completeness.unavailable_sections).not.toContain("resources");
    expect(resourceExclusions(before)).toEqual([]);
    for (const { mode, fields, resources, excludedCount } of [
      {
        mode: "missing",
        fields: undefined,
        resources: [],
        excludedCount: null,
      },
      {
        mode: "invalid-entry",
        fields: undefined,
        resources: [expectedResource("keep.js")],
        excludedCount: 1,
      },
      {
        mode: "valid",
        fields: { type: undefined },
        resources: [expectedResource("keep.js")],
        excludedCount: 1,
      },
      {
        mode: "valid",
        fields: { contentSize: -1 },
        resources: [
          expectedResource("keep.js"),
          expectedResource("peer.js", null),
        ],
        excludedCount: 1,
      },
      { mode: "empty", fields: undefined, resources: [], excludedCount: 0 },
    ] as const) {
      state.mode = mode;
      state.peerFields = fields;
      const after = await capture();
      expect(
        after.resources.toSorted((left, right) =>
          left.url.localeCompare(right.url),
        ),
      ).toEqual(resources);
      expect(resourceExclusions(after)).toEqual(
        mode === "empty"
          ? []
          : [
              {
                section: "resources",
                reason: "invalid_protocol_value",
                count: excludedCount,
              },
            ],
      );
      if (mode !== "empty")
        expect(after.completeness.unavailable_sections).toContain("resources");
      else
        expect(after.completeness.unavailable_sections).not.toContain(
          "resources",
        );
      for (const [left, right] of [
        [before, after],
        [after, before],
        [after, after],
      ] as const) {
        const reply = await harness.client.callTool({
          name: "compare_web_captures",
          arguments: {
            before: { inspection: left },
            after: { inspection: right },
          },
        });
        expect(reply.isError).not.toBe(true);
        expect(reply.structuredContent).toMatchObject({
          operation: "compare_web_captures",
          normalized_result: {
            dimensions: {
              resources: {
                status:
                  mode !== "empty"
                    ? "unknown"
                    : left === right
                      ? "unchanged"
                      : "changed",
                total_changes: mode === "empty" && left !== right ? 2 : 0,
              },
            },
          },
        });
      }
    }
  });
});

describe("resource uncertainty in public CLI Evidence", () => {
  cliTest(
    "preserves partial membership while complete inventories still prove removal",
    async ({ cli }) => {
      const { state, inspect } = await startBrowser();
      const root = await createTestTempDirectory("rea-resource-comparison-");
      const before = join(root, "before.json");
      const after = join(root, "after.json");
      await writeFile(before, JSON.stringify({ inspection: await inspect() }));
      for (const { mode, fields } of [
        { mode: "invalid-entry", fields: undefined },
        { mode: "valid", fields: { type: undefined } },
        { mode: "valid", fields: { contentSize: -1 } },
        { mode: "empty", fields: undefined },
      ] as const) {
        state.mode = mode;
        state.peerFields = fields;
        await writeFile(after, JSON.stringify({ inspection: await inspect() }));
        const cliResult = await cli.run({
          arguments: ["compare-web-captures", before, after, "--json"],
          environment: process.env,
        });
        expect(cliResult.exitCode).toBe(0);
        expect(cliResult.signal).toBeNull();
        expect(cliResult.json).toMatchObject({
          operation: "compare_web_captures",
          normalized_result: {
            dimensions: {
              resources: {
                status: mode === "empty" ? "changed" : "unknown",
                total_changes: mode === "empty" ? 2 : 0,
              },
            },
          },
        });
      }
    },
  );
});
