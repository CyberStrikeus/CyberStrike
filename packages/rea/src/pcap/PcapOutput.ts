import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  AnalysisCancelledError,
  AnalysisProtocolError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { parsePcapHttpUri } from "./PcapHttpUri.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { parseDnsMessageRaw } from "./PcapDnsWire.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

const OPERATION = "inspect_pcap_capture";
/** Bounds JSON decoding plus its expanded object graph before JSON.parse. */
export const TSHARK_JSON_MAX_BYTES = 8 * 1024 * 1024;
const MAX_RETAINED_BYTES = 16 * 1024 * 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;

const assertOutputReadActive = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted)
    throw new AnalysisCancelledError(OPERATION, { cause: signal.reason });
};

const protocolFailure = (reason: string): never => {
  throw new AnalysisProtocolError(`Invalid packet-capture output: ${reason}`);
};

export interface CapinfosMetadata {
  readonly fileType: string;
  readonly encapsulation: string;
  readonly packetCount: number;
  readonly captureStart: string | null;
  readonly captureEnd: string | null;
  readonly captureDurationSeconds: number | null;
  readonly snapshotLength: number | null;
  readonly sha256: string | null;
}

/**
 * capinfos -S prints each packet timestamp as seconds since the Unix epoch
 * with the capture's own fractional precision, a leading minus for an instant
 * before the epoch. Its default spelling is a zone-less local wall-clock time,
 * so one capture reads differently on hosts in different time zones. Project
 * the exact value to an RFC 3339 UTC instant, keeping the fractional digit
 * count. "n/a" (an empty capture), a wall-clock spelling and a value outside
 * years 0000 to 9999 stay unknown.
 */
const captureInstant = (value: string | undefined): string | null => {
  // Wireshark formats at most 64-bit seconds and nine fractional digits.
  const match = /^(-?)(\d{1,20})(?:\.(\d{1,9}))?$/u.exec(value ?? "");
  if (match?.[2] === undefined) return null;
  const negative = match[1] === "-";
  let seconds = BigInt(match[2]);
  let fraction = match[3] ?? "";
  if (negative) {
    // -1.25 is one and a quarter seconds before the epoch: whole second
    // -2 plus 0.75, so the fraction is borrowed from the next whole second.
    const digits = fraction.length;
    const borrowed = digits > 0 && BigInt(fraction) > 0n;
    seconds = -seconds - (borrowed ? 1n : 0n);
    if (borrowed)
      fraction = (10n ** BigInt(digits) - BigInt(fraction))
        .toString()
        .padStart(digits, "0");
  }
  if (seconds < -62_167_219_200n || seconds > 253_402_300_799n) return null;
  const date = new Date(Number(seconds) * 1000);
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < 0 || year > 9999) return null;
  return `${date.toISOString().slice(0, 19)}${fraction === "" ? "" : `.${fraction}`}Z`;
};

/** capinfos -M with a C locale provides exact numbers instead of "20 k". */
export const parseCapinfosOutput = (stdout: string): CapinfosMetadata => {
  const lines = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const at = line.indexOf(":");
    if (at >= 0 && !/^\s/u.test(line)) {
      const key = line.slice(0, at);
      const value = line.slice(at + 1).trim();
      // capinfos repeats this label for inferred truncation lengths. They
      // describe captured packets, not the capture header's snapshot limit.
      if (key === "Packet size limit" && !value.startsWith("file hdr:"))
        continue;
      lines.set(key, value);
    }
  }
  const fileType = lines.get("File type");
  const encapsulation = lines.get("File encapsulation");
  const countText = lines.get("Number of packets");
  if (
    !fileType ||
    !encapsulation ||
    countText === undefined ||
    !/^\d+$/u.test(countText)
  )
    return protocolFailure(
      "capinfos did not provide machine-readable type, encapsulation and packet count",
    );
  const packetCount = Number(countText);
  if (!Number.isSafeInteger(packetCount))
    return protocolFailure("packet count is not representable");
  const durationText = lines.get("Capture duration");
  const duration =
    durationText === undefined
      ? null
      : /^(\d+(?:\.\d+)?)(?:\s+seconds?)?$/u.exec(durationText);
  const durationSeconds = duration === null ? null : Number(duration[1]);
  const snapshot = /^file hdr:\s*(\d+) bytes$/u.exec(
    lines.get("Packet size limit") ?? "",
  );
  const snapshotLength = snapshot === null ? null : Number(snapshot[1]);
  const sha256 = lines.get("SHA256") ?? null;
  if (sha256 !== null && !/^[0-9a-f]{64}$/u.test(sha256))
    return protocolFailure("capinfos SHA256 is malformed");
  return {
    fileType,
    encapsulation,
    packetCount,
    captureStart: captureInstant(
      lines.get("Earliest packet time") ?? lines.get("First packet time"),
    ),
    captureEnd: captureInstant(
      lines.get("Latest packet time") ?? lines.get("Last packet time"),
    ),
    captureDurationSeconds:
      durationSeconds !== null && Number.isFinite(durationSeconds)
        ? durationSeconds
        : null,
    snapshotLength:
      snapshotLength !== null &&
      Number.isSafeInteger(snapshotLength) &&
      snapshotLength > 0
        ? snapshotLength
        : null,
    sha256,
  };
};

export interface TsharkFields {
  readonly endpoints: { address: string; port: null; packet_count: number }[];
  readonly endpointCount: number;
  readonly dnsQueries: {
    query: string;
    query_labels_hex?: string[] | null;
    response_addresses: string[];
    response_address_count: number;
  }[];
  readonly dnsQueryCount: number;
  readonly dnsLimitations: string[];
  readonly tlsSniValues: string[];
  readonly tlsSniCount: number;
  readonly protocolDistribution: { protocol: string; packet_count: number }[];
  readonly protocolCount: number;
  readonly httpRequestUris: string[];
  readonly httpRequestUriCount: number;
  readonly httpUriRedactionCount: number;
  readonly unattributedDnsAddresses: string[];
  readonly unattributedDnsAddressCount: number;
  readonly unattributedDnsPackets: number;
  readonly packetCount: number;
  readonly partial: boolean;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeTsharkPackets = async (
  stdout: string,
  budget: { decodedBytes: number },
  signal?: AbortSignal,
): Promise<unknown[]> => {
  assertOutputReadActive(signal);
  if (Buffer.byteLength(stdout) > TSHARK_JSON_MAX_BYTES)
    throw new AnalysisResourceConstraintError(
      OPERATION,
      "memory",
      "tshark JSON exceeds the bounded decoding budget",
      { max_json_bytes: TSHARK_JSON_MAX_BYTES },
      fixedAllowanceOptions("The tshark JSON decoding allowance", "capture"),
    );
  // Account for source-driven JSON expansion before materializing protocol trees.
  let quoted = false,
    escaped = false;
  budget.decodedBytes += stdout.length * 2;
  for (let index = 0; index < stdout.length; index += 1) {
    if (index % 65536 === 0) {
      await yieldToEventLoop();
      assertOutputReadActive(signal);
    }
    const char = stdout[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      budget.decodedBytes += 64;
    } else if (char === "{" || char === "[") {
      budget.decodedBytes += 128;
    } else if (char === ":" || char === ",") budget.decodedBytes += 128;
    if (budget.decodedBytes > MAX_DECODED_BYTES)
      throw new AnalysisResourceConstraintError(
        OPERATION,
        "memory",
        "tshark JSON expansion exceeds the decoding budget",
        { max_decoded_bytes: MAX_DECODED_BYTES },
        fixedAllowanceOptions("The tshark JSON expansion allowance", "capture"),
      );
  }
  let packets: unknown;
  try {
    packets = JSON.parse(stdout) as unknown;
  } catch (cause) {
    throw new AnalysisProtocolError("tshark emitted malformed JSON", { cause });
  }
  if (!Array.isArray(packets))
    return protocolFailure("tshark packet root must be an array");
  return packets;
};

/** Decode each bounded acquisition, then join DNS PDUs by unique capture frame. */
export const parseTsharkJsonOutput = async (
  stdout: string,
  signal?: AbortSignal,
  dnsStdout?: string,
): Promise<TsharkFields> => {
  const budget = { decodedBytes: 0 };
  const packets = await decodeTsharkPackets(stdout, budget, signal);
  for (const packet of packets) {
    if (
      !object(packet) ||
      !object(packet._source) ||
      !object(packet._source.layers)
    )
      return protocolFailure("packet lacks _source.layers");
    const layers = packet._source.layers;
    // Selected-field acquisitions have a flat frame.number key. Protocol-tree
    // acquisitions are separately parsed for producer goldens and DNS PDUs.
    if ("frame.number" in layers) {
      for (const [key, value] of Object.entries(layers)) {
        if (
          ["dns", "dns_raw", "mdns", "mdns_raw", "llmnr", "llmnr_raw"].includes(
            key,
          )
        )
          continue;
        if (
          !Array.isArray(value) ||
          !value.every((item) => typeof item === "string")
        )
          return protocolFailure(
            `selected field ${key} must be an array of strings`,
          );
      }
    }
  }
  if (dnsStdout !== undefined) {
    const seen = new Set<number>();
    for (const packet of await decodeTsharkPackets(dnsStdout, budget, signal)) {
      if (
        !object(packet) ||
        !object(packet._source) ||
        !object(packet._source.layers)
      )
        return protocolFailure("DNS packet lacks _source.layers");
      const layers = packet._source.layers;
      const frame = object(layers.frame)
        ? layers.frame["frame.number"]
        : undefined;
      if (typeof frame !== "string" || !/^[1-9][0-9]*$/u.test(frame))
        return protocolFailure("DNS packet lacks a unique frame number");
      const number = Number(frame);
      const base = packets[number - 1];
      if (
        !Number.isSafeInteger(number) ||
        seen.has(number) ||
        !object(base) ||
        !object(base._source) ||
        !object(base._source.layers)
      )
        return protocolFailure(
          "DNS frame is duplicated or outside the capture inventory",
        );
      seen.add(number);
      for (const family of ["dns", "mdns", "llmnr"]) {
        base._source.layers[family] = layers[family];
        base._source.layers[`${family}_raw`] = layers[`${family}_raw`];
      }
    }
  }
  const endpoints = new Map<string, number>();
  const dns = new Map<
    string,
    { query: string; labels: readonly string[] | null; addresses: Set<string> }
  >();
  const sni = new Set<string>();
  const protocols = new Map<string, number>();
  const uris = new Set<string>();
  const observedUris = new Set<string>();
  let uriRedactions = 0;
  let unresolvedHttpUriTarget = false;
  const unattributed = new Set<string>();
  let unattributedPackets = 0;
  let unresolvedDnsOwnership = false;
  const dnsLimitations = new Set<string>();
  let retainedBytes = 0;
  const charge = (value: string): void => {
    retainedBytes += 192 + 2 * Buffer.byteLength(value);
    if (retainedBytes > MAX_RETAINED_BYTES)
      throw new AnalysisResourceConstraintError(
        OPERATION,
        "memory",
        "Packet inventory exceeds the retained-fact budget",
        { max_retained_bytes: MAX_RETAINED_BYTES },
        fixedAllowanceOptions(
          "The packet-inventory retained-fact allowance",
          "capture",
        ),
      );
  };
  const add = (set: Set<string>, value: string): void => {
    if (!set.has(value)) {
      charge(value);
      set.add(value);
    }
  };
  for (let index = 0; index < packets.length; index += 1) {
    if (index % 256 === 0) {
      await yieldToEventLoop();
      assertOutputReadActive(signal);
    }
    const packet: unknown = packets[index];
    if (
      !object(packet) ||
      !object(packet._source) ||
      !object(packet._source.layers)
    )
      return protocolFailure(
        `packet ${String(index + 1)} lacks _source.layers`,
      );
    const layers = packet._source.layers;
    // The tree is the producer-owned hierarchy; flatten only selected scalar
    // observations. DNS identity and RR ownership remain scoped to each PDU.
    const values = new Map<string, string[]>();
    const pending: unknown[] = [layers];
    while (pending.length > 0) {
      const value = pending.pop();
      if (Array.isArray(value)) {
        for (let item = value.length - 1; item >= 0; item -= 1)
          pending.push(value[item]);
        continue;
      }
      if (!object(value)) continue;
      const entries = Object.entries(value);
      for (const [key, child] of entries) {
        if (key.endsWith("_raw")) continue;
        if (typeof child === "string") {
          const list = values.get(key) ?? [];
          list.push(child);
          values.set(key, list);
        } else if (
          Array.isArray(child) &&
          child.every((item) => typeof item === "string")
        ) {
          const list = values.get(key) ?? [];
          for (const item of child) list.push(item);
          values.set(key, list);
        }
      }
      for (let entry = entries.length - 1; entry >= 0; entry -= 1) {
        const [key, child] = entries[entry]!;
        if (
          !key.endsWith("_raw") &&
          (object(child) ||
            (Array.isArray(child) &&
              child.some((item) => typeof item !== "string")))
        )
          pending.push(child);
      }
    }
    const field = (name: string): readonly string[] => values.get(name) ?? [];
    const frame = field("frame.number");
    if (
      frame.length !== 1 ||
      !/^\d+$/u.test(frame[0]!) ||
      Number(frame[0]) !== index + 1
    )
      return protocolFailure(
        "frame inventory is missing, duplicated or out of order",
      );
    const protocolStack = field("frame.protocols");
    if (protocolStack.length !== 1)
      return protocolFailure(
        "packet protocol inventory is missing or ambiguous",
      );
    // TShark reports [""] for a frame with no dissected protocol, including
    // zero-length packets. Keep the frame without inventing a protocol row.
    const protocol = protocolStack[0]!;
    // Count one occurrence per packet even for loopback or nested IP layers.
    for (const address of new Set([
      ...field("ip.src"),
      ...field("ip.dst"),
      ...field("ipv6.src"),
      ...field("ipv6.dst"),
    ])) {
      if (address === "") continue;
      if (!endpoints.has(address)) charge(address);
      endpoints.set(address, (endpoints.get(address) ?? 0) + 1);
    }
    const messages: {
      family: "dns" | "mdns" | "llmnr";
      source: unknown;
      raw: unknown;
    }[] = [];
    for (const family of ["dns", "mdns", "llmnr"] as const) {
      const source = layers[family];
      const sources = Array.isArray(source)
        ? source
        : source === undefined
          ? []
          : [source];
      const raw = layers[`${family}_raw`];
      const raws =
        Array.isArray(raw) && typeof raw[0] !== "string"
          ? raw
          : raw === undefined
            ? []
            : [raw];
      for (const [pdu, source] of sources.entries())
        messages.push({
          family,
          source,
          raw: raws.length === sources.length ? raws[pdu] : undefined,
        });
    }
    let packetUnattributed = false;
    const treeQueries = new Map<string, number>();
    const treeAddresses = new Map<string, number>();
    const count = (counts: Map<string, number>, value: string): void => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    };
    for (const [pdu, message] of messages.entries()) {
      const facts = parseDnsMessageRaw(
        message.raw,
        message.source,
        message.family,
      );
      for (const question of facts.questions)
        count(treeQueries, question.query);
      for (const [, address] of facts.assigned) count(treeAddresses, address);
      for (const address of facts.unattributed) count(treeAddresses, address);
      const keys = facts.questions.map((question, occurrence) => {
        const key =
          question.labels_hex === null
            ? `unknown:${String(index)}:${String(pdu)}:${String(occurrence)}`
            : JSON.stringify([question.query, question.labels_hex]);
        if (!dns.has(key)) {
          charge(question.query);
          for (const label of question.labels_hex ?? []) charge(label);
          dns.set(key, {
            query: question.query,
            labels: question.labels_hex,
            addresses: new Set(),
          });
        }
        return key;
      });
      unresolvedDnsOwnership ||= facts.incomplete;
      for (const reason of facts.incomplete_reasons ?? [])
        add(dnsLimitations, reason);
      for (const [question, address] of facts.assigned)
        add(dns.get(keys[question]!)!.addresses, address);
      if (facts.unattributed.length > 0) {
        packetUnattributed = true;
        for (const address of facts.unattributed) add(unattributed, address);
      }
    }
    // Flat selected observations are independent capture facts. Consume matching
    // tree occurrences rather than comparing sets: one missing PDU may have the
    // same display and address as a successfully decoded message.
    if (
      dnsStdout !== undefined ||
      ["dns.qry.name", "dns.a", "dns.aaaa"].some((key) => key in layers)
    ) {
      const selected = (name: string): readonly string[] =>
        (layers[name] as readonly string[] | undefined) ?? [];
      const consume = (counts: Map<string, number>, value: string): boolean => {
        const remaining = counts.get(value) ?? 0;
        if (remaining === 0) return false;
        if (remaining === 1) counts.delete(value);
        else counts.set(value, remaining - 1);
        return true;
      };
      let mismatch = false;
      for (const [occurrence, query] of selected("dns.qry.name").entries()) {
        if (consume(treeQueries, query)) continue;
        mismatch = true;
        if (query === "") continue;
        charge(query);
        dns.set(`selected:${String(index)}:${String(occurrence)}`, {
          query,
          labels: null,
          addresses: new Set(),
        });
      }
      for (const address of [...selected("dns.a"), ...selected("dns.aaaa")]) {
        if (consume(treeAddresses, address)) continue;
        mismatch = true;
        if (address === "") continue;
        packetUnattributed = true;
        add(unattributed, address);
      }
      if (mismatch || treeQueries.size > 0 || treeAddresses.size > 0) {
        unresolvedDnsOwnership = true;
        add(
          dnsLimitations,
          "Selected DNS observations and per-message trees differ in query or address occurrences; unmatched selected facts are retained without wire identity or ownership",
        );
      }
    }
    if (packetUnattributed) unattributedPackets += 1;
    for (const value of field("tls.handshake.extensions_server_name"))
      if (value !== "") add(sni, value);
    if (protocol !== "") {
      if (!protocols.has(protocol)) charge(protocol);
      protocols.set(protocol, (protocols.get(protocol) ?? 0) + 1);
    }
    const fullUris = field("http.request.full_uri");
    const fullUriCandidates = fullUris.map((value) => ({
      value,
      parsed: parsePcapHttpUri(value, "full-uri"),
    }));
    const requestUriCandidates = field("http.request.uri").map((value) => ({
      value,
      parsed: parsePcapHttpUri(value, "request-target"),
    }));
    // Wireshark emits full_uri alongside each request URI it can resolve.
    // Raw absolute-form targets stand on their own; relative targets need a
    // corresponding full_uri occurrence. Compare counts only after consuming
    // exact absolute-form duplicates, since output arrays have no join key.
    const absoluteRequests = new Map<string, number>();
    let relativeRequestCount = 0;
    for (const candidate of requestUriCandidates) {
      if (candidate.value === "") continue;
      if (candidate.parsed.origin !== null)
        absoluteRequests.set(
          candidate.value,
          (absoluteRequests.get(candidate.value) ?? 0) + 1,
        );
      else relativeRequestCount += 1;
    }
    let unmatchedFullUriCount = 0;
    for (const candidate of fullUriCandidates) {
      const absoluteCount = absoluteRequests.get(candidate.value) ?? 0;
      if (absoluteCount > 0)
        absoluteRequests.set(candidate.value, absoluteCount - 1);
      else if (candidate.value !== "") unmatchedFullUriCount += 1;
    }
    if (relativeRequestCount > unmatchedFullUriCount)
      unresolvedHttpUriTarget = true;

    const http2Uris = field("http2.request.full_uri").filter(
      (value) => value !== "",
    );
    if (
      field("http2.headers.path").filter((value) => value !== "").length >
      http2Uris.length
    )
      unresolvedHttpUriTarget = true;
    for (const candidate of [
      ...fullUriCandidates,
      ...http2Uris.map((value) => ({
        value,
        parsed: parsePcapHttpUri(value, "full-uri"),
      })),
      ...requestUriCandidates.filter(({ parsed }) => parsed.origin !== null),
    ]) {
      const { value, parsed } = candidate;
      if (value === "" || observedUris.has(value)) continue;
      add(observedUris, value);
      const { credentials } = parsed;
      if (credentials !== null) uriRedactions += 1;
      if (credentials === "ambiguous") continue;
      add(
        uris,
        credentials === null
          ? value
          : value.slice(0, credentials.start) + value.slice(credentials.end),
      );
    }
  }
  assertOutputReadActive(signal);
  return {
    endpoints: [...endpoints]
      .sort((a, b) => b[1] - a[1] || compareUnicodeCodePoints(a[0], b[0]))
      .map(([address, packet_count]) => ({
        address,
        port: null,
        packet_count,
      })),
    endpointCount: endpoints.size,
    dnsQueries: [...dns.values()].map(({ query, labels, addresses }) => ({
      query,
      query_labels_hex: labels === null ? null : [...labels],
      response_addresses: [...addresses],
      response_address_count: addresses.size,
    })),
    dnsQueryCount: dns.size,
    dnsLimitations: [...dnsLimitations],
    tlsSniValues: [...sni],
    tlsSniCount: sni.size,
    protocolDistribution: [...protocols]
      .sort((a, b) => b[1] - a[1] || compareUnicodeCodePoints(a[0], b[0]))
      .map(([protocol, packet_count]) => ({ protocol, packet_count })),
    protocolCount: protocols.size,
    httpRequestUris: [...uris],
    httpRequestUriCount: observedUris.size,
    httpUriRedactionCount: uriRedactions,
    unattributedDnsAddresses: [...unattributed],
    unattributedDnsAddressCount: unattributed.size,
    unattributedDnsPackets: unattributedPackets,
    packetCount: packets.length,
    partial:
      observedUris.size > uris.size ||
      unresolvedDnsOwnership ||
      unresolvedHttpUriTarget,
  };
};
