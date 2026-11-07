import { CI_FLAGS, CI_LANES } from "./scopes.mjs";
import { recordQualification } from "./qualification.mjs";

const jobs = JSON.parse(process.env.CI_JOBS);
const outputs = jobs?.changes?.outputs;
if (!["fast", "full", "reused"].includes(outputs?.tier))
  throw new Error(
    "CI classification requires a valid tier: fast, full, or reused",
  );
const invalidFlags = CI_FLAGS.filter(
  (flag) => outputs[flag] !== "true" && outputs[flag] !== "false",
);
if (invalidFlags.length)
  throw new Error(
    `CI classification requires explicit true/false scope outputs: ${invalidFlags.join(", ")}`,
  );
const selectedScopes = CI_FLAGS.filter((flag) => outputs[flag] === "true");
const reused = outputs.tier === "reused";
if (
  reused &&
  (process.env.GITHUB_EVENT_NAME !== "schedule" ||
    !/^[1-9]\d*$/.test(outputs.qualification_run_id ?? "") ||
    !Number.isSafeInteger(Number(outputs.qualification_run_id)) ||
    selectedScopes.length !== 0)
)
  throw new Error(
    "Reused qualification requires a scheduled admission receipt and no selected lanes",
  );
if (outputs.tier === "full" && selectedScopes.length !== CI_FLAGS.length)
  throw new Error("Full qualification requires every canonical CI scope");
const required = reused ? ["changes"] : ["changes", "static", "test"];
if (outputs.tier === "full") required.push("static-deep");
for (const scope of selectedScopes)
  required.push(...CI_LANES[scope].required[outputs.tier]);
const failed = [...new Set(required)].filter(
  (name) => jobs[name]?.result !== "success",
);
for (const [name, job] of Object.entries(jobs)) {
  if (["failure", "cancelled"].includes(job.result) && !failed.includes(name))
    failed.push(name);
}
if (failed.length)
  throw new Error(`CI lanes did not pass: ${failed.join(", ")}`);
console.log("Every selected CI lane passed");
if (reused)
  console.log(
    `Qualification reused from run ${outputs.qualification_run_id}; no fresh provider observation`,
  );
if (outputs.tier === "full" && process.env.CI_QUALIFICATION_DIRECTORY)
  recordQualification(process.env.CI_QUALIFICATION_DIRECTORY);
