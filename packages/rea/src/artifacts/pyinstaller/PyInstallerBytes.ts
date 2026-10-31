import type { FileHandle } from "node:fs/promises";
import { err, ok, type Result } from "../../domain/result.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { abortIfNeeded } from "../ArtifactHash.js";
import {
  pyInstallerFailure,
  type PyInstallerFailure,
} from "./PyInstallerFailure.js";

/** Fill one already-budgeted format range; only zero bytes establish EOF. */
export const readPyInstallerBytes = async (
  handle: Pick<FileHandle, "read">,
  input: {
    readonly position: number;
    readonly length: number;
    readonly label: string;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Result<Buffer, PyInstallerFailure>> => {
  abortIfNeeded(input.signal);
  if (
    !Number.isSafeInteger(input.position) ||
    !Number.isSafeInteger(input.length) ||
    input.position < 0 ||
    input.length < 0 ||
    !Number.isSafeInteger(input.position + input.length)
  )
    return err(
      pyInstallerFailure(
        "format",
        `${input.label} has an invalid source range`,
      ),
    );
  const bytes = Buffer.alloc(input.length);
  let offset = 0;
  while (offset < bytes.length) {
    abortIfNeeded(input.signal);
    let count: number;
    try {
      const read = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        input.position + offset,
      );
      count = read.bytesRead;
    } catch (cause: unknown) {
      throw new ArtifactReaderFailure(
        "io",
        `${input.label} could not be read`,
        { cause },
      );
    }
    abortIfNeeded(input.signal);
    if (count === 0)
      return err(pyInstallerFailure("format", `${input.label} is truncated`));
    offset += count;
  }
  return ok(bytes);
};
