import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// Inert NSKeyedArchiver fixture: the final string follows the offset table.
const source = Buffer.from(
  "YnBsaXN0MDBVJG51bGzUAwUGBwQICQtZJGFyY2hpdmVyXxAPTlNLZXllZEFyY2hpdmVyWCRvYmplY3RzVCR0b3BYJHZlcnNpb26iAAHRCgxUcm9vdBIAAYaggAEAAAgAAIMAAA4AABcAACEAADMAADwAAEEAAEoAAE0AAFAAAFUAAFpVaGVsbG8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAQAAAAAAAAANAAAAAAAAAAIAAAAAAAAAXA==",
  "base64",
);

const fixture = (width: number, postTable: boolean): Buffer => {
  const oldTable = 92;
  const count = 13;
  const oldEnd = oldTable + count * 3;
  const trailer = source.length - 32;
  const content = source.subarray(oldEnd, trailer);
  const table = postTable ? oldTable : oldTable + content.length;
  const result = Buffer.alloc(trailer - count * 3 + count * width + 32);
  source.copy(result, 0, 0, oldTable);
  content.copy(result, postTable ? table + count * width : oldTable);
  for (let i = 0; i < count; i += 1) {
    const value = source.readUIntBE(oldTable + i * 3, 3);
    const relocated =
      value === oldEnd ? (postTable ? table + count * width : oldTable) : value;
    result.writeUIntBE(relocated, table + i * width, width);
  }
  const newTrailer = result.length - 32;
  source.copy(result, newTrailer, trailer);
  result[newTrailer + 6] = width;
  result.writeBigUInt64BE(BigInt(table), newTrailer + 24);
  return result;
};

cliTest(
  "preserves post-table keyed archive strings through offset normalization",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-post-table-");
    for (const [width, postTable] of [
      [1, true],
      [3, true],
      [4, true],
      [3, false],
    ] as const) {
      const path = join(root, `${width}-${String(postTable)}.bplist`);
      const original = fixture(width, postTable);
      await writeFile(path, original);
      const result = await cli.run({
        arguments: ["inspect-keyed-archive", path, "--format", "json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.normalized_result.objects[1]).toMatchObject({
        status: "observed",
        value: "hello",
      });
      expect((await readFile(path)).equals(original)).toBe(true);
    }
  },
);
