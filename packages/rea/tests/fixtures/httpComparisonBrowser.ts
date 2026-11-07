import { startFakeCdpBrowser, type FakeCdpBrowser } from "./fakeCdpBrowser.js";

export type HttpRequestObservation = {
  readonly requestId: string;
  readonly path?: string;
  readonly status?: number;
  readonly mimeType?: string;
  readonly encodedDataLength?: number;
};

type CdpEvent = Parameters<FakeCdpBrowser["emitEvent"]>[0];

const requestEvents = (
  observation: HttpRequestObservation,
  origin: string,
  sessionId: string | undefined,
): CdpEvent[] => {
  const session = sessionId === undefined ? {} : { sessionId };
  const url = `${origin}${observation.path ?? "/api/items"}`;
  const { requestId, status, mimeType, encodedDataLength } = observation;
  const events: CdpEvent[] = [
    {
      ...session,
      method: "Network.requestWillBeSent",
      params: {
        requestId,
        timestamp: 1,
        type: "Fetch",
        request: { url, method: "GET", headers: {} },
        initiator: { type: "other" },
      },
    },
  ];
  if (status !== undefined || mimeType !== undefined)
    events.push({
      ...session,
      method: "Network.responseReceived",
      params: {
        requestId,
        timestamp: 2,
        type: "Fetch",
        response: {
          url,
          headers: {},
          ...(status === undefined ? {} : { status }),
          ...(mimeType === undefined ? {} : { mimeType }),
        },
      },
    });
  if (encodedDataLength !== undefined)
    events.push({
      ...session,
      method: "Network.loadingFinished",
      params: { requestId, timestamp: 3, encodedDataLength },
    });
  return events;
};

/** Capture changing response coverage through the real CDP wire boundary. */
export const startHttpComparisonBrowser = async (
  initial: readonly HttpRequestObservation[],
): Promise<{
  readonly browser: FakeCdpBrowser;
  setRequests(next: readonly HttpRequestObservation[]): void;
}> => {
  let requests = initial;
  const browser = await startFakeCdpBrowser({
    eventsBeforeReply: ["Network.enable"],
    commandEvents(command, origin) {
      return command.method === "Network.enable"
        ? requests.flatMap((request) =>
            requestEvents(request, origin, command.sessionId),
          )
        : undefined;
    },
  });
  return {
    browser,
    setRequests(next) {
      requests = next;
    },
  };
};
