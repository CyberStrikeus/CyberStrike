import { BINARY_ARCHITECTURES } from "../binaryTargetTypes.js";
import { createEvidence, type Evidence } from "../evidence.js";
import type {
  ElectronFuseReport,
  InspectElectronFusesInput,
} from "./electronFuses.js";

/** Preserve the same validated fuse facts on success and incomplete finalization. */
export const createElectronFuseEvidence = (
  input: InspectElectronFusesInput,
  value: ElectronFuseReport,
  provider: Evidence["provider"],
): Evidence => {
  const architecture = subjectArchitecture(value);
  return createEvidence(
    {
      path: value.artifact.resolved_path,
      sha256: value.artifact.sha256,
      format: value.artifact.format,
      ...(architecture === undefined ? {} : { architecture }),
    },
    provider,
    {
      operation: "inspect_electron_fuses",
      parameters: input,
      result: value,
      confidence: "observed",
      limitations: value.limitations,
      locations: locationsFor(value),
    },
  );
};

const subjectArchitecture = (report: ElectronFuseReport) => {
  if (report.artifact.format === "mach-o-universal") return undefined;
  if (report.slices.length !== 1) return undefined;
  const name = report.slices[0]?.architecture;
  return BINARY_ARCHITECTURES.find((supported) => supported === name);
};

const locationsFor = (report: ElectronFuseReport) => [
  { kind: "artifact-path" as const, path: report.artifact.selected_path },
  ...(report.artifact.resolved_path === report.artifact.selected_path
    ? []
    : [
        {
          kind: "artifact-path" as const,
          path: report.artifact.resolved_path,
        },
      ]),
  ...report.slices.flatMap((slice) =>
    slice.sentinels.map((sentinel) => ({
      kind: "file-offset" as const,
      offset: sentinel.sentinel_offset,
    })),
  ),
];
