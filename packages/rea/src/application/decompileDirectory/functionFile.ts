import type { DecompileDirectoryFunctionRecord } from "../../contracts/decompileDirectory.js";
import type { ExportIdentity } from "./exportTree.js";

export interface FunctionBodyFact {
  readonly available: false;
  readonly reason: string;
}

export interface FunctionBodyRanges {
  readonly available: true;
  readonly ranges: readonly { readonly start: string; readonly end: string }[];
  readonly non_contiguous: boolean;
}

export type FunctionBody = FunctionBodyFact | FunctionBodyRanges;

/** Line-comment header plus the provider text. A block comment would close early inside pseudocode. */
export const functionFileText = (input: {
  readonly procedure: {
    readonly address: string;
    readonly name: string | null;
  };
  readonly body: FunctionBody;
  readonly identity: ExportIdentity;
  readonly limitations: readonly string[];
  readonly pseudocode: string;
}): string => {
  const lines = [
    "// rea decompile_all",
    `// name: ${headerValue(input.procedure.name ?? "")}`,
    `// address: ${headerValue(input.procedure.address)}`,
    ...bodyLines(input.body),
    `// provider: ${headerValue(providerLine(input.identity))}`,
    `// analysis_profile: ${input.identity.analysisProfileDigest ?? "unavailable"}`,
    ...limitationLines(input.limitations),
    "// pseudocode: provider-specific; not original source",
  ];
  return `${lines.join("\n")}\n\n${input.pseudocode}`;
};

export const bodyRecord = (
  body: FunctionBody,
): DecompileDirectoryFunctionRecord["body"] =>
  body.available
    ? {
        available: true,
        ranges: body.ranges.map((range) => ({
          start: range.start,
          end: range.end,
        })),
        non_contiguous: body.non_contiguous,
      }
    : { available: false, reason: body.reason };

const bodyLines = (body: FunctionBody): readonly string[] =>
  body.available
    ? [
        "// body: available",
        ...body.ranges.map(
          (range) =>
            `// range: ${headerValue(range.start)}-${headerValue(range.end)} inclusive`,
        ),
        `// non_contiguous: ${body.non_contiguous ? "true" : "false"}`,
      ]
    : ["// body: unavailable", `// body_reason: ${headerValue(body.reason)}`];

const limitationLines = (limitations: readonly string[]): readonly string[] => {
  const joined = limitations
    .map((limitation) => headerValue(limitation))
    .filter((limitation) => limitation.length > 0)
    .join("; ");
  if (joined.length <= 4_000)
    return [`// limitations: ${joined.length === 0 ? "none" : joined}`];
  return [
    `// limitations: ${joined.slice(0, 4_000)}`,
    "// limitations_truncated: true; decompile-index.json keeps the complete list",
  ];
};

const providerLine = (identity: ExportIdentity): string =>
  `${identity.provider.name} ${identity.provider.version ?? "unknown"} (${identity.provider.id})`;

/** Keep a provider string on one header line without control characters. */
const headerValue = (value: string): string =>
  value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 2_000);
