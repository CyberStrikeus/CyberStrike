import { ProcessAdmissionError } from "./ProcessAdmissionError.js";
import { open } from "node:fs/promises";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";
import { withArtifactFileHandle } from "../artifacts/ArtifactFileOperation.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

/** Per-process ceilings inherited by an owned Linux producer. */
export interface LinuxResourceLimits {
  readonly address_space_bytes: number;
  readonly file_bytes: number;
  readonly cpu_seconds: number;
}
const rows = {
  address_space_bytes: "Max address space",
  file_bytes: "Max file size",
  cpu_seconds: "Max cpu time",
} as const;

/** Bound the resident input copy and retained text before allocation/collection. */
export const BOUNDED_PRODUCER_LIMITS = {
  input_bytes: 32 * 1024 * 1024,
  output_bytes: 4 * 1024 * 1024,
  command_timeout_ms: 30_000,
  address_space_bytes: 1024 * 1024 * 1024,
  file_bytes: 64 * 1024 * 1024,
  cpu_seconds: 30,
} as const;

/**
 * Pin soft and hard ceilings together, ending at the prlimit option terminator.
 * Callers that append the producer command themselves use this prefix.
 */
export const prlimitCeilingArguments = (
  limits: LinuxResourceLimits,
): string[] => [
  `--as=${limits.address_space_bytes}:${limits.address_space_bytes}`,
  `--fsize=${limits.file_bytes}:${limits.file_bytes}`,
  `--cpu=${limits.cpu_seconds}:${limits.cpu_seconds}`,
  "--core=0:0",
  "--",
];

/** Pin soft and hard ceilings together, then hand the producer argv to the limiter. */
export const prlimitArgumentVector = (
  limits: LinuxResourceLimits,
  command: string,
): string[] => [...prlimitCeilingArguments(limits), command];

/** Never raise either inherited soft policy or hard ceiling. */
export const clampLinuxResourceLimits = (
  configured: LinuxResourceLimits,
  report: string,
): LinuxResourceLimits => {
  const effective = { ...configured };
  for (const key of Object.keys(rows) as (keyof LinuxResourceLimits)[]) {
    const matches = report
      .split("\n")
      .filter((line) => line.startsWith(`${rows[key]} `));
    const values = matches[0]?.slice(rows[key].length).trim().split(/\s+/u);
    if (matches.length !== 1 || values === undefined || values.length !== 3)
      throw new ProcessAdmissionError("limit_unreadable", { limit: key });
    let ceiling = BigInt(configured[key]);
    for (const token of values.slice(0, 2)) {
      if (token === "unlimited") continue;
      if (!/^[0-9]+$/u.test(token))
        throw new ProcessAdmissionError("limit_invalid", { limit: key });
      const value = BigInt(token);
      if (value < ceiling) ceiling = value;
    }
    effective[key] = Number(ceiling);
  }
  return effective;
};

/** Read the trusted kernel report with a fixed allocation before spawning. */
export const readLinuxResourceLimits = async (
  configured: LinuxResourceLimits,
  resourceScope?: ArtifactResourceScope,
): Promise<LinuxResourceLimits> => {
  const file = await open("/proc/self/limits", "r");
  return withArtifactFileHandle(
    "/proc/self/limits",
    file,
    resourceScope,
    undefined,
    async (handle) => {
      const reportBudget = 16 * 1024;
      const buffer = await readFileHandleRange(handle, 0, reportBudget);
      if (buffer.length === reportBudget)
        throw new ProcessAdmissionError("report_exceeds_budget", {
          budget_bytes: reportBudget,
        });
      return clampLinuxResourceLimits(configured, buffer.toString("utf8"));
    },
  );
};
