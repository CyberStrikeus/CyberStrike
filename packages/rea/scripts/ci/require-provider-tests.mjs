import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const resources = [
  "enforces both address-space limits before any producer allocation",
  "preserves lower inherited file/CPU limits in the real launch",
];
const descriptors = [
  "capture",
  "tool",
  "limiter",
  "kernel",
  "field-tool",
  "field-limiter",
  "field-kernel",
].map(
  (member) =>
    `retains failed ${member} descriptors and retries them before further acquisition and shutdown`,
);
const requirements = {
  packet: {
    "tests/acceptance/pcapVerifier.test.ts": [
      "verifies complete and unresolved HTTP coverage with real Wireshark tools",
    ],
    "tests/boundary/captures/resourceLimits.test.ts": [
      ...resources,
      "reports a real kernel file-limit termination with its effective ceiling",
    ],
    "tests/boundary/captures/captureDescriptorCleanup.test.ts": descriptors,
  },
  signal: {
    "tests/boundary/signals/resourceLimits.test.ts": resources,
    "tests/boundary/signals/recordingDescriptorCleanup.test.ts": descriptors,
  },
};

const [lane, reportPath] = process.argv.slice(2);
if (!Object.hasOwn(requirements, lane ?? "") || !reportPath)
  throw new Error(
    "Expected provider test lane (packet or signal) and report path",
  );
const root = resolve(process.cwd());
const rootPrefix = `${root}${sep}`;
const reportFile = resolve(root, reportPath);
if (!reportFile.startsWith(rootPrefix)) {
  const failure = { code: "report_path_outside_checkout" };
  throw Object.assign(new Error(JSON.stringify(failure)), failure);
}
const report = JSON.parse(await readFile(reportFile, "utf8"));
if (report?.success !== true || !Array.isArray(report.testResults))
  throw new Error(
    "Provider test report is missing a successful test inventory",
  );
for (const [path, cases] of Object.entries(requirements[lane])) {
  const matches = report.testResults.filter((file) => {
    if (typeof file?.name !== "string") return false;
    const filePath = relative(process.cwd(), resolve(file.name));
    return !isAbsolute(filePath) && filePath.split(sep).join("/") === path;
  });
  if (matches.length !== 1 || !Array.isArray(matches[0].assertionResults))
    throw new Error(`Expected exactly one provider test result for ${path}`);
  for (const name of cases) {
    const results = matches[0].assertionResults.filter(
      (test) => test?.fullName === name,
    );
    if (results.length !== 1 || results[0].status !== "passed")
      throw new Error(`Required provider test did not pass: ${path}: ${name}`);
  }
}
console.log(`Required ${lane} resource and cleanup cases passed`);
