import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Compile source-owned fixtures using explicitly supplied, pinned toolchains. */
export async function buildRecoveryFixtures(root, prefix) {
  if (!prefix)
    throw new Error(
      "verify:javascript:recovery requires REA_JAVASCRIPT_FIXTURE_TOOLS pointing to the isolated esbuild/webpack installation",
    );
  const require = createRequire(join(prefix, "package.json"));
  const esbuild = require("esbuild");
  const webpack = require("webpack");
  const webpackVersion = require("webpack/package.json").version;
  if (esbuild.version !== "0.25.10" || webpackVersion !== "5.101.3")
    throw new Error(
      "Fixture compilers must be esbuild 0.25.10 and webpack 5.101.3",
    );
  const source = fileURLToPath(new URL("./entry.mjs", import.meta.url));
  const webpackOutput = join(root, "webpack");
  await mkdir(webpackOutput);
  const compileWebpack = async (options) =>
    new Promise((resolve, reject) => {
      const compiler = webpack(options);
      compiler.run((error, stats) => {
        compiler.close((closeError) => {
          if (error || closeError) return reject(error ?? closeError);
          if (!stats || stats.hasErrors())
            return reject(new Error(stats?.toString() ?? "No webpack stats"));
          resolve();
        });
      });
    });
  await compileWebpack({
    mode: "production",
    entry: source,
    parallelism: 1,
    optimization: { concatenateModules: false },
    output: { path: webpackOutput, filename: "bundle.js" },
  });
  const splitOutput = join(root, "webpack-code-split");
  await mkdir(splitOutput);
  const splitSource = fileURLToPath(
    new URL("./code-split/entry.mjs", import.meta.url),
  );
  await compileWebpack({
    mode: "production",
    entry: splitSource,
    parallelism: 1,
    optimization: {
      concatenateModules: false,
      runtimeChunk: "single",
      splitChunks: {
        chunks: "all",
        minSize: 0,
        cacheGroups: {
          shared: { test: /shared\.mjs$/u, name: "shared", enforce: true },
        },
      },
    },
    output: {
      path: splitOutput,
      filename: "[name].js",
      chunkFilename: "[id].chunk.js",
    },
  });
  const splitFiles = (await readdir(splitOutput))
    .filter((name) => name !== "main.js")
    .sort();
  if (splitFiles.length !== 3)
    throw new Error("Expected runtime, shared and lazy chunks");
  const esbuildPath = join(root, "esbuild.js");
  await esbuild.build({
    entryPoints: [source],
    outfile: esbuildPath,
    bundle: true,
    format: "iife",
    minify: true,
    logLevel: "silent",
  });
  // One self-contained source fixture avoids unresolved imports in the oracle.
  const helperSource = await readFile(
    fileURLToPath(new URL("./helpers.mjs", import.meta.url)),
    "utf8",
  );
  const plain = await esbuild.transform(
    helperSource.replaceAll("export ", "") +
      "\nglobalThis.recoveryFixture = {greet, total};",
    { minify: true },
  );
  const minifiedPath = join(root, "minified.js");
  await writeFile(minifiedPath, plain.code);
  if (plain.code.length === 0)
    throw new Error("Expected a real minifier output");
  return {
    files: [
      {
        name: "minified",
        path: minifiedPath,
        expectedFormat: "unknown",
        expectedModules: 1,
      },
      {
        name: "webpack",
        path: join(webpackOutput, "bundle.js"),
        expectedFormat: "webpack5",
        expectedModules: 2,
      },
      {
        name: "esbuild-scope-hoisted",
        path: esbuildPath,
        expectedFormat: "unknown",
        expectedModules: 1,
      },
      {
        name: "heuristic-aggressive",
        path: minifiedPath,
        expectedFormat: "unknown",
        expectedModules: 1,
        options: { extraction_mode: "heuristic", rewrite_level: "aggressive" },
      },
      {
        name: "inspection-minimal",
        path: join(webpackOutput, "bundle.js"),
        expectedFormat: "webpack5",
        expectedModules: 2,
        options: { extraction_mode: "inspection", rewrite_level: "minimal" },
      },
    ],
    codeSplit: {
      name: "webpack-code-split",
      path: join(splitOutput, "main.js"),
      additional_paths: splitFiles.map((name) => join(splitOutput, name)),
      expectedFormat: "webpack5",
      expectedModules: 4,
    },
    toolchains: { esbuild: esbuild.version, webpack: webpackVersion },
  };
}
