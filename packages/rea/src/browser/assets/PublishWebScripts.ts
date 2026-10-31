import { createHash } from "node:crypto";
import { join } from "node:path";
import { Readable } from "node:stream";

import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  DestinationCaseCollisionFailure,
  DestinationPathUnrepresentableFailure,
} from "../../artifacts/ArtifactPaths.js";
import { SafeOutputTree } from "../../artifacts/SafeOutputTree.js";
import { outputDirectoryAdmissionRefusal } from "../../artifacts/SafeOutputTreeAdmission.js";
import { SafeOutputTreeCreationFailure } from "../../artifacts/SafeOutputTreeCreationFailure.js";
import { PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION } from "../../domain/browserNetworkEvidence.js";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import {
  webScriptExportManifestSchema,
  webScriptExportResultSchema,
  type ExportWebScriptsInput,
  type ExportedWebScript,
  type WebScriptExportResult,
} from "../../domain/webScriptExport.js";
import {
  isolatedWebScriptPath,
  planWebScriptExport,
  type PlannedWebScript,
} from "../../domain/webScriptExportPlan.js";
import { WebScriptExportError } from "../../domain/webScriptExportError.js";
import type { SelectedScriptCapture } from "./ScriptCaptureAdapters.js";

const LIMITATIONS = [
  "Only script bytes retained in this capture are exported. Sources are not refetched or executed, and a response or Debugger source does not prove execution.",
  "Ordinary unambiguous URL paths preserve relative module layouts by origin, including case-distinct spellings. Query variants, exact path collisions, file/directory prefixes, inline sources, and unrepresentable paths are isolated. A case-distinct pair is isolated only when the destination filesystem cannot store both spellings; the record names that pair. Browser module relationships of isolated paths remain unknown.",
  "Local JavaScript analysis does not implement browser import maps, root-relative URL resolution, remote URL loading, or browser runtime behavior. It may strip import queries and fragments; isolated variants are not canonical targets.",
  "Source-map declarations are retained as metadata. No source maps or missing dependencies are fetched or reconstructed.",
  "Scenario response bytes preserve the output of Playwright's Response.body() API; any source-body provenance caveat from the capture is retained in this manifest. Debugger sources are the exposed text encoded as UTF-8. Redacted bytes are exported exactly as retained, and may no longer parse as JavaScript.",
];

const OPERATION = "export_web_scripts";

interface PublishWebScriptsOptions {
  readonly resources: ArtifactResourceScope;
  readonly signal?: AbortSignal;
}

/** Exclusively publish verified bytes and a manifest, rolling back partial work. */
export const publishWebScripts = async (
  input: ExportWebScriptsInput,
  capture: SelectedScriptCapture & { readonly sourceEvidenceId: string | null },
  captureSha256: string,
  options: PublishWebScriptsOptions,
): Promise<WebScriptExportResult> =>
  options.resources.run(async () => {
    const assertActive = (): void => {
      if (options.signal?.aborted)
        throw new AnalysisCancelledError(OPERATION, {
          cause: options.signal.reason,
        });
    };
    const planned = planWebScriptExport(capture.scripts);
    const scenarioResponseBodyCaptured =
      capture.kind === "browser-scenario" &&
      capture.scripts.some(
        (script) =>
          script.source.kind === "scenario-response" &&
          script.content.state === "captured" &&
          (script.content.representation === "playwright-response-body-bytes" ||
            script.content.representation === "browser-decoded-response-bytes"),
      );
    const responseBodyProvenanceLimitations =
      scenarioResponseBodyCaptured &&
      !capture.limitations.includes(
        PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION,
      )
        ? [PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION]
        : [];
    let tree: SafeOutputTree | undefined;
    let result: WebScriptExportResult | undefined;
    try {
      tree = await SafeOutputTree.create(input.output_directory);
      assertActive();
      const records: ExportedWebScript[] = [];
      for (const [index, item] of planned.entries()) {
        assertActive();
        records.push(
          await publishPlannedScript(tree, item, index, options.signal),
        );
      }
      const manifest = webScriptExportManifestSchema.parse({
        capture_path: input.capture_path,
        capture_sha256: captureSha256,
        capture_kind: capture.kind,
        source_evidence_id: capture.sourceEvidenceId,
        capture_completeness: capture.completeness,
        output_directory: tree.outputRoot,
        analysis_input: records.some(
          ({ content }) => content.state === "exported",
        )
          ? { input_path: join(tree.outputRoot, "files"), format: "directory" }
          : null,
        scripts: records,
        limitations: [
          ...capture.limitations,
          ...responseBodyProvenanceLimitations,
          ...LIMITATIONS,
          ...(records.some(({ content }) => content.state === "exported")
            ? []
            : [
                "No script bytes were exportable. Include script sources in inspect_web_page or select response_body in capture_browser_scenario, then capture again.",
              ]),
        ],
      });
      const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      const digest = createHash("sha256").update(bytes).digest("hex");
      result = webScriptExportResultSchema.parse({
        ...manifest,
        manifest: {
          path: join(tree.outputRoot, "manifest.json"),
          sha256: digest,
          bytes: bytes.length,
        },
      });
      await tree.write(
        "manifest.json",
        Readable.from([bytes]),
        { sha256: digest, bytes: bytes.byteLength },
        options.signal,
      );
      assertActive();
      await tree.commit(options.signal);
      return result;
    } catch (cause: unknown) {
      const cancellation =
        cause instanceof AnalysisCancelledError
          ? cause
          : cause instanceof ArtifactReaderFailure &&
              cause.cancellation !== undefined
            ? new AnalysisCancelledError(OPERATION, {
                cause: cause.cancellation.reason,
              })
            : undefined;
      if (cause instanceof SafeOutputTreeCreationFailure) tree = cause.tree;
      if (tree !== undefined) {
        const cleanup = await options.resources.release({
          kind: "output-tree",
          resource: tree.outputRoot,
          tree,
        });
        if (cleanup.kind === "failed") {
          const cleanupCause = cleanup.cause;
          const diagnostic = tree.published
            ? `Publication completed, but descriptor cleanup failed (${message(cleanupCause)}). The published output remains available.`
            : `Publication failed (${message(cause)}); rollback failed (${message(cleanupCause)}). Remove the residual output directory before retrying.`;
          const partialObservation =
            tree.published && result !== undefined
              ? ({ kind: "web-script-export", result } as const)
              : undefined;
          if (cancellation !== undefined) {
            const cancelled = new AnalysisCancelledError(OPERATION, {
              cause: cancellation.cause,
              cleanup: { reason: diagnostic, resources: [tree.outputRoot] },
              ...(partialObservation === undefined
                ? {}
                : { partialObservation }),
            });
            cleanup.lease.bindCleanupError(cancelled);
            throw cancelled;
          }
          const error = new WebScriptExportError(
            cause instanceof ArtifactReaderFailure ? cause.reason : "io",
            tree.outputRoot,
            diagnostic,
            { cause, residualPaths: [tree.outputRoot] },
          );
          if (partialObservation !== undefined)
            error.retainPartialObservation(partialObservation);
          cleanup.lease.bindCleanupError(error);
          throw error;
        }

        if (tree.published && result !== undefined) return result;
      }
      if (cancellation !== undefined) throw cancellation;
      // Only a destination refusal can blame the selected output directory.
      throw outputDirectoryAdmissionRefusal(
        OPERATION,
        "output_directory",
        cause,
      );
    }
  });

const publishPlannedScript = async (
  tree: SafeOutputTree,
  item: PlannedWebScript,
  index: number,
  signal: AbortSignal | undefined,
): Promise<ExportedWebScript> => {
  const { script, record } = item;
  const content = script.content;
  if (content.state !== "captured" || record.content.state !== "exported")
    return record;
  const write = (relativePath: string): Promise<unknown> =>
    tree.write(
      `files/${relativePath}`,
      Readable.from([content.bytes]),
      { sha256: content.sha256, bytes: content.bytes.byteLength },
      signal,
    );
  try {
    await write(record.content.relative_path);
    return record;
  } catch (cause: unknown) {
    if (
      !(
        cause instanceof DestinationCaseCollisionFailure ||
        cause instanceof DestinationPathUnrepresentableFailure
      ) ||
      record.content.layout !== "url-path"
    )
      throw cause;
    const relativePath = isolatedWebScriptPath(script.source, index);
    await write(relativePath);
    return {
      ...record,
      content: {
        ...record.content,
        relative_path: relativePath,
        layout: "isolated",
        layout_reason: cause.message,
      },
    };
  }
};

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown publication failure";
