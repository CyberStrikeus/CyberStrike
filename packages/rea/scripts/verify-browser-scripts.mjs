#!/usr/bin/env node
import { access } from "node:fs/promises";
import { verifyBrowserScriptExport } from "./lib/browser-script-export-e2e.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { requireOrdinaryWindowsVerifierCaller } from "./lib/windows-ordinary-user-verifier.mjs";

const executable = process.env.REA_BROWSER_EXECUTABLE;
if (executable === undefined || executable === "")
  throw new Error(
    "verify:browser:scripts requires REA_BROWSER_EXECUTABLE pointing to an installed Chrome-family browser",
  );
await requireOrdinaryWindowsVerifierCaller();
await access(executable);
const run = createVerifierRun();
const proof = await verifyBrowserScriptExport(executable, process.argv[2]);
process.stdout.write(
  `${JSON.stringify({ ...proof, verifier_run: await completeVerifierRun(run), verified: true })}\n`,
);
