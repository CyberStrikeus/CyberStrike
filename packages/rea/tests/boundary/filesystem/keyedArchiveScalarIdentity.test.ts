import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "plist";
import { expect, it } from "vitest";
import { inspectBundleKeyedArchive } from "../../../src/artifacts/apple/KeyedArchiveReader.js";
import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { keyedArchiveUidBytes } from "../../fixtures/keyedArchiveThreeByteUid.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const cases = [
  "unsafe-integer",
  "integral-real",
  "hexadecimal-integer",
  "unsafe-hexadecimal-integer",
] as const;
const fixture = async (kind: (typeof cases)[number]) => {
  const root = await createTestTempDirectory("rea-integer-scalar-");
  const xml = build({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: ["$null", "__VALUE__"],
    $top: { root: { CF$UID: 1 } },
  }).replace(
    "<string>__VALUE__</string>",
    kind === "unsafe-integer"
      ? "<integer>9007199254740993</integer>"
      : kind === "hexadecimal-integer"
        ? "<integer>0x2A</integer>"
        : kind === "unsafe-hexadecimal-integer"
          ? "<integer>0x20000000000001</integer>"
          : "<real>9007199254740992</real>",
  );
  const bytes = Buffer.from(xml);
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
  kind: (typeof cases)[number],
  digest: string,
) => {
  expect(result.archive_sha256).toBe(digest);
  expect(result.roots).toEqual({ root: { CF$UID: 1 } });
  expect(
    result.objects.map(({ id, kind: objectKind, status }) => ({
      id,
      kind: objectKind,
      status,
    })),
  ).toEqual([
    { id: 0, kind: "nil", status: "nil" },
    { id: 1, kind: "scalar", status: "observed" },
  ]);
  expect(result.references).toEqual([
    {
      source: null,
      path: ["root"],
      target: 1,
      status: "resolved",
      raw: { CF$UID: 1 },
    },
  ]);
  expect(result.total_objects).toBe(2);
  expect(result.total_references).toBe(1);
  expect(result.offset).toBe(0);
  expect(result.next_offset).toBeNull();
  expect(result.truncated).toBe(false);
  const value = result.objects.find(({ id }) => id === 1)?.value;
  expect(value).toBeDefined();
  const precisionNote = result.limitations.some(
    (note) =>
      /integer|number/iu.test(note) &&
      /precision|exact range|rounded|completely observed/iu.test(note),
  );
  if (kind === "integral-real") expect(value).toBe(9007199254740992);
  else if (kind === "hexadecimal-integer") {
    // Apple's parser reads 0x2A as 42; the literal is classified, not unknown.
    expect(value).toBe(42);
    expect(precisionNote).toBe(false);
  } else if (kind === "unsafe-hexadecimal-integer") {
    expect(value).toEqual({
      $plist_type: "integer",
      decimal: "9007199254740993",
    });
  } else {
    const exact =
      typeof value === "object" &&
      value !== null &&
      JSON.stringify(value) ===
        JSON.stringify({ $plist_type: "integer", decimal: "9007199254740993" });
    const disclosed = result.limitations.some(
      (note) =>
        /integer|number/iu.test(note) &&
        /precision|exact range|rounded/iu.test(note),
    );
    expect(exact || disclosed).toBe(true);
  }
};
it.each(cases)(
  "filesystem preserves primitive scalar graph for %s",
  async (kind) => {
    const item = await fixture(kind);
    verify(
      await inspectBundleKeyedArchive({
        bundlePath: item.root,
        targetSha256: item.digest,
        parameters: { path: "archive.plist", limit: 100 },
      }),
      kind,
      item.digest,
    );
  },
);
cliTest.for(cases)(
  "built CLI preserves primitive scalar graph for %s",
  async (kind, { cli }) => {
    const item = await fixture(kind);
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", item.path, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode).toBe(0);
    verify(
      keyedArchiveResultSchema.parse(
        parseEvidence(output.json).normalized_result,
      ),
      kind,
      item.digest,
    );
  },
);

cliTest.for(["three-byte-uid"] as const)(
  "preserves three-byte UID identity through the keyed-archive CLI",
  async (_kind, { cli }) => {
    const root = await createTestTempDirectory("rea-keyed-three-byte-uid-");
    const path = join(root, "archive.plist");
    const bytes = keyedArchiveUidBytes();
    const digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes);
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", path, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode).toBe(0);
    const result = keyedArchiveResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.archive_sha256).toBe(digest);
    expect(result.roots).toEqual({ root: { UID: 66051 } });
    expect(result.references).toContainEqual({
      source: null,
      path: ["root"],
      target: 66051,
      status: "unresolved",
      raw: { UID: 66051 },
    });
  },
);

cliTest(
  "reports an inexact binary UID as unsupported without changing the artifact",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-inexact-uid-");
    const path = join(root, "archive.plist");
    const bytes = keyedArchiveUidBytes(8, BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    const originalHash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes);

    const output = await cli.run({
      arguments: ["inspect-keyed-archive", path, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });

    expect(output.exitCode).toBe(1);
    expect(output.json).toMatchObject({
      code: "unsupported_target",
      message: expect.stringContaining("9007199254740992"),
    });
    const after = await readFile(path);
    expect(Buffer.compare(after, bytes)).toBe(0);
    expect(createHash("sha256").update(after).digest("hex")).toBe(originalHash);
  },
);
