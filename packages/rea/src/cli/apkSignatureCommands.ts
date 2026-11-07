import { z } from "incur";
import type { Logger } from "pino";
import { APK_SIGNATURE_PROVIDER_IDENTITY } from "../apkSignature/ApkSignatureRelease.js";
import { apkSignatureModule } from "../composition/apkSignature.js";
import { inspectApkSignatureInputSchema } from "../domain/apkSignature/apkSignatureQuery.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { safeParseJson } from "../domain/safeJson.js";
import { logCliCommand } from "../cliLogging.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";

/** CLI shares selected delivery and complete-Evidence publication with other artifact tools. */
export const registerApkSignatureCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(apkSignatureModule.cliCommand, {
    description:
      "Inspect declared APK signing schemes, signers and content digests",
    args: z.object({
      path: localPathStringSchema.describe("Selected local APK/ZIP/AAB"),
    }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      view: z
        .string()
        .optional()
        .describe(
          "JSON signer/digest/lineage selection; requires --detail summary and --evidence_output",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, apkSignatureModule.cliCommand, async () => {
          const decoded =
            options.view === undefined
              ? { ok: true as const, value: undefined }
              : safeParseJson(options.view);
          if (!decoded.ok)
            return projectAnalysisError(
              new AnalysisInputError(
                "inspect_apk_signature",
                { cause: decoded.cause },
                [
                  {
                    path: ["view"],
                    reason: "invalid_format",
                    message: "view must be a JSON APK signature selection",
                  },
                ],
              ),
            );
          const input = inspectApkSignatureInputSchema.safeParse({
            path: absoluteCallerPath(args.path),
            detail: options.detail,
            ...(decoded.value === undefined ? {} : { view: decoded.value }),
          });
          if (!input.success)
            return projectAnalysisError(
              analysisInputErrorFromIssues(
                "inspect_apk_signature",
                input.error.issues,
                { view: decoded.value },
              ),
            );
          const service = apkSignatureModule.create(environment);
          return deliverCliAnalysisEvidence({
            callerInputPath: args.path,
            run: () =>
              service.inspect(
                { path: input.data.path, detail: "complete" },
                { signal },
              ),
            service,
            providerId: APK_SIGNATURE_PROVIDER_IDENTITY.id,
            operation: apkSignatureModule.contract.name,
            signal,
            detail: options.detail,
            evidenceOutput: options.evidence_output,
            ...(input.data.view === undefined
              ? {}
              : {
                  view: { kind: "apk-signature" as const, ...input.data.view },
                }),
          });
        }),
      ),
  });
};
