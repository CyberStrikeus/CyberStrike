import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { inspectBundleKeyedArchive } from "../../../src/artifacts/apple/KeyedArchiveReader.js";
import { plistNestingLimitMessage } from "../../../src/domain/apple/plistValue.js";
import type { OpenStepPropertyListCode } from "../../../src/domain/propertyListOpenStep.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { deeplyNestedXmlPlist } from "../../fixtures/keyedArchiveXmlNesting.js";

it.each([129, 3000])(
  "reports XML nesting of %i levels as the keyed archive decode limit",
  async (depth) => {
    const root = await createTestTempDirectory("rea-keyed-depth-");
    await writeFile(join(root, "Deep.plist"), deeplyNestedXmlPlist(depth));
    const rejected = await inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: "a".repeat(64),
      parameters: { path: "Deep.plist" },
      platform: "linux",
    }).catch((cause: unknown) => cause);
    // The format owner must reject source depth before recursive decoding
    // exhausts the call stack.
    expect(rejected).toMatchObject({
      reason: "limit",
      message: `Cannot decode selected Foundation keyed archive: ${plistNestingLimitMessage()}`,
    });
  },
);

it.each([
  ["(}", "unexpected_character", 1],
  ["{)", "unexpected_character", 1],
  ["(@", "unexpected_character", 1],
  ["{key @", "expected_equals", 5],
  ["(x @", "expected_separator", 3],
  ["(x ", "expected_separator", 3],
  ["{key ", "expected_equals", 5],
  ["{key = x,", "unexpected_character", 8],
] as const)(
  "reports OpenStep %s before a deep suffix as %s at %s",
  async (prefix, code: OpenStepPropertyListCode, position) => {
    const root = await createTestTempDirectory("rea-keyed-openstep-malformed-");
    await writeFile(join(root, "Malformed.plist"), prefix + "(".repeat(130));
    const rejected = await inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: "a".repeat(64),
      parameters: { path: "Malformed.plist" },
      platform: "linux",
    }).catch((cause: unknown) => cause);
    expect(rejected).toBeInstanceOf(ArtifactReaderFailure);
    expect(rejected).toMatchObject({
      reason: "format",
      cause: {
        _tag: "OpenStepPropertyListError",
        code,
        position,
      },
    });
  },
);

it("retains the limit classification for syntactically valid deep OpenStep values", async () => {
  const root = await createTestTempDirectory("rea-keyed-openstep-limit-");
  await writeFile(
    join(root, "Deep.plist"),
    "(".repeat(129) + "x" + ")".repeat(129),
  );
  const rejected = await inspectBundleKeyedArchive({
    bundlePath: root,
    targetSha256: "a".repeat(64),
    parameters: { path: "Deep.plist" },
    platform: "linux",
  }).catch((cause: unknown) => cause);
  expect(rejected).toMatchObject({
    reason: "limit",
    message: `Cannot decode selected Foundation keyed archive: ${plistNestingLimitMessage()}`,
  });
});

it.each([
  ["array sibling", (deep: string) => `((x),${deep})`],
  ["compound dictionary key", (deep: string) => `{(key)=${deep};}`],
] as const)(
  "retains the named OpenStep depth limit after a completed %s",
  async (_name, document) => {
    const root = await createTestTempDirectory(
      "rea-keyed-openstep-sibling-depth-",
    );
    const deep = "(".repeat(30000) + "x" + ")".repeat(30000);
    await writeFile(join(root, "Deep.plist"), document(deep));
    const rejected = await inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: "a".repeat(64),
      parameters: { path: "Deep.plist" },
      platform: "linux",
    }).catch((cause: unknown) => cause);
    expect(rejected).toMatchObject({
      reason: "limit",
      message: `Cannot decode selected Foundation keyed archive: ${plistNestingLimitMessage()}`,
    });
  },
);
