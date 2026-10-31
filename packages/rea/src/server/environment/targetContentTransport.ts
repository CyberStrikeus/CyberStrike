import {
  isCallToolResult,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";

import {
  carriesTargetContentMarker,
  TARGET_CONTENT_RESULT_META,
} from "../toolResultEncoding.js";

type RequestId = string | number;

const requestId = (value: unknown): RequestId | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined;

/** Marks every tools/call result as target content, including errors the SDK builds before a replay callback runs. */
export class TargetContentTransport implements Transport {
  onclose: Transport["onclose"];
  onerror: Transport["onerror"];
  onmessage: Transport["onmessage"];
  readonly hasPerRequestStream?: boolean;
  readonly #calls = new Set<RequestId>();

  constructor(private readonly transport: Transport) {
    if (transport.hasPerRequestStream !== undefined)
      this.hasPerRequestStream = transport.hasPerRequestStream;
    transport.onmessage = (message, extra) => {
      if (isJSONRPCRequest(message) && message.method === "tools/call")
        this.#calls.add(message.id);
      // The SDK sends no reply after a cancellation, so release the id here.
      if (
        isJSONRPCNotification(message) &&
        message.method === "notifications/cancelled"
      ) {
        const id = requestId(message.params?.["requestId"]);
        if (id !== undefined) this.#calls.delete(id);
      }
      this.onmessage?.(message, extra);
    };
    transport.onerror = (error) => this.onerror?.(error);
    transport.onclose = () => {
      this.#calls.clear();
      this.onclose?.();
    };
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }
  set sessionId(value: string | undefined) {
    this.transport.sessionId = value;
  }

  start(): Promise<void> {
    return this.transport.start();
  }

  close(): Promise<void> {
    return this.transport.close();
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version);
  }

  setSupportedProtocolVersions(versions: string[]): void {
    this.transport.setSupportedProtocolVersions?.(versions);
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const id = "id" in message ? requestId(message.id) : undefined;
    const call = id !== undefined && this.#calls.delete(id);
    if (
      call &&
      isJSONRPCResultResponse(message) &&
      isCallToolResult(message.result) &&
      !carriesTargetContentMarker(message.result)
    )
      return this.transport.send(
        {
          ...message,
          result: {
            ...message.result,
            _meta: { ...message.result._meta, ...TARGET_CONTENT_RESULT_META },
          },
        },
        options,
      );
    return this.transport.send(message, options);
  }
}
