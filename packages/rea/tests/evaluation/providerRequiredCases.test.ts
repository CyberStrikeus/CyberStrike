import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const script = fileURLToPath(
  new URL("../../scripts/ci/require-provider-tests.mjs", import.meta.url),
);
const cleanupCases = [
  "capture",
  "tool",
  "limiter",
  "kernel",
  "field-tool",
  "field-limiter",
  "field-kernel",
].map(
  (item) =>
    `retains failed ${item} descriptors and retries them before further acquisition and shutdown`,
);
const commonLimits = [
  "enforces both address-space limits before any producer allocation",
  "preserves lower inherited file/CPU limits in the real launch",
];
const testFile = (path: string, names: string[]) => ({
  name: resolve(path),
  assertionResults: names.map((fullName) => ({ fullName, status: "passed" })),
});
const report = (lane: "packet" | "signal") => ({
  success: true,
  testResults:
    lane === "packet"
      ? [
          testFile("tests/boundary/captures/resourceLimits.test.ts", [
            ...commonLimits,
            "reports a real kernel file-limit termination with its effective ceiling",
          ]),
          testFile(
            "tests/boundary/captures/captureDescriptorCleanup.test.ts",
            cleanupCases,
          ),
          testFile("tests/acceptance/pcapVerifier.test.ts", [
            "verifies complete and unresolved HTTP coverage with real Wireshark tools",
          ]),
        ]
      : [
          testFile(
            "tests/boundary/signals/resourceLimits.test.ts",
            commonLimits,
          ),
          testFile(
            "tests/boundary/signals/recordingDescriptorCleanup.test.ts",
            cleanupCases,
          ),
        ],
});
const run = (lane: string, value: unknown) => {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  const directory = mkdtempSync(
    join(process.cwd(), ".cache", "rea-required-cases-"),
  );
  try {
    const path = join(directory, "report.json");
    writeFileSync(path, JSON.stringify(value));
    return execFileSync(process.execPath, [script, lane, path], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
const outsideReportFailure = (reportPath: string) => {
  try {
    execFileSync(process.execPath, [script, "packet", reportPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return undefined;
  } catch (error) {
    return error;
  }
};

it.each(["packet", "signal"] as const)(
  "requires the %s resource and descriptor cases without banning unrelated skips",
  (lane) => {
    const result = report(lane);
    result.testResults.push({
      name: resolve("tests/unrelated.test.ts"),
      assertionResults: [{ fullName: "host-specific", status: "pending" }],
    });
    expect(run(lane, result)).toContain("cases passed");
    for (const resultIndex of report(lane).testResults.keys()) {
      const skipped = report(lane);
      skipped.testResults[resultIndex]!.assertionResults[0]!.status = "pending";
      expect(() => run(lane, skipped)).toThrow(
        "Required provider test did not pass",
      );
      const failed = report(lane);
      failed.testResults[resultIndex]!.assertionResults[0]!.status = "failed";
      expect(() => run(lane, failed)).toThrow(
        "Required provider test did not pass",
      );
      const removed = report(lane);
      removed.testResults[resultIndex]!.assertionResults.shift();
      expect(() => run(lane, removed)).toThrow(
        "Required provider test did not pass",
      );
      const duplicate = report(lane);
      duplicate.testResults[resultIndex]!.assertionResults.push(
        duplicate.testResults[resultIndex]!.assertionResults[0]!,
      );
      expect(() => run(lane, duplicate)).toThrow(
        "Required provider test did not pass",
      );
    }
    const missingFile = report(lane);
    missingFile.testResults.pop();
    expect(() => run(lane, missingFile)).toThrow(
      "Expected exactly one provider test result",
    );
    expect(() => run(lane, { success: true, testResults: [] })).toThrow();
    expect(() => run(lane, { success: false, testResults: [] })).toThrow();
  },
);

it.each([
  ["parent", resolve(process.cwd(), "..", "rea-provider-report.json")],
  ["sibling prefix", `${resolve(process.cwd())}-outside/report.json`],
  ["absolute outside", resolve(tmpdir(), "rea-provider-report.json")],
] as const)(
  "rejects a %s report path outside the checkout",
  (_label, reportPath) => {
    const failure = z
      .object({ status: z.literal(1), stderr: z.string() })
      .parse(outsideReportFailure(reportPath));
    const encoded = failure.stderr.match(
      /\{"code":"report_path_outside_checkout"\}/u,
    )?.[0];
    expect(JSON.parse(encoded ?? "")).toEqual({
      code: "report_path_outside_checkout",
    });
  },
);

it("rejects unknown lanes and missing or malformed reports", () => {
  expect(() => run("other", report("packet"))).toThrow(
    "Expected provider test lane",
  );
  expect(() => run("packet", null)).toThrow(
    "missing a successful test inventory",
  );
  expect(() =>
    execFileSync(process.execPath, [script, "packet", "/missing/report.json"], {
      stdio: "pipe",
    }),
  ).toThrow();
});

it.each([
  [
    "real-packet-capture.yml",
    "tshark",
    "packet",
    "tests/boundary/captures/resourceLimits.test.ts",
    "tests/boundary/captures/captureDescriptorCleanup.test.ts",
  ],
  [
    "real-signal-recording.yml",
    "sigrok",
    "signal",
    "tests/boundary/signals/resourceLimits.test.ts",
    "tests/boundary/signals/recordingDescriptorCleanup.test.ts",
  ],
] as const)(
  "keeps required case validation in %s",
  (workflow, job, lane, limits, cleanup) => {
    const file = new URL(
      `../../.github/workflows/${workflow}`,
      import.meta.url,
    );
    const parsed = z
      .object({
        jobs: z.record(
          z.string(),
          z.object({
            steps: z.array(z.object({ run: z.string().optional() })),
          }),
        ),
      })
      .parse(parse(readFileSync(file, "utf8")));
    const step = parsed.jobs[job]?.steps.find((item) =>
      item.run?.includes("scripts/ci/require-provider-tests.mjs"),
    );
    expect(step?.run).toContain('rm -f "$report"');
    expect(step?.run).toContain("node scripts/run-exact-tests.mjs run");
    expect(step?.run).toContain("--reporter=json");
    expect(step?.run).toContain('--outputFile.json="$report"');
    expect(step?.run).toContain(limits);
    expect(step?.run).toContain(cleanup);
    if (lane === "packet")
      expect(step?.run).toContain("tests/acceptance/pcapVerifier.test.ts");
    expect(step?.run).toContain(
      `node scripts/ci/require-provider-tests.mjs ${lane} "$report"`,
    );
  },
);
