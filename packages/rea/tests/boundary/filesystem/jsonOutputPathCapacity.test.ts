import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const failure = vi.hoisted(() => ({
  parent: undefined as string | undefined,
  kind: undefined as "directory" | "content" | "destination" | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  const { dirname } = await import("node:path");
  const pathFailure = () =>
    Object.assign(new Error("controlled filesystem pathname ceiling"), {
      code: "ENAMETOOLONG",
    });
  return {
    ...filesystem,
    mkdtemp: async (...args: Parameters<typeof filesystem.mkdtemp>) => {
      if (
        failure.kind === "directory" &&
        dirname(String(args[0])) === failure.parent
      )
        throw pathFailure();
      return filesystem.mkdtemp(...args);
    },
    open: async (...args: Parameters<typeof filesystem.open>) => {
      if (
        failure.kind === "content" &&
        dirname(dirname(String(args[0]))) === failure.parent
      )
        throw pathFailure();
      return filesystem.open(...args);
    },
    realpath: async (...args: Parameters<typeof filesystem.realpath>) => {
      if (failure.kind === "destination" && String(args[0]) === failure.parent)
        throw pathFailure();
      return filesystem.realpath(...args);
    },
  };
});
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { writeTextParts } from "../../../src/application/JsonFiles.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

it.each(["directory", "content"] as const)(
  "falls back to a shorter same-filesystem staging parent after %s pathname exhaustion and removes every stage",
  async (kind) => {
    const root = await createTestTempDirectory("rea-staging-path-capacity-");
    const parent = join(root, "nested");
    await mkdir(parent);
    const resources = new ArtifactResourceScope();
    onTestFinished(() => resources.close());
    failure.parent = await realpath(parent);
    failure.kind = kind;
    try {
      const destination = join(parent, "out.json");
      const result = await writeTextParts(
        ["exact", " bytes"],
        destination,
        false,
        resources,
      );
      expect(result).toMatchObject({
        ok: true,
        value: { path: destination, bytes: 11 },
      });
      expect(await readFile(destination, "utf8")).toBe("exact bytes");
      expect(await readdir(parent)).toEqual(["out.json"]);
      expect(await readdir(root)).toEqual(["nested"]);
    } finally {
      failure.kind = undefined;
      failure.parent = undefined;
    }
  },
);

it("reports an actual selected-parent pathname refusal as a filesystem resource constraint", async () => {
  const root = await createTestTempDirectory("rea-selected-path-capacity-");
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close());
  failure.parent = root;
  failure.kind = "destination";
  try {
    const result = await writeTextParts(
      ["bytes"],
      join(root, "out.json"),
      false,
      resources,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "resource_constraint",
        category: "resource_constraint",
        retryable: false,
        details: { reason: "path-limit", boundary: "filesystem-path" },
      });
    expect(await readdir(root)).toEqual([]);
  } finally {
    failure.kind = undefined;
    failure.parent = undefined;
  }
});

it.skipIf(process.platform !== "darwin")(
  "publishes under a real macOS parent near the pathname limit when direct destination creation is supported",
  async () => {
    const root = await realpath(
      await createTestTempDirectory("rea-long-parent-"),
    );
    let parent = root;
    while (Buffer.byteLength(parent) + 201 < 1002) {
      parent = join(parent, "b".repeat(200));
      await mkdir(parent);
    }
    const remaining = 1002 - Buffer.byteLength(parent) - 1;
    if (remaining > 0) {
      parent = join(parent, "l".repeat(remaining));
      await mkdir(parent);
    }
    const bytes = "canonical output bytes";
    await writeFile(join(parent, "out.json.probe"), bytes);
    const resources = new ArtifactResourceScope();
    onTestFinished(() => resources.close());
    const destination = join(parent, "out.json");
    const result = await writeTextParts([bytes], destination, false, resources);
    expect(result.ok).toBe(true);
    expect(await readFile(destination, "utf8")).toBe(bytes);
    expect(
      (await readdir(parent)).filter((name) => name.startsWith(".rea-write-")),
    ).toEqual([]);
    expect(
      (await readdir(dirname(parent))).filter((name) =>
        name.startsWith(".rea-write-"),
      ),
    ).toEqual([]);
  },
);
