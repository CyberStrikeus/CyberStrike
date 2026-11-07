import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { keyedArchiveResultSchema } from "../../../dist/domain/apple/keyedArchive.js";

const rowSchema = z.object({
  container: z.enum(["roots", "objects"]),
  root: z.string(),
  objectId: z.number().int().nonnegative().optional(),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  kind: z.enum(["integer", "real"]),
  literal: z.string(),
});
const archiveSchema = z.object({
  filename: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  rows: z.array(rowSchema),
});
const oracleSchema = z.object({ xml: archiveSchema, binary: archiveSchema });

const formats = ["xml", "binary"];
const requiredRows = [
  { root: "unsafeSigned", kind: "integer", literal: "9007199254740993" },
  {
    root: "unsafeNegative",
    kind: "integer",
    literal: "-9223372036854775808",
  },
  { root: "safeInteger", kind: "integer", literal: "9007199254740991" },
  { root: "safeNegative", kind: "integer", literal: "-42" },
  { root: "integralReal", kind: "real", literal: "9007199254740992" },
  {
    root: "boxedUnsigned",
    kind: "integer",
    literal: "9007199254740993",
    container: "objects",
  },
  {
    root: "boxedReal",
    kind: "real",
    literal: "9007199254740992",
    container: "objects",
  },
];

const valueAt = (value, path) => {
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = value[key];
  }
  return value;
};

const isUnsafeInteger = (row) =>
  row.kind === "integer" &&
  (BigInt(row.literal) > BigInt(Number.MAX_SAFE_INTEGER) ||
    BigInt(row.literal) < BigInt(Number.MIN_SAFE_INTEGER));

/** Verify the actual Foundation output and the production CLI/MCP result. */
export async function verifyKeyedArchiveIntegerArchives(root) {
  const oracle = oracleSchema.parse(
    JSON.parse(await readFile(join(root, "oracle.json"), "utf8")),
  );
  const archives = [];

  for (const format of formats) {
    const archive = oracle[format];
    for (const required of requiredRows) {
      assert.ok(
        archive.rows.some(
          (row) =>
            row.root === required.root &&
            row.kind === required.kind &&
            row.literal === required.literal &&
            (required.container === undefined ||
              row.container === required.container),
        ),
        `${format} Foundation oracle omitted ${required.root} ${required.literal}`,
      );
    }

    const archivePath = join(root, archive.filename);
    const digest = createHash("sha256")
      .update(await readFile(archivePath))
      .digest("hex");
    assert.equal(digest, archive.sha256, `${format} archive digest`);
    archives.push({ format, archive, archivePath, digest });
  }
  return archives;
}

/** Check every oracle numeric slot, preserving object-table identity lookups. */
export function assertKeyedArchiveIntegerResult(
  result,
  format,
  digest,
  oracle,
) {
  const parsed = keyedArchiveResultSchema.parse(result);
  assert.equal(parsed.archive_sha256, digest);
  assert.equal(parsed.target_sha256, digest);
  assert.equal(
    parsed.archive_format,
    format === "xml" ? "xml-plist" : "binary-plist",
  );

  for (const row of oracle.rows) {
    const unsafe = isUnsafeInteger(row);
    const source =
      row.container === "roots"
        ? parsed.roots
        : parsed.objects.find((object) => object.id === row.objectId)?.value;
    const value = valueAt(source, row.path);
    assert.notEqual(
      value,
      undefined,
      `${row.root} numeric slot remains present`,
    );

    if (unsafe) {
      const exact =
        typeof value === "object" &&
        value !== null &&
        value.$plist_type === "integer" &&
        value.decimal === BigInt(row.literal).toString();
      const disclosed = parsed.limitations.some(
        (reason) =>
          /integer|number/iu.test(reason) &&
          /precision|exact range|rounded/iu.test(reason),
      );
      assert.ok(
        exact || disclosed,
        `${row.root} ${row.literal} must be exact or disclose numeric loss`,
      );
    } else {
      assert.equal(
        typeof value,
        "number",
        `${row.root} retains its numeric type`,
      );
      assert.equal(value, Number(row.literal), `${row.root} numeric value`);
    }
  }
  return parsed;
}
