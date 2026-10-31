import type { WebExecution } from "../../domain/webExecution.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { sanitizeBrowserUrl } from "../../domain/browserObservation.js";
import { jsonObjectSchema } from "../../domain/jsonValue.js";
import type { CdpEvent } from "../CdpConnection.js";
import { runtimeRequestSchema } from "../CdpNetworkEventFacts.js";
import { runtimeStackSchema } from "./CdpRuntimeProtocol.js";
import type { CdpRuntimeSources } from "./CdpRuntimeSources.js";
import { sanitizeRuntimeInitiator } from "./CdpRuntimeInitiator.js";
import { assertRuntimeRetention } from "./CdpRuntimeRetention.js";

type RuntimeRequestSources = Pick<
  CdpRuntimeSources,
  "location" | "sourceUrl"
> & {
  readonly session: Pick<
    CdpRuntimeSources["session"],
    "operation" | "allowedOrigins"
  > & {
    readonly target: Pick<CdpRuntimeSources["session"]["target"], "frame_id">;
  };
};

/** Join producer initiators by script ID while preserving unresolved async parent identities. */
export class CdpRuntimeRequests {
  readonly items: WebExecution["requests"] = [];
  excluded = 0;
  #bytes = 0;
  #failure: AnalysisError | undefined;
  constructor(readonly sources: RuntimeRequestSources) {}

  /** Retain only armed-window requests from the selected main frame and selected origins. */
  ingest(event: CdpEvent): void {
    if (
      event.method !== "Network.requestWillBeSent" ||
      this.#failure !== undefined
    )
      return;
    try {
      const request = runtimeRequestSchema.parse(event.params);
      const url = sanitizeBrowserUrl(request.request.url);
      if (
        request.frameId !== this.sources.session.target.frame_id ||
        url.origin === null ||
        !this.sources.session.allowedOrigins.has(url.origin)
      ) {
        this.excluded += 1;
        return;
      }
      const callsites: WebExecution["requests"][number]["callsites"] = [];
      const parents: WebExecution["requests"][number]["async_parent_ids"] = [];
      let current: unknown = request.initiator.stack;
      while (current !== undefined) {
        const stack = runtimeStackSchema.parse(current);
        for (const frame of stack.callFrames)
          callsites.push(
            this.sources.location(
              frame.scriptId,
              frame.url,
              frame.lineNumber,
              frame.columnNumber,
              frame.functionName,
            ),
          );
        if (stack.parentId !== undefined)
          parents.push({
            id: stack.parentId.id,
            debugger_id: stack.parentId.debuggerId ?? null,
          });
        current = stack.parent;
      }
      if (
        request.initiator.url !== undefined &&
        request.initiator.lineNumber !== undefined
      )
        callsites.push(
          this.sources.location(
            "",
            sanitizeBrowserUrl(request.initiator.url).url,
            request.initiator.lineNumber,
            request.initiator.columnNumber ?? null,
          ),
        );
      const retained: WebExecution["requests"][number] = {
        request_id: request.requestId,
        url: url.url,
        method: request.request.method,
        timestamp_seconds: request.timestamp,
        initiator_type: request.initiator.type,
        reported_initiator: sanitizeRuntimeInitiator(
          jsonObjectSchema.parse(request.initiator),
          this.sources,
        ),
        callsites,
        async_parent_ids: parents,
        causal_attribution: "unknown",
      };
      this.#bytes += Buffer.byteLength(JSON.stringify(retained));
      assertRuntimeRetention(
        this.sources.session.operation,
        "requests",
        this.#bytes,
      );
      this.items.push(retained);
    } catch (cause: unknown) {
      this.#failure =
        cause instanceof AnalysisError
          ? cause
          : new AnalysisOutputError(
              this.sources.session.operation,
              cause instanceof Error ? cause.message : String(cause),
            );
    }
  }

  /** Preserve all repeated/redirect requests and bind callsites after metadata collection ends. */
  result(): WebExecution["requests"] {
    this.check();
    const result = this.items.map((request) => ({
      ...request,
      reported_initiator: sanitizeRuntimeInitiator(
        jsonObjectSchema.parse(request.reported_initiator),
        this.sources,
      ),
      callsites: request.callsites.map((site) =>
        this.sources.location(
          site.script_id,
          site.url,
          site.line_number,
          site.column_number,
          site.function_name,
        ),
      ),
    }));
    // Late source binding may expand the output after the ingress projection.
    assertRuntimeRetention(
      this.sources.session.operation,
      "requests",
      Buffer.byteLength(JSON.stringify(result)),
    );
    return result;
  }
  /** Report malformed or oversized producer evidence without partial success. */
  check(): void {
    if (this.#failure !== undefined) throw this.#failure;
  }
}
