import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type {
  EvidenceWriter,
  EvidenceReader,
  EvidenceUnknownWriter,
} from "../../application/investigation/InvestigationRecordPort.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "../analysisAdmission.js";

/** Shared services for registering JavaScript application graph workflows. */
export interface ApplicationToolRegistration {
  readonly artifactResources: ArtifactResourceScope;
  readonly withAdmittedAnalysis?: WithAdmittedAnalysis;
  readonly logger: Logger;
  readonly evidenceById: EvidenceReader["evidenceById"] | undefined;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
  readonly recordEvidenceWithUnknown:
    | EvidenceUnknownWriter["recordEvidenceWithUnknown"]
    | undefined;
}
