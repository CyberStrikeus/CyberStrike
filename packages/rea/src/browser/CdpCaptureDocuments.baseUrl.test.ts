import { describe, expect, it } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { captureDom } from "./CdpCaptureDocuments.js";
import { capturedSvgNodeKind } from "./CdpCaptureDomNamespaces.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";

const origin = "https://app.example.test";
const documentUrl = `${origin}/screens/app`;
const input = inspectWebPageInputSchema.parse({
  cdp_endpoint: "http://127.0.0.1:9222",
  allowed_origins: [origin],
  target_id: "page-1",
});

const snapshot = (
  baseUrl?: string,
  baseHref = "assets/",
  pageUrl = documentUrl,
  linkHref = "guide",
) => ({
  strings: [
    pageUrl,
    baseUrl ?? "",
    "#document",
    "BASE",
    "A",
    "LINK",
    "FORM",
    "",
    "href",
    baseHref,
    linkHref,
    "rel",
    "mcp",
    "agent",
    "action",
    "submit",
  ],
  documents: [
    {
      documentURL: 0,
      ...(baseUrl === undefined ? {} : { baseURL: 1 }),
      nodes: {
        nodeType: [9, 1, 1, 1, 1],
        nodeName: [2, 3, 4, 5, 6],
        nodeValue: [7, 7, 7, 7, 7],
        parentIndex: [-1, 0, 0, 0, 0],
        attributes: [[], [8, 9], [8, 10], [8, 13, 11, 12], [14, 15]],
      },
    },
  ],
});

const capture = (value: ReturnType<typeof snapshot>) => {
  const step = captureDom(value, new Set([origin]), input).next();
  if (!step.done) throw new Error("Unexpected SVG identity query");
  return step.value;
};

const prefixedXhtmlSnapshot = () => {
  const strings = [
    `${origin}/root/prefixed.xhtml`,
    `${origin}/assets/`,
    "#document",
    "h:html",
    "h:head",
    "h:base",
    "h:body",
    "h:form",
    "h:button",
    "",
    "xmlns:h",
    "http://www.w3.org/1999/xhtml",
    "href",
    "/assets/",
    "action",
    "formaction",
  ];
  return {
    strings,
    documents: [
      {
        documentURL: 0,
        baseURL: 1,
        nodes: {
          nodeType: [9, 1, 1, 1, 1, 1, 1],
          nodeName: [2, 3, 4, 5, 6, 7, 8],
          nodeValue: [9, 9, 9, 9, 9, 9, 9],
          parentIndex: [-1, 0, 1, 2, 1, 4, 5],
          attributes: [[], [10, 11], [], [12, 13], [], [14, 9], [15, 9]],
        },
      },
    ],
  };
};

describe("DOM metadata document base URLs", () => {
  it("splits link relations only on HTML ASCII whitespace", () => {
    const strings = [
      documentUrl,
      "#document",
      "LINK",
      "",
      "href",
      "/valid",
      "rel",
      "alternate\u00a0mcp alternate\u000bmodel-context alternate\u2003ai-plugin alternate\ufeffservice-desc mcp\tservice-desc",
    ];
    const result = captureDom(
      {
        strings,
        documents: [
          {
            documentURL: 0,
            nodes: {
              nodeType: [9, 1],
              nodeName: [1, 2],
              nodeValue: [3, 3],
              parentIndex: [-1, 0],
              attributes: [[], [4, 5, 6, 7]],
            },
          },
        ],
      },
      new Set([origin]),
      input,
    ).next();
    if (!result.done) throw new Error("Unexpected SVG identity query");
    expect(
      result.value.agentHints.map(({ declaration }) => declaration),
    ).toEqual(["mcp", "service-desc"]);
  });

  it("resolves links, actions and agent hints against the captured document base", () => {
    const result = capture(snapshot(`${origin}/screens/assets/`));
    expect(result.urls.map(({ url }) => url)).toEqual([
      `${origin}/screens/assets/`,
      `${origin}/screens/assets/guide`,
      `${origin}/screens/assets/agent`,
      `${origin}/screens/assets/submit`,
    ]);
    expect(result.agentHints[0]?.url).toBe(`${origin}/screens/assets/agent`);
  });

  it("uses the document URL as fallback when no baseURL was supplied", () => {
    const result = capture(snapshot());
    expect(result.urls.map(({ url }) => url)).toEqual([
      `${origin}/screens/assets/`,
      `${origin}/screens/guide`,
      `${origin}/screens/agent`,
      `${origin}/screens/submit`,
    ]);
  });

  it("applies destination policy after resolving an ordinary foreign base", () => {
    const foreign = "https://cdn.example.test/assets/";
    const result = capture(snapshot(foreign, foreign));
    expect(result.nodes).toHaveLength(5);
    expect(result.urls).toHaveLength(4);
    expect(
      result.urls.every(
        ({ url, destination_scope }) =>
          url === null && destination_scope === "outside_policy",
      ),
    ).toBe(true);
    expect(result.agentHints[0]?.url).toBeNull();
  });

  it("keeps an absolute approved link independent of a foreign base", () => {
    const foreign = "https://cdn.example.test/assets/";
    const result = capture(
      snapshot(foreign, foreign, documentUrl, `${origin}/guide`),
    );
    expect(result.urls[1]).toMatchObject({
      url: `${origin}/guide`,
      destination_scope: "approved",
    });
  });

  it.each([
    "javascript:void(0)",
    "mailto:someone@example.test",
    "data:text/plain,hello",
    "ftp://app.example.test/file",
  ])("classifies the non-http(s) destination %s as unsupported", (href) => {
    const result = capture(snapshot(undefined, "assets/", documentUrl, href));
    expect(result.urls[1]).toMatchObject({
      url: null,
      destination_scope: "unsupported",
    });
  });

  it("classifies an unparseable destination as unsupported", () => {
    const result = capture(
      snapshot(undefined, "assets/", documentUrl, "https://[invalid"),
    );
    expect(result.urls[1]).toMatchObject({
      url: null,
      destination_scope: "unsupported",
    });
  });

  it("classifies a same-origin destination with credentials as approved", () => {
    const result = capture(
      snapshot(
        undefined,
        "assets/",
        documentUrl,
        "https://user:secret@app.example.test/guide",
      ),
    );
    expect(result.urls[1]).toMatchObject({
      url: `${origin}/guide`,
      destination_scope: "approved",
    });
  });

  it("does not authorize a foreign document using its approved base URL", () => {
    const result = capture(
      snapshot(
        `${origin}/assets/`,
        "assets/",
        "https://outside.example.test/app",
      ),
    );
    expect(result.nodes).toEqual([]);
    expect(result.urls).toEqual([]);
    expect(result.agentHints).toEqual([]);
  });
});

describe("prefixed XHTML form destinations", () => {
  it("resolves a prefixed base href against the document, not itself", () => {
    const value = prefixedXhtmlSnapshot();
    value.strings[1] = `${origin}/root/assets/`;
    value.strings[13] = "assets/";
    const step = captureDom(value, new Set([origin]), input).next();
    if (!step.done) throw new Error("Unexpected SVG identity query");
    expect(step.value.urls[0]?.url).toBe(`${origin}/root/assets/`);
  });

  it("resolves empty actions to the document URL", () => {
    const result = captureDom(
      prefixedXhtmlSnapshot(),
      new Set([origin]),
      input,
    ).next();
    if (!result.done) throw new Error("Unexpected SVG identity query");
    expect(result.value.urls).toEqual([
      {
        node_index: 3,
        attribute: "href",
        url: `${origin}/assets/`,
        destination_scope: "approved",
      },
      {
        node_index: 5,
        attribute: "action",
        url: `${origin}/root/prefixed.xhtml`,
        destination_scope: "approved",
      },
      {
        node_index: 6,
        attribute: "formaction",
        url: `${origin}/root/prefixed.xhtml`,
        destination_scope: "approved",
      },
    ]);
  });
});

describe("empty form destinations with a document base URL", () => {
  it("keeps an empty form action approved when the document base is foreign", () => {
    const foreign = "https://cdn.example.test/assets/";
    const value = snapshot(foreign, foreign);
    value.strings[15] = "";
    expect(capture(value).urls[3]).toMatchObject({
      url: documentUrl,
      destination_scope: "approved",
    });
  });

  it.each([" ", "\t\r\n\f"])(
    "resolves an HTML-whitespace-only form action to the document: %j",
    (action) => {
      const baseUrl = `${origin}/assets/`;
      const value = snapshot(baseUrl);
      value.strings[15] = action;
      expect(capture(value).urls[3]?.url).toBe(documentUrl);
    },
  );

  it.each(["BUTTON", "INPUT"])(
    "retains document-base resolution for a whitespace-only %s formaction",
    (nodeName) => {
      const baseUrl = `${origin}/assets/`;
      const value = snapshot(baseUrl);
      value.strings[6] = nodeName;
      value.strings[14] = "formaction";
      value.strings[15] = " ";
      expect(capture(value).urls[3]?.url).toBe(baseUrl);
    },
  );

  it.each([
    { value: "\u000b", suffix: "" },
    { value: "\u00a0", suffix: "%C2%A0" },
  ])(
    "does not treat non-HTML whitespace as an empty form action: $value",
    ({ value: action, suffix }) => {
      const baseUrl = `${origin}/assets/`;
      const value = snapshot(baseUrl);
      value.strings[15] = action;
      expect(capture(value).urls[3]?.url).toBe(`${baseUrl}${suffix}`);
    },
  );

  it("keeps the first value when an attribute name repeats", () => {
    const value = snapshot();
    const later = `${origin}/later`;
    value.strings.push(later);
    const href = value.strings.indexOf("href");
    const guide = value.strings.indexOf("guide");
    const nodes = value.documents[0]?.nodes;
    if (nodes === undefined) throw new TypeError("Expected a DOM snapshot");
    nodes.attributes[2] = [href, guide, href, value.strings.length - 1];
    const result = capture(value);
    expect(result.nodes[2]?.attribute_names).toEqual(["href"]);
    expect(result.urls.map(({ url }) => url)).toContain(
      `${origin}/screens/guide`,
    );
    expect(result.urls.map(({ url }) => url)).not.toContain(later);
  });

  it("does not apply form semantics to an action attribute on another element", () => {
    const baseUrl = `${origin}/assets/`;
    const value = snapshot(baseUrl);
    value.strings[6] = "DIV";
    value.strings[15] = "";
    expect(capture(value).urls[3]?.url).toBe(baseUrl);
  });
});

describe("repeated DOM attribute names", () => {
  it("keeps the first declaration for attribute names and destination URLs", () => {
    const value = snapshot(undefined, "assets/", documentUrl, "guide");
    const hrefUpperIndex = value.strings.length;
    const secondGuideIndex = hrefUpperIndex + 1;
    value.strings.push("href", "second-guide");
    const docNodes = value.documents[0]?.nodes;
    if (docNodes !== undefined) {
      docNodes.attributes[2] = [8, 10, hrefUpperIndex, secondGuideIndex];
    }
    const result = capture(value);
    const linkNode = result.nodes[2];
    expect(linkNode?.attribute_names).toEqual(["href"]);
    const linkUrl = result.urls.find(({ node_index }) => node_index === 2);
    expect(linkUrl?.url).toBe(`${origin}/screens/guide`);
  });
});

it("preserves case-sensitive SVG attributes and uses the actual href", () => {
  const value = snapshot();
  const first = value.strings.length;
  value.strings.push(
    "a",
    "HREF",
    "/wrong",
    "href",
    "/actual",
    "viewBox",
    "viewbox",
    "0 0 10 10",
  );
  value.documents[0]!.nodes.nodeName[2] = first;
  value.documents[0]!.nodes.attributes[2] = [
    first + 1,
    first + 2,
    first + 3,
    first + 4,
    first + 5,
    first + 7,
    first + 6,
    first + 7,
  ];
  const result = capture(value);
  expect(result.nodes[2]?.attribute_names).toEqual([
    "HREF",
    "href",
    "viewBox",
    "viewbox",
  ]);
  expect(result.urls.find(({ node_index }) => node_index === 2)?.url).toBe(
    `${origin}/actual`,
  );
});

interface SvgSnapshotNode {
  readonly name: string;
  readonly parent: number;
  readonly attributes?: readonly (readonly [string, string])[];
  readonly svg?: boolean;
}

const svgDocument = (
  elements: readonly SvgSnapshotNode[],
  baseUrl = `${origin}/screens/assets/`,
) => {
  const strings = [documentUrl, baseUrl];
  const intern = (value: string): number => {
    const existing = strings.indexOf(value);
    if (existing >= 0) return existing;
    strings.push(value);
    return strings.length - 1;
  };
  const nodeType = [9];
  const nodeName = [intern("#document")];
  const nodeValue = [intern("")];
  const parentIndex = [-1];
  const attributes: number[][] = [[]];
  const backendNodeId = [1];
  const svgNodeKinds = new Map<string, boolean>();
  for (const element of elements) {
    const id = backendNodeId.length + 1;
    backendNodeId.push(id);
    if (element.svg !== undefined)
      svgNodeKinds.set(`${String(id)}:${element.name}`, element.svg);
    nodeType.push(1);
    nodeName.push(intern(element.name));
    nodeValue.push(intern(""));
    parentIndex.push(element.parent);
    const encoded: number[] = [];
    for (const [name, value] of element.attributes ?? [])
      encoded.push(intern(name), intern(value));
    attributes.push(encoded);
  }
  return {
    strings,
    documents: [
      {
        documentURL: 0,
        baseURL: 1,
        nodes: {
          nodeType,
          nodeName,
          nodeValue,
          parentIndex,
          attributes,
          backendNodeId,
        },
        svgNodeKinds,
      },
    ],
  };
};

const captureSvg = (value: ReturnType<typeof svgDocument>) => {
  const kinds = new Map(
    value.documents.flatMap((document) => [...document.svgNodeKinds]),
  );
  const capture = captureDom(value, new Set([origin]), input);
  let step = capture.next();
  while (!step.done) {
    step = capture.next(
      step.value.map((query) =>
        kinds.get(`${String(query.backendNodeId)}:${query.nodeName}`),
      ),
    );
  }
  return step.value;
};

const urlFor = (
  result: ReturnType<typeof captureSvg>,
  nodeIndex: number,
): (typeof result.urls)[number] | undefined =>
  result.urls.find((url) => url.node_index === nodeIndex);

describe("browser SVG identity", () => {
  const query = { backendNodeId: 42, nodeName: "a" };
  const node = { ...query, nodeType: 1 };

  it("uses only a matching described element's SVG flag", () => {
    expect(capturedSvgNodeKind(query, { node: { ...node, isSVG: true } })).toBe(
      true,
    );
    expect(
      capturedSvgNodeKind(query, { node: { ...node, isSVG: false } }),
    ).toBe(false);
    expect(capturedSvgNodeKind(query, { node })).toBe(false);
    for (const invalid of [
      {},
      { node: { ...node, backendNodeId: 43, isSVG: true } },
      { node: { ...node, nodeName: "A", isSVG: true } },
      { node: { ...node, nodeType: 3, isSVG: true } },
      { node: { ...node, isSVG: "true" } },
    ])
      expect(capturedSvgNodeKind(query, invalid)).toBeUndefined();
  });

  it("distinguishes identically named SVG and MathML elements regardless of parent", () => {
    const result = captureSvg(
      svgDocument([
        { name: "svg", parent: 0 },
        { name: "desc", parent: 1 },
        {
          name: "a",
          svg: true,
          parent: 2,
          attributes: [["xlink:href", "/svg"]],
        },
        {
          name: "a",
          svg: false,
          parent: 2,
          attributes: [["xlink:href", "/math"]],
        },
        {
          name: "A",
          svg: false,
          parent: 1,
          attributes: [["xlink:href", "/html"]],
        },
        {
          name: "a",
          svg: true,
          parent: 0,
          attributes: [["xlink:href", "/orphan"]],
        },
      ]),
    );
    expect(result.urls.map(({ url }) => url)).toEqual([
      `${origin}/svg`,
      `${origin}/orphan`,
    ]);
  });

  it("records unresolved identity without inventing a destination or hiding attributes", () => {
    const value = svgDocument([
      { name: "a", parent: 0, attributes: [["xlink:href", "/unknown"]] },
    ]);
    const completeness = new CdpCaptureCompleteness();
    const capture = captureDom(value, new Set([origin]), input, completeness);
    expect(capture.next()).toEqual({
      done: false,
      value: [{ backendNodeId: 2, nodeName: "a" }],
    });
    const step = capture.next([undefined]);
    expect(step.done).toBe(true);
    if (!step.done) throw new Error("Unexpected second query");
    expect(step.value.unresolvedSvgNodes).toBe(1);
    expect(step.value.urls).toEqual([]);
    expect(step.value.nodes[1]?.attribute_names).toEqual(["xlink:href"]);
    expect(completeness.snapshot().excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "metadata",
          reason: "provider_unavailable",
          count: 1,
        }),
      ]),
    );
  });
});

it("keeps batched SVG identities aligned around missing IDs and ordinary links", () => {
  const value = svgDocument([
    { name: "a", parent: 0, attributes: [["xlink:href", "/svg"]] },
    { name: "A", parent: 0, attributes: [["href", "/ordinary"]] },
    { name: "a", parent: 0, attributes: [["xlink:href", "/missing-id"]] },
    { name: "a", parent: 0, attributes: [["xlink:href", "/non-svg"]] },
  ]);
  const completeness = new CdpCaptureCompleteness();
  const capture = captureDom(
    {
      ...value,
      documents: value.documents.map((document) => ({
        ...document,
        nodes: { ...document.nodes, backendNodeId: [1, 2, 3, null, 5] },
      })),
    },
    new Set([origin]),
    input,
    completeness,
  );
  expect(capture.next()).toEqual({
    done: false,
    value: [
      { backendNodeId: 2, nodeName: "a" },
      { backendNodeId: 5, nodeName: "a" },
    ],
  });
  const step = capture.next([true, false]);
  if (!step.done) throw new Error("Unexpected second batch");
  expect(
    step.value.urls.map(({ node_index, url }) => [node_index, url]),
  ).toEqual([
    [1, `${origin}/svg`],
    [2, `${origin}/ordinary`],
  ]);
  expect(step.value.unresolvedSvgNodes).toBe(1);
  expect(completeness.snapshot().excluded).toContainEqual({
    section: "metadata",
    reason: "provider_unavailable",
    count: 1,
  });
});

describe("SVG xlink:href destinations", () => {
  it("reports an SVG anchor that only has xlink:href, keeping the first value", () => {
    const result = captureSvg(
      svgDocument([
        { name: "svg", parent: 0 },
        { name: "g", parent: 1 },
        {
          name: "a",
          svg: true,
          parent: 2,
          attributes: [
            ["xlink:href", "/xl-s2h"],
            ["xlink:href", "/later"],
          ],
        },
      ]),
    );
    expect(result.nodes[3]?.attribute_names).toEqual(["xlink:href"]);
    expect(result.urls).toEqual([
      {
        node_index: 3,
        attribute: "href",
        url: `${origin}/xl-s2h`,
        destination_scope: "approved",
      },
    ]);
  });

  it.each([
    ["xlink:href", "href"],
    ["href", "xlink:href"],
  ] as const)(
    "uses href when an SVG anchor also has xlink:href (%s then %s)",
    (first, second) => {
      const valueFor = (name: string): string =>
        name === "href" ? "/href-wins" : "/xlink-loses";
      const result = captureSvg(
        svgDocument([
          { name: "svg", parent: 0 },
          {
            name: "a",
            svg: true,
            parent: 1,
            attributes: [
              [first, valueFor(first)],
              [second, valueFor(second)],
            ],
          },
        ]),
      );
      expect(result.urls).toEqual([
        {
          node_index: 2,
          attribute: "href",
          url: `${origin}/href-wins`,
          destination_scope: "approved",
        },
      ]);
    },
  );

  it("does not report xlink:href on an HTML anchor or a MathML element", () => {
    const result = captureSvg(
      svgDocument([
        {
          name: "A",
          svg: false,
          parent: 0,
          attributes: [["xlink:href", "/xl-html"]],
        },
        { name: "math", parent: 0 },
        {
          name: "mrow",
          svg: false,
          parent: 2,
          attributes: [["xlink:href", "/xl-math"]],
        },
        { name: "svg", parent: 0 },
        {
          name: "a",
          svg: true,
          parent: 4,
          attributes: [["xlink:href", "/xl-s2h"]],
        },
      ]),
    );
    expect(result.nodes[1]?.attribute_names).toEqual(["xlink:href"]);
    expect(result.nodes[3]?.attribute_names).toEqual(["xlink:href"]);
    expect(urlFor(result, 1)).toBeUndefined();
    expect(urlFor(result, 3)).toBeUndefined();
    expect(urlFor(result, 5)?.url).toBe(`${origin}/xl-s2h`);
  });

  it("classifies an SVG xlink:href outside the allowed origins as outside_policy", () => {
    const result = captureSvg(
      svgDocument([
        { name: "svg", parent: 0 },
        {
          name: "a",
          svg: true,
          parent: 1,
          attributes: [["xlink:href", "https://cdn.example.test/out"]],
        },
      ]),
    );
    expect(result.urls).toEqual([
      {
        node_index: 2,
        attribute: "href",
        url: null,
        destination_scope: "outside_policy",
      },
    ]);
  });

  it("resolves SVG image and use xlink:href against the document base", () => {
    const result = captureSvg(
      svgDocument([
        { name: "svg", parent: 0 },
        {
          name: "image",
          svg: true,
          parent: 1,
          attributes: [["xlink:href", "guide"]],
        },
        {
          name: "use",
          svg: true,
          parent: 1,
          attributes: [["xlink:href", "icon.svg"]],
        },
      ]),
    );
    expect(result.urls).toEqual([
      {
        node_index: 2,
        attribute: "href",
        url: `${origin}/screens/assets/guide`,
        destination_scope: "approved",
      },
      {
        node_index: 3,
        attribute: "href",
        url: `${origin}/screens/assets/icon.svg`,
        destination_scope: "approved",
      },
    ]);
  });
});

describe("SVG xlink:href context", () => {
  it("binds SVG identity to the selected element across documents", () => {
    const svg = svgDocument([
      {
        name: "a",
        svg: true,
        parent: 2,
        attributes: [["xlink:href", "/svg-link"]],
      },
      { name: "g", parent: 3 },
      { name: "svg", parent: 0 },
    ]);
    const html = svgDocument([
      {
        name: "A",
        svg: false,
        parent: 2,
        attributes: [["xlink:href", "/html-link"]],
      },
      { name: "DIV", parent: 3 },
      { name: "BODY", parent: 0 },
    ]);
    const offset = svg.strings.length;
    const result = captureSvg({
      strings: [...svg.strings, ...html.strings],
      documents: [
        ...svg.documents,
        ...html.documents.map((document) => ({
          ...document,
          documentURL: document.documentURL + offset,
          baseURL: document.baseURL + offset,
          nodes: {
            ...document.nodes,
            nodeName: document.nodes.nodeName.map((index) => index + offset),
            nodeValue: document.nodes.nodeValue.map((index) => index + offset),
            attributes: document.nodes.attributes.map((attributes) =>
              attributes.map((index) => index + offset),
            ),
          },
        })),
      ],
    });
    expect(result.urls).toEqual([
      {
        node_index: 1,
        attribute: "href",
        url: `${origin}/svg-link`,
        destination_scope: "approved",
      },
    ]);
  });

  it.each(["foreignObject", "desc", "title"])(
    "preserves browser SVG identity across %s HTML integration points",
    (integrationPoint) => {
      const result = captureSvg(
        svgDocument([
          { name: "svg", parent: 0 },
          { name: integrationPoint, parent: 1 },
          {
            name: "A",
            svg: false,
            parent: 2,
            attributes: [["xlink:href", "/xl-html-fo"]],
          },
          { name: "svg", parent: 2 },
          {
            name: "a",
            svg: true,
            parent: 4,
            attributes: [["xlink:href", "/xl-nested"]],
          },
        ]),
      );
      expect(urlFor(result, 3)).toBeUndefined();
      expect(urlFor(result, 5)).toMatchObject({
        attribute: "href",
        url: `${origin}/xl-nested`,
        destination_scope: "approved",
      });
    },
  );
});

describe("SVG XLink precedence and unknown identity", () => {
  it("keeps an empty href ahead of xlink:href", () => {
    const baseUrl = `${origin}/screens/assets/`;
    const result = captureSvg(
      svgDocument(
        [
          { name: "svg", parent: 0 },
          {
            name: "a",
            svg: true,
            parent: 1,
            attributes: [
              ["href", ""],
              ["xlink:href", "/xlink-should-lose"],
            ],
          },
        ],
        baseUrl,
      ),
    );
    expect(result.urls).toEqual([
      {
        node_index: 2,
        attribute: "href",
        url: baseUrl,
        destination_scope: "approved",
      },
    ]);
  });

  it("classifies a non-http SVG xlink:href as unsupported", () => {
    const result = captureSvg(
      svgDocument([
        { name: "svg", parent: 0 },
        {
          name: "a",
          svg: true,
          parent: 1,
          attributes: [["xlink:href", "javascript:void(0)"]],
        },
      ]),
    );
    expect(result.urls).toEqual([
      {
        node_index: 2,
        attribute: "href",
        url: null,
        destination_scope: "unsupported",
      },
    ]);
  });

  it("keeps an unavailable SVG identity unknown despite ancestor names", () => {
    const cyclic = captureSvg(
      svgDocument([
        { name: "g", parent: 2 },
        {
          name: "a",
          parent: 1,
          attributes: [["xlink:href", "/cycle"]],
        },
      ]),
    );
    const dangling = captureSvg(
      svgDocument([
        {
          name: "a",
          parent: 99,
          attributes: [["xlink:href", "/missing-parent"]],
        },
      ]),
    );
    expect(cyclic.urls).toEqual([]);
    expect(dangling.urls).toEqual([]);
  });
});

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const xhtmlRoot = (
  attributes: readonly (readonly [string, string])[] = [
    ["xmlns", XHTML_NAMESPACE],
    ["xmlns:svg", SVG_NAMESPACE],
    ["xmlns:xlink", XLINK_NAMESPACE],
  ],
): SvgSnapshotNode => ({
  name: "html",
  parent: 0,
  attributes,
});

const approvedHref = (
  nodeIndex: number,
  url: string,
): {
  readonly node_index: number;
  readonly attribute: "href";
  readonly url: string;
  readonly destination_scope: "approved";
} => ({
  node_index: nodeIndex,
  attribute: "href",
  url,
  destination_scope: "approved",
});

describe("XHTML link agent hints", () => {
  it.each([
    ["html", "link", "xmlns"],
    ["h:html", "h:link", "xmlns:h"],
  ])("recognizes equivalent %s namespaces", (root, link, namespace) => {
    const result = captureSvg(
      svgDocument([
        { name: root, parent: 0, attributes: [[namespace, XHTML_NAMESPACE]] },
        {
          name: link,
          parent: 1,
          attributes: [
            ["href", "/agent"],
            ["rel", "mcp model-context ai-plugin service-desc"],
          ],
        },
      ]),
    );
    expect(result.agentHints).toEqual(
      ["mcp", "model-context", "ai-plugin", "service-desc"].map(
        (declaration) => ({
          mechanism: "dom_link_rel",
          declaration,
          url: `${origin}/agent`,
          trust: "page-declared-untrusted",
        }),
      ),
    );
  });

  it("does not treat foreign or differently cased XML elements as XHTML links", () => {
    const result = captureSvg(
      svgDocument([
        xhtmlRoot([
          ["xmlns", XHTML_NAMESPACE],
          ["xmlns:f", "urn:foreign"],
        ]),
        {
          name: "f:link",
          parent: 1,
          attributes: [
            ["rel", "mcp"],
            ["href", "/agent"],
          ],
        },
        {
          name: "LINK",
          parent: 1,
          attributes: [
            ["rel", "mcp"],
            ["href", "/agent"],
          ],
        },
      ]),
    );
    expect(result.agentHints).toEqual([]);
  });
});

describe("XML SVG roots and namespace scope restoration", () => {
  it.each(["svg", "document"])(
    "resolves namespaces under an unprefixed XML %s root",
    (name) => {
      const result = captureSvg(
        svgDocument([
          {
            name,
            parent: 0,
            attributes: [
              ["xmlns", SVG_NAMESPACE],
              ["xmlns:p", XLINK_NAMESPACE],
            ],
          },
          {
            name: "a",
            svg: true,
            parent: 1,
            attributes: [["p:href", "/linked"]],
          },
        ]),
      );
      expect(result.urls).toEqual([approvedHref(2, `${origin}/linked`)]);
    },
  );

  it.each([2, 3, 99])(
    "rejects self-parent, cyclic and dangling XML ancestry (%s)",
    (parent) => {
      const result = captureSvg(
        svgDocument([
          xhtmlRoot(),
          {
            name: "svg:a",
            parent,
            attributes: [
              ["xmlns:svg", SVG_NAMESPACE],
              ["xmlns:p", XLINK_NAMESPACE],
              ["p:href", "/invalid"],
            ],
          },
          { name: "svg:g", parent: 2 },
        ]),
      );
      expect(result.urls).toEqual([]);
    },
  );

  it("restores namespace declarations and undeclarations before visiting siblings", () => {
    const result = captureSvg(
      svgDocument([
        xhtmlRoot(),
        {
          name: "svg:a",
          parent: 1,
          attributes: [
            ["xmlns:xlink", ""],
            ["xlink:href", "/undeclared"],
          ],
        },
        {
          name: "svg:a",
          parent: 1,
          attributes: [["xlink:href", "/inherited"]],
        },
        {
          name: "svg:a",
          parent: 1,
          attributes: [
            ["xmlns:svg", "other"],
            ["xlink:href", "/rebound"],
          ],
        },
        { name: "svg:a", parent: 1, attributes: [["xlink:href", "/restored"]] },
      ]),
    );
    expect(result.urls).toEqual([
      approvedHref(3, `${origin}/inherited`),
      approvedHref(5, `${origin}/restored`),
    ]);
  });
});

describe("XHTML and XML SVG namespace prefixes", () => {
  it("reports prefixed svg:a, svg:image, and an svg:a with no svg parent", () => {
    const result = captureSvg(
      svgDocument([
        xhtmlRoot(),
        { name: "svg:svg", parent: 1 },
        {
          name: "svg:a",
          parent: 2,
          attributes: [
            ["xlink:href", "/xl-pa1"],
            ["xlink:href", "/later"],
          ],
        },
        {
          name: "svg:image",
          parent: 2,
          attributes: [["xlink:href", "guide"]],
        },
        {
          name: "svg:a",
          parent: 1,
          attributes: [["xlink:href", "/xl-orphan"]],
        },
      ]),
    );
    expect(result.nodes[3]?.node_name).toBe("svg:a");
    expect(result.nodes[3]?.attribute_names).toEqual(["xlink:href"]);
    expect(result.urls).toEqual([
      approvedHref(3, `${origin}/xl-pa1`),
      approvedHref(4, `${origin}/screens/assets/guide`),
      approvedHref(5, `${origin}/xl-orphan`),
    ]);
  });

  it("reports svg:a under svg:foreignObject and skips XHTML anchors there", () => {
    const result = captureSvg(
      svgDocument([
        xhtmlRoot([
          ["xmlns", XHTML_NAMESPACE],
          ["xmlns:svg", SVG_NAMESPACE],
          ["xmlns:xlink", XLINK_NAMESPACE],
          ["xmlns:h", XHTML_NAMESPACE],
        ]),
        { name: "svg:svg", parent: 1 },
        { name: "svg:foreignObject", parent: 2 },
        {
          name: "a",
          svg: true,
          parent: 3,
          attributes: [["xlink:href", "/xl-html-fo"]],
        },
        {
          name: "h:a",
          parent: 3,
          attributes: [["xlink:href", "/xl-h"]],
        },
        {
          name: "svg:a",
          parent: 3,
          attributes: [["xlink:href", "/xl-fo-svg"]],
        },
      ]),
    );
    expect(urlFor(result, 4)).toBeUndefined();
    expect(urlFor(result, 5)).toBeUndefined();
    expect(result.urls).toEqual([approvedHref(6, `${origin}/xl-fo-svg`)]);
  });

  it("reads XLink by namespace, including a prefix other than xlink", () => {
    const result = captureSvg(
      svgDocument([
        xhtmlRoot([["xmlns", XHTML_NAMESPACE]]),
        {
          name: "svg",
          parent: 1,
          attributes: [
            ["xmlns", SVG_NAMESPACE],
            ["xmlns:xlink", "http://example.com/not-xlink"],
            ["xmlns:x", XLINK_NAMESPACE],
          ],
        },
        {
          name: "a",
          svg: true,
          parent: 2,
          attributes: [
            ["xlink:href", "/not-xlink"],
            ["x:href", "/xl-custom"],
            ["x:href", "/later"],
          ],
        },
      ]),
    );
    expect(result.nodes[3]?.attribute_names).toEqual(["xlink:href", "x:href"]);
    expect(result.urls).toEqual([approvedHref(3, `${origin}/xl-custom`)]);
  });

  it("keeps plain href ahead of a namespaced XLink href, including an empty href", () => {
    const baseUrl = `${origin}/screens/assets/`;
    const anchor = (
      parent: number,
      attributes: readonly (readonly [string, string])[],
    ): SvgSnapshotNode => ({
      name: "svg:a",
      parent,
      attributes,
    });
    const result = captureSvg(
      svgDocument(
        [
          xhtmlRoot(),
          { name: "svg:svg", parent: 1 },
          anchor(2, [
            ["xlink:href", "/xlink-loses"],
            ["href", "/href-wins"],
          ]),
          anchor(2, [
            ["href", "/href-wins"],
            ["xlink:href", "/xlink-loses"],
          ]),
          anchor(2, [
            ["href", ""],
            ["xlink:href", "/xlink-should-lose"],
          ]),
        ],
        baseUrl,
      ),
    );
    expect(result.urls).toEqual([
      approvedHref(3, `${origin}/href-wins`),
      approvedHref(4, `${origin}/href-wins`),
      approvedHref(5, baseUrl),
    ]);
  });
});

describe("XHTML SVG exclusions, HTML documents, and prefix scope", () => {
  it("classifies a prefixed SVG xlink:href outside the allowed origins as outside_policy", () => {
    const result = captureSvg(
      svgDocument([
        xhtmlRoot(),
        { name: "svg:svg", parent: 1 },
        {
          name: "svg:a",
          parent: 2,
          attributes: [["xlink:href", "https://cdn.example.test/out"]],
        },
      ]),
    );
    expect(result.urls).toEqual([
      {
        node_index: 3,
        attribute: "href",
        url: null,
        destination_scope: "outside_policy",
      },
    ]);
  });

  it("does not treat bogus:svg in another namespace as SVG", () => {
    const result = captureSvg(
      svgDocument([
        xhtmlRoot([
          ["xmlns", XHTML_NAMESPACE],
          ["xmlns:svg", SVG_NAMESPACE],
          ["xmlns:xlink", XLINK_NAMESPACE],
          ["xmlns:bogus", "http://example.com/not-svg"],
        ]),
        {
          name: "bogus:svg",
          parent: 1,
          attributes: [["xlink:href", "/xl-bogus"]],
        },
        {
          name: "bogus:a",
          parent: 2,
          attributes: [["xlink:href", "/xl-bogus-a"]],
        },
        {
          name: "svg:a",
          parent: 1,
          attributes: [["xlink:href", "/xl-kept"]],
        },
      ]),
    );
    expect(result.nodes[2]?.node_name).toBe("bogus:svg");
    expect(result.urls).toEqual([approvedHref(4, `${origin}/xl-kept`)]);
  });

  it("leaves HTML documents on literal svg and xlink:href names", () => {
    const result = captureSvg(
      svgDocument([
        { name: "HTML", parent: 0 },
        {
          name: "svg",
          parent: 1,
          attributes: [
            ["xmlns", SVG_NAMESPACE],
            ["xmlns:x", XLINK_NAMESPACE],
          ],
        },
        {
          name: "a",
          svg: true,
          parent: 2,
          attributes: [["xlink:href", "/xl-literal"]],
        },
        {
          name: "a",
          svg: true,
          parent: 2,
          attributes: [["x:href", "/xl-custom-html"]],
        },
        {
          name: "svg:a",
          parent: 1,
          attributes: [
            ["xmlns:svg", SVG_NAMESPACE],
            ["xmlns:xlink", XLINK_NAMESPACE],
            ["xlink:href", "/xl-prefixed-html"],
          ],
        },
        {
          name: "A",
          svg: false,
          parent: 1,
          attributes: [["xlink:href", "/xl-html-anchor"]],
        },
      ]),
    );
    expect(result.urls).toEqual([approvedHref(3, `${origin}/xl-literal`)]);
  });
});

describe("XML namespace resolution ordering and capacity", () => {
  it("applies an element's own xmlns declarations to its name and href", () => {
    const result = captureSvg(
      svgDocument([
        { name: "html", parent: 0, attributes: [["xmlns", XHTML_NAMESPACE]] },
        {
          name: "svg:a",
          parent: 1,
          attributes: [
            ["xmlns:svg", SVG_NAMESPACE],
            ["xmlns:xlink", XLINK_NAMESPACE],
            ["xlink:href", "/xl-self"],
          ],
        },
      ]),
    );
    expect(result.urls).toEqual([approvedHref(2, `${origin}/xl-self`)]);
  });

  it("resolves a prefix declared on a later ancestor", () => {
    const result = captureSvg(
      svgDocument([
        {
          name: "svg:a",
          parent: 2,
          attributes: [["xlink:href", "/forward"]],
        },
        { name: "svg:svg", parent: 3 },
        xhtmlRoot(),
      ]),
    );
    expect(result.urls).toEqual([approvedHref(1, `${origin}/forward`)]);
  });

  it("resolves a deep chain with distinct namespace declarations without quadratic expansion", () => {
    const depth = 12_000;
    const elements: SvgSnapshotNode[] = [
      xhtmlRoot(),
      { name: "svg:svg", parent: 1 },
    ];
    let parent = 2;
    for (let index = 0; index < depth; index += 1) {
      elements.push({
        name: "svg:g",
        parent,
        attributes: [[`xmlns:p${index}`, `urn:prefix:${index}`]],
      });
      parent = elements.length;
    }
    elements.push({
      name: "svg:a",
      parent,
      attributes: [["xlink:href", "/deep"]],
    });
    const snapshot = svgDocument(elements);
    const result = captureSvg(snapshot);
    expect(result.urls).toEqual([
      approvedHref(elements.length, `${origin}/deep`),
    ]);
  }, 30_000);
});
