import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { absoluteCallerPath } from "../../filesystem/callerPath.js";

/** Choose a fresh temporary destination for an artifact extraction. */
export const createArtifactExtractionDestination = (): string =>
  absoluteCallerPath(`${tmpdir()}/rea-extracted-${randomUUID()}`);
