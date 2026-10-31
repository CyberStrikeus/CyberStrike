import { describe, expect, it } from "vitest";

import {
  captureAccessibility,
  captureDom,
  captureFrames,
  captureResources,
  cdpFrameUrl,
  classifyCdpFrameUrl,
  observeCdpFrameUrl,
} from "./CdpCaptureDocuments.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import { inspectWebPageInputSchema } from "../domain/browserObservation.js";

const origin = "https://app.example.test";

it.each([
  [{ url: `${origin}/page?x=1#old` }, `${origin}/page?x=1#old`],
  [
    { url: `${origin}/page?x=1#old`, urlFragment: "#new" },
    `${origin}/page?x=1#new`,
  ],
  [{ url: `${origin}/page?x=1#old`, urlFragment: "" }, `${origin}/page?x=1`],
  [{ url: `${origin}/page`, urlFragment: null }, undefined],
  [{ url: `${origin}/page`, urlFragment: "missing-hash" }, undefined],
])("preserves frame URL fragment semantics: %j", (frame, expected) => {
  expect(cdpFrameUrl(frame)).toBe(expected);
});

it("keeps source identity and scope independent while redacting transport credentials", () => {
  const frame = {
    url: "https://user:password@app.example.test/page?token=local#old",
    urlFragment: "#new",
  };
  const allowed = new Set([origin]);
  expect(classifyCdpFrameUrl(observeCdpFrameUrl(frame), allowed)).toEqual({
    scope: "approved",
    origin,
    url: `${origin}/page?token=local#new`,
  });
  expect(
    classifyCdpFrameUrl(
      observeCdpFrameUrl({ ...frame, urlFragment: 7 }),
      allowed,
    ),
  ).toEqual({
    scope: "approved",
    origin,
    url: undefined,
  });
  expect(
    classifyCdpFrameUrl(
      observeCdpFrameUrl({ urlFragment: "#https://app.example.test" }),
      allowed,
    ),
  ).toEqual({
    scope: "unknown",
    origin: null,
    url: undefined,
  });
});

it("does not authorize a foreign origin through its fragment", () => {
  const completeness = new CdpCaptureCompleteness();
  const captured = captureFrames(
    {
      frameTree: {
        frame: {
          id: "foreign",
          url: "https://foreign.test/page",
          urlFragment: `#${origin}`,
        },
      },
    },
    new Set([origin]),
    undefined,
    completeness,
  );
  expect(captured.items).toEqual([]);
  expect(completeness.snapshot().policy_filtered_sections).toContain("frames");
});

it("classifies a malformed frame fragment as unknown protocol coverage", () => {
  const completeness = new CdpCaptureCompleteness();
  const captured = captureFrames(
    { frameTree: { frame: { id: "frame-main", url: origin, urlFragment: 7 } } },
    new Set([origin]),
    undefined,
    completeness,
  );
  expect(captured.items).toEqual([]);
  expect(completeness.snapshot()).toMatchObject({
    unavailable_sections: ["frames"],
    policy_filtered_sections: [],
  });
});

describe("CDP DOM capture", () => {
  it("preserves node names and parents when aligned arrays are valid", () => {
    const generator = captureDom(
      {
        strings: [origin + "/app", "#document", "DIV", "SPAN", ""],
        documents: [
          {
            documentURL: 0,
            baseURL: 0,
            nodes: {
              nodeType: [9, 1, 1],
              nodeName: [1, 2, 3],
              nodeValue: [4, 4, 4],
              parentIndex: [-1, 0, 1],
              attributes: [[], [], []],
            },
          },
        ],
      },
      new Set([origin]),
      inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        allowed_origins: [origin],
        target_id: "page-1",
      }),
    );
    let captured = generator.next([]);
    while (!captured.done) captured = generator.next([]);
    expect(captured.value.nodes.map((node) => node.node_name)).toEqual([
      "#document",
      "DIV",
      "SPAN",
    ]);
    expect(captured.value.nodes.map((node) => node.parent_index)).toEqual([
      -1, 0, 1,
    ]);
    expect(captured.value.nodes.map((node) => node.node_value_length)).toEqual([
      0, 0, 0,
    ]);
  });

  it.each(["nodeName", "parentIndex", "nodeValue", "attributes"] as const)(
    "preserves DOM fact positions and reports malformed %s entries",
    (field) => {
      const strings = [
        origin + "/app",
        "#document",
        "DIV",
        "SPAN",
        "href",
        "title",
        "/page",
      ];
      const nodeArrays: Record<string, unknown> = {
        nodeType: [9, 1, 1],
        nodeName: [1, 2, 3],
        nodeValue: [0, 0, 0],
        parentIndex: [-1, 0, 1],
        attributes: [[], [], []],
      };
      if (field === "nodeName") nodeArrays.nodeName = [1, "malformed", 3];
      if (field === "parentIndex")
        nodeArrays.parentIndex = [-1, "malformed", 1];
      if (field === "nodeValue") nodeArrays.nodeValue = [0, 0, "malformed"];
      if (field === "attributes")
        nodeArrays.attributes = [[], [4, "malformed", 5, 6], []];
      const completeness = new CdpCaptureCompleteness();
      const generator = captureDom(
        {
          strings,
          documents: [
            {
              documentURL: 0,
              baseURL: 0,
              nodes: nodeArrays,
            },
          ],
        },
        new Set([origin]),
        inspectWebPageInputSchema.parse({
          cdp_endpoint: "http://127.0.0.1:9222",
          allowed_origins: [origin],
          target_id: "page-1",
        }),
        completeness,
      );
      let captured = generator.next([]);
      while (!captured.done) captured = generator.next([]);
      expect(captured.value.total).toBe(3);
      expect(captured.value.nodes.map((node) => node.node_name)).toEqual(
        field === "nodeValue" ? ["#document", "DIV"] : ["#document", "SPAN"],
      );
      expect(captured.value.nodes.map((node) => node.index)).toEqual(
        field === "nodeValue" ? [0, 1] : [0, 2],
      );
      expect(captured.value.nodes.map((node) => node.parent_index)).toEqual(
        field === "nodeValue" ? [-1, 0] : [-1, 1],
      );
      if (field === "attributes") {
        expect(
          captured.value.nodes.map((node) => node.attribute_names),
        ).toEqual([[], []]);
        expect(captured.value.urls).toEqual([]);
      }
      expect(completeness.snapshot()).toMatchObject({
        unavailable_sections: expect.arrayContaining(["dom"]),
        excluded: expect.arrayContaining([
          { section: "dom", reason: "invalid_protocol_value", count: 1 },
        ]),
      });
    },
  );
});

describe("CDP DOM string and namespace validity", () => {
  it.each([
    { field: "nodeName", index: -1 },
    { field: "nodeName", index: 20 },
    { field: "nodeName", index: 2, malformedString: true },
    { field: "nodeValue", index: -2 },
    { field: "nodeValue", index: 20 },
    { field: "nodeValue", index: 5, malformedString: true },
    { field: "attributeName", index: -1 },
    { field: "attributeName", index: 20 },
    { field: "attributeValue", index: -2 },
    { field: "attributeValue", index: 20 },
  ] as const)(
    // -1 is DOMSnapshot's empty string for values, never for names.
    "omits a node when its $field string index is invalid ($index)",
    ({
      field,
      index,
      malformedString,
    }: {
      readonly field:
        | "nodeName"
        | "nodeValue"
        | "attributeName"
        | "attributeValue";
      readonly index: number;
      readonly malformedString?: boolean;
    }) => {
      const strings: unknown[] = [
        origin + "/app",
        "#document",
        "DIV",
        "SPAN",
        "href",
        "/good",
      ];
      const nodeArrays: Record<string, unknown> = {
        nodeType: [9, 1, 1],
        nodeName: [1, 2, 3],
        nodeValue: [0, 0, 0],
        parentIndex: [-1, 0, 0],
        attributes: [[], [], []],
      };
      if (field === "nodeName") nodeArrays.nodeName = [1, index, 3];
      if (field === "nodeValue") nodeArrays.nodeValue = [0, index, 0];
      if (field === "attributeName")
        nodeArrays.attributes = [[], [index, 5], []];
      if (field === "attributeValue")
        nodeArrays.attributes = [[], [4, index], []];
      if (malformedString === true) strings[index === 2 ? 2 : 5] = 42;
      const completeness = new CdpCaptureCompleteness();
      const generator = captureDom(
        {
          strings,
          documents: [
            {
              documentURL: 0,
              baseURL: 0,
              nodes: nodeArrays,
            },
          ],
        },
        new Set([origin]),
        inspectWebPageInputSchema.parse({
          cdp_endpoint: "http://127.0.0.1:9222",
          allowed_origins: [origin],
          target_id: "page-1",
        }),
        completeness,
      );
      let captured = generator.next([]);
      while (!captured.done) captured = generator.next([]);

      expect(captured.value.total).toBe(3);
      expect(captured.value.nodes.map((node) => node.index)).toEqual([0, 2]);
      expect(captured.value.nodes.map((node) => node.node_name)).toEqual([
        "#document",
        "SPAN",
      ]);
      expect(completeness.snapshot().excluded).toContainEqual({
        section: "dom",
        reason: "invalid_protocol_value",
        count: 1,
      });
    },
  );

  it("does not infer SVG ancestry through an element with malformed namespace data", () => {
    const strings: unknown[] = [
      origin + "/app",
      "#document",
      "svg",
      "a",
      "xmlns:xlink",
      "http://www.w3.org/1999/xlink",
      "xlink:href",
      "/svg-link",
    ];
    const completeness = new CdpCaptureCompleteness();
    const generator = captureDom(
      {
        strings,
        documents: [
          {
            documentURL: 0,
            baseURL: 0,
            nodes: {
              nodeType: [9, 1, 1],
              nodeName: [1, 2, 3],
              nodeValue: [0, 0, 0],
              parentIndex: [-1, 0, 1],
              attributes: [[], [4, 99], [6, 7]],
            },
          },
        ],
      },
      new Set([origin]),
      inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        allowed_origins: [origin],
        target_id: "page-1",
      }),
      completeness,
    );
    let captured = generator.next([]);
    while (!captured.done) captured = generator.next([]);

    expect(captured.value.nodes.map((node) => node.index)).toEqual([0, 2]);
    expect(captured.value.nodes[1]?.attribute_names).toEqual(["xlink:href"]);
    expect(captured.value.urls).toEqual([]);
    expect(
      completeness
        .snapshot()
        .excluded.some(
          ({ section, reason }) =>
            section === "metadata" && reason === "invalid_protocol_value",
        ),
    ).toBe(true);
  });
});

describe("CDP frame capture", () => {
  it("walks deeply nested frame trees and returns every frame and resource", () => {
    let frameTree: Record<string, unknown> = {
      frame: { id: "frame-0", url: `${origin}/0` },
      resources: [
        { url: `${origin}/0.js`, type: "Script", mimeType: "text/javascript" },
      ],
    };
    for (let index = 1; index < 2_000; index += 1) {
      frameTree = {
        frame: {
          id: `frame-${String(index)}`,
          url: `${origin}/${String(index)}`,
        },
        resources: [
          {
            url: `${origin}/${String(index)}.js`,
            type: "Script",
            mimeType: "text/javascript",
          },
        ],
        childFrames: [frameTree],
      };
    }
    const result = { frameTree };
    const frames = captureFrames(result, new Set([origin]));
    const resources = captureResources(result, new Set([origin]));
    expect(frames.items).toHaveLength(2_000);
    expect(resources.items).toHaveLength(2_000);
  });
});

describe("CDP accessibility inventory and identity", () => {
  it("keeps an explicit empty accessibility inventory complete", () => {
    const completeness = new CdpCaptureCompleteness();
    const capture = captureAccessibility([{ nodes: [] }], {
      includeText: true,
      completeness,
    });

    expect(capture).toMatchObject({
      total: 0,
      nodes: [],
      hasUnobservedChildren: false,
    });
    expect(completeness.snapshot()).toMatchObject({
      unavailable_sections: [],
      excluded: [],
    });
  });

  it.each([undefined, { length: 1 }])(
    "keeps an omitted or non-array node inventory unknown: %s",
    (nodes) => {
      const completeness = new CdpCaptureCompleteness();
      const capture = captureAccessibility([{ nodes }], {
        includeText: true,
        completeness,
      });

      expect(capture).toMatchObject({
        total: 0,
        nodes: [],
        hasUnobservedChildren: false,
      });
      expect(completeness.snapshot()).toMatchObject({
        unavailable_sections: ["accessibility"],
        excluded: [
          {
            section: "accessibility",
            reason: "invalid_protocol_value",
            count: null,
          },
        ],
      });
    },
  );

  it("retains valid nodes and counts malformed inventory entries", () => {
    const completeness = new CdpCaptureCompleteness();
    const capture = captureAccessibility(
      [
        {
          nodes: [
            null,
            {},
            { nodeId: "missing-ignored" },
            { nodeId: "invalid-ignored", ignored: "false" },
            { nodeId: "invalid-parent", ignored: false, parentId: 3 },
            { nodeId: "invalid-children", ignored: false, childIds: "bad" },
            { nodeId: "node-1", ignored: false, role: { value: "button" } },
            "malformed",
          ],
        },
      ],
      { includeText: true, completeness },
    );

    expect(capture.total).toBe(3);
    expect(capture.nodes.map((node) => node.node_id)).toEqual([
      "invalid-parent",
      "invalid-children",
      "node-1",
    ]);
    expect(capture.nodes[2]).toMatchObject({ role: "button", ignored: false });
    expect(completeness.snapshot()).toMatchObject({
      unavailable_sections: ["accessibility"],
      excluded: [
        {
          section: "accessibility",
          reason: "invalid_protocol_value",
          count: 7,
        },
      ],
    });
  });

  it("shares admitted identities between projection and child coverage", () => {
    const completeness = new CdpCaptureCompleteness();
    const capture = captureAccessibility(
      [
        {
          nodes: [
            {
              nodeId: "parent",
              ignored: false,
              parentId: "",
              childIds: ["", 3, "child", "missing"],
            },
            { nodeId: "child", ignored: false, parentId: "parent" },
          ],
        },
      ],
      { includeText: true, completeness },
    );

    expect(
      capture.nodes.map(({ node_id, parent_id }) => ({ node_id, parent_id })),
    ).toEqual([
      { node_id: "parent", parent_id: null },
      { node_id: "child", parent_id: "parent" },
    ]);
    expect(capture.hasUnobservedChildren).toBe(true);
    expect(completeness.snapshot().excluded).toEqual([
      { section: "accessibility", reason: "invalid_protocol_value", count: 2 },
    ]);
    const observed = captureAccessibility(
      [
        {
          nodes: [
            { nodeId: "parent", ignored: false, childIds: ["", null, "child"] },
            { nodeId: "child", ignored: false },
          ],
        },
      ],
      { includeText: true },
    );
    expect(observed.hasUnobservedChildren).toBe(false);
  });
});

describe("CDP accessibility text capture", () => {
  it("retains full approved accessibility text", () => {
    const capture = captureAccessibility(
      [
        {
          nodes: [
            {
              nodeId: "node-1",
              ignored: false,
              role: { value: "button" },
              name: { value: "😀a" },
              description: { value: "éé" },
              childIds: ["missing-child"],
              properties: [
                { name: "disabled", value: { value: true } },
                { name: "valuetext", value: { value: "private value" } },
              ],
            },
          ],
        },
      ],
      {
        includeText: true,
      },
    );

    expect(capture.nodes[0]).toMatchObject({
      name: "😀a",
      description: "éé",
      states: [{ name: "disabled", value: true }],
    });
    expect(capture.hasUnobservedChildren).toBe(true);
    expect(capture.textCapture).toEqual({
      status: "included",
      retained_bytes: 9,
      excluded_fields: 0,
    });
  });

  it("counts accessibility fields omitted without text approval", () => {
    const capture = captureAccessibility(
      [
        {
          nodes: [
            {
              nodeId: "node-1",
              ignored: false,
              name: { value: "private name" },
              description: { value: "private description" },
            },
          ],
        },
      ],
      {
        includeText: false,
      },
    );

    expect(capture.nodes[0]).toMatchObject({ name: null, description: null });
    expect(capture.textCapture).toEqual({
      status: "not_approved",
      retained_bytes: 0,
      excluded_fields: 2,
    });
  });
});

describe("CDP DOM snapshot empty strings", () => {
  it("reads Chrome's -1 string index as an empty node or attribute value", () => {
    const completeness = new CdpCaptureCompleteness();
    const generator = captureDom(
      {
        strings: [
          origin + "/app",
          "#document",
          "A",
          "href",
          "hidden",
          "#text",
          "go",
        ],
        documents: [
          {
            documentURL: 0,
            baseURL: -1,
            nodes: {
              nodeType: [9, 1, 3],
              nodeName: [1, 2, 5],
              nodeValue: [-1, -1, 6],
              parentIndex: [-1, 0, 1],
              attributes: [[], [3, -1, 4, -1], []],
            },
          },
        ],
      },
      new Set([origin]),
      inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        allowed_origins: [origin],
        target_id: "page-1",
      }),
      completeness,
    );
    let captured = generator.next([]);
    while (!captured.done) captured = generator.next([]);
    expect(
      captured.value.nodes.map(
        ({ node_name, node_value_length, attribute_names }) => ({
          node_name,
          node_value_length,
          attribute_names,
        }),
      ),
    ).toEqual([
      { node_name: "#document", node_value_length: 0, attribute_names: [] },
      {
        node_name: "A",
        node_value_length: 0,
        attribute_names: ["href", "hidden"],
      },
      { node_name: "#text", node_value_length: 2, attribute_names: [] },
    ]);
    expect(completeness.snapshot().excluded).toEqual([]);
  });
});

it.each([7, null, "without-hash"])(
  "retains base URL evidence with malformed fragment %s",
  (urlFragment) => {
    expect(
      observeCdpFrameUrl({ url: `${origin}/page?x=1#old`, urlFragment }),
    ).toEqual({ kind: "invalid_fragment", scopeUrl: `${origin}/page?x=1#old` });
  },
);

it.each([7, "missing-hash"])(
  "retains foreign frame scope independently of malformed fragment %s",
  (urlFragment) => {
    const completeness = new CdpCaptureCompleteness();
    const captured = captureFrames(
      {
        frameTree: {
          frame: { id: "root", url: origin },
          childFrames: [
            {
              frame: {
                id: "foreign",
                parentId: "root",
                url: "https://foreign.test/page",
                urlFragment,
              },
            },
          ],
        },
      },
      new Set([origin]),
      undefined,
      completeness,
    );
    expect(captured.items.map((frame) => frame.frame_id)).toEqual(["root"]);
    expect(completeness.snapshot().excluded).toEqual(
      expect.arrayContaining([
        { section: "frames", reason: "invalid_protocol_value", count: 1 },
        { section: "frames", reason: "disallowed_origin", count: 1 },
      ]),
    );
    expect(completeness.snapshot().policy_filtered_sections).toContain(
      "frames",
    );
  },
);
