import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { objcRecordBudgetMacho } from "../../../fixtures/objcRecordBudgetMacho.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const sectionCases = [
  {
    section: "__objc_classlist",
    size: 12,
    reason: "Misaligned Objective-C class-list size",
  },
  {
    section: "__objc_protolist",
    size: 12,
    reason: "Misaligned Objective-C protocol list",
  },
  {
    section: "__objc_catlist",
    size: 12,
    reason: "Misaligned Objective-C category list",
  },
  {
    section: "__swift5_types",
    size: 6,
    reason: "Misaligned Swift type section",
  },
  {
    section: "__swift5_proto",
    size: 6,
    reason: "Misaligned Swift conformance section",
  },
];

const inspect = async (bytes: Buffer) => {
  const root = await createTestTempDirectory("rea-dispatch-format-");
  const path = join(root, "fixture.macho");
  await writeFile(path, bytes);
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
  ).createClient(await nativeMachoTargetForFile(path));
  try {
    return {
      path,
      result: await client.execute("inspect_native_dispatch_metadata", {}),
    };
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
};

it.each(sectionCases)(
  "reports malformed $section bytes as a target refusal with the producing reason",
  async ({ section, size, reason }) => {
    const bytes = objcRecordBudgetMacho("class");
    bytes.fill(0, 104, 120);
    bytes.write(section, 104);
    bytes.writeBigUInt64LE(BigInt(size), 144);
    const { path, result } = await inspect(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed target refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unsupported_target",
      category: "unsupported_target",
      details: { operation: "inspect_native_dispatch_metadata", path, reason },
    });
  },
);

it("keeps an unsupported big-endian CPU declaration distinct from provider failure", async () => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(0xfeedfacf);
  bytes.writeUInt32BE(0x0100000c, 4);
  bytes.writeUInt32BE(2, 12);
  const { path, result } = await inspect(bytes);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected unsupported target refusal");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unsupported_target",
    category: "unsupported_target",
    details: { path, reason: "Unsupported big-endian Mach-O CPU type" },
  });
});

it("continues decoding the well-formed eight-byte class-list control", async () => {
  const { result } = await inspect(objcRecordBudgetMacho("class"));
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    result: {
      objc_classes: [expect.objectContaining({ name: "FixtureClass" })],
    },
  });
});
