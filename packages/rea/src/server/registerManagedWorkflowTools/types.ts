import type {
  EvidenceWriter,
  EvidenceUnknownWriter,
} from "../../application/investigation/InvestigationRecordPort.js";
import type { BinarySessionPort } from "../../application/binary/BinarySessionPort.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "../analysisAdmission.js";

/** Shared services for registering managed-code workflow tools. */
export interface ManagedWorkflowToolRegistration {
  readonly withAdmittedAnalysis?: WithAdmittedAnalysis;
  readonly logger: Logger;
  readonly recordEvidence: EvidenceWriter["recordEvidence"] | undefined;
  readonly recordEvidenceWithUnknown:
    | EvidenceUnknownWriter["recordEvidenceWithUnknown"]
    | undefined;
  readonly session: BinarySessionPort;
}
