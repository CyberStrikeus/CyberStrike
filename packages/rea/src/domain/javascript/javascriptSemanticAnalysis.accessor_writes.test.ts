import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const returned = (source: string) => {
  const ir = analyzeJavaScriptSemantics(source);
  const callable = ir.callables.find(({ name }) => name === "observe");
  return callable?.returnSites[0]?.value;
};

it("keeps members unknown after a write through a local setter", () => {
  // The setter runs on assignment and may replace any member of `this`.
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, set update(next) { this.value = next; } };
        state.update = 2;
        return state;
      }
    `),
  ).toMatchObject({ status: "unknown" });
});

it("keeps sibling literals when the written key is an ordinary property", () => {
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, update: 0 };
        state.update = 2;
        return state;
      }
    `),
  ).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "value",
        value: { status: "literal", value: 1 },
      }),
    ]),
  });
});

it("keeps nested members unknown after a write through a nested setter", () => {
  const value = returned(`
    export function observe() {
      const state = {
        label: "kept",
        nested: { value: 1, set update(next) { this.value = next; } },
      };
      state.nested.update = 2;
      return state;
    }
  `);
  expect(value).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "label",
        value: { status: "literal", value: "kept" },
      }),
      expect.objectContaining({
        name: "nested",
        value: expect.objectContaining({ status: "unknown" }),
      }),
    ]),
  });
});

it("keeps sibling literals when an accessor is deleted rather than assigned", () => {
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, set update(next) {} };
        delete state.update;
        return state;
      }
    `),
  ).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "value",
        value: { status: "literal", value: 1 },
      }),
    ]),
  });
});

it("keeps sibling literals when a later data property replaces the setter", () => {
  expect(
    returned(`
      export function observe() {
        const state = { value: 1, set update(next) {}, update: 0 };
        state.update = 2;
        return state;
      }
    `),
  ).toMatchObject({
    status: "object",
    properties: expect.arrayContaining([
      expect.objectContaining({
        name: "value",
        value: { status: "literal", value: 1 },
      }),
    ]),
  });
});
