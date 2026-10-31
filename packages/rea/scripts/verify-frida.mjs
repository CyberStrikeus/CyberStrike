import { basename } from "node:path";

import { FridaInstrumentationService } from "../dist/application/frida/FridaInstrumentationService.js";
import { FridaInstrumentationManager } from "../dist/frida/FridaInstrumentationManager.js";
import { isValidFridaRemoteAddress } from "../dist/contracts/fridaRemoteAddress.js";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(
    "Usage: npm run verify:frida [-- --address HOST:PORT --pid PID [remote auth flags]]\n" +
      "Without flags, verifies a local Node.js process created by this script.\n",
  );
  process.exit(0);
}

const manager = new FridaInstrumentationManager();
const service = new FridaInstrumentationService(manager);
const remote =
  options.address === undefined
    ? undefined
    : {
        address: options.address,
        ...(options.token === undefined ? {} : { token: options.token }),
        ...(options.certificate === undefined
          ? {}
          : { certificate: options.certificate }),
        ...(options.origin === undefined ? {} : { origin: options.origin }),
        ...(options.keepaliveInterval === undefined
          ? {}
          : { keepaliveInterval: options.keepaliveInterval }),
      };

try {
  const report = await withVerifierCleanup(async () => {
    let targetProcess;
    let input;
    if (remote === undefined) {
      input = {
        mode: "spawn",
        deviceId: "local",
        program: process.execPath,
        argv: ["-e", "setTimeout(() => {}, 1500)"],
        source: {
          sourceKind: "inline",
          source: "send({ rea_frida_verification: 'ok', pid: Process.id });",
        },
        durationMs: 500,
      };
      targetProcess = { pid: undefined, name: basename(process.execPath) };
    } else {
      const inventory = await service.listProcesses({ remote });
      if (!inventory.ok) throw new Error(inventory.error.message);
      targetProcess = inventory.value.processes.find(
        ({ pid }) => pid === options.pid,
      );
      if (targetProcess === undefined)
        throw new Error(
          `Selected PID ${String(options.pid)} was not observed remotely`,
        );
      input = {
        mode: "attach",
        remote,
        pid: options.pid,
        source: {
          sourceKind: "inline",
          source: "send({ rea_frida_verification: 'ok', pid: Process.id });",
        },
        durationMs: 500,
      };
    }

    const result = await service.instrument(input);
    if (!result.ok) throw new Error(result.error.message);
    const observed = result.value.evidence.normalized_result;
    if (
      typeof observed !== "object" ||
      observed === null ||
      Array.isArray(observed) ||
      !Array.isArray(observed.messages)
    )
      throw new Error("Frida returned no message observation");
    const messageObserved = observed.messages.some(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        !Array.isArray(message) &&
        message.type === "send" &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        !Array.isArray(message.payload) &&
        message.payload.rea_frida_verification === "ok" &&
        message.payload.pid === observed.pid,
    );
    if (!messageObserved)
      throw new Error("Selected target did not return the Frida marker");
    return {
      ok: result.value.cleanupError === null,
      provider: "frida",
      host_platform: process.platform,
      target_mode: remote === undefined ? "local_spawn" : "remote_attach",
      target_pid: observed.pid,
      target_name: targetProcess.name,
      ...(remote === undefined ? {} : { remote_target_observed: true }),
      script_message_observed: true,
      cleanup_error: result.value.cleanupError,
    };
  }, [() => manager.closeAll()]);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
} catch (cause) {
  const causes = cause instanceof AggregateError ? cause.errors : [cause];
  process.stderr.write(
    `Frida real-provider verification failed: ${causes.map((reason) => (reason instanceof Error ? reason.message : String(reason))).join("; ")}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const values = parseOptionValues(args);
  const address = values.get("--address");
  const pidValue = values.get("--pid");
  const pid = parseRemotePid(address, pidValue);
  if (address === undefined) assertNoRemoteOptions(values);
  const keepaliveInterval = parseKeepalive(values.get("--keepalive-interval"));
  return {
    help: false,
    ...(address === undefined ? {} : { address }),
    ...(pid === undefined ? {} : { pid }),
    ...(values.has("--token") ? { token: values.get("--token") } : {}),
    ...(values.has("--certificate")
      ? { certificate: values.get("--certificate") }
      : {}),
    ...(values.has("--origin") ? { origin: values.get("--origin") } : {}),
    ...(keepaliveInterval === undefined ? {} : { keepaliveInterval }),
  };
}

function parseOptionValues(args) {
  const values = new Map();
  const valueFlags = new Set([
    "--address",
    "--pid",
    "--token",
    "--certificate",
    "--origin",
    "--keepalive-interval",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      typeof flag !== "string" ||
      !valueFlags.has(flag) ||
      value === undefined ||
      values.has(flag)
    )
      throw new Error(
        "Expected no arguments for local-fixture verification, or --address HOST:PORT --pid PID and optional remote auth flags",
      );
    values.set(flag, value);
    index += 1;
  }
  return values;
}

function parseRemotePid(address, pidValue) {
  if ((address === undefined) !== (pidValue === undefined))
    throw new Error("Remote verification requires both --address and --pid");
  if (address !== undefined && !isValidFridaRemoteAddress(address))
    throw new Error(
      "--address must be a host[:port] without credentials, path, query, or fragment",
    );
  const pid = pidValue === undefined ? undefined : Number(pidValue);
  if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0))
    throw new Error("--pid must be a positive process identifier");
  return pid;
}

function assertNoRemoteOptions(values) {
  for (const flag of [
    "--token",
    "--certificate",
    "--origin",
    "--keepalive-interval",
  ])
    if (values.has(flag))
      throw new Error("Remote connection options require --address and --pid");
}

function parseKeepalive(value) {
  const interval = value === undefined ? undefined : Number(value);
  if (
    interval !== undefined &&
    (!Number.isSafeInteger(interval) || interval <= 0)
  )
    throw new Error("--keepalive-interval must be a positive integer");
  return interval;
}
