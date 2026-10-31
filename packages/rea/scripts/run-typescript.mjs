#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Use the pinned package's platform inventory; let its launcher select libc. */
export const selectTypeScriptCompiler = (
  platform,
  arch,
  optionalDependencies,
) => {
  if (platform === "win32") return "typescript";
  const prefix = `@tsrs/${platform}-${arch}`;
  return Object.keys(optionalDependencies).some(
    (name) => name === prefix || name.startsWith(`${prefix}-`),
  )
    ? "tsrs"
    : "typescript";
};

export const resolveTypeScriptCompiler = () => {
  const require = createRequire(import.meta.url);
  const rustPackagePath = require.resolve("tsrs/package.json");
  const rustPackage = JSON.parse(readFileSync(rustPackagePath, "utf8"));
  const compiler = selectTypeScriptCompiler(
    process.platform,
    process.arch,
    rustPackage.optionalDependencies,
  );
  const packagePath =
    compiler === "tsrs"
      ? rustPackagePath
      : require.resolve("typescript/package.json");
  const metadata =
    compiler === "tsrs"
      ? rustPackage
      : JSON.parse(readFileSync(packagePath, "utf8"));
  const command = compiler === "tsrs" ? "tsrs" : "tsc";
  return {
    name: compiler,
    identity: `${compiler}@${metadata.version}`,
    launcher: resolve(dirname(packagePath), metadata.bin[command]),
  };
};

const main = async () => {
  const compiler = resolveTypeScriptCompiler();
  if (
    process.env.TURBO_HASH !== undefined &&
    process.env.REA_TYPESCRIPT_COMPILER !== compiler.identity
  )
    throw new Error(
      "Compiler identity is missing or stale. Run Turbo through scripts/run-turbo.mjs.",
    );
  if (compiler.name === "tsrs") {
    const args = process.argv.slice(2);
    // Rust consumes --maxMemory once; duplicating it becomes an unknown option.
    // Preserve explicit resource choices rather than injecting another value.
    const defaults = [
      ["--checkers", String(Math.min(2, availableParallelism()))],
      ["--maxMemory", "3G"],
    ].flatMap(([option, value]) =>
      args.includes(option) ? [] : [option, value],
    );
    process.argv.splice(2, 0, ...defaults);
  }
  // Delegate execution, diagnostics, status and signals to the package's launcher.
  // An unavailable binary on a supported host must fail rather than hide drift.
  await import(pathToFileURL(compiler.launcher).href);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
