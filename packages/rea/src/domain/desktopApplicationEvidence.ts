import {
  createEvidence,
  type Evidence,
  type EvidenceProvider,
} from "./evidence.js";
import type {
  DesktopApplication,
  InspectDesktopApplicationInput,
} from "./desktopApplication.js";

/** One Evidence interpretation for complete and interrupted directory observations. */
export const createDesktopApplicationEvidence = (
  input: InspectDesktopApplicationInput,
  report: DesktopApplication,
  provider: EvidenceProvider,
): Evidence =>
  createEvidence(
    {
      path: report.root.path,
      format: "directory",
      sha256: report.root.snapshot_sha256,
    },
    provider,
    {
      operation: "inspect_desktop_application",
      parameters: input,
      result: report,
      rawResult: null,
      confidence: "observed",
      limitations: report.limitations,
      locations: [{ kind: "artifact-path", path: input.path }],
    },
  );
