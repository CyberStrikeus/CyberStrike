import { err, ok, type Result } from "../domain/result.js";
import { EVM_CPU_SECONDS, EVM_INTERFACE_LIMITS } from "./EvmoleRelease.js";

/** Selected worker soft limits to configure; inherited hard limits are left unchanged. */
export interface EvmWorkerLimits {
  readonly addressSpaceBytes: number;
  readonly cpuSeconds: number;
  readonly fileSizeBytes: number;
}

/** Read only the three selected Linux limits, retaining tighter soft/hard boundaries. */
export const selectEvmWorkerLimits = (
  raw: unknown,
): Result<EvmWorkerLimits, string> => {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 64 * 1024)
    return err(
      "Linux resource limits must be text within the 64 KiB parsing budget.",
    );
  const selected: number[] = [];
  for (const [name, units, maximum] of [
    ["Max address space", "bytes", EVM_INTERFACE_LIMITS.addressSpaceBytes],
    ["Max cpu time", "seconds", EVM_CPU_SECONDS],
    ["Max file size", "bytes", EVM_INTERFACE_LIMITS.outputBytes],
  ] as const) {
    const entries = raw
      .split("\n")
      .filter((line) => line.startsWith(name + " "));
    if (entries.length !== 1)
      return err(`Linux resource limits must report exactly one ${name} row.`);
    const match = new RegExp(
      `^${name}\\s+(unlimited|[0-9]+)\\s+(unlimited|[0-9]+)\\s+${units}\\s*$`,
    ).exec(entries[0] ?? "");
    if (match === null)
      return err(`Malformed inherited Linux resource limit: ${name}.`);
    let effective = BigInt(maximum);
    const soft = match[1];
    const hard = match[2];
    if (soft === undefined || hard === undefined)
      return err(`Missing ${name} values.`);
    if (
      hard !== "unlimited" &&
      (soft === "unlimited" || BigInt(soft) > BigInt(hard))
    )
      return err(`Inherited ${name} soft limit exceeds its hard limit.`);
    for (const value of [soft, hard])
      if (value !== "unlimited" && BigInt(value) < effective)
        effective = BigInt(value);
    selected.push(Number(effective));
  }
  const [addressSpaceBytes, cpuSeconds, fileSizeBytes] = selected;
  if (
    addressSpaceBytes === undefined ||
    cpuSeconds === undefined ||
    fileSizeBytes === undefined
  )
    return err("Required Linux resource limits were not selected.");
  return ok({ addressSpaceBytes, cpuSeconds, fileSizeBytes });
};
