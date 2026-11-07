import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { itWithCaptureCapability as captureTest } from "../../boundary/process/processCaptureCapability.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliCompileCacheEnvironment } from "../../support/cli/cliFixture.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../../../scripts/rea.mjs", import.meta.url));
const nul = "/tmp/selected\0filename";
const electron = {
  executable_path: "/tmp/Electron",
  application_path: "/tmp/main.js",
};

it("keeps overall replay verification unknown when capture divergence is unknown", async () => {
  const { call } = await connectLocalToolsMcp();
  const captureEvidence = (
    side: "left" | "right",
    {
      environmentUnknown = false,
      exitCode = 0,
    }: {
      readonly environmentUnknown?: boolean;
      readonly exitCode?: number;
    } = {},
  ) =>
    createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: { side },
      result: {
        ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
        exit: { ...EMPTY_PROCESS_CAPTURE_EXAMPLE.exit, code: exitCode },
        residual_unknowns: environmentUnknown
          ? [
              {
                scope: "environment",
                reason:
                  "Inherited host environment variables are not recorded.",
              },
            ]
          : [],
      },
      confidence: "observed",
      authority: "controlled-replay",
      environment: {
        id: "fixture-process",
        platform: "fixture",
        architecture: "fixture",
        isolation: "process",
      },
    });
  const compare = async (left: unknown, right: unknown) => {
    const response = await call("compare_process_captures", { left, right });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return toolContract("compare_process_captures").outputSchema.parse(
      response.structuredContent,
    );
  };
  const verify = async (
    comparison: { readonly evidence_id: string },
    dimension: "overall" | "terminal",
  ) => {
    const response = await call("verify_reconstruction", {
      specification: {
        name: "Overall replay compatibility",
        claims: [
          {
            kind: "behavioral",
            claim_id: dimension,
            title: "Replay behavior agrees",
            comparison_evidence_id: comparison.evidence_id,
            dimension,
          },
        ],
      },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return toolContract("verify_reconstruction").outputSchema.parse(
      response.structuredContent,
    ).normalized_result;
  };

  const complete = await compare(
    captureEvidence("left"),
    captureEvidence("right"),
  );
  expect((await verify(complete, "overall")).status).toBe("pass");

  const incomplete = await compare(
    captureEvidence("left", { environmentUnknown: true }),
    captureEvidence("right", { environmentUnknown: true }),
  );
  expect(incomplete.normalized_result).toMatchObject({
    status: "unchanged",
    first_divergence: {
      status: "unknown",
      reason: "Residual unknowns prevent proving that no divergence occurred.",
    },
  });
  const overall = await verify(incomplete, "overall");
  expect(overall.status).toBe("unknown");
  expect(overall.claims.items[0]?.limitations).toContain(
    "Residual unknowns prevent proving that no divergence occurred.",
  );
  expect((await verify(incomplete, "terminal")).status).toBe("pass");

  const changed = await compare(
    captureEvidence("left", { environmentUnknown: true }),
    captureEvidence("right", { environmentUnknown: true, exitCode: 1 }),
  );
  expect((await verify(changed, "overall")).status).toBe("fail");
});

const runCliExpectingInputError = async (
  scenarioPath: string,
  environment?: NodeJS.ProcessEnv,
): Promise<unknown> => {
  const failure = await execute(
    process.execPath,
    [cli, "capture-process", scenarioPath, "--json"],
    { env: environment },
  ).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(failure).toMatchObject({ code: 1 });
  if (!(failure instanceof Error) || !("stdout" in failure))
    throw new Error("Expected the CLI to report an input error on stdout");
  return JSON.parse(String(failure.stdout)) as unknown;
};

const pathRequests: readonly [string, Record<string, unknown>][] = [
  ["open_binary", { path: nul }],
  ["open_binary", { path: process.execPath, snapshot_path: nul }],
  ["close_binary", { snapshot_path: nul }],
  ["binary_session", { expected_server_path: nul }],
  ["export_evidence_bundle", { path: nul }],
  ["import_evidence_bundle", { path: nul }],
  ["inspect_managed_artifact", { path: nul }],
  ["inspect_android_package", { path: nul }],
  ["search_android_classes", { path: nul, query: "" }],
  ["inspect_android_class", { path: nul, class_name: "probe.Class" }],
  [
    "inspect_android_method",
    { path: nul, class_name: "probe.Class", method_name: "run" },
  ],
  [
    "inspect_android_class",
    { path: "/tmp/probe.apk", class_name: "probe.Class", mapping_path: nul },
  ],
  [
    "inspect_android_method",
    {
      path: "/tmp/probe.apk",
      class_name: "probe.Class",
      method_name: "run",
      mapping_path: nul,
    },
  ],
  ["trace_android_references", { path: nul, class_name: "probe.Class" }],
  ["inspect_firmware_regions", { path: nul }],
  ["extract_firmware", { path: nul, output_directory: "/tmp/out" }],
  ["extract_firmware", { path: "/tmp/firmware.bin", output_directory: nul }],
  ["inspect_plist", { path: nul }],
  ["inspect_with_objdump", { path: nul, operation: "file_headers" }],
  ["execute_rizin_command", { path: nul, command: "iI" }],
  ...[
    { kind: "function", name: "main\0suffix" },
    { kind: "function", name: "main", module: "lib.dylib\0suffix" },
    { kind: "objc-method", selector: "run\0suffix" },
    { kind: "objc-method", class_name: "Probe\0suffix", selector: "run" },
  ].map((breakpoint): [string, Record<string, unknown>] => [
    "observe_native_calls",
    { breakpoints: [breakpoint] },
  ]),
  [
    "observe_native_calls",
    {
      breakpoints: [{ kind: "function", name: "main" }],
      working_directory: nul,
    },
  ],
  [
    "observe_native_calls",
    { breakpoints: [{ kind: "function", name: "main" }], arguments: ["a\0b"] },
  ],
  ["analyze_javascript_application", { input_path: nul }],
  ["recover_javascript_sources", { path: nul, output_directory: "/tmp/out" }],
  [
    "recover_javascript_sources",
    { path: "/tmp/main.js", output_directory: nul },
  ],
  [
    "compare_bundles",
    { left_bundle_path: nul, right_bundle_path: "/tmp/right.json" },
  ],
  [
    "compare_bundles",
    { left_bundle_path: "/tmp/left.json", right_bundle_path: nul },
  ],
  [
    "capture_browser_scenario",
    {
      browser: { mode: "launch", executable_path: nul },
      start_url: { url: "http://127.0.0.1:1" },
      actions: [
        { step_id: "settle", action: "wait_for_timeout", duration_ms: 0 },
      ],
    },
  ],
  ...["executable_path", "application_path", "application_root"].map(
    (key): [string, Record<string, unknown>] => [
      "capture_electron_scenario",
      { ...electron, [key]: nul },
    ],
  ),
  ["capture_electron_scenario", { ...electron, args: ["a\0b"] }],
  ["demangle_swift", { symbols: ["abc\0def"] }],
  ["inspect_web_network_capture", { capture_path: nul, format: "har" }],
  [
    "export_web_scripts",
    { capture_path: nul, output_directory: "/tmp/exported-scripts" },
  ],
  ["inspect_pe_resources", { path: nul }],
  ["inspect_pe_certificates", { path: nul }],
  ["inspect_pe_imports", { path: nul }],
  ["inspect_native_exports", { path: nul }],
  ["inspect_elf_notes", { path: nul }],
  ["inspect_apple_ips", { path: nul }],
  ["inspect_devicetree", { path: nul }],
  ["inspect_kernel_module", { path: nul }],
  ["inspect_pe_load_config", { path: nul }],
  ["inspect_python_pyc", { path: nul }],
  ["inspect_erlang_beam", { path: nul }],
  ["inspect_binary_layout", { path: nul }],
  ["inspect_recorded_crash", { path: nul }],
  ["inspect_wasm_artifact", { path: nul }],
  ["inspect_wasm_artifact", { path: "/tmp/sample.wasm", glue_paths: [nul] }],
  [
    "inspect_wasm_artifact",
    { path: "/tmp/sample.wasm", candidate_paths: [nul] },
  ],
  ["inspect_evm_interface", { path: nul, encoding: "raw" }],
  [
    "export_web_scripts",
    { capture_path: "/tmp/capture.json", output_directory: nul },
  ],
  [
    "trace_web_source_location",
    {
      manifest_path: nul,
      script_index: 0,
      source_map: { path: "/tmp/source.map", url: "http://127.0.0.1/a" },
      generated_position: { line: 1, column: 0 },
    },
  ],
  [
    "trace_web_source_location",
    {
      manifest_path: "/tmp/manifest.json",
      script_index: 0,
      source_map: { path: nul, url: "http://127.0.0.1/a" },
      generated_position: { line: 1, column: 0 },
    },
  ],
  ["trace_web_module_imports", { manifest_path: nul, script_index: 0 }],
  [
    "trace_web_module_imports",
    {
      manifest_path: "/tmp/manifest.json",
      script_index: 0,
      import_map: { path: nul, base_url: "http://127.0.0.1/a" },
    },
  ],
  ["start_frida_session", { mode: "spawn", device_id: "local", program: nul }],
  [
    "load_frida_script",
    {
      session_id: "00000000-0000-4000-8000-000000000001",
      source_kind: "file",
      path: nul,
    },
  ],
  [
    "instrument_with_frida",
    {
      mode: "spawn",
      device_id: "local",
      program: nul,
      source_kind: "inline",
      source: "send(1);",
    },
  ],
  [
    "instrument_with_frida",
    {
      mode: "spawn",
      device_id: "local",
      program: "/bin/true",
      source_kind: "file",
      path: nul,
    },
  ],
  ["start_rizin_debug_session", { path: nul, inferior_tty: "/dev/pts/7" }],
  ["start_rizin_debug_session", { path: "/tmp/program", inferior_tty: nul }],
  ["start_gdb_session", { inferior_tty: nul }],
];

it("rejects OS-invalid local inputs through the real advertised MCP contracts", async () => {
  const { call } = await connectLocalToolsMcp();
  for (const [name, arguments_] of pathRequests) {
    const response = await call(name, arguments_);
    expect(response.isError, name).toBe(true);
    expect(JSON.stringify(response.content), name).toContain("NUL");
  }
  const relative = await call("extract_firmware", {
    path: "/tmp/firmware.bin",
    output_directory: "relative-output",
  });
  expect(relative.isError).toBe(true);
  expect(JSON.stringify(relative.content)).toContain(
    "absolute local filesystem path",
  );
});

const ignoredOptions = [
  { terminal: { columns: 80, row: 12 } },
  { events: [{ type: "input", at_ms: 0, data: "x", secret: true }] },
  { events: [{ type: "resize", at_ms: 0, columns: 80, rows: 24, row: 12 }] },
  { events: [{ type: "signal", at_ms: 0, signal: "SIGTERM", pid: 1 }] },
  { normalization: { path: true } },
  { limits: { file_count: 1 } },
  {
    normalization: {
      patterns: [{ pattern: "x", replacement: "y", regex: true }],
    },
  },
];

captureTest(
  "rejects malformed process choices through CLI and MCP before launching the command",
  async () => {
    const root = await createTestTempDirectory("rea-local-contracts-");
    const environment = cliCompileCacheEnvironment(
      process.env,
      join(root, "node-compile-cache"),
    );
    const marker = join(root, "launched");
    const scenario = {
      executable: process.execPath,
      arguments: [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1],'launched')",
        marker,
      ],
    };
    const { call } = await connectLocalToolsMcp();
    const invalid = [
      ...ignoredOptions,
      ...["", "KEY=VALUE", "KEY\0VALUE", "REA_PROCESS_RUN_ID"].map((key) => ({
        environment: { [key]: "value" },
      })),
      { executable: `node\0` },
      { arguments: ["\0"] },
      { working_directory: "/tmp/dir\0" },
      { environment: { KEY: "\0" } },
      { filesystem_observation_paths: ["\0"] },
      { timeout_ms: 10, events: [{ type: "input", at_ms: 11, data: "late" }] },
      {
        events: [
          { type: "resize", at_ms: 2, columns: 80, rows: 24 },
          { type: "input", at_ms: 1, data: "out of order" },
        ],
      },
      ...["command_shims", "replay", "reactive", "checkpoints"].map(
        (field) => ({
          [field]: [],
        }),
      ),
    ];
    // Each CLI case initializes its own runtime. Bound subprocess fanout too,
    // so one test cannot oversubscribe the host beyond the Vitest workers.
    for (let start = 0; start < invalid.length; start += 2)
      await Promise.all(
        invalid.slice(start, start + 2).map(async (options, offset) => {
          const request = { ...scenario, ...options };
          expect(
            (await call("capture_process_scenario", request)).isError,
            JSON.stringify(options),
          ).toBe(true);
          const path = join(root, `scenario-${String(start + offset)}.json`);
          await writeFile(path, JSON.stringify(request));
          await expect(
            execute(
              process.execPath,
              [cli, "capture-process", path, "--json"],
              {
                env: environment,
              },
            ),
            JSON.stringify(options),
          ).rejects.toMatchObject({
            code: 1,
            stdout: expect.stringContaining("invalid_request"),
          });
        }),
      );
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    const missing = join(root, "missing-executable");
    const failed = await call("capture_process_scenario", {
      executable: missing,
    });
    expect(parseMcpToolError(failed)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          operation: "capture_process_scenario",
          issues: [
            {
              path: ["executable"],
              message: expect.stringContaining(`${missing} (ENOENT)`),
            },
          ],
        },
      },
    });
    await writeFile(
      join(root, "scenario.json"),
      JSON.stringify({ executable: missing }),
    );
    const executableCliFailure = await runCliExpectingInputError(
      join(root, "scenario.json"),
      environment,
    );
    expect(executableCliFailure).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_process_scenario",
        issues: [
          {
            path: ["executable"],
            message: expect.stringContaining(`${missing} (ENOENT)`),
          },
        ],
      },
    });

    const missingWorkingDirectory = join(root, "missing-working-directory");
    const cwdFailure = await call("capture_process_scenario", {
      executable: process.execPath,
      working_directory: missingWorkingDirectory,
    });
    expect(parseMcpToolError(cwdFailure)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          operation: "capture_process_scenario",
          issues: [
            {
              path: ["working_directory"],
              message: expect.stringContaining(
                `${missingWorkingDirectory} (ENOENT)`,
              ),
            },
          ],
        },
      },
    });
    const cwdScenario = join(root, "missing-working-directory.json");
    await writeFile(
      cwdScenario,
      JSON.stringify({
        executable: process.execPath,
        working_directory: missingWorkingDirectory,
      }),
    );
    expect(
      await runCliExpectingInputError(cwdScenario, environment),
    ).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_process_scenario",
        issues: [
          {
            path: ["working_directory"],
            message: expect.stringContaining(
              `${missingWorkingDirectory} (ENOENT)`,
            ),
          },
        ],
      },
    });
  },
  // 22 malformed requests plus two filesystem errors each start a fresh CLI.
  // Cache compilation, but allow for startup at the bounded fanout of two.
  120_000,
);

captureTest.each(["untruncated", "truncated"] as const)(
  "captures real process choices and composes a %s self-comparison",
  async (captureState) => {
    const root = await createTestTempDirectory("rea-local-capture-");
    const { call } = await connectLocalToolsMcp();
    const captured = await call("capture_process_scenario", {
      executable: process.execPath,
      arguments: [
        "-e",
        `require('node:fs').writeFileSync('state','selected');console.log(process.env['app.setting'],process.env.MY_PASSWORD,process.env['REA_PROCESS_RUN_ID'+String.fromCharCode(10)]);${captureState === "truncated" ? "console.log('x'.repeat(5000))" : ""}`,
      ],
      working_directory: root,
      environment: {
        "app.setting": "value",
        "1": "numbered",
        MY_PASSWORD: "ordinary-evidence",
        "REA_PROCESS_RUN_ID\n": "caller-value",
      },
      filesystem_observation_paths: [root],
      limits: captureState === "truncated" ? { output_bytes: 128 } : {},
    });
    expect(captured.isError, JSON.stringify(captured)).not.toBe(true);
    const capture = toolContract("capture_process_scenario").outputSchema.parse(
      captured.structuredContent,
    );
    const source = capture;
    if (captureState === "untruncated")
      expect(
        capture.normalized_result.frames.map((frame) => frame.data).join(""),
      ).toContain("value ordinary-evidence caller-value");
    else expect(capture.normalized_result.truncated).toBe(true);
    const environment = await call("capture_process_scenario", {
      executable: "/usr/bin/printenv",
      arguments: ["1"],
      environment: { "1": "numbered" },
    });
    const environmentEnvelope = toolContract(
      "capture_process_scenario",
    ).outputSchema.parse(environment.structuredContent);
    const received = environmentEnvelope.normalized_result.frames
      .map((frame) => frame.data)
      .join("");
    expect(received).toBe("numbered\r\n");
    expect(await readFile(join(root, "state"), "utf8")).toBe("selected");
    expect(capture.normalized_result.filesystem_effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "created" })]),
    );
    expect(capture.normalized_result.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
    const compared = await call("compare_process_captures", {
      left: source,
      right: source,
    });
    expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
    const comparison = toolContract(
      "compare_process_captures",
    ).outputSchema.parse(compared.structuredContent);
    expect(comparison.normalized_result).toMatchObject({
      status: "unknown",
      terminal: captureState === "truncated" ? "unknown" : "unchanged",
      interaction: "unchanged",
      exit: "unchanged",
      process: "unknown",
    });
    const verification = await call("verify_reconstruction", {
      specification: {
        name: "Self comparison retains uncertainty",
        claims: [
          {
            claim_id: "control",
            title: "Control capture",
            comparison_evidence_id: comparison.evidence_id,
            kind: "behavioral",
            dimension: "overall",
          },
        ],
      },
    });
    expect(verification.isError, JSON.stringify(verification)).not.toBe(true);
    expect(verification.structuredContent).toMatchObject({
      normalized_result: {
        status: "unknown",
        claims: {
          items: [
            {
              left_evidence_ids: [source.evidence_id],
              right_evidence_ids: [source.evidence_id],
              evidence_links: expect.arrayContaining([
                source.evidence_id,
                comparison.evidence_id,
              ]),
            },
          ],
        },
      },
    });
    const behavior = await call("find_changed_behavior", {
      comparisons: [comparison],
    });
    expect(behavior.isError, JSON.stringify(behavior)).not.toBe(true);
    expect(behavior.structuredContent).toMatchObject({
      normalized_result: { behavior_status: "unknown" },
    });
    const unknowns = await call("list_unknowns", {
      domain: "process-comparison",
    });
    expect(unknowns.structuredContent).toMatchObject({
      result: {
        items: [
          {
            status: "open",
            supporting_evidence_ids: [source.evidence_id],
            contradicting_evidence_ids: [],
          },
        ],
      },
    });
    const bundle = await call("get_evidence_bundle", {});
    expect(
      (await call("compare_process_captures", { left: source, right: source }))
        .isError,
    ).not.toBe(true);
    expect((await call("get_evidence_bundle", {})).structuredContent).toEqual(
      bundle.structuredContent,
    );
    const path = join(root, "capture.json");
    await writeFile(path, JSON.stringify(source));
    const cliComparison = await execute(process.execPath, [
      cli,
      "compare-process-captures",
      path,
      path,
      "--json",
    ]);
    expect(parseEvidence(JSON.parse(cliComparison.stdout))).toEqual(comparison);
  },
);

captureTest(
  "accepts NUL as actual terminal input while preserving capture defaults",
  async () => {
    const { call } = await connectLocalToolsMcp();
    const response = await call("capture_process_scenario", {
      executable: process.execPath,
      arguments: [
        "-e",
        "process.stdin.setRawMode(true);process.stdin.resume();process.stdin.once('data',bytes=>{console.log('stdin-byte:'+bytes[0]);process.exit(0)});console.log('ready')",
      ],
      events: [{ type: "input", at_ms: 1000, data: "\0" }],
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const capture = toolContract("capture_process_scenario").outputSchema.parse(
      response.structuredContent,
    );
    expect(
      capture.normalized_result.frames.map((frame) => frame.data).join(""),
    ).toContain("stdin-byte:0");
    expect(capture.normalized_result.manifest.scenario).toMatchObject({
      environment: {},
      filesystem_observation_paths: [],
      terminal: { columns: 80, rows: 24, scrollback: 1000 },
    });
    expect(capture.normalized_result.interaction_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input",
          data: "\0",
          outcome: "dispatched",
        }),
      ]),
    );
  },
);
