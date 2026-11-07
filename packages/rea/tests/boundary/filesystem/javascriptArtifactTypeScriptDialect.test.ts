import { parse } from "@babel/parser";
import { expect, it } from "vitest";

import { reconstructJavaScriptArtifact } from "../../support/javascriptApplicationScope.js";
import {
  typeScriptDialectCases,
  createTypeScriptDialectArtifact,
  expectTypeScriptDialectReference,
  expectValidTypeScriptInput,
} from "../../fixtures/javascriptArtifactTypeScriptDialect.js";

for (const fixture of typeScriptDialectCases) {
  it(`validates ${fixture.path} with the locked TypeScript producer`, async () => {
    await expectValidTypeScriptInput(fixture.path, fixture.source);
  });
}

for (const format of ["directory", "asar"] as const) {
  for (const fixture of typeScriptDialectCases) {
    it(`${format} retains ${fixture.path} syntax-derived reference facts`, async () => {
      const input = await createTypeScriptDialectArtifact(format, [fixture]);
      const result = await reconstructJavaScriptArtifact({ input_path: input });
      expect(result.statistics).toMatchObject({
        parse_failures: 0,
        invalid_utf8_files: 0,
      });
      expectTypeScriptDialectReference(result.graph, fixture);
    });
  }
}

for (const extension of ["mts", "cts"] as const) {
  it(`establishes the valid disambiguated ${extension} producer syntax`, async () => {
    const source =
      'const identity = <T,>(value: T): T => value;\nimport "./dep.js";';
    await expectValidTypeScriptInput(`control.${extension}`, source);
    expect(
      parse(source, {
        sourceType: "unambiguous",
        plugins: [["typescript", { disallowAmbiguousJSXLike: true }]],
      }).errors,
    ).toEqual([]);
  });
}
