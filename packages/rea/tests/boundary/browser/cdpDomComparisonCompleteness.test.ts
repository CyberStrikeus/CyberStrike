import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import type { WebPageInspection } from "../../../src/domain/browserObservationSchemas.js";
import { compareWebCaptures } from "../../../src/domain/webCaptureDiff.js";
import { compareWebCapturesInputSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

type SnapshotMode =
  | "valid"
  | "omitted-node"
  | "changed-node"
  | "missing-nodes"
  | "null-nodes"
  | "missing-documents"
  | "invalid-documents"
  | "empty-documents"
  | "invalid-document"
  | "mixed-documents"
  | "missing-strings";

const snapshot = (origin: string, mode: SnapshotMode) => {
  const document = {
    documentURL: 0,
    nodes: {
      nodeType: [9, 1],
      nodeName: [1, mode === "changed-node" ? 6 : 3],
      nodeValue: [2, 2],
      parentIndex: [-1, 0],
      attributes: [[], mode === "omitted-node" ? null : [4, 5]],
    },
  };
  let documents: unknown = [document];
  if (mode === "missing-nodes") documents = [{ documentURL: 0 }];
  if (mode === "null-nodes") documents = [{ documentURL: 0, nodes: null }];
  if (mode === "missing-documents") documents = undefined;
  if (mode === "invalid-documents") documents = {};
  if (mode === "empty-documents") documents = [];
  if (mode === "invalid-document") documents = [null];
  if (mode === "mixed-documents") documents = [document, null];
  return {
    strings:
      mode === "missing-strings"
        ? undefined
        : [origin + "/app", "#document", "", "A", "href", "/target", "SPAN"],
    documents,
  };
};

const startBrowser = async () => {
  const state = {
    mode: "valid" as SnapshotMode,
    nested: false,
    renamed: false,
    parentOverride: undefined as { value: unknown } | undefined,
  };
  const browser = await startFakeCdpBrowser({
    commandResult(command, origin) {
      if (command.method === "DOMSnapshot.captureSnapshot")
        return snapshot(origin, state.mode);
      if (command.method !== "Page.getFrameTree") return undefined;
      const id = (name: string) => (state.renamed ? "new-" + name : name);
      const child = {
        frame: {
          id: id("b"),
          parentId:
            state.parentOverride === undefined
              ? id(state.nested ? "a" : "main")
              : state.parentOverride.value,
          loaderId: "loader-b",
          url: origin + "/b",
        },
      };
      const parent = {
        frame: {
          id: id("a"),
          parentId: id("main"),
          loaderId: "loader-a",
          url: origin + "/a",
        },
        childFrames: state.nested ? [child] : [],
      };
      return {
        frameTree: {
          frame: {
            id: id("main"),
            loaderId: "loader-main",
            url: origin + "/app",
          },
          childFrames: state.nested ? [parent] : [parent, child],
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
  return { state, inspect };
};

const compare = (before: WebPageInspection, after: WebPageInspection) =>
  compareWebCaptures(
    compareWebCapturesInputSchema.parse({
      before: { inspection: before },
      after: { inspection: after },
    }),
  );

describe("DOM protocol omissions at the production capture boundary", () => {
  it.each([
    "missing-nodes",
    "null-nodes",
    "missing-documents",
    "invalid-documents",
    "empty-documents",
    "invalid-document",
    "mixed-documents",
    "missing-strings",
  ] as const)("retains unknown coverage for %s", async (mode) => {
    const { state, inspect } = await startBrowser();
    state.mode = mode;
    const capture = await inspect();
    for (const section of ["dom", "metadata"])
      expect(capture.completeness.unavailable_sections).toContain(section);
    if (mode === "mixed-documents") {
      expect(capture.dom.nodes.map(({ node_name }) => node_name)).toEqual([
        "#document",
        "A",
      ]);
      expect(capture.metadata.dom_urls).toHaveLength(1);
    }
    const comparison = compare(capture, capture);
    expect(comparison.dimensions.dom_structure.status).toBe("unknown");
    expect(comparison.dimensions.metadata.status).toBe("unknown");
  });

  it("does not turn a rejected node and its URL into a page change", async () => {
    const { state, inspect } = await startBrowser();
    const valid = await inspect();
    state.mode = "omitted-node";
    const partial = await inspect();
    expect(partial.dom.total_nodes).toBe(2);
    expect(partial.dom.nodes).toHaveLength(1);
    for (const [before, after] of [
      [valid, partial],
      [partial, valid],
    ]) {
      if (before === undefined || after === undefined)
        throw new Error("Missing pair");
      const comparison = compare(before, after);
      expect(comparison.dimensions.dom_structure.status).toBe("unknown");
      expect(comparison.dimensions.metadata.status).toBe("unknown");
      expect(comparison.overall_status).toBe("unknown");
    }
  });
});

describe("complete frame and DOM comparison", () => {
  it.each([undefined, null, 17, ""])(
    "keeps missing or invalid child parent evidence unknown (%#)",
    async (parent) => {
      const { state, inspect } = await startBrowser();
      const before = await inspect();
      state.parentOverride = { value: parent };
      const after = await inspect();
      expect(after.frames).toHaveLength(3);
      expect(after.completeness.unavailable_sections).toContain("frames");
      expect(compare(before, after).dimensions.dom_structure.status).toBe(
        "unknown",
      );
      expect(compare(after, after).dimensions.dom_structure.status).toBe(
        "unknown",
      );
    },
  );
  it("retains a complete observed node change", async () => {
    const { state, inspect } = await startBrowser();
    const before = await inspect();
    expect(compare(before, before).dimensions.dom_structure.status).toBe(
      "unchanged",
    );
    state.mode = "changed-node";
    expect(
      compare(before, await inspect()).dimensions.dom_structure.status,
    ).toBe("changed");
  });

  it("compares frame ancestry independently of volatile IDs", async () => {
    const { state, inspect } = await startBrowser();
    const before = await inspect();
    state.renamed = true;
    expect(
      compare(before, await inspect()).dimensions.dom_structure.status,
    ).toBe("unchanged");
    state.nested = true;
    const nested = await inspect();
    expect(nested.frames[2]?.parent_frame_id).toBe("new-a");
    expect(compare(before, nested).dimensions.dom_structure.status).toBe(
      "changed",
    );
  });

  it("retains proven frame changes when DOM node evidence is incomplete", async () => {
    const { state, inspect } = await startBrowser();
    const before = await inspect();
    state.mode = "omitted-node";
    state.nested = true;
    const comparison = compare(before, await inspect());
    expect(comparison.dimensions.dom_structure.status).toBe("changed");
    expect(comparison.dimensions.metadata.status).toBe("unknown");
  });
});

describe("DOM evidence through the public CLI", () => {
  cliTest(
    "preserves omissions and independently proven frame changes",
    async ({ cli }) => {
      const { state, inspect } = await startBrowser();
      const root = await createTestTempDirectory("rea-dom-comparison-");
      const before = join(root, "before.json");
      const after = join(root, "after.json");
      await writeFile(before, JSON.stringify({ inspection: await inspect() }));
      state.mode = "omitted-node";
      for (const nested of [false, true]) {
        state.nested = nested;
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
            overall_status: nested ? "changed" : "unknown",
            dimensions: {
              dom_structure: { status: nested ? "changed" : "unknown" },
              metadata: { status: "unknown" },
            },
          },
        });
      }
      state.mode = "missing-nodes";
      await writeFile(after, JSON.stringify({ inspection: await inspect() }));
      const cliResult = await cli.run({
        arguments: ["compare-web-captures", after, after, "--json"],
        environment: process.env,
      });
      expect(cliResult.exitCode).toBe(0);
      expect(cliResult.signal).toBeNull();
      expect(cliResult.json).toMatchObject({
        operation: "compare_web_captures",
        normalized_result: {
          overall_status: "unknown",
          dimensions: { dom_structure: { status: "unknown" } },
        },
      });
    },
  );
});
