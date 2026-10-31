import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { PeResourcesPort } from "./PeResourcesPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectPeResourcesInputSchema,
  peResourcesSchema,
  type PeResources,
  type PeResourceIdentity,
} from "../../domain/native/peResources.js";
import { peSubjectArchitecture } from "../../domain/peMachine.js";
import { err, ok, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class PeResourcesService {
  constructor(readonly provider: PeResourcesPort) {}

  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const operation = "inspect_pe_resources";
    const input = parseAnalysisInput(
      operation,
      rawInput,
      inspectPeResourcesInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = peResourcesSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      !validReport(
        report.data,
        input.value.max_entries,
        input.value.max_file_bytes,
      )
    )
      return err(
        new AnalysisOutputError(
          operation,
          "PE resource provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const architecture = peSubjectArchitecture(value.machine, value.format);
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "pe",
          sha256: value.artifact.sha256,
          ...(architecture === undefined ? {} : { architecture }),
        },
        this.provider.identity,
        {
          operation,
          parameters: input.value,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [{ kind: "artifact-path", path: value.artifact.path }],
        },
      ),
      options?.signal,
    );
  }
}

/** Check cross-field invariants before provider output becomes public Evidence. */
const validReport = (
  report: PeResources,
  maxEntries: number,
  maxBytes: number,
): boolean => {
  const inside = ({ offset, bytes }: { offset: number; bytes: number }) =>
    offset <= report.artifact.bytes - bytes;
  const identityInside = (identity: PeResourceIdentity): boolean =>
    identity.kind === "id" || inside(identity.location);
  if (
    report.artifact.bytes > maxBytes ||
    report.coverage.resources !== report.resources.length ||
    report.coverage.examined_entries > maxEntries ||
    report.coverage.examined_entries !==
      report.directories.reduce(
        (sum, item) => sum + item.named_entries + item.id_entries,
        0,
      )
  )
    return false;
  if (
    report.directory === null &&
    (report.directories.length > 0 || report.resources.length > 0)
  )
    return false;
  if (
    report.directory !== null &&
    (!inside(report.directory.location) ||
      !inside(report.directory.data_directory_location))
  )
    return false;
  if (
    !report.directories.every(
      (item) =>
        inside(item.location) &&
        item.path.length === item.entry_locations.length &&
        item.entry_locations.every(inside) &&
        item.path.every(identityInside),
    )
  )
    return false;
  if (
    !report.resources.every(
      (item, index) =>
        item.index === index &&
        inside(item.data_entry_location) &&
        inside(item.payload.location) &&
        item.entry_locations.every(inside) &&
        [item.type, item.name, item.language].every(identityInside),
    )
  )
    return false;
  return report.icon_groups.every((group) => {
    const resource = report.resources[group.resource_index];
    if (
      resource === undefined ||
      resource.type.kind !== "id" ||
      resource.type.id !== 14
    )
      return false;
    return group.images.every(
      (image) =>
        inside(image.location) &&
        image.location.offset >= resource.payload.location.offset &&
        image.location.offset + image.location.bytes <=
          resource.payload.location.offset + resource.payload.location.bytes &&
        image.candidate_resource_indices.every((index) => {
          const icon = report.resources[index];
          return (
            icon !== undefined &&
            icon.type.kind === "id" &&
            icon.type.id === 3 &&
            icon.name.kind === "id" &&
            icon.name.id === image.resource_id
          );
        }) &&
        (image.same_language_resource_index === null
          ? image.size_matches === null
          : image.candidate_resource_indices.includes(
              image.same_language_resource_index,
            ) &&
            sameIdentity(
              report.resources[image.same_language_resource_index]?.language,
              resource.language,
            ) &&
            image.size_matches ===
              (report.resources[image.same_language_resource_index]?.payload
                .location.bytes ===
                image.declared_bytes)),
    );
  });
};

const sameIdentity = (
  left: PeResourceIdentity | undefined,
  right: PeResourceIdentity,
): boolean =>
  left?.kind === "id" && right.kind === "id"
    ? left.id === right.id
    : left?.kind === "name" &&
      right.kind === "name" &&
      left.utf16le_hex === right.utf16le_hex;
