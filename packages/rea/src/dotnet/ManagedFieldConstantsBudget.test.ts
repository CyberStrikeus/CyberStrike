import { expect, it } from "vitest";
import { buildManagedPeFixture } from "../../scripts/fixtures/managed/pe.mjs";
import {
  managedDecodeBudget,
  ManagedRepresentationFailure,
} from "./ManagedDecodeBudget.js";
import { createManagedFieldConstantReader } from "./ManagedFieldConstants.js";
import { readManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";

it("uses the layout's existing representation capacity instead of an independent constant budget", () => {
  const bytes = buildManagedPeFixture({
    fields: [{ name: "Default", flags: 0x8056 }],
    constants: [{ typeCode: 8, value: Buffer.from("01000000", "hex") }],
  });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Fixture has no CLI metadata");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "metadata"),
    pe.cli.metadata.size,
  );
  const budget = managedDecodeBudget(layout);
  budget.reserve(63 * 1024 * 1024, null);
  // Leave less than one KiB, representing earlier facets in this same inspection.
  expect(() => {
    for (let i = 0; i < 1024; i++) budget.reserve(1024, null);
  }).toThrow(ManagedRepresentationFailure);
  const read = createManagedFieldConstantReader(bytes, layout, []);
  expect(() => read(1, 0x8056)).toThrow(ManagedRepresentationFailure);
});
