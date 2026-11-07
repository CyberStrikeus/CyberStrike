import {
  parseRecordedTransportUrl,
  type RecordedTransportUrl,
} from "../domain/recordedTransportUrl.js";

/** Wireshark URI facts. HTTP/2 :path is a path, not an absolute URI. */
export const PCAP_HTTP_URI_FIELDS = {
  "http.request.full_uri": "full-uri",
  "http.request.uri": "request-target",
  "http2.request.full_uri": "full-uri",
} as const;

export type PcapHttpUriRole =
  (typeof PCAP_HTTP_URI_FIELDS)[keyof typeof PCAP_HTTP_URI_FIELDS];

/** Origin-form targets retain path semantics, including a leading double slash. */
export const parsePcapHttpUri = (
  value: string,
  role: PcapHttpUriRole,
): RecordedTransportUrl =>
  role === "request-target" && value.startsWith("/")
    ? { origin: null, path: null, credentials: null }
    : parseRecordedTransportUrl(value);
