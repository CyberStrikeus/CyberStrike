import {
  createAnalysisExecution,
  type AnalysisExecution,
} from "../application/AnalysisProvider.js";
import { AnalysisProtocolError } from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { adbArguments, runAdb, type AdbRunLimits } from "./AdbCommand.js";
import type { AdbBinarySelection } from "./AdbConfiguration.js";
import {
  parseAdbDevicesOutput,
  parseGetpropOutput,
} from "./AdbDeviceOutput.js";
import type { AdbRequest } from "../domain/adb/adbDeviceAnalysis.js";
import type {
  AdbClientResult,
  AdbProviderIdentity,
} from "./AdbOperationResults.js";

const DEVICES_TIMEOUT_MS = 20_000;
const DEVICES_MAX_OUTPUT_BYTES = 1024 * 1024;
const SHELL_TIMEOUT_MS = 30_000;
const GETPROP_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface AdbCommandContext {
  readonly operation: AdbRequest["operation"];
  readonly request: AdbRequest;
  readonly selection: AdbBinarySelection;
  readonly client: AdbClientResult;
  readonly provider: AdbProviderIdentity;
  readonly signal: AbortSignal | undefined;
  readonly shell: (
    arguments_: readonly string[],
    limits: AdbRunLimits,
  ) => ReturnType<typeof runAdb>;
}

export const inspectAdbClientOperation = (
  context: AdbCommandContext,
): Result<AnalysisExecution, AnalysisError> =>
  ok(
    createAnalysisExecution(
      { client: context.client, contacted_adb_server: false },
      context.provider,
    ),
  );

export const listAdbDevicesOperation = async (
  context: AdbCommandContext,
): Promise<Result<AnalysisExecution, AnalysisError>> => {
  const ran = await runAdb(
    context.operation,
    { device: "adb-devices" },
    context.selection,
    ["devices", "-l"],
    {
      timeoutMs: DEVICES_TIMEOUT_MS,
      maxOutputBytes: DEVICES_MAX_OUTPUT_BYTES,
      volatileOutput: true,
    },
    context.signal,
  );
  if (!ran.ok) return ran;
  const { devices, unparsedLines, daemonStarted } = parseAdbDevicesOutput(
    ran.value.stdout,
    ran.value.stderr,
  );
  if (unparsedLines.total > 0)
    return err(
      new AnalysisProtocolError(
        `adb devices reported an unrecognized line: ${unparsedLines.sample[0]!}`,
      ),
    );
  return ok(
    createAnalysisExecution(
      {
        client: context.client,
        devices,
        may_have_started_adb_server: daemonStarted,
      },
      context.provider,
      {
        limitations: [
          "Device kind is inferred from the emulator serial prefix and USB transport metadata, not from device attestation",
          "Kind stays unknown for TCP transports unless the serial is an emulator port",
        ],
      },
    ),
  );
};

export const inspectAdbDeviceOperation = async (
  context: AdbCommandContext,
): Promise<Result<AnalysisExecution, AnalysisError>> => {
  const { request } = context;
  if (request.operation !== "inspect_adb_device")
    return err(
      new AnalysisProtocolError(
        `adb device inspection does not accept ${request.operation}`,
      ),
    );
  const serial = request.input.serial;
  const ran = await runAdb(
    context.operation,
    { device: serial },
    context.selection,
    adbArguments(serial, ["shell", "getprop"]),
    {
      timeoutMs: SHELL_TIMEOUT_MS,
      maxOutputBytes: GETPROP_MAX_OUTPUT_BYTES,
      volatileOutput: true,
    },
    context.signal,
  );
  if (!ran.ok) return ran;
  const { properties, emulatorObserved } = parseGetpropOutput(ran.value.stdout);
  return ok(
    createAnalysisExecution(
      {
        client: context.client,
        serial,
        properties,
        property_count: properties.length,
        emulator_observed: emulatorObserved,
      },
      context.provider,
      {
        limitations: [
          "Properties are a fixed whitelist of build identity facts, not the full getprop dump",
          "emulator_observed is null when the build does not report ro.kernel.qemu",
        ],
      },
    ),
  );
};
