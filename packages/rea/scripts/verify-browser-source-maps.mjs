#!/usr/bin/env node
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { verifyBrowserSourceMap } from "./lib/browser-source-map-e2e.mjs";
import { verifyBrowserNestedSourceMaps } from "./lib/browser-nested-source-map-e2e.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { requireOrdinaryWindowsVerifierCaller } from "./lib/windows-ordinary-user-verifier.mjs";

await requireOrdinaryWindowsVerifierCaller();
const executable = process.env.REA_BROWSER_EXECUTABLE;
if (!executable || !isAbsolute(executable))
  throw new Error(
    "verify:browser:source-maps requires absolute REA_BROWSER_EXECUTABLE pointing to caller-supplied Chromium",
  );
await access(executable);
const run = createVerifierRun();
const proof = await verifyBrowserSourceMap(executable, process.argv[2]);
const nested = await verifyBrowserNestedSourceMaps(executable, process.argv[2]);
process.stdout.write(
  `${JSON.stringify({ ...proof, nested_source_maps: nested, verifier_run: await completeVerifierRun(run), verified: true })}\n`,
);
