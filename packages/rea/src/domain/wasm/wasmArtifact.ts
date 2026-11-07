import { wasmInterfaceSchema } from "./wasmInterface.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { EvidenceSubjectTarget } from "../evidence.js";

import { absoluteLocalPathStringSchema } from "../localPath.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const artifact = z.strictObject({
  path: z.string().min(1),
  sha256: digest,
  bytes: z.int().nonnegative(),
});
/** Default execution budget; upper bound is the runtime's signed 32-bit timer range. */
export const DEFAULT_WASM_COMMAND_TIMEOUT_MS = 30_000;
export const MAX_WASM_COMMAND_TIMEOUT_MS = 2_147_483_647;
/** Selected artifact lists share the same resource bound across path transports. */
export const wasmArtifactPathsSchema = (
  pathSchema: z.ZodString = absoluteLocalPathStringSchema,
) => z.array(pathSchema).max(16);
/** All artifacts are explicitly selected local files; references never trigger acquisition. */
export const inspectWasmArtifactInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute selected local WASM artifact path",
  ),
  glue_paths: wasmArtifactPathsSchema().default([]),
  candidate_paths: wasmArtifactPathsSchema().default([]),
  command_timeout_ms: z
    .number()
    .int()
    .min(1)
    .max(MAX_WASM_COMMAND_TIMEOUT_MS)
    .exactOptional()
    .describe(
      `Deadline in milliseconds for each WABT version/analysis command (default ${String(DEFAULT_WASM_COMMAND_TIMEOUT_MS)}), not the whole inspection. Allow additional client time for all commands, file checks and cleanup. Input/output safety limits remain fixed.`,
    ),
});
/** Upstream output stays intact; import/export names are never split on ambiguous punctuation. */
export const wasmArtifactSchema = z
  .strictObject({
    artifact,
    validation: z.literal("valid"),
    sections: z.array(
      z.strictObject({
        kind: z.string().min(1),
        start: z.int().nonnegative(),
        end: z.int().nonnegative(),
        bytes: z.int().nonnegative(),
        description: z.string(),
      }),
    ),
    interface: wasmInterfaceSchema.exactOptional(),
    imports: z.array(z.string()),
    exports: z.array(z.string()),
    debug_name_metadata: z
      .enum(["unknown", "not-present", "complete", "uninterpretable"])
      .default("unknown"),
    custom_section_warnings: z
      .array(
        z.strictObject({
          tool: z.enum(["wasm-validate", "wasm-objdump", "wasm2wat"]),
          text: z.string().min(1),
        }),
      )
      .nullable()
      .default(null),
    headers: z.string(),
    details: z.string(),
    wat: z.strictObject({
      text: z.string().min(1),
      sha256: digest,
      representation: z.literal("decoded-wat"),
    }),
    tool_profile: z.strictObject({
      source: z.literal("https://github.com/WebAssembly/wabt"),
      release: z.literal("1.0.42"),
      source_commit: z.literal("ff0ef7e0009402740c805a9744c09b05be063e48"),
      commands: z
        .array(
          z.strictObject({
            tool: z.enum(["wasm-validate", "wasm-objdump", "wasm2wat"]),
            path: z.string().min(1),
            sha256: digest,
            version_banner: z.string(),
            arguments: z.array(z.string()),
          }),
        )
        .length(3),
      timeout_ms: z.int().positive(),
      output_budget_bytes: z.int().positive(),
    }),
    candidates: z.array(artifact),
    glue: z.array(
      z.strictObject({
        artifact,
        parse_status: z.enum(["complete", "partial", "failed"]),
        references: z.array(
          z.strictObject({
            value: z.string(),
            line: z.int().positive(),
            column: z.int().nonnegative(),
            candidate_paths: z.array(z.string()),
            association: z.enum([
              "local-path-candidate",
              "basename-candidates",
              "unresolved",
            ]),
            evidence_kind: z.literal("static-literal"),
          }),
        ),
      }),
    ),
    runtime_execution: z.literal("not-performed"),
    network_fetch: z.literal("not-performed"),
    limitations: z.array(z.string()),
  })
  .superRefine((value, context) => {
    if (
      createHash("sha256").update(value.wat.text, "utf8").digest("hex") !==
      value.wat.sha256
    )
      context.addIssue({
        code: "custom",
        path: ["wat", "sha256"],
        message: "Decoded WAT digest does not match its UTF-8 text.",
      });
    const selected = value.candidates[0];
    if (
      selected?.path !== value.artifact.path ||
      selected.sha256 !== value.artifact.sha256 ||
      selected.bytes !== value.artifact.bytes
    )
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Selected candidate does not match artifact identity.",
      });
    const tolerantCustomSections =
      value.tool_profile.commands[0]?.arguments.includes(
        "--ignore-custom-section-errors",
      );
    for (const [index, command] of value.tool_profile.commands.entries()) {
      const expected = ["wasm-validate", "wasm-objdump", "wasm2wat"][index];
      const argumentsExpected =
        command.tool === "wasm-objdump"
          ? ["-h", "-x", "module.wasm"]
          : tolerantCustomSections
            ? ["--enable-all", "--ignore-custom-section-errors", "module.wasm"]
            : ["--enable-all", "module.wasm"];
      if (
        command.tool !== expected ||
        command.version_banner.trim() !== "1.0.42" ||
        JSON.stringify(command.arguments) !== JSON.stringify(argumentsExpected)
      )
        context.addIssue({
          code: "custom",
          path: ["tool_profile", "commands", index],
          message: "Unexpected WABT command profile.",
        });
    }
    for (const [index, section] of value.sections.entries())
      if (
        section.end > value.artifact.bytes ||
        section.end - section.start !== section.bytes
      )
        context.addIssue({
          code: "custom",
          path: ["sections", index],
          message: "Section range does not match selected artifact bytes.",
        });
  });
export type InspectWasmArtifactInput = z.infer<
  typeof inspectWasmArtifactInputSchema
>;
export type WasmArtifact = z.infer<typeof wasmArtifactSchema>;

/** Semantic WASM subject identity excludes delivery-only local paths. */
export type WasmArtifactSubject = Pick<
  EvidenceSubjectTarget,
  "sha256" | "format"
>;
type WasmArtifactFileSubject = WasmArtifactSubject & {
  readonly format: "file";
};

/** Match semantic artifact identity; local subject paths are delivery metadata. */
export const wasmArtifactMatchesSubject = (
  artifact: WasmArtifact["artifact"],
  subject: WasmArtifactSubject | null | undefined,
): subject is WasmArtifactFileSubject =>
  subject != null &&
  subject.sha256 === artifact.sha256 &&
  subject.format === "file";
