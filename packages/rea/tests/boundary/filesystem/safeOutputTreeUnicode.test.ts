import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";

const boundary = vi.hoisted(() => ({ decomposed: false }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (...args: unknown[]) => {
      const entries: unknown = await Reflect.apply(
        actual.readdir,
        undefined,
        args,
      );
      return boundary.decomposed &&
        Array.isArray(entries) &&
        entries.every((name): name is string => typeof name === "string")
        ? entries.map((name) => name.normalize("NFD"))
        : entries;
    },
  };
});

const writeAccent = async (tree: SafeOutputTree) => {
  const bytes = Buffer.from("owned");
  await tree.write("café.txt", Readable.from([bytes]), {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
};

it("accepts a decomposed directory listing while verifying the original owned file identity", async () => {
  const root = await createTestTempDirectory("rea-output-unicode-");
  const tree = await SafeOutputTree.create(join(root, "output"));
  await writeAccent(tree);
  boundary.decomposed = true;
  try {
    await tree.commit();
    expect(tree.published).toBe(true);
  } finally {
    boundary.decomposed = false;
    await tree.closeHandles();
  }
});

it.skipIf(process.platform !== "linux")(
  "does not collapse an additional canonically equivalent foreign filename",
  async () => {
    const root = await createTestTempDirectory("rea-output-unicode-foreign-");
    const output = join(root, "output");
    const tree = await SafeOutputTree.create(output);
    await writeAccent(tree);
    const foreign = join(output, "cafe\u0301.txt");
    await writeFile(foreign, "foreign", { flag: "wx" });
    try {
      await expect(tree.commit()).rejects.toThrow("Unowned or missing");
      expect(await readFile(foreign, "utf8")).toBe("foreign");
    } finally {
      await tree.closeHandles();
    }
  },
);
