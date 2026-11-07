import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { expect } from "vitest";
import { processTest } from "../../support/process/processFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { windowsNativeArtifactFixture } from "../../fixtures/windowsNativeArtifact.js";

const repository = fileURLToPath(new URL("../../..", import.meta.url));

/** Copy the selected entry's relative ESM graph; package dependencies stay absent. */
const copyModuleGraph = async (root: string, entry: string): Promise<void> => {
  const pending = [join(repository, entry)];
  const copied = new Set<string>();
  while (pending.length > 0) {
    const source = pending.pop();
    if (source === undefined || copied.has(source)) continue;
    copied.add(source);
    const output = join(root, relative(repository, source));
    const text = await readFile(source, "utf8");
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
    for (const node of parse(text, {
      sourceType: "module",
      plugins: ["typescript"],
    }).program.body) {
      if (
        node.type !== "ImportDeclaration" &&
        node.type !== "ExportNamedDeclaration" &&
        node.type !== "ExportAllDeclaration"
      )
        continue;
      const specifier = node.source?.value;
      if (!specifier?.startsWith(".")) continue;
      let dependency = resolve(dirname(source), specifier);
      try {
        await access(dependency);
      } catch (cause) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT" &&
          dependency.endsWith(".js") &&
          source.endsWith(".ts")
        )
          dependency = dependency.slice(0, -3) + ".ts";
        else throw cause;
      }
      pending.push(dependency);
    }
  }
};

for (const mode of ["preinstall source", "packed source-free"]) {
  processTest(
    `verifies native artifact identity from ${mode} without installed dependencies`,
    async ({ processes }) => {
      const root = await createTestTempDirectory(
        "rea-native-artifact-verifier-",
      );
      await mkdir(join(root, "scripts"), { recursive: true });
      await copyFile(
        join(repository, "scripts/verify-windows-native-artifact.mjs"),
        join(root, "scripts/verify-windows-native-artifact.mjs"),
      );
      if (mode === "preinstall source")
        await copyModuleGraph(root, "scripts/lib/verifier-source-loader.mjs");
      await copyModuleGraph(
        root,
        mode === "preinstall source"
          ? "src/domain/windowsNativeArtifact.ts"
          : "dist/domain/windowsNativeArtifact.js",
      );
      await expect(access(join(root, "node_modules"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      if (mode === "packed source-free") {
        await expect(access(join(root, "src"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          access(join(root, "scripts/lib/verifier-source-loader.mjs")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ type: "module", version: "1.0.0" }),
      );
      const artifactRoot = join(root, "native/windows/build");
      await mkdir(artifactRoot, { recursive: true });
      const { bytes, manifest } = windowsNativeArtifactFixture();
      await writeFile(join(artifactRoot, manifest.artifact), bytes);
      const manifestPath = join(artifactRoot, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest));
      const run = () =>
        processes.run(
          process.execPath,
          [join(root, "scripts/verify-windows-native-artifact.mjs")],
          { cwd: root, timeoutMs: 10_000 },
        );
      const valid = await run();
      expect(valid.exitCode, valid.stderr).toBe(0);
      expect(JSON.parse(valid.stdout)).toEqual({
        ok: true,
        ...manifest,
        artifactBytes: bytes.length,
      });
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, extra: true }),
      );
      const invalid = await run();
      expect(invalid.exitCode).not.toBe(0);
      expect(invalid.stderr).toContain("missing or unknown fields");
    },
  );
}
