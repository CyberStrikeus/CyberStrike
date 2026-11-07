import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  BUILT_TEST_PROJECTS,
  SOURCE_TEST_PROJECTS,
} from "../lib/test-projects.mjs";

const [group, ...arguments_] = process.argv.slice(2);
const projects = { source: SOURCE_TEST_PROJECTS, built: BUILT_TEST_PROJECTS }[
  group
];
if (!projects) throw new Error("Expected source or built test group");
// The group owns project selection; callers can request reporters or shards.
if (
  arguments_.some((argument) => /^--(?:project|exclude)(?:=|$)/u.test(argument))
)
  throw new Error("Test groups cannot override their project inventory");
const child = spawn(
  process.execPath,
  [
    resolve("node_modules/vitest/vitest.mjs"),
    "run",
    ...projects.flatMap(({ name }) => ["--project", name]),
    ...arguments_,
  ],
  { stdio: "inherit" },
);
let shutdownSignal;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    shutdownSignal ??= signal;
    child.kill(signal);
  });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("close", (code) => {
  process.exitCode =
    shutdownSignal === "SIGINT"
      ? 130
      : shutdownSignal === "SIGTERM"
        ? 143
        : (code ?? 1);
});
