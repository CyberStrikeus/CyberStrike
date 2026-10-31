import { z } from "zod";
import { apkSignatureResultSchema } from "../../domain/apkSignature/apkSignatureReport.js";
import { inspectApkSignatureInputSchema } from "../../domain/apkSignature/apkSignatureQuery.js";
import {
  apkSignaturePageViewResultSchema,
  apkSignatureSummaryViewResultSchema,
} from "../../domain/analysisView/analysisView.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";

/** Static APK signature-scheme inspection of a selected local archive. */
export const INSPECT_APK_SIGNATURE_CONTRACT = {
  name: "inspect_apk_signature",
  ...toolContractMetadata("inspect_apk_signature"),
  kind: "artifact-provider",
  requiresActiveTarget: true,
  description:
    "Inspect declared v1/v2/v3/v3.1 APK signers, certificate fingerprints, algorithm IDs, content digests, SDK ranges, rotation lineage and source stamp without executing Android code. SHA-256 identifies the exact local file. Summary retains complete Evidence; an optional view selects signers/digests/lineage using stable IDs, scheme or signer-ID batches, fields and paging. Read retained pages with inspect_analysis_view kind apk-signature after the source is removed. IDs include artifact digest, scheme and source ordinal; certificates retain raw-DER SHA-256. Content-digest equality is not cryptographic signature verification: modified declarations can match modified bytes. Authenticity, signatures, lineage trust and v1 entry coverage remain unverified. Malformed structures and resource refusals are explicit; no device, network or SDK is used by REA.",
  inputSchema: inspectApkSignatureInputSchema,
  outputSchema: evidenceResultOf(
    z.union([
      apkSignatureResultSchema,
      apkSignatureSummaryViewResultSchema,
      apkSignaturePageViewResultSchema,
    ]),
  ),
  examples: [
    {
      title: "Identify who signed an APK and under which schemes",
      input: { path: "/artifacts/app.apk" },
    },
  ],
} as const satisfies ToolContract;

/** Keep the public catalog in its existing order, using its named contract. */
export const APK_SIGNATURE_TOOL_CONTRACTS = [
  INSPECT_APK_SIGNATURE_CONTRACT,
] as const;
