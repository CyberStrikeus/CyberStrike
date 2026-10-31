import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPeResourcesService } from "../../../src/composition/binaryDiagnostics.js";
import { peResourceFixture } from "../../../src/native/pe/PeResources.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("PE resource stable filesystem boundary", () => {
  it("reports non-file and malformed PE selections as caller input errors", async () => {
    const root = await createTestTempDirectory("rea-pe-resource-files-");
    const path = join(root, "image.exe");
    const alias = join(root, "alias.exe");
    const malformed = join(root, "malformed.exe");
    await writeFile(path, peResourceFixture().bytes);
    await writeFile(malformed, Buffer.from("not a PE image"));
    await symlink(path, alias);
    const service = createPeResourcesService();
    for (const [candidate, reason] of [
      [root, "invalid_format"],
      [alias, "invalid_format"],
      [malformed, "invalid_format"],
      [join(root, "missing.exe"), "invalid_value"],
      [join(path, "child.exe"), "invalid_value"],
    ] as const) {
      const result = await service.inspect({ path: candidate });
      if (result.ok) throw new Error("Expected file acquisition failure");
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        operation: "inspect_pe_resources",
        issues: [
          {
            path: ["path"],
            reason,
            message: expect.any(String),
          },
        ],
      });
    }
  });

  it.skipIf(process.platform === "win32")(
    "reports a native symlink-loop failure as invalid selected-path input",
    async () => {
      const root = await createTestTempDirectory("rea-pe-resource-path-loop-");
      const loop = join(root, "loop");
      await symlink(loop, loop, "dir");
      const path = join(loop, "image.exe");
      const result = await createPeResourcesService().inspect({ path });
      if (result.ok) throw new Error("Expected symlink-loop failure");
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        operation: "inspect_pe_resources",
        issues: [
          {
            path: ["path"],
            reason: "invalid_value",
            message: expect.stringContaining("ELOOP"),
          },
        ],
        cause: { code: "ELOOP" },
      });
    },
  );

  it("returns typed resource and cancellation failures", async () => {
    const root = await createTestTempDirectory("rea-pe-resource-budget-");
    const path = join(root, "image.exe");
    await writeFile(path, peResourceFixture().bytes);
    const service = createPeResourcesService();
    for (const input of [
      { path, max_file_bytes: 64 },
      { path, max_entries: 1 },
    ]) {
      const result = await service.inspect(input);
      if (result.ok) throw new Error("Expected resource budget failure");
      expect(result.error._tag).toBe("AnalysisResourceConstraintError");
    }
    const result = await service.inspect(
      { path },
      { signal: AbortSignal.abort() },
    );
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
  });

  it("admits the largest measured stock Windows resource table by default", async () => {
    // Windows 11 25H2 SystemResources measures imageres.dll.mun at 6476
    // examined entries; the default budget must admit real system images, not
    // only small fixtures. Two types with 1620 and 1617 one-language names
    // examine 2 + 2 * 3237 entries.
    const resources = [
      ...Array.from({ length: 1620 }, (_unused, index) => ({
        type: 10,
        name: index + 1,
        language: 1033,
        payload: Buffer.from([index % 256]),
      })),
      ...Array.from({ length: 1617 }, (_unused, index) => ({
        type: 3,
        name: index + 1,
        language: 1033,
        payload: Buffer.from([index % 256]),
      })),
    ];
    const root = await createTestTempDirectory("rea-pe-resource-stock-scale-");
    const path = join(root, "image.exe");
    await writeFile(path, peResourceFixture(false, resources, 262144).bytes);
    const result = await createPeResourcesService().inspect({ path });
    if (!result.ok)
      throw new Error(
        `Expected the default budgets to admit the image: ${result.error.message}`,
      );
    expect(result.value.normalized_result).toMatchObject({
      coverage: {
        status: "complete",
        examined_entries: 6476,
        resources: 3237,
      },
    });
  });
});
