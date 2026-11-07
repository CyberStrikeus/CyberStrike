import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { DevicetreePort } from "./DevicetreePort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectDevicetreeInputSchema,
  devicetreeSchema,
  type Devicetree,
} from "../../domain/firmware/devicetree.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";
import { parseAnalysisInput } from "../AnalysisInput.js";

const OPERATION = "inspect_devicetree";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class DevicetreeService {
  constructor(readonly provider: DevicetreePort) {}

  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const input = parseAnalysisInput(
      OPERATION,
      rawInput,
      inspectDevicetreeInputSchema,
      options?.signal,
    );
    if (!input.ok) return input;
    if (!isAbsolute(input.value.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    const result = await this.provider.inspect(input.value, options);
    if (!result.ok) return result;
    const report = devicetreeSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.value.path ||
      report.data.artifact.bytes > input.value.max_file_bytes ||
      report.data.nodes.length > input.value.max_nodes ||
      report.data.coverage.examined_properties > input.value.max_properties ||
      !validReport(report.data)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "devicetree provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const locations = [
      { kind: "artifact-path" as const, path: value.artifact.path },
    ];
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "file",
          sha256: value.artifact.sha256,
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: input.value,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations,
        },
      ),
      options?.signal,
    );
  }
}

/** Validate coverage and byte provenance at the provider boundary. */
const validReport = (report: Devicetree): boolean => {
  if (
    report.header.totalsize > report.artifact.bytes ||
    report.coverage.examined_nodes !== report.nodes.length
  )
    return false;
  let properties = 0;
  const paths = new Set<string>();
  for (const node of report.nodes) {
    if (
      paths.has(node.path) ||
      (node.parent !== null && !paths.has(node.parent)) ||
      node.offset >= report.header.totalsize
    )
      return false;
    paths.add(node.path);
    properties += node.properties.length;
    for (const property of node.properties) {
      if (
        property.offset > report.header.totalsize - property.bytes ||
        property.hex.length !== Math.min(property.bytes, 256) * 2 ||
        property.truncated !== property.bytes > 256
      )
        return false;
    }
  }
  return (
    properties === report.coverage.examined_properties &&
    report.reservations.every((r) => r.offset <= report.header.totalsize - 16)
  );
};
