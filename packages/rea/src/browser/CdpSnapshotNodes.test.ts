import { expect, it } from "vitest";
import { snapshotDocumentNodes, snapshotNodeAt } from "./CdpSnapshotNodes.js";

const strings = [
  "#document",
  "svg",
  "xmlns",
  "http://www.w3.org/2000/svg",
  "😀",
];
const raw = () => ({
  nodeType: [9, 1, 1],
  nodeName: [0, 1, 1],
  nodeValue: [-1, -1, 4],
  parentIndex: [-1, 0, 1],
  attributes: [[], [2, 3], []],
});

it("decodes references once while retaining independently unknown facts", () => {
  const source = raw();
  source.nodeValue[1] = 999;
  const nodes = snapshotDocumentNodes(source, strings);
  if (nodes === undefined) throw new Error("Expected aligned columns");
  expect(nodes.nodeNames[1]).toBe("svg");
  expect(nodes.attributes[1]).toEqual([
    ["xmlns", "http://www.w3.org/2000/svg"],
  ]);
  expect(nodes.parents[1]).toBe(0);
  expect(nodes.nodeValues[1]).toBeUndefined();
  expect(snapshotNodeAt(nodes, 1)).toEqual({
    ok: false,
    error: { _tag: "InvalidCdpSnapshotNode", index: 1 },
  });
  expect(snapshotNodeAt(nodes, 2)).toMatchObject({
    ok: true,
    value: { nodeValue: "😀", parent: 1 },
  });
});

it("invalidates only cycle facts without inventing a root for descendants", () => {
  const source = raw();
  source.parentIndex = [1, 0, 1];
  const nodes = snapshotDocumentNodes(source, strings);
  expect(nodes?.parents).toEqual([undefined, undefined, 1]);
});

it.each([
  { parents: [-1, -1, 0] },
  { parents: [2, 0, -1] },
  { parents: [-1, 0, 1] },
])("preserves acyclic root and forward relationships %j", ({ parents }) => {
  expect(
    snapshotDocumentNodes({ ...raw(), parentIndex: parents }, strings)?.parents,
  ).toEqual(parents);
});

it.each([1.5, -2, 3, NaN, null, "0"])(
  "keeps malformed parent %s unknown at its original position",
  (parent) => {
    const nodes = snapshotDocumentNodes(
      { ...raw(), parentIndex: [-1, parent, 1] },
      strings,
    );
    expect(nodes?.parents).toEqual([-1, undefined, 1]);
  },
);

it.each([
  { attributes: [2] },
  { attributes: [999, 3] },
  { attributes: [2, 999] },
  { attributes: "invalid" },
])("refuses malformed attribute references %j", ({ attributes }) => {
  const nodes = snapshotDocumentNodes(
    { ...raw(), attributes: [[], attributes, []] },
    strings,
  );
  if (nodes === undefined) throw new Error("Expected aligned columns");
  expect(snapshotNodeAt(nodes, 1).ok).toBe(false);
  expect(snapshotNodeAt(nodes, 2).ok).toBe(true);
});
