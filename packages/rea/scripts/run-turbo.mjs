#!/usr/bin/env node

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { resolveTypeScriptCompiler } from "./run-typescript.mjs";

// Compute the actual host compiler before Turbo hashes or restores its tasks.
process.env.REA_TYPESCRIPT_COMPILER = resolveTypeScriptCompiler().identity;
const require = createRequire(import.meta.url);
await import(pathToFileURL(require.resolve("turbo/bin/turbo")).href);
