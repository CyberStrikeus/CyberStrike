import { expect, it } from "vitest";
import { inspectPeImportsInputSchema, peImportsSchema } from "./peImports.js";

it("rejects extra caller arguments and admits an empty import inventory", () => {
  expect(
    inspectPeImportsInputSchema.safeParse({
      path: "/artifacts/app.exe",
      extra: true,
    }).success,
  ).toBe(false);
  const report = peImportsSchema.parse({
    artifact: {
      path: "/artifacts/app.exe",
      sha256: "a".repeat(64),
      bytes: 512,
    },
    format: "pe32-plus",
    machine: 0x8664,
    bits: 64,
    architecture: "amd64",
    import_directory: null,
    delay_import_directory: null,
    imports: [],
    delay_imports: [],
    imphash: {
      algorithm: "pefile",
      md5: null,
      reason: "IMAGE_DIRECTORY_ENTRY_IMPORT is absent.",
    },
    coverage: {
      status: "complete",
      reason: null,
      examined_dlls: 0,
      imports: 0,
      delay_imports: 0,
    },
    issues: [],
    limitations: [
      "IMAGE_DIRECTORY_ENTRY_IMPORT is absent. That is not proof the image never imported APIs through another table or overlay.",
    ],
  });
  expect(report.imports).toEqual([]);
  expect(report.imphash.md5).toBeNull();
});
