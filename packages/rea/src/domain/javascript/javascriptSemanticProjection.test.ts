import * as t from "@babel/types";
import { expect, it } from "vitest";

import { semanticIdentifierRole } from "./javascriptSemanticProjection.js";
import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

const rolesFor = (source: string) => {
  const parsed = parseJavaScriptSource(source);
  if (parsed === null) throw new Error("Expected parsed source");
  const references: { name: string; role: string }[] = [];
  let snapshots = 0;
  traverseJavaScriptAst(parsed.program, {
    enter(node, parent, readAncestors) {
      if (!t.isIdentifier(node) || parent === null) return;
      const role = semanticIdentifierRole(node, parent, () => {
        snapshots++;
        return readAncestors();
      });
      if (role !== null) references.push({ name: node.name, role });
    },
  });
  return { references, snapshots };
};

it.each([256, 512])(
  "classifies a %s-member chain without copying or scanning its ancestry",
  (depth) => {
    expect(rolesFor(`object${".property".repeat(depth)};`)).toEqual({
      references: [{ name: "object", role: "read" }],
      snapshots: 0,
    });
  },
);

it("retains optional and computed member reads without ancestor snapshots", () => {
  expect(
    rolesFor("object.property; object[key]; object?.property; object?.[key];"),
  ).toEqual({
    references: [
      { name: "object", role: "read" },
      { name: "object", role: "read" },
      { name: "key", role: "read" },
      { name: "object", role: "read" },
      { name: "object", role: "read" },
      { name: "key", role: "read" },
    ],
    snapshots: 0,
  });
});

it("still reads ancestry to distinguish bound patterns from default-value reads", () => {
  const result = rolesFor(
    "const {key: value = compute()} = object; ({key: target} = source);",
  );
  expect(result.references).toEqual([
    { name: "compute", role: "read" },
    { name: "object", role: "read" },
    { name: "target", role: "write" },
    { name: "source", role: "read" },
  ]);
  expect(result.snapshots).toBeGreaterThan(0);
});

it("keeps member receivers and computed keys as reads in assignment patterns and updates", () => {
  expect(
    rolesFor("({field: object[key]} = source); object[key]++;").references,
  ).toEqual([
    { name: "object", role: "read" },
    { name: "key", role: "read" },
    { name: "source", role: "read" },
    { name: "object", role: "read" },
    { name: "key", role: "read" },
  ]);
});
