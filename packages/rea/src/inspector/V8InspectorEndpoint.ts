import { z } from "zod";

import type {
  JavaScriptRuntimeTargetList,
  JavaScriptRuntimeTargetLocation,
} from "../domain/javascript/javascriptRuntimeObservation.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import { urlDeclaresQueryOrFragment } from "../domain/urlComponents.js";
import { parseCdpEndpointValue, readCdpJson } from "../browser/CdpEndpoint.js";
import { parseCdpDiscoveryTargets } from "../browser/CdpDiscoveryTargets.js";

const versionSchema = z
  .object({
    Browser: z.string().min(1),
    "Protocol-Version": z.string().min(1),
    "V8-Version": z.string().optional(),
  })
  .passthrough();

export interface V8InspectorTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly attached: boolean | null;
  readonly webSocketUrl: string | null;
}

export interface V8InspectorDiscovery {
  readonly limitations: readonly string[];
  readonly ambiguousTargetIds?: readonly string[];
  readonly runtime: JavaScriptRuntimeTargetList["runtime"];
  readonly targets: readonly V8InspectorTarget[];
}

/** Discover Node/Electron Inspector targets from one loopback endpoint. */
export const discoverV8Inspector = async (
  endpoint: string,
  operation: BrowserObservationOperation,
  signal?: AbortSignal,
): Promise<V8InspectorDiscovery> => {
  const [versionInput, targetsInput] = await Promise.all([
    readCdpJson(new URL("/json/version", endpoint), operation, signal),
    readCdpJson(new URL("/json/list", endpoint), operation, signal),
  ]);
  const version = parseCdpEndpointValue(versionSchema, versionInput, operation);
  const { targets, limitations, ambiguousTargetIds } = parseCdpDiscoveryTargets(
    targetsInput,
    operation,
  );
  return {
    limitations,
    ambiguousTargetIds,
    runtime: {
      product: version.Browser,
      protocol_version: version["Protocol-Version"],
      v8_version: version["V8-Version"] ?? null,
    },
    targets: targets.map((target) => ({
      id: target.id,
      type: target.type,
      url: target.url,
      attached: target.attached ?? null,
      webSocketUrl: validatedInspectorWebSocket(
        endpoint,
        target.id,
        target.webSocketDebuggerUrl,
      ),
    })),
  };
};

const validatedInspectorWebSocket = (
  endpoint: string,
  targetId: string,
  reported: unknown,
): string | null => {
  if (typeof reported !== "string" || reported.length === 0) return null;
  let socket: URL;
  try {
    socket = new URL(reported);
  } catch {
    return null;
  }
  const trusted = new URL(endpoint);
  const allowedPaths = new Set([
    `/${targetId}`,
    `/devtools/node/${targetId}`,
    `/devtools/page/${targetId}`,
  ]);
  if (
    socket.protocol !== "ws:" ||
    socket.port !== trusted.port ||
    socket.username !== "" ||
    socket.password !== "" ||
    urlDeclaresQueryOrFragment(socket) ||
    !allowedPaths.has(socket.pathname)
  )
    return null;
  socket.hostname = trusted.hostname;
  return socket.href;
};

/** Authorized target plus its durable location. */
export interface AuthorizedV8InspectorTarget extends Omit<
  V8InspectorTarget,
  "webSocketUrl"
> {
  readonly webSocketUrl: string;
  readonly location: JavaScriptRuntimeTargetLocation;
}
