import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { readGhidraLanguageCatalog } from "../../../src/ghidra/GhidraLanguageCatalog.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const xml =
  '<language_definitions><language id="toy:LE:32:default" description="�"><compiler id="default"/></language></language_definitions>';
it.each([
  { name: "literal U+FFFD", bytes: Buffer.from(xml), expectedError: null },
  {
    name: "UTF-8 BOM",
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml)]),
    expectedError: null,
  },
  {
    name: "UTF-16 BOM/declaration",
    bytes: Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<?xml version="1.0" encoding="UTF-16"?>' + xml, "utf16le"),
    ]),
    expectedError: null,
  },
  {
    name: "malformed UTF-8",
    bytes: Buffer.concat([
      Buffer.from('<language_definitions description="'),
      Buffer.from([0xff]),
      Buffer.from(
        '"><language id="toy:LE:32:default"/></language_definitions>',
      ),
    ]),
    expectedError: "invalid-bytes",
  },
  {
    name: "encoding mismatch",
    bytes: Buffer.from('<?xml version="1.0" encoding="UTF-16"?>' + xml),
    expectedError: "encoding-mismatch",
  },
  {
    name: "malformed XML alongside U+FFFD",
    bytes: Buffer.from(xml.replace('id="toy:LE:32:default"', "id=unquoted")),
    expectedError: "malformed",
  },
])(
  "reads $name at the language-file byte boundary",
  async ({ bytes, expectedError }) => {
    const root = await createTestTempDirectory("rea-ghidra-xml-encoding-");
    const directory = join(
      root,
      "Ghidra",
      "Processors",
      "toy",
      "data",
      "languages",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "toy.ldefs"), bytes);
    if (expectedError === null)
      expect(
        await readGhidraLanguageCatalog(root, new ArtifactResourceScope()),
      ).toEqual([{ id: "toy:LE:32:default", compilerSpecIds: ["default"] }]);
    else
      await expect(
        readGhidraLanguageCatalog(root, new ArtifactResourceScope()),
      ).rejects.toMatchObject({
        reason: expectedError,
      });
  },
);
