import { execFile, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import { observeNativeUi } from "../dist/native/NativeUiObservation.js";
import { NATIVE_UI_HELPER_MAX_BUFFER } from "../dist/native/NativeUiOutputBudget.js";
import { artifactMcpResult, withArtifactMcp } from "./lib/artifact-e2e.mjs";
import { observeProcessStartIdentity } from "../dist/process/ProcessOwnershipObservation.js";

if (process.platform !== "darwin")
  throw new Error(
    "Native UI verification requires macOS, an interactive desktop and Xcode command-line tools",
  );
const root = await mkdtemp(join(tmpdir(), "rea-ui-fixture-"));
let child;
let childExit;
let fixturePid;
let fixtureIdentity;
let report;
try {
  const childRetrievalTest = join(root, "child-retrieval-test");
  await promisify(execFile)("/usr/bin/xcrun", [
    "swiftc",
    fileURLToPath(
      new URL("../bridge/native/NativeUIChildren.swift", import.meta.url),
    ),
    fileURLToPath(
      new URL("../bridge/native/NativeUIValues.swift", import.meta.url),
    ),
    fileURLToPath(
      new URL(
        "../tests/conformance/native/native-ui-children/main.swift",
        import.meta.url,
      ),
    ),
    "-o",
    childRetrievalTest,
  ]);
  const childRetrieval = await promisify(execFile)(childRetrievalTest, []);
  const [slashRichProducerJson, numericProducerJson] = childRetrieval.stdout
    .trimEnd()
    .split("\n");
  if (
    slashRichProducerJson === undefined ||
    numericProducerJson === undefined
  ) {
    throw new Error(
      "Native UI serializer seam did not emit its producer bytes",
    );
  }
  const slashRichConsumerJson = JSON.stringify(
    JSON.parse(slashRichProducerJson),
  );
  if (slashRichProducerJson !== slashRichConsumerJson) {
    throw new Error(
      "Swift helper JSON bytes differ from the normalized JavaScript consumer representation",
    );
  }
  const numericConsumerJson = JSON.stringify(JSON.parse(numericProducerJson));
  if (
    Buffer.byteLength(numericProducerJson) <=
    Buffer.byteLength(numericConsumerJson)
  ) {
    throw new Error(
      "Foundation numeric fixture no longer exercises larger producer JSON bytes",
    );
  }
  if (Buffer.byteLength(numericProducerJson) > NATIVE_UI_HELPER_MAX_BUFFER) {
    throw new Error("Foundation numeric fixture exceeds the raw helper budget");
  }

  const contents = join(root, "Fixture.app", "Contents");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>io.rea.source-owned-ui-fixture</string><key>CFBundleName</key><string>REA UI Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  const executable = join(contents, "MacOS", "fixture");
  await promisify(execFile)("/usr/bin/xcrun", [
    "swiftc",
    "-module-cache-path",
    join(root, "modules"),
    fileURLToPath(
      new URL("../tests/conformance/native/ui.swift", import.meta.url),
    ),
    "-o",
    executable,
  ]);
  const coordinates = join(root, "scope.json");
  await writeFile(coordinates, "");
  child = spawn(
    "/usr/bin/open",
    ["-W", "-n", "-g", "--stdout", coordinates, join(root, "Fixture.app")],
    { stdio: "ignore" },
  );
  childExit = new Promise((resolve) => child.once("exit", resolve));
  let scope;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const output = await readFile(coordinates, "utf8");
    if (output.includes("\n")) {
      scope = JSON.parse(output.split("\n")[0]);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (scope === undefined)
    throw new Error(
      "Source-owned UI fixture failed to expose one window within 20 seconds",
    );
  fixturePid = scope.pid;
  fixtureIdentity = await observeProcessStartIdentity(fixturePid);
  assert.equal(
    fixtureIdentity?.state,
    "readable",
    "Fixture OS start identity is unavailable",
  );
  const target = await parseBinaryTarget(executable);
  if (!target.ok) throw target.error;
  const observation = await observeNativeUi(
    target.value,
    "observe_native_ui",
    {
      ...scope,
    },
    { environment: process.env },
  );
  if (
    !observation.ok &&
    !/accessibility-denied|screen-recording-denied/u.test(
      observation.error.message,
    )
  )
    throw observation.error;
  if (!observation.ok && !process.argv.includes("--allow-permission-denial"))
    throw new Error(
      `Native UI E2E requires successful capture; permissions prevented coverage: ${observation.error.message}. Use --allow-permission-denial only for the separate permission diagnostic lane.`,
    );
  let scenarioStatus = "not-run-permission-denied";
  if (observation.ok) {
    const button = observation.value.initial.nodes.find(
      (node) => node.title === "Increment REA fixture",
    );
    if (button === undefined)
      throw new Error("Source-owned fixture button is absent from AX capture");
    const scenario = await observeNativeUi(
      target.value,
      "capture_native_ui_scenario",
      {
        ...scope,
        screenshot: false,
        steps: [
          { kind: "click", path: button.path },
          { kind: "wait", milliseconds: 200 },
        ],
      },
      { environment: process.env },
    );
    if (!scenario.ok) throw scenario.error;
    if (
      scenario.value.steps.some((step) => step.outcome !== "completed") ||
      !scenario.value.steps
        .at(-1)
        ?.after?.nodes.some((node) => node.title === "REA fixture incremented")
    )
      throw new Error(
        `Source-owned AX scenario failed: ${JSON.stringify(scenario.value.steps.map(({ outcome, reason }) => ({ outcome, reason })))}`,
      );
    scenarioStatus = "selected-AX-button-action-observed";
    const cli = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("./rea.mjs", import.meta.url)),
        "capture-native-ui-scenario",
        executable,
        "--pid",
        String(scope.pid),
        "--window-id",
        String(scope.window_id),
        "--steps",
        JSON.stringify([
          { kind: "click", path: button.path },
          { kind: "wait", milliseconds: 200 },
        ]),
        "--json",
      ],
      { maxBuffer: 32 * 1024 * 1024, timeout: 180000 },
    );
    const evidence = JSON.parse(cli.stdout);
    if (
      evidence.normalized_result?.steps?.some(
        (step) => step.outcome !== "completed",
      ) ||
      evidence.normalized_result?.steps?.length !== 2
    )
      throw new Error(
        `Native UI CLI did not preserve the selected scenario: ${JSON.stringify(evidence.error ?? evidence.normalized_result?.steps?.map(({ outcome, reason }) => ({ outcome, reason })))}`,
      );
    scenarioStatus = "selected-AX-button-action-and-CLI-parity-observed";
    await withArtifactMcp(executable, async (client) => {
      const observed = await artifactMcpResult(client, "observe_native_ui", {
        ...scope,
        screenshot: false,
      });
      if (
        !observed.initial.nodes.some(
          (node) =>
            node.role === "AXButton" &&
            JSON.stringify(node.path) === JSON.stringify(button.path),
        )
      )
        throw new Error("MCP omitted the selected fixture's actual AX button");
      const captured = await artifactMcpResult(
        client,
        "capture_native_ui_scenario",
        {
          ...scope,
          screenshot: false,
          steps: [
            { kind: "click", path: button.path },
            { kind: "wait", milliseconds: 200 },
          ],
        },
      );
      if (
        captured.steps.length !== 2 ||
        captured.steps.some((step) => step.outcome !== "completed") ||
        !captured.steps
          .at(-1)
          ?.after?.nodes.some(
            (node) => node.title === "REA fixture incremented",
          )
      )
        throw new Error("MCP did not observe the selected fixture's AX action");
    });
    scenarioStatus = "selected-AX-button-action-and-CLI-MCP-parity-observed";
  }
  const mismatch = await observeNativeUi(
    { ...target.value, sha256: "0".repeat(64) },
    "observe_native_ui",
    scope,
    { environment: process.env },
  );
  if (mismatch.ok || !mismatch.error.message.includes("target-mismatch"))
    throw new Error("Real helper did not reject changed target bytes");
  report = {
    ok: true,
    verification_status: observation.ok ? "passed" : "permission-boundary-only",
    positive_e2e: observation.ok,
    observation: observation.ok
      ? "captured-selected-fixture-window"
      : "os-permission-denial-verified",
    scenario: scenarioStatus,
    permission_failure: observation.ok ? null : observation.error.message,
    mismatch_rejected: true,
    target_owned: true,
  };
} finally {
  if (fixturePid !== undefined && fixtureIdentity?.state === "readable") {
    const current = await observeProcessStartIdentity(fixturePid);
    if (current !== undefined) {
      assert.ok(
        current.state === "readable" &&
          current.identity === fixtureIdentity.identity,
        "Fixture PID identity changed; refusing to signal another process",
      );
      try {
        process.kill(fixturePid, "SIGTERM");
      } catch (cause) {
        if (cause.code !== "ESRCH") throw cause;
      }
    }
  }
  if (child !== undefined && child.exitCode === null) {
    child.kill("SIGTERM");
    await childExit;
  }
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report)}\n`);
