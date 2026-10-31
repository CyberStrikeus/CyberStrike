import { expect, it } from "vitest";
import { readAndroidNativeInventory } from "./AndroidNativeInventory.js";
import type { JadxToolPort } from "./JadxAnalysis.js";
import type { JsonValue } from "../domain/jsonValue.js";

const SNAPSHOT = "/admitted/immutable target.apk";

const row = {
  source_index: 0,
  class_name: "fixture.Native",
  method_name: "read_原",
  descriptor: "([B)J",
  dex_entry: "classes.dex",
  dex_entry_index: 0,
  class_index: 2,
  method_index: 5,
};
const inventory = () => ({
  scope: "apk-root-dex-declarations",
  methods: [row],
  coverage: {
    status: "complete",
    dex_entries: 1,
    examined_dex_entries: 1,
    examined_classes: 3,
    examined_methods: 9,
  },
  unknowns: [] as string[],
});
const tools = (value: unknown): JadxToolPort => ({
  json: async (name, input) => {
    expect(name).toBe("rea_native_declarations");
    expect(input).toEqual({ path: SNAPSHOT });
    return value as JsonValue;
  },
  text: async () => {
    throw new Error("Native inventory must not request source");
  },
  listClasses: async () => {
    throw new Error("Native inventory must not page display classes");
  },
});

it("preserves duplicate native identities from distinct original DEX members", async () => {
  const source = inventory();
  source.methods.push({
    ...row,
    source_index: 1,
    dex_entry: "classes2.dex",
    dex_entry_index: 2,
  });
  source.coverage.dex_entries = 2;
  source.coverage.examined_dex_entries = 2;
  const actual = await readAndroidNativeInventory(tools(source), SNAPSHOT);
  expect(actual.methods).toEqual(source.methods);
  expect(actual.coverage.status).toBe("complete");
});

it("keeps usable facts and explicit incomplete DEX coverage", async () => {
  const source = inventory();
  source.coverage.status = "partial";
  source.coverage.dex_entries = 2;
  source.unknowns.push("classes2.dex cannot be read");
  expect(await readAndroidNativeInventory(tools(source), SNAPSHOT)).toEqual(
    source,
  );
});

it.each([
  (source: ReturnType<typeof inventory>) => {
    source.methods[0] = { ...row, descriptor: "not a prototype" };
  },
  (source: ReturnType<typeof inventory>) => {
    source.methods[0] = { ...row, source_index: 7 };
  },
  (source: ReturnType<typeof inventory>) => {
    source.coverage.examined_dex_entries = 2;
  },
  (source: ReturnType<typeof inventory>) => {
    source.coverage.dex_entries = 2;
  },
  (source: ReturnType<typeof inventory>) => {
    source.coverage.examined_methods = 0;
  },
  (source: ReturnType<typeof inventory>) => {
    source.unknowns.push("hidden incomplete input");
  },
  (source: ReturnType<typeof inventory>) => {
    source.methods.push({ ...row, source_index: 1, dex_entry: "other.dex" });
  },
])("rejects malformed or inconsistent producer facts (%#)", async (mutate) => {
  const source = inventory();
  mutate(source);
  await expect(
    readAndroidNativeInventory(tools(source), SNAPSHOT),
  ).rejects.toMatchObject({
    _tag: "AnalysisOutputError",
  });
});
