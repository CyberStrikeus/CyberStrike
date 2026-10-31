import type { JsonValue } from "../../src/domain/jsonValue.js";
import type { CdpEvent } from "../../src/browser/CdpConnection.js";
import type { ServerResponse } from "node:http";
export interface FakeCdpCommand {
  readonly id: number;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly sessionId?: string;
}

export interface FakeCdpBrowser {
  readonly endpoint: string;
  readonly browserWebSocketUrl: string;
  readonly allowedOrigin: string;
  readonly commands: readonly FakeCdpCommand[];
  /** Actual WebSocket connections still held by the wire fixture. */
  activeConnectionCount(): number;
  /** WebSocket upgrades accepted over the fixture's lifetime. */
  openedConnectionCount(): number;
  /** Deliver actual malformed wire data without bypassing the production transport parser. */
  emitRawMessage(message: string): void;
  emitEvent(event: CdpEvent): void;
  readonly httpRequests: readonly {
    readonly url: string;
    readonly authorization: string | undefined;
    readonly cookie: string | undefined;
    readonly referer: string | undefined;
  }[];
  close(): Promise<void>;
}

export interface FakeOptions {
  /** Send these commands' producer events before acknowledging completion, as a wire barrier. */
  readonly eventsBeforeReply?: readonly string[];
  /** Return a native-shaped command rejection through the actual wire parser. */
  readonly commandError?: (
    command: FakeCdpCommand,
  ) => { readonly code: number; readonly message: string } | undefined;
  /** Producer reply seam preserves the real HTTP/WebSocket transport and command parser. */
  readonly commandResult?: (
    command: FakeCdpCommand,
    origin: string,
    frameReads: number,
  ) => Readonly<Record<string, unknown>> | undefined;
  /** Return undefined to use the stock producer events; an empty array suppresses them. */
  readonly commandEvents?: (
    command: FakeCdpCommand,
    origin: string,
  ) => readonly CdpEvent[] | undefined;
  /** Delay each HTTP discovery document so a short command deadline can be observed separately. */
  readonly discoveryDelayMs?: number;
  /** Delay WebSocket upgrade acceptance so handshake and attach deadlines stay distinct. */
  readonly handshakeDelayMs?: number;
  readonly malformedDiscovery?: boolean;
  readonly oversizedDiscovery?: boolean;
  readonly invalidBrowserWebSocket?: boolean;
  readonly pageScopedVersionWebSocket?: boolean;
  readonly omitTargetWebSocket?: boolean;
  readonly additionalPageWithWebSocket?: boolean;
  readonly additionalPageWithoutWebSocket?: boolean;
  readonly additionalPageCount?: number;
  readonly additionalElectronPageCount?: number;
  readonly invalidAttachedSession?: boolean;
  readonly malformedMessageOnMethod?: string;
  readonly malformedEventOnMethod?: string;
  readonly malformedEventShapeOnMethod?: string;
  readonly closeOnMethod?: string;
  readonly hangOnMethod?: string;
  readonly unsupportedMethods?: readonly string[];
  readonly transitionalFrameReads?: number;
  readonly attachedFrameUrl?: string;
  readonly frameUrlAfterFirstRead?: string;
  readonly navigateDuringObservationUrl?: string;
  readonly navigateDuringCaptureUrl?: string;
  readonly navigateDuringScreenshotUrl?: string;
  readonly screenshotDocumentLoader?: string;
  readonly extraCollections?: boolean;
  readonly indexedDbDateKeys?: boolean;
  readonly foreignSessionEvents?: boolean;
  readonly redirectToDisallowedOrigin?: boolean;
  readonly redirectFromDisallowedOrigin?: boolean;
  readonly redirectWithinOrigin?: boolean;
  readonly malformedRedirectResponse?: boolean;
  readonly omitRedirectResponse?: boolean;
  readonly redirectResponseUrl?: string;
  readonly redirectResponseEnvelope?: unknown;
  readonly responseAfterMalformedUrl?: string;
  readonly unrelatedWorker?: boolean;
  readonly binaryWebSocketEvent?: boolean;
  /** Emit an allowed WebSocket creation without any frames in the capture window. */
  readonly webSocketWithoutFrames?: boolean;
  readonly invalidBinaryWebSocketEvent?: boolean;
  readonly sourceMapBody?: string;
  /** Test-owned HTTP response for selected map URLs; true means handled. */
  readonly sourceMapReply?: (url: string, response: ServerResponse) => boolean;
  /** Accept a source-map request and leave the response open. */
  readonly hangSourceMap?: boolean;
  readonly sourceMapRedirect?: string;
  readonly sessionTimeline?:
    | "same_origin"
    | "outside_policy"
    | "target_detached"
    | "target_crashed";
  readonly sessionTimelineEventCount?: number;
  readonly sessionRedirectResourceType?: "Document" | "Fetch" | "Script";
  readonly closeAfterMethod?: string;
  readonly sensitiveShapes?: boolean;
  /** Deliver a console argument the protocol spells as `{ type: "object", subtype: "null" }`. */
  readonly nullConsoleArgument?: boolean;
  readonly cachedResponseBody?: string;
  readonly invalidResponseBodyBase64?: boolean;
  readonly webMcpTools?: boolean;
  readonly webMcpConsequential?: JsonValue;
  /** Replaces the primary tool's registration stack; returning `undefined` omits it. */
  readonly webMcpStackTrace?: (origin: string) => JsonValue | undefined;
  readonly webMcpSameUrlRegistrations?: "retain" | "remove-second";
  readonly webMcpFrameCount?: number;
  readonly webMcpSchemaPropertyCount?: number;
  readonly webMcpInputSchema?: JsonValue;
  readonly webMcpChildLeavesScope?: boolean;
  readonly webMcpChildTransientBlank?: boolean;
  readonly webMcpChildRecoversAfterTransient?: boolean;
  readonly webMcpChildNavigatesAllowed?: boolean;
  readonly electronFileUrl?: string;
  /** Omit attached from the Electron page's HTTP discovery target. */
  readonly omitElectronTargetAttachmentState?: boolean;
  readonly duplicateElectronInventory?: boolean;
  readonly electronInventoryCount?: number;
  readonly urlShapedAllowedTitle?:
    | boolean
    | "host-path"
    | "root-relative"
    | "prefixed";
}
