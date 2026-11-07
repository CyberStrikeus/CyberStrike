import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseOpenStep } from "plist";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { resolveAppBundleExecutable } from "./AppBundleExecutable.js";

it.each([
  ["no comment", ""],
  ["block comment", "/* App metadata */\n"],
  ["line comment", "// App metadata\n"],
  ["mixed comments", " \t/* header */\n// executable selection\n"],
])("resolves an OpenStep Info.plist with %s", async (_label, prefix) => {
  const root = await createTestTempDirectory("rea-openstep-bundle-");
  const bundle = join(root, "Fixture.app");
  const programs = join(bundle, "Contents", "MacOS");
  const executable = join(programs, "Fixture");
  const infoPlist = join(bundle, "Contents", "Info.plist");
  const source = `${prefix}{ CFBundleExecutable = Fixture; }`;
  expect(parseOpenStep(source)).toEqual({ CFBundleExecutable: "Fixture" });
  await mkdir(programs, { recursive: true });
  await writeFile(infoPlist, source);
  await writeFile(executable, "fixture - never executed");

  expect(await resolveAppBundleExecutable(bundle)).toEqual({
    ok: true,
    value: { executable, infoPlist },
  });
});
