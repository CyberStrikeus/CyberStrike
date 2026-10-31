import type { ResidualUnknown } from "../domain/residualUnknown.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import {
  readImmutableEvidenceBundle,
  writeEvidenceBundle,
  evidenceBundleExportReceipt,
} from "../application/EvidenceBundleFiles.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { err, ok } from "../domain/result.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { inspectEvidenceBundle } from "../application/investigation/InspectEvidenceBundle.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { withAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";

interface EvidenceToolRegistration {
  readonly server: EvidenceMcpServer;
  readonly session: BinarySessionPort;
  readonly resources: ArtifactResourceScope;
  readonly exportContract: ReturnType<
    typeof toolContract<"export_evidence_bundle">
  >;
  readonly importContract: ReturnType<
    typeof toolContract<"import_evidence_bundle">
  >;
  readonly snapshotContract: ReturnType<
    typeof toolContract<"get_evidence_bundle">
  >;
}

/** Register evidence bundle import and export tools. */
export const registerEvidenceTools = (
  registration: EvidenceToolRegistration,
): void => {
  registerExportEvidenceTool(registration);
  registerImportEvidenceTool(registration);
  registerSnapshotEvidenceTool(registration);
};

const registerExportEvidenceTool = ({
  server,
  session,
  resources,
  exportContract,
}: EvidenceToolRegistration): void => {
  server.registerTool(
    exportContract.name,
    toolRegistrationOptions(exportContract),
    async (input, context) => {
      const bundle = session.immutableEvidenceBundle();
      const written = await writeEvidenceBundle(
        bundle,
        input.path,
        input.overwrite,
        resources,
        context.mcpReq.signal,
      );
      return written.ok
        ? server.delivery.toCallToolResult(
            ok(evidenceBundleExportReceipt(bundle, written.value)),
            exportContract,
          )
        : server.delivery.toCallToolResult(written, exportContract);
    },
  );
};

const registerSnapshotEvidenceTool = ({
  server,
  session,
  snapshotContract,
}: EvidenceToolRegistration): void => {
  server.registerTool(
    snapshotContract.name,
    toolRegistrationOptions(snapshotContract),
    (input) =>
      server.delivery.toCallToolResult(
        inspectEvidenceBundle(session.immutableEvidenceBundle(), input),
        snapshotContract,
      ),
  );
};

const registerImportEvidenceTool = ({
  server,
  session,
  resources,
  importContract,
}: EvidenceToolRegistration): void => {
  const admission = withAdmittedAnalysis({ kind: "session", session });
  server.registerTool(
    importContract.name,
    toolRegistrationOptions(importContract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        admission,
        importContract.name,
        context.mcpReq.signal,
        async () => {
          const path = input.path;
          const signal = context.mcpReq.signal;
          const loaded = await readImmutableEvidenceBundle(
            path,
            signal,
            resources,
            importContract.name,
          );
          if (!loaded.ok)
            return server.delivery.toCallToolResult(loaded, importContract);
          if (signal.aborted)
            return server.delivery.toCallToolResult(
              err(
                new AnalysisCancelledError("import_evidence_bundle", {
                  cause: signal.reason,
                }),
              ),
              importContract,
            );
          const imported = session.importEvidenceBundle(loaded.value);
          return imported.ok
            ? server.delivery.toCallToolResult(
                ok({
                  imported: imported.value.recordsAdded,
                  unknowns_added: imported.value.unknownsAdded,
                  total: imported.value.totalRecords,
                }),
                importContract,
              )
            : server.delivery.toCallToolResult(imported, importContract);
        },
      ),
  );
};

interface UnknownToolRegistration {
  readonly server: EvidenceMcpServer;
  readonly session: BinarySessionPort;
}

/** Register residual-unknown query and mutation tools. */
const registerListUnknownsTool = ({
  server,
  session,
}: UnknownToolRegistration): void => {
  const listContract = toolContract("list_unknowns");
  server.registerTool(
    listContract.name,
    toolRegistrationOptions(listContract),
    (input) => {
      const page = session.listUnknownsPage({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.domain === undefined ? {} : { domain: input.domain }),
        offset: input.offset,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
      return server.delivery.toCallToolResult(ok(page), listContract);
    },
  );
};

const registerRecordUnknownTool = ({
  server,
  session,
}: UnknownToolRegistration): void => {
  const recordContract = toolContract("record_unknown");
  server.registerTool(
    recordContract.name,
    toolRegistrationOptions(recordContract),
    (input) => {
      const result = session.recordUnknown(input);
      return server.delivery.toCallToolResult(
        result,
        recordContract,
        result.ok ? committedUnknownReceipt(result.value) : {},
      );
    },
  );
};

const registerUpdateUnknownTool = ({
  server,
  session,
}: UnknownToolRegistration): void => {
  const updateContract = toolContract("update_unknown");
  server.registerTool(
    updateContract.name,
    toolRegistrationOptions(updateContract),
    (input) => {
      const result = session.updateUnknown(input);
      return server.delivery.toCallToolResult(
        result,
        updateContract,
        result.ok ? committedUnknownReceipt(result.value) : {},
      );
    },
  );
};

const registerVerifyUnknownTool = ({
  server,
  session,
}: UnknownToolRegistration): void => {
  const verifyContract = toolContract("verify_unknown_resolution");
  server.registerTool(
    verifyContract.name,
    toolRegistrationOptions(verifyContract),
    (input) =>
      server.delivery.toCallToolResult(
        session.verifyUnknownResolution(input.unknown_id),
        verifyContract,
      ),
  );
};

export const registerUnknownTools = (
  registration: UnknownToolRegistration,
): void => {
  registerListUnknownsTool(registration);
  registerRecordUnknownTool(registration);
  registerUpdateUnknownTool(registration);
  registerVerifyUnknownTool(registration);
};

const committedUnknownReceipt = (
  unknown: ResidualUnknown,
): Readonly<Record<string, JsonValue>> => ({
  committed_unknown: {
    unknown_id: unknown.unknown_id,
    revision: unknown.revision,
    mutation_evidence_ids: unknown.mutation_evidence_ids,
  },
  evidence_reference: {
    kind: "retained-evidence",
    evidence_id: unknown.mutation_evidence_ids[0]!,
  },
});
