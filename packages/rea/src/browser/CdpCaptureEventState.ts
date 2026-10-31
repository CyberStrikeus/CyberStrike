import type { CdpContextFrameClaim } from "./CdpScriptContextFacts.js";
import type { InspectWebPageInput } from "../domain/browserObservation.js";
import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import type { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import type { CapturedScript, NetworkState } from "./CdpCaptureEventTypes.js";

export interface CdpCaptureEventsState {
  readonly input: InspectWebPageInput;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly scripts: Map<string, CapturedScript>;
  readonly scriptMetadataBudgetOmissionsById: Map<string, true>;
  rejectedScriptMetadataBudgetCount: number;
  rejectedSourceMapMetadataBudgetCount: number;
  readonly scriptMetadataBytesById: Map<string, number>;
  retainedScriptMetadataBytes: number;
  /** Console, websocket-frame and selected request/response shape outputs share one allowance. */
  retainedEventBytes: number;
  readonly bodyShapeBytesByRequestId: Map<
    string,
    { readonly request: number; readonly response: number }
  >;
  readonly executionContextFrames: Map<string, CdpContextFrameClaim>;
  readonly network: Map<string, NetworkState>;
  readonly networkRequestTimestamps: Map<string, number>;
  readonly malformedRedirectRequestIds: Set<string>;
  /** Requests whose selected JSON request-body shape was expected but not obtained. */
  readonly missingRequestBodyShapeIds: Set<string>;
  readonly webSocketConnectionsById: Map<
    string,
    WebPageInspection["network"]["websocket_connections"][number]
  >;
  console: WebPageInspection["console"]["events"];
  responseMetadata: WebPageInspection["metadata"]["responses"];
  agentHints: WebPageInspection["metadata"]["agent_hints"];
  readonly completeness: CdpCaptureCompleteness;
  originViolation: boolean;
  navigationDuringCapture: boolean;
  unknownRootIdentity: boolean;
  mainFrameId: string | undefined;
  /**
   * Identity of the document last observed in the main frame. `frameNavigated`
   * re-fires for the same document, so this is what distinguishes a real
   * document change from a duplicate event.
   */
  committedDocument: string | undefined;
}
