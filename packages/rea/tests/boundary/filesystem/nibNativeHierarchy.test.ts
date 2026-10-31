import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { xcodeIbtoolAvailable } from "../../fixtures/ibtool.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { decodeNibArchive } from "../../../src/artifacts/apple/NibArchive.js";
import { analyzeInterfaceBuilderBundle } from "../../../src/artifacts/apple/InterfaceBuilderAnalysis.js";

import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  createInterfaceBuilderUidFixture,
  expectInterfaceBuilderUidCase,
  interfaceBuilderUidCases,
} from "../../fixtures/interfaceBuilderMalformedUid.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const compile = promisify(execFile);

const compileNestedViews = async (
  depth: number,
  withWindow = false,
  withTextField = false,
) => {
  const root = await createTestTempDirectory("rea-nib-hierarchy-");
  const bundle = join(root, "Fixture.app");
  const resources = join(bundle, "Contents", "Resources");
  await mkdir(resources, { recursive: true });
  const source = await readFile(
    "tests/conformance/interface-builder/Main.xib",
    "utf8",
  );
  const nested =
    Array.from(
      { length: depth },
      (_, i) =>
        `<view id="nested-${i}" customClass="NSView"><rect key="frame" x="0" y="0" width="100" height="100"/><subviews>`,
    ).join("") + "</subviews></view>".repeat(depth);
  const xib = join(root, "Nested.xib");
  let xibSource = source.replace("</subviews>", `${nested}</subviews>`);
  if (withTextField)
    xibSource = xibSource.replace(
      "</subviews>",
      `<textField id="text"><rect key="frame" x="20" y="60" width="120" height="22"/><textFieldCell key="cell" title="Sample" id="text-cell"><font key="font" metaFont="system"/></textFieldCell></textField></subviews>`,
    );
  if (withWindow)
    xibSource = xibSource
      .replace(
        '<view id="view" customClass="NSView">',
        '<window title="Example" id="window"><windowStyleMask key="styleMask" titled="YES" closable="YES"/><rect key="contentRect" x="0" y="0" width="480" height="320"/><view key="contentView" id="view" customClass="NSView">',
      )
      .replace("</view>\n  </objects>", "</view></window>\n  </objects>");
  await writeFile(xib, xibSource);
  const nib = join(resources, "Main.nib");
  await compile("/usr/bin/xcrun", [
    "ibtool",
    "--errors",
    "--warnings",
    "--compile",
    nib,
    xib,
  ]);
  return { bundle, archive: decodeNibArchive(await readFile(nib)) };
};

describe.skipIf(!xcodeIbtoolAvailable)(
  "native compiled NIB view hierarchy",
  () => {
    it.each([4, 40])(
      "recovers every serialized superview link for %i nested views",
      async (depth) => {
        const { bundle, archive } = await compileNestedViews(depth);
        const result = await analyzeInterfaceBuilderBundle({
          bundlePath: bundle,
          targetSha256: "a".repeat(64),
        });
        const parents = archive.objects.flatMap(({ id, values }) => {
          const parent = values.NSSuperview;
          return typeof parent === "object" &&
            parent !== null &&
            !Array.isArray(parent) &&
            typeof parent.$nib_object_ref === "number"
            ? [{ child: String(id), parent: String(parent.$nib_object_ref) }]
            : [];
        });
        expect(parents).toHaveLength(depth + 1);
        for (const pair of parents) {
          const child = result.graph.nodes.find(
            ({ attributes }) =>
              attributes.interface_builder_object_id === pair.child,
          );
          const parent = result.graph.nodes.find(
            ({ attributes }) =>
              attributes.interface_builder_object_id === pair.parent,
          );
          expect(child).toBeDefined();
          expect(parent).toBeDefined();
          expect(
            result.graph.edges.some(
              ({ from, to, relation }) =>
                from === parent?.id &&
                to === child?.id &&
                relation === "contains",
            ),
          ).toBe(true);
        }
        expect(result.documents[0]?.hierarchy_complete).toBe(true);
        expect(result.graph.truncated).toBe(false);
      },
    );

    it("retains the native window-to-content-view relation alongside superview links", async () => {
      const { bundle, archive } = await compileNestedViews(4, true);
      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "c".repeat(64),
      });
      const window = archive.objects.find(
        ({ class_name }) => class_name === "NSWindowTemplate",
      );
      const content = window?.values.NSWindowView;
      if (
        window === undefined ||
        typeof content !== "object" ||
        content === null ||
        Array.isArray(content)
      )
        throw new Error("native window content link missing");
      const windowNode = result.graph.nodes.find(
        ({ attributes }) =>
          attributes.interface_builder_object_id === String(window.id),
      );
      const viewNode = result.graph.nodes.find(
        ({ attributes }) =>
          attributes.interface_builder_object_id ===
          String(content.$nib_object_ref),
      );
      expect(windowNode).toBeDefined();
      expect(viewNode).toBeDefined();
      expect(
        result.graph.edges.some(
          ({ from, to, relation }) =>
            from === windowNode?.id &&
            to === viewNode?.id &&
            relation === "contains",
        ),
      ).toBe(true);
      expect(result.documents[0]?.hierarchy_complete).toBe(true);
      expect(result.graph.truncated).toBe(false);
    });

    it("does not treat a compiled text field cell as an unplaced view", async () => {
      const { bundle, archive } = await compileNestedViews(0, true, true);
      const text = archive.objects.find(
        ({ class_name }) => class_name === "NSTextField",
      );
      const cell = archive.objects.find(
        ({ class_name }) => class_name === "NSTextFieldCell",
      );
      expect(text).toBeDefined();
      expect(cell).toBeDefined();
      expect(cell?.values.NSControlView).toEqual({ $nib_object_ref: text?.id });
      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "e".repeat(64),
      });
      expect(result.documents[0]?.hierarchy_complete).toBe(true);
      expect(result.graph.truncated).toBe(false);
      expect(result.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "hierarchy:Contents/Resources/Main.nib",
          status: "complete",
        }),
      );
    });

    it("reports partial coverage for a native hierarchy beyond the projection depth bound", async () => {
      const { bundle } = await compileNestedViews(132);
      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "d".repeat(64),
      });
      expect(result.documents[0]?.hierarchy_complete).toBe(false);
      expect(result.graph.truncated).toBe(true);
      expect(result.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "hierarchy:Contents/Resources/Main.nib",
          status: "partial",
          reason: "serialized_view_hierarchy_incomplete",
          omitted: expect.any(Number),
        }),
      );
      expect(
        result.graph.coverage.find(
          ({ facet }) => facet === "hierarchy:Contents/Resources/Main.nib",
        )?.omitted,
      ).toBeGreaterThan(0);
    });

    it.each([false, true])(
      "reports partial hierarchy at the object budget (window=%s)",
      async (withWindow) => {
        const { bundle } = await compileNestedViews(4, withWindow);
        const result = await analyzeInterfaceBuilderBundle({
          bundlePath: bundle,
          targetSha256: "b".repeat(64),
          limits: { max_objects: 2 },
        });
        expect(result.documents[0]?.hierarchy_complete).toBe(false);
        expect(result.graph.truncated).toBe(true);
        expect(result.graph.coverage).toContainEqual(
          expect.objectContaining({
            facet: "hierarchy:Contents/Resources/Main.nib",
            status: "partial",
          }),
        );
      },
    );
  },
);

// Selected by the existing native Apple CI job; no workflow change is needed.
describe.skipIf(process.platform !== "darwin")(
  "Foundation malformed hierarchy references",
  () => {
    it.each(interfaceBuilderUidCases)(
      "filesystem reports %s hierarchy coverage and original bytes",
      async (selectedCase) => {
        const fixture = await createInterfaceBuilderUidFixture(selectedCase);
        const result = await analyzeInterfaceBuilderBundle({
          bundlePath: fixture.app,
          targetSha256: "f".repeat(64),
        });
        expectInterfaceBuilderUidCase(
          result,
          selectedCase,
          fixture.bytes,
          fixture.oracle,
        );
      },
    );
    cliTest.for(interfaceBuilderUidCases)(
      "built CLI reports $0 hierarchy coverage and original bytes",
      async (selectedCase, { cli }) => {
        const fixture = await createInterfaceBuilderUidFixture(selectedCase);
        const output = await cli.run({
          arguments: ["decode-interface-builder", fixture.app, "--json"],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        expect(output.exitCode, JSON.stringify(output)).toBe(0);
        const result = interfaceBuilderAnalysisSchema.parse(
          parseEvidence(output.json).normalized_result,
        );
        expectInterfaceBuilderUidCase(
          result,
          selectedCase,
          fixture.bytes,
          fixture.oracle,
        );
      },
    );
  },
);
