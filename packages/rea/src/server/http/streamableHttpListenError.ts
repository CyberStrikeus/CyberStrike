import { err, ok, type Result } from "../../domain/result.js";

/** Parsed listener failure facts for recovery guidance. */
export type StreamableHttpListenFailure =
  | {
      readonly kind: "host_allowlist";
      readonly reason: "missing";
    }
  | {
      readonly kind: "host_lookup";
      readonly systemCode:
        | "ENOTFOUND"
        | "EAI_AGAIN"
        | "EAI_FAIL"
        | "EAI_NONAME"
        | "ENODATA"
        | "EAI_NODATA";
    }
  | { readonly kind: "host_unavailable"; readonly systemCode: "EADDRNOTAVAIL" }
  | { readonly kind: "port_in_use"; readonly systemCode: "EADDRINUSE" }
  | {
      readonly kind: "permission_denied";
      readonly systemCode: "EACCES" | "EPERM";
    };

export interface UnclassifiedStreamableHttpListenFailure {
  readonly kind: "unclassified";
  readonly systemCode?: string;
}

export type StreamableHttpListenClassification = Result<
  StreamableHttpListenFailure,
  UnclassifiedStreamableHttpListenFailure
>;

const systemCode = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null || !("code" in cause))
    return undefined;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : undefined;
};

/** Classify configuration and native listener failures once, at their owning boundary. */
const classify = (cause: unknown): StreamableHttpListenClassification => {
  if (cause instanceof StreamableHttpHostAllowlistError)
    return ok(cause.failure);
  const code = systemCode(cause);
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "EAI_FAIL":
    case "EAI_NONAME":
    case "ENODATA":
    case "EAI_NODATA":
      return ok({ kind: "host_lookup", systemCode: code });
    case "EADDRNOTAVAIL":
      return ok({ kind: "host_unavailable", systemCode: "EADDRNOTAVAIL" });
    case "EADDRINUSE":
      return ok({ kind: "port_in_use", systemCode: "EADDRINUSE" });
    case "EACCES":
    case "EPERM":
      return ok({ kind: "permission_denied", systemCode: code });
    default:
      return err({
        kind: "unclassified",
        ...(code === undefined ? {} : { systemCode: code }),
      });
  }
};

/** A declaration failure, distinct from an operating-system bind failure. */
export class StreamableHttpHostAllowlistError extends Error {
  readonly failure: Extract<
    StreamableHttpListenFailure,
    { kind: "host_allowlist" }
  >;

  constructor(address: string) {
    super(
      `Refusing to serve ${address} outside loopback without an operator-declared host allowlist; set MCP_ALLOWED_HOSTS (or --allowed-hosts) to every host name clients will use, then retry`,
    );
    this.failure = { kind: "host_allowlist", reason: "missing" };
  }
}

/** Recovery belongs to the parsed failure owner, shared by CLI and MCP. */
const listenerRemediation = (
  classification: StreamableHttpListenClassification,
): string => {
  if (!classification.ok)
    return "Check the selected listener host, port, and binding permissions, then retry.";
  switch (classification.value.kind) {
    case "host_allowlist":
      return "Set MCP_ALLOWED_HOSTS to the host names or IP addresses clients will use, without URL components or ports, then retry. For rea mcp --http, --allowed-hosts accepts the same comma-separated list.";
    case "host_lookup":
      return "Check --host or MCP_HOST and host name resolution; correct the value or resolve the lookup failure, then retry.";
    case "host_unavailable":
      return "Choose an address assigned to this machine with --host or MCP_HOST, then retry.";
    case "port_in_use":
      return "Choose another --port or MCP_PORT, or stop the process using it.";
    case "permission_denied":
      return "Choose a host and port this process is permitted to bind; if the selected port is restricted, use an allowed port.";
  }
};

export type StreamableHttpListenPhase = "startup" | "serving";

/** Listener failure retaining its native cause, phase, and parsed recovery facts. */
export class StreamableHttpListenError extends Error {
  override readonly name = "StreamableHttpListenError";
  readonly classification: StreamableHttpListenClassification;
  readonly phase: StreamableHttpListenPhase;
  readonly remediationAction: string;

  constructor(cause: unknown, phase: StreamableHttpListenPhase = "startup") {
    super(
      phase === "startup"
        ? `MCP HTTP listener startup failed: ${cause instanceof Error ? cause.message : String(cause)}`
        : `MCP HTTP listener failed after binding: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.phase = phase;
    this.classification = classify(cause);
    this.remediationAction = listenerRemediation(this.classification);
  }
}
