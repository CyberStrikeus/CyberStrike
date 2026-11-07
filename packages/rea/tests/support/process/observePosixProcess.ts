import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Observable POSIX process state; unknown states remain rejected by the caller. */
export type PosixProcessObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "zombie"; readonly state: string }
  | { readonly kind: "running"; readonly state: string };

/** Observe one PID with ps without signaling it or treating checker faults as absence. */
export const observePosixProcess = async (
  pid: number,
): Promise<PosixProcessObservation> => {
  let stdout: string;
  try {
    const result = await execFileAsync("ps", [
      "-o",
      "stat=",
      "-p",
      String(pid),
    ]);
    if (result.stderr !== "")
      throw new Error(
        `Process observation emitted diagnostics: ${result.stderr}`,
      );
    stdout = result.stdout;
  } catch (cause: unknown) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      cause.code === 1 &&
      "stdout" in cause &&
      typeof cause.stdout === "string" &&
      cause.stdout.trim() === "" &&
      "stderr" in cause &&
      cause.stderr === ""
    )
      return { kind: "absent" };
    throw cause;
  }

  const state = stdout.trim();
  if (state === "") return { kind: "absent" };
  return state.startsWith("Z")
    ? { kind: "zombie", state }
    : { kind: "running", state };
};
