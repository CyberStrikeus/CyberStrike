import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { plistNestingLimitMessage } from "../domain/apple/plistValue.js";
import { resolveAppBundleExecutable } from "./AppBundleExecutable.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

describe("OpenStep Info.plist nesting during app target resolution", () => {
  it.each([127, 128, 3000])(
    "applies the shared bound to %s nested payload arrays",
    async (depth) => {
      const root = await createTestTempDirectory("rea-app-openstep-depth-");
      const app = join(root, "Example.app");
      const programs = join(app, "Contents", "MacOS");
      await mkdir(programs, { recursive: true });
      await writeFile(join(programs, "App"), "inert program-path fixture");
      await writeFile(
        join(app, "Contents", "Info.plist"),
        `{ CFBundleExecutable = App; payload = ${"(".repeat(depth)}x${")".repeat(depth)}; }`,
      );

      const result = await resolveAppBundleExecutable(app);

      if (depth === 127) {
        expect(result).toMatchObject({
          ok: true,
          value: { executable: join(programs, "App") },
        });
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: {
            path: join(app, "Contents", "Info.plist"),
            cause: expect.objectContaining({
              message: plistNestingLimitMessage(),
            }),
          },
        });
      }
    },
  );

  it("resolves the first Info.plist root without decoding deeply nested trailing text", async () => {
    const root = await createTestTempDirectory("rea-app-openstep-trailing-");
    const app = join(root, "Example.app");
    const programs = join(app, "Contents", "MacOS");
    await mkdir(programs, { recursive: true });
    await writeFile(join(programs, "App"), "inert program-path fixture");
    await writeFile(
      join(app, "Contents", "Info.plist"),
      `{ CFBundleExecutable = App; }${"(".repeat(3000)}x${")".repeat(3000)}`,
    );

    expect(await resolveAppBundleExecutable(app)).toMatchObject({
      ok: true,
      value: { executable: join(programs, "App") },
    });
  });
});
