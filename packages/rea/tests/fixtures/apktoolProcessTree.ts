import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { z } from "zod";
import { cleanupOwnedProcessGroup } from "../../src/process/ProcessOwnership.js";

const markerSchema = z.object({
  rootPid: z.int().positive(),
  childPid: z.int().positive(),
  runId: z.string().min(1),
  ready: z.boolean(),
});

/** Bound the observation, clearing its timer on both settlement paths. */
export const awaitApktoolOperation = async <T>(
  pending: Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Apktool fixture operation did not settle within ${String(timeoutMs)} ms`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** One public-command fixture, its published identity, and token-verified teardown. */
export const createApktoolProcessFixture = async (
  root: string,
  mode: "probe" | "decode",
) => {
  const command = join(root, "apktool");
  const markerPath = join(root, "pids.json");
  const producer = new URL("./apktoolProcessTree.mjs", import.meta.url).href;
  await writeFile(
    command,
    [
      `#!${process.execPath}`,
      `import(${JSON.stringify(producer)}).then(({ run }) => run(${JSON.stringify({ mode, markerPath })}));`,
      "",
    ].join("\n"),
    { mode: 0o700, flag: "wx" },
  );
  let owner: z.infer<typeof markerSchema> | undefined;
  let released = false;
  const readMarker = async () => {
    let text: string;
    try {
      text = await readFile(markerPath, "utf8");
    } catch (cause: unknown) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    }
    const marker = markerSchema.parse(JSON.parse(text));
    if (
      owner !== undefined &&
      (marker.rootPid !== owner.rootPid ||
        marker.childPid !== owner.childPid ||
        marker.runId !== owner.runId)
    )
      throw new Error("Apktool fixture marker changed its process identity");
    owner = marker;
    return marker;
  };
  const cleanup = async (operations: readonly Promise<unknown>[] = []) => {
    const settled = await Promise.allSettled(
      operations.map((operation) => awaitApktoolOperation(operation, 10_000)),
    );
    const failures = settled.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason as unknown] : [],
    );
    if (!released) {
      try {
        await readMarker();
      } catch (cause: unknown) {
        failures.push(cause);
      }
      if (owner !== undefined) {
        try {
          const result = await cleanupOwnedProcessGroup({
            runId: owner.runId,
            leaderPid: owner.rootPid,
            processGroupId: owner.rootPid,
          });
          if (result.cleaned) released = true;
          else
            failures.push(
              new Error(
                `Apktool fixture cleanup remains unverified: ${result.reason}`,
              ),
            );
        } catch (cause: unknown) {
          failures.push(cause);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        "Apktool fixture settlement and cleanup failures",
      );
  };
  onTestFinished(() => cleanup());
  return { command, markerPath, readMarker, cleanup };
};
