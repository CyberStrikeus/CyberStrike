import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { adbDisplayPartialObservationSchema } from "../../../src/domain/adb/adbDeviceAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

const SERIAL = "numeric-declarations-device";
const PACKAGE = "com.example.numeric";
const UNSAFE = "9007199254740993";
const OVERFLOW = "9".repeat(400);
const VERSION_NAME = "  caller version\t  ";

const createNumericAdbFixture = async () => {
  const root = await createTestTempDirectory("rea-adb-numeric-declarations-");
  const binary = join(root, "adb");
  const size = join(root, "size.txt");
  const density = join(root, "density.txt");
  const packageDetails = join(root, "package.txt");
  await writeFile(
    binary,
    `#!${process.execPath}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === 'version') {
  console.log('Android Debug Bridge version 1.0.41\\nVersion 34.0.5-fixture\\nInstalled as ' + process.argv[1]);
  process.exit(0);
}
const outputs = new Map([
  [${JSON.stringify(`-s ${SERIAL} shell wm size`)}, ${JSON.stringify(size)}],
  [${JSON.stringify(`-s ${SERIAL} shell wm density`)}, ${JSON.stringify(density)}],
  [${JSON.stringify(`-s ${SERIAL} shell dumpsys package ${PACKAGE}`)}, ${JSON.stringify(packageDetails)}],
]);
const path = outputs.get(args.join(' '));
if (path === undefined) process.exit(91);
process.stdout.write(require('node:fs').readFileSync(path));
`,
    { mode: 0o700 },
  );
  const environment = {
    HOME: root,
    USERPROFILE: root,
    REA_ADB_PATH: binary,
    REA_LOG_LEVEL: "silent",
  };
  const { call } = await connectLocalToolsMcp(environment);
  return { environment, size, density, packageDetails, call };
};

const invalidPhysical = " \tPhysical size: portrait  \t";
const unsafeOverride = ` \tOverride size: ${UNSAFE}x2  \t`;
const zeroOverride = " \tOverride size: 0x2  \t";
const unsafeDensity = ` \tPhysical density: ${UNSAFE}  \t`;
const invalidDensity = " \tPhysical density: many  \t";
const zeroDensity = " \tOverride density: 0  \t";
const overflowDensity = ` \tOverride density: ${OVERFLOW}  \t`;
const bareZero = " \t0  \t";
const cappedSizeIssues = Array.from({ length: 6 }, (_, index) => ({
  command: "wm size",
  field: "override_size",
  reason: "invalid_format",
  raw_line: ` \tOverride size: malformed-${String(index)}  \t`,
}));
const cappedDensityIssues = Array.from({ length: 6 }, (_, index) => ({
  command: "wm density",
  field: "override_density",
  reason: "nonpositive",
  raw_line: ` \tOverride density: 0${" ".repeat(index + 1)}\t`,
}));

const displayScenarios = [
  {
    name: "absent optional declarations",
    size: "Physical size: 1080x2340\n",
    density: "420\n",
    physical_size: { width: 1080, height: 2340 },
    override_size: null,
    physical_density: 420,
    override_density: null,
    issues: [],
    coverage: "complete",
  },
  {
    name: "unknown density without a malformed declaration",
    size: "Physical size: 1080x2340\n",
    density: "\n",
    physical_size: { width: 1080, height: 2340 },
    override_size: null,
    physical_density: null,
    override_density: null,
    issues: [],
    coverage: "partial",
  },
  {
    name: "positive safe boundaries",
    size: "Physical size: 9007199254740991x1\nOverride size: 1x9007199254740991\n",
    density: "Physical density: 9007199254740991\nOverride density: 1\n",
    physical_size: { width: Number.MAX_SAFE_INTEGER, height: 1 },
    override_size: { width: 1, height: Number.MAX_SAFE_INTEGER },
    physical_density: Number.MAX_SAFE_INTEGER,
    override_density: 1,
    issues: [],
    coverage: "complete",
  },
  {
    name: "later valid labeled declarations retain earlier issues",
    size: `${invalidPhysical}\nPhysical size: 100x200\nOverride size: 1x2\nOverride size: 640x480\n`,
    density: `${unsafeDensity}\nPhysical density: 320\n${zeroDensity}\nOverride density: 480\n`,
    physical_size: { width: 100, height: 200 },
    override_size: { width: 640, height: 480 },
    physical_density: 320,
    override_density: 480,
    issues: [
      {
        command: "wm size",
        field: "physical_size",
        reason: "invalid_format",
        raw_line: invalidPhysical,
      },
      {
        command: "wm density",
        field: "physical_density",
        reason: "unsafe_integer",
        raw_line: unsafeDensity,
      },
      {
        command: "wm density",
        field: "override_density",
        reason: "nonpositive",
        raw_line: zeroDensity,
      },
    ],
    coverage: "partial",
  },
  {
    name: "malformed final labels suppress earlier values and bare density",
    size: `Physical size: 1080x2340\nOverride size: 720x1280\n${unsafeOverride}\n${zeroOverride}\n`,
    density: `420\nPhysical density: 320\n${invalidDensity}\n480\n${overflowDensity}\n`,
    physical_size: { width: 1080, height: 2340 },
    override_size: null,
    physical_density: null,
    override_density: null,
    issues: [
      {
        command: "wm size",
        field: "override_size",
        reason: "unsafe_integer",
        raw_line: unsafeOverride,
      },
      {
        command: "wm size",
        field: "override_size",
        reason: "nonpositive",
        raw_line: zeroOverride,
      },
      {
        command: "wm density",
        field: "physical_density",
        reason: "invalid_format",
        raw_line: invalidDensity,
      },
      {
        command: "wm density",
        field: "override_density",
        reason: "unsafe_integer",
        raw_line: overflowDensity,
      },
    ],
    coverage: "partial",
  },
  {
    name: "the first bare numeric density wins even when invalid",
    size: "Physical size: 1080x2340\n",
    density: `${bareZero}\n420\n`,
    physical_size: { width: 1080, height: 2340 },
    override_size: null,
    physical_density: null,
    override_density: null,
    issues: [
      {
        command: "wm density",
        field: "physical_density",
        reason: "nonpositive",
        raw_line: bareZero,
      },
    ],
    coverage: "partial",
  },
  {
    name: "one issue sample bound across both commands",
    size: [
      "Physical size: 1080x2340",
      ...cappedSizeIssues.map(({ raw_line }) => raw_line),
      "",
    ].join("\n"),
    density: [
      "Physical density: 420",
      ...cappedDensityIssues.map(({ raw_line }) => raw_line),
      "",
    ].join("\n"),
    physical_size: { width: 1080, height: 2340 },
    override_size: null,
    physical_density: 420,
    override_density: null,
    issues: [...cappedSizeIssues, ...cappedDensityIssues],
    coverage: "partial",
  },
];

cliTest.skipIf(process.platform === "win32")(
  "preserves display declaration precedence and bounded numeric issues through CLI and MCP",
  async ({ cli }) => {
    const fixture = await createNumericAdbFixture();
    const contract = toolContract("inspect_adb_display");
    for (const scenario of displayScenarios) {
      await writeFile(fixture.size, scenario.size);
      await writeFile(fixture.density, scenario.density);
      const invocation = {
        arguments: ["inspect-adb-display", SERIAL, "--json"],
        environment: fixture.environment,
      };
      const output = await (scenario === displayScenarios[0]
        ? cli.run(invocation)
        : runFileCli(cli, invocation));
      expect(output.exitCode, `${scenario.name}: ${output.stderr}`).toBe(0);
      const evidence = contract.outputSchema.parse(output.json);
      expect(evidence.parameters).toEqual({ serial: SERIAL });
      expect(evidence.normalized_result).toMatchObject({
        serial: SERIAL,
        physical_size: scenario.physical_size,
        override_size: scenario.override_size,
        physical_density: scenario.physical_density,
        override_density: scenario.override_density,
        numeric_issues: {
          sample: scenario.issues.slice(0, 10),
          total: scenario.issues.length,
        },
        coverage: scenario.coverage,
      });
      const reply = await fixture.call("inspect_adb_display", {
        serial: SERIAL,
      });
      expect(reply.isError).not.toBe(true);
      const structured = contract.outputSchema.parse(reply.structuredContent);
      expect(structured.normalized_result).toEqual(evidence.normalized_result);
      expect(structured.limitations).toEqual(evidence.limitations);
    }
  },
);

cliTest.skipIf(process.platform === "win32")(
  "returns typed partial display facts instead of success for absent or malformed physical size",
  async ({ cli }) => {
    const fixture = await createNumericAdbFixture();
    await writeFile(
      fixture.density,
      "Physical density: 320\nOverride density: 480\n",
    );
    for (const [value, reason] of [
      [null, null],
      ["portrait", "invalid_format"],
      [`${UNSAFE}x2`, "unsafe_integer"],
      [`2x${OVERFLOW}`, "unsafe_integer"],
      ["0x2", "nonpositive"],
    ] as const) {
      const raw = value === null ? null : ` \tPhysical size: ${value}  \t`;
      await writeFile(
        fixture.size,
        [
          ...(raw === null ? [] : ["Physical size: 1080x2340", raw]),
          "Override size: 7x9",
          "",
        ].join("\n"),
      );
      const invocation = {
        arguments: ["inspect-adb-display", SERIAL, "--json"],
        environment: fixture.environment,
      };
      const output = await (value === null
        ? cli.run(invocation)
        : runFileCli(cli, invocation));
      expect(output.exitCode, output.stderr).toBe(1);
      const projected = analysisErrorProjectionSchema.parse(output.json);
      expect(projected.code).toBe("unreadable_output");
      const partial = adbDisplayPartialObservationSchema.parse(
        projected.details?.partial_observation,
      );
      expect(partial).toMatchObject({
        provider_id: "adb",
        operation: "inspect_adb_display",
        reason:
          raw === null ? "physical_size_absent" : "physical_size_malformed",
        result: {
          serial: SERIAL,
          physical_size: null,
          override_size: { width: 7, height: 9 },
          physical_density: 320,
          override_density: 480,
          numeric_issues: {
            sample:
              raw === null
                ? []
                : [
                    {
                      command: "wm size",
                      field: "physical_size",
                      reason,
                      raw_line: raw,
                    },
                  ],
            total: raw === null ? 0 : 1,
          },
          coverage: "partial",
        },
      });
      const reply = await fixture.call("inspect_adb_display", {
        serial: SERIAL,
      });
      const mcpError = parseMcpToolError(reply).error;
      expect(mcpError).toEqual(projected);
      expect(
        adbDisplayPartialObservationSchema.parse(
          mcpError.details?.partial_observation,
        ),
      ).toEqual(partial);
    }
  },
);

const malformedUser = " \tuserId=unknown  \t";
const unsafeApp = ` \tappId=${UNSAFE}  \t`;
const overflowUser = ` \tuserId=${OVERFLOW}  \t`;
const malformedApp = " \tappId=-1  \t";
const cappedPackageIssues = Array.from({ length: 12 }, (_, index) => ({
  command: "dumpsys package",
  field: "user_id",
  reason: "invalid_format",
  raw_line: ` \t${index % 2 === 0 ? "userId" : "appId"}=bad-${String(index)}  \t`,
}));
const packageScenarios = [
  {
    name: "absent user id before a hidden package",
    lines: [],
    userId: null,
    issues: [],
  },
  {
    name: "zero admitted first through appId",
    lines: ["  appId=0 shared", "  userId=10001"],
    userId: 0,
    issues: [],
  },
  {
    name: "safe boundary with numeric suffix grammar",
    lines: ["  userId=9007199254740991 target"],
    userId: Number.MAX_SAFE_INTEGER,
    issues: [],
  },
  {
    name: "invalid aliases before and after the first admitted user",
    lines: [
      malformedUser,
      unsafeApp,
      "  userId=10001 installing=true",
      "  appId=20002",
      overflowUser,
      malformedApp,
    ],
    userId: 10001,
    issues: [
      {
        command: "dumpsys package",
        field: "user_id",
        reason: "invalid_format",
        raw_line: malformedUser,
      },
      {
        command: "dumpsys package",
        field: "user_id",
        reason: "unsafe_integer",
        raw_line: unsafeApp,
      },
      {
        command: "dumpsys package",
        field: "user_id",
        reason: "unsafe_integer",
        raw_line: overflowUser,
      },
      {
        command: "dumpsys package",
        field: "user_id",
        reason: "invalid_format",
        raw_line: malformedApp,
      },
    ],
  },
  {
    name: "unsafe declarations leave the user unknown",
    lines: [unsafeApp, overflowUser],
    userId: null,
    issues: [
      {
        command: "dumpsys package",
        field: "user_id",
        reason: "unsafe_integer",
        raw_line: unsafeApp,
      },
      {
        command: "dumpsys package",
        field: "user_id",
        reason: "unsafe_integer",
        raw_line: overflowUser,
      },
    ],
  },
  {
    name: "bounded diagnostics after an admitted zero",
    lines: [
      "  userId=0",
      ...cappedPackageIssues.map(({ raw_line }) => raw_line),
    ],
    userId: 0,
    issues: cappedPackageIssues,
  },
];

cliTest.skipIf(process.platform === "win32")(
  "preserves package user alias admission, raw versions and numeric issues through CLI and MCP",
  async ({ cli }) => {
    const fixture = await createNumericAdbFixture();
    const contract = toolContract("inspect_adb_package");
    for (const scenario of packageScenarios) {
      await writeFile(
        fixture.packageDetails,
        [
          `Package [${PACKAGE}]:`,
          `  pkg=Package{fixture ${PACKAGE}}`,
          `  versionName=${VERSION_NAME}`,
          `  versionCode=${UNSAFE} minSdk=26`,
          ...scenario.lines,
          "Hidden system packages:",
          "  userId=hidden-invalid",
          "  appId=777",
          "  versionName=hidden-version",
          "",
        ].join("\n"),
      );
      const invocation = {
        arguments: ["inspect-adb-package", SERIAL, PACKAGE, "--json"],
        environment: fixture.environment,
      };
      const output = await (scenario === packageScenarios[0]
        ? cli.run(invocation)
        : runFileCli(cli, invocation));
      expect(output.exitCode, `${scenario.name}: ${output.stderr}`).toBe(0);
      const evidence = contract.outputSchema.parse(output.json);
      expect(evidence.parameters).toEqual({ serial: SERIAL, package: PACKAGE });
      expect(evidence.normalized_result).toMatchObject({
        serial: SERIAL,
        package_name: PACKAGE,
        user_id: scenario.userId,
        version_name: VERSION_NAME,
        version_code: UNSAFE,
        requested_permissions_count: 0,
        numeric_issues: {
          sample: scenario.issues.slice(0, 10),
          total: scenario.issues.length,
        },
        coverage: scenario.issues.length === 0 ? "complete" : "partial",
      });
      const reply = await fixture.call("inspect_adb_package", {
        serial: SERIAL,
        package: PACKAGE,
      });
      expect(reply.isError).not.toBe(true);
      const structured = contract.outputSchema.parse(reply.structuredContent);
      expect(structured.normalized_result).toEqual(evidence.normalized_result);
      expect(structured.limitations).toEqual(evidence.limitations);
    }
  },
);
