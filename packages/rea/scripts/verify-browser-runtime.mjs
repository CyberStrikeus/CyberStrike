#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyBrowserRuntime } from "./lib/browser-runtime-e2e.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

const executable = process.env.REA_BROWSER_EXECUTABLE;
if (executable === undefined)
  throw new Error(
    "verify:browser:runtime requires caller-supplied REA_BROWSER_EXECUTABLE",
  );
if (process.platform !== "win32") {
  try {
    await promisify(execFile)("ps", ["-p", String(process.pid), "-o", "pid="], {
      timeout: 5_000,
    });
  } catch (cause) {
    throw new Error(
      "verify:browser:runtime requires the host ps command for owned fixture cleanup",
      { cause },
    );
  }
}
const run = createVerifierRun();
const result = await verifyBrowserRuntime(executable, process.argv[2]);
console.log(
  JSON.stringify(
    { status: "passed", ...result, verifier: await completeVerifierRun(run) },
    null,
    2,
  ),
);
