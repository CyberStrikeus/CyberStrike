import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build, buildBinary, parseBinary } from "plist";
import { expect, it } from "vitest";
import { inspectBundleKeyedArchive } from "../../../src/artifacts/apple/KeyedArchiveReader.js";
import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const scenarios = [
  "integer-collision",
  "integer-real-collision",
  "opaque-xml",
  "supplemental-binary-table",
] as const;
const fixture = async (scenario: (typeof scenarios)[number]) => {
  const root = await createTestTempDirectory("rea-integer-ambiguity-");
  const fields =
    scenario === "integer-collision"
      ? { first: "__FIRST__", second: "__SECOND__" }
      : scenario === "integer-real-collision"
        ? { first: "__FIRST__", real: "__REAL__" }
        : {
            first: "__FIRST__",
            real: "__REAL__",
            text: "<integer>9007199254740993</integer>",
          };
  const source = {
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: ["$null", fields],
    $top: { root: { CF$UID: 1 } },
  };
  let bytes: Buffer;
  if (scenario === "supplemental-binary-table") {
    bytes = Buffer.from(
      buildBinary({
        ...source,
        $top: { root: { UID: 1 } },
        $objects: ["$null", { real: 9007199254740992 }],
      }),
    );
    const trailer = bytes.length - 32;
    // Add one unreachable offset entry backed by the first trailer byte. The
    // locked primary decoder accepts it; supplemental pre-trailer capacity does not.
    bytes.writeBigUInt64BE(
      bytes.readBigUInt64BE(trailer + 8) + 1n,
      trailer + 8,
    );
    const original = parseBinary(bytes);
    expect(original).toMatchObject({
      $objects: ["$null", { real: 9007199254740992 }],
    });
  } else {
    let xml = build(source)
      .replace(
        "<string>__FIRST__</string>",
        `<integer>${scenario === "integer-collision" ? "9007199254740992" : "9007199254740993"}</integer>`,
      )
      .replace(
        "<string>__SECOND__</string>",
        "<integer>9007199254740993</integer>",
      )
      .replace(
        "<string>__REAL__</string>",
        `<real>${scenario === "opaque-xml" ? "9007199254740996" : "9007199254740992"}</real>`,
      );
    if (scenario === "opaque-xml")
      xml = xml.replace(
        "</plist>",
        "<!-- <integer>9007199254740993</integer><real>9007199254740992</real> --></plist>",
      );
    bytes = Buffer.from(xml);
  }
  const path = join(root, "archive.plist");
  await writeFile(path, bytes);
  return {
    root,
    path,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
};
const verify = (
  result: ReturnType<typeof keyedArchiveResultSchema.parse>,
  scenario: (typeof scenarios)[number],
  digest: string,
) => {
  expect(result.archive_sha256).toBe(digest);
  expect(result.objects).toHaveLength(2);
  expect(result.references).toContainEqual(
    expect.objectContaining({ source: null, target: 1, status: "resolved" }),
  );
  const value = result.objects.find(({ id }) => id === 1)?.value;
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  expect(typeof value).toBe("object");
  const fields = value as Record<string, unknown>;
  const precisionNote = result.limitations.some(
    (note) =>
      /integer|number/iu.test(note) &&
      /precision|exact range|rounded/iu.test(note),
  );
  if (scenario === "integer-collision") {
    // Neither colliding decoded slot may be assigned one arbitrary exact literal.
    expect(fields.first).toBe(9007199254740992);
    expect(fields.second).toBe(9007199254740992);
    expect(precisionNote).toBe(true);
  } else if (scenario === "integer-real-collision") {
    expect(fields.first).toBe(9007199254740992);
    expect(fields.real).toBe(9007199254740992);
    expect(precisionNote).toBe(true);
  } else if (scenario === "opaque-xml") {
    expect(fields.text).toBe("<integer>9007199254740993</integer>");
    expect(fields.real).toBe(9007199254740996);
    expect(fields.first).toBeDefined();
    const exact =
      typeof fields.first === "object" &&
      fields.first !== null &&
      JSON.stringify(fields.first) ===
        JSON.stringify({ $plist_type: "integer", decimal: "9007199254740993" });
    expect(exact || precisionNote).toBe(true);
    // If a literal count is reported, opaque content must not inflate it.
    const countNote = result.limitations.find((note) =>
      /integer literal\(s\)/u.test(note),
    );
    if (countNote !== undefined)
      expect(countNote).toMatch(/^1 observed integer literal/u);
  } else {
    expect(fields.real).toBe(9007199254740992);
  }
};
it.each(scenarios)(
  "filesystem retains numeric meaning for %s",
  async (scenario) => {
    const item = await fixture(scenario);
    const result = await inspectBundleKeyedArchive({
      bundlePath: item.root,
      targetSha256: item.digest,
      parameters: { path: "archive.plist", limit: 100 },
    });
    verify(result, scenario, item.digest);
  },
);
cliTest.for(scenarios)(
  "built CLI retains numeric meaning for %s",
  async (scenario, { cli }) => {
    const item = await fixture(scenario);
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", item.path, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode).toBe(0);
    verify(
      keyedArchiveResultSchema.parse(
        parseEvidence(output.json).normalized_result,
      ),
      scenario,
      item.digest,
    );
  },
);
