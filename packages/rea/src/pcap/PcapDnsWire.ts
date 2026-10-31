import { isIPv4, isIPv6 } from "node:net";
import { err, ok, type Result } from "../domain/result.js";

interface DnsWireFailure {
  readonly kind: "invalid_dns_wire";
  readonly reason: string;
}
const invalidWire = (reason: string): Result<never, DnsWireFailure> =>
  err({ kind: "invalid_dns_wire", reason });

/** DNS wire identities stay separate from Wireshark's potentially lossy labels. */
export interface DnsWireQuestion {
  readonly query: string;
  readonly labels_hex: readonly string[] | null;
}
export interface DnsMessageFacts {
  readonly questions: readonly DnsWireQuestion[];
  readonly assigned: readonly (readonly [number, string])[];
  readonly unattributed: readonly string[];
  readonly incomplete: boolean;
  readonly incomplete_reasons?: readonly string[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read named producer fields, retaining occurrence order within one PDU. */
const fields = (source: unknown): Map<string, unknown[]> => {
  const result = new Map<string, unknown[]>();
  const pending = [source];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1)
        pending.push(value[index]);
    } else if (object(value)) {
      const entries = Object.entries(value);
      for (const [key, field] of entries) {
        if (!["dns.qry.name", "dns.a", "dns.aaaa", "dns.id_raw"].includes(key))
          continue;
        const values = result.get(key) ?? [];
        if (key === "dns.id_raw") values.push(field);
        else if (Array.isArray(field)) values.push(...field);
        else values.push(field);
        result.set(key, values);
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index]!;
        if (!key.endsWith("_raw")) pending.push(child);
      }
    }
  }
  return result;
};
interface Name {
  readonly labels: readonly string[];
  readonly key: string;
  readonly end: number;
}
interface WireQuestion {
  readonly name: Name;
  readonly type: number;
  readonly dnsClass: number;
}
interface ObservedAddress {
  readonly value: string;
  readonly type: number;
  readonly canonical: string | null;
  used: boolean;
}
interface RecordFact {
  readonly owner: string;
  readonly type: number;
  readonly dnsClass: number;
  readonly answer: boolean;
  readonly target: string | null;
  readonly address: string | null;
}

const decodeName = (
  message: Buffer,
  start: number,
  boundary = message.length,
): Result<Name, DnsWireFailure> => {
  const labels: string[] = [];
  const folded: string[] = [];
  const visited = new Set<number>();
  let at = start,
    end: number | null = null,
    expanded = 1;
  for (;;) {
    if (at >= message.length || visited.has(at))
      return invalidWire("DNS name is truncated or cyclic");
    visited.add(at);
    const length = message[at]!;
    if ((length & 0xc0) === 0xc0) {
      if (at + 2 > (end === null ? boundary : message.length))
        return invalidWire(
          "DNS name encoding or compression pointer is invalid",
        );
      const pointer = ((length & 0x3f) << 8) | message[at + 1]!;
      if (pointer >= at)
        return invalidWire(
          "DNS name encoding or compression pointer is invalid",
        );
      end ??= at + 2;
      at = pointer;
    } else {
      if ((length & 0xc0) !== 0)
        return invalidWire(
          "DNS name encoding or compression pointer is invalid",
        );
      if (at + 1 + length > (end === null ? boundary : message.length))
        return invalidWire(
          "DNS name encoding or compression pointer is invalid",
        );
      at += 1;
      if (length === 0)
        return ok({ labels, key: folded.join("."), end: end ?? at });
      expanded += length + 1;
      if (expanded > 255)
        return invalidWire(
          "DNS name encoding or compression pointer is invalid",
        );
      const label = message.subarray(at, at + length);
      labels.push(label.toString("hex"));
      folded.push(
        [...label]
          .map((byte) =>
            (byte >= 65 && byte <= 90 ? byte + 32 : byte)
              .toString(16)
              .padStart(2, "0"),
          )
          .join(""),
      );
      at += length;
    }
  }
};

const canonicalAddress = (value: string, type: number): string | null => {
  if (type === 1) return isIPv4(value) ? value : null;
  return isIPv6(value) && !value.includes("%")
    ? new URL(`http://[${value}]/`).hostname
    : null;
};

const decodeMessage = (
  raw: unknown,
  ids: readonly unknown[],
): Result<Buffer, DnsWireFailure> => {
  if (
    !Array.isArray(raw) ||
    raw.length !== 5 ||
    typeof raw[0] !== "string" ||
    !/^(?:[0-9a-f]{2})*$/iu.test(raw[0]) ||
    !Number.isSafeInteger(raw[1]) ||
    !Number.isSafeInteger(raw[2]) ||
    raw[2] !== raw[0].length / 2 ||
    ids.length !== 1 ||
    !Array.isArray(ids[0]) ||
    !Number.isSafeInteger(ids[0][1])
  )
    return invalidWire(
      "DNS raw bytes, message framing or header coordinates are unavailable or invalid",
    );
  const header = (ids[0][1] as number) - (raw[1] as number);
  if (header !== 0 && header !== 2)
    return invalidWire(
      "DNS raw bytes, message framing or header coordinates are unavailable or invalid",
    );
  const bytes = Buffer.from(raw[0], "hex");
  if (bytes.length < header + 12)
    return invalidWire(
      "DNS raw bytes, message framing or header coordinates are unavailable or invalid",
    );
  if (header === 2 && bytes.readUInt16BE(0) !== bytes.length - 2)
    return invalidWire(
      "DNS raw bytes, message framing or header coordinates are unavailable or invalid",
    );
  return ok(bytes.subarray(header));
};

const addressInventory = (observed: readonly ObservedAddress[]) => {
  const addressesByIdentity = new Map<
    string,
    { next: number; entries: ObservedAddress[] }
  >();
  for (const entry of observed) {
    if (entry.canonical === null) continue;
    const key = `${entry.type}:${entry.canonical}`;
    const queue = addressesByIdentity.get(key) ?? { next: 0, entries: [] };
    queue.entries.push(entry);
    addressesByIdentity.set(key, queue);
  }
  return addressesByIdentity;
};

const decodeRecords = (
  message: Buffer,
  start: number,
  classValue: (value: number) => number,
  observed: readonly ObservedAddress[],
): Result<readonly RecordFact[], DnsWireFailure> => {
  const u16 = (at: number): number => message.readUInt16BE(at);
  const counts = [u16(6), u16(8), u16(10)];
  let at = start;
  const addressesByIdentity = addressInventory(observed);
  const records: RecordFact[] = [];
  for (let section = 0; section < counts.length; section += 1) {
    for (let index = 0; index < counts[section]!; index += 1) {
      const ownerResult = decodeName(message, at);
      if (!ownerResult.ok) return ownerResult;
      const owner = ownerResult.value;
      if (owner.end + 10 > message.length)
        return invalidWire("DNS record header is truncated");
      const type = u16(owner.end)!;
      const dnsClass = classValue(u16(owner.end + 2)!);
      const size = u16(owner.end + 8)!;
      at = owner.end + 10;
      const end = at + size;
      if (end > message.length)
        return invalidWire("DNS record data is truncated");
      let target: string | null = null;
      let address: string | null = null;
      if (type === 5 && dnsClass === 1) {
        const decoded = decodeName(message, at, end);
        if (!decoded.ok) return decoded;
        if (decoded.value.end !== end)
          return invalidWire("CNAME data length disagrees with its name");
        target = decoded.value.key;
      } else if ((type === 1 || type === 28) && dnsClass === 1) {
        if (size !== (type === 1 ? 4 : 16))
          return invalidWire(
            "Internet address record has an invalid data length",
          );
        const wireAddress =
          type === 1
            ? [...message.subarray(at, end)].join(".")
            : Array.from({ length: 8 }, (_, index) =>
                message.readUInt16BE(at + index * 2).toString(16),
              ).join(":");
        const canonical = canonicalAddress(wireAddress, type);
        const queue = addressesByIdentity.get(`${type}:${canonical}`);
        const observation = queue?.entries[queue.next++];
        if (observation === undefined)
          return invalidWire(
            "Wire address has no equivalent producer address observation",
          );
        observation.used = true;
        address = observation.value;
      }
      records.push({
        owner: owner.key,
        type,
        dnsClass,
        answer: section === 0,
        target,
        address,
      });
      at = end;
    }
  }
  if (at !== message.length)
    return invalidWire("DNS message contains unexamined trailing bytes");
  return ok(records);
};

const eligibleQuestion = (
  decodedQuestions: readonly WireQuestion[],
  flags: number,
): WireQuestion | null => {
  const question = decodedQuestions[0];
  if (
    (flags & 0x8000) === 0 ||
    decodedQuestions.length !== 1 ||
    question === undefined ||
    ![1, 255].includes(question.dnsClass) ||
    ![1, 28, 255].includes(question.type)
  )
    return null;
  return question;
};

const attributeAddresses = (
  questions: readonly DnsWireQuestion[],
  question: WireQuestion | null,
  records: readonly RecordFact[],
  observed: readonly ObservedAddress[],
): DnsMessageFacts => {
  const unknown = (reason: string): DnsMessageFacts => ({
    questions,
    assigned: [],
    unattributed: observed.map((entry) => entry.value),
    incomplete: true,
    incomplete_reasons: [reason],
  });
  if (observed.length === 0)
    return { questions, assigned: [], unattributed: [], incomplete: false };
  if (question === null)
    return unknown(
      "Question count, response flag, type or class does not establish Internet address ownership",
    );
  const links = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.answer && record.type === 5 && record.dnsClass === 1) {
      const targets = links.get(record.owner) ?? new Set<string>();
      targets.add(record.target!);
      links.set(record.owner, targets);
    }
  }
  const reachable = new Set([question.name.key]);
  let current = question.name.key;
  while (links.has(current)) {
    const targets = links.get(current)!;
    if (targets.size !== 1)
      return unknown(
        "Conflicting CNAME targets do not establish address ownership",
      );
    const next = targets.values().next().value!;
    if (reachable.has(next))
      return unknown("CNAME cycle does not establish address ownership");
    reachable.add(next);
    current = next;
  }
  const assigned: [number, string][] = [];
  const unattributed: string[] = observed
    .filter((entry) => !entry.used)
    .map((entry) => entry.value);
  for (const record of records) {
    if (record.address === null) continue;
    if (
      record.answer &&
      record.dnsClass === 1 &&
      reachable.has(record.owner) &&
      (question.type === 255 || question.type === record.type) &&
      !links.has(record.owner)
    )
      assigned.push([0, record.address]);
    else unattributed.push(record.address);
  }
  return {
    questions,
    assigned,
    unattributed,
    incomplete: unattributed.length > 0,
    incomplete_reasons:
      unattributed.length > 0
        ? [
            "Some producer addresses lack proven ownership by the question's Internet answer chain",
          ]
        : [],
  };
};

/**
 * Parse one complete dns_raw tuple and its matching DNS protocol tree. Offsets
 * may name a reassembled buffer; all compression pointers use message bytes.
 * Expected malformed or unsupported wire data preserves producer observations.
 */
export const parseDnsMessageRaw = (
  raw: unknown,
  source: unknown,
  family: "dns" | "mdns" | "llmnr" = "dns",
): DnsMessageFacts => {
  const producer = fields(source);
  const strings = (name: string): string[] =>
    (producer.get(name) ?? []).filter(
      (value): value is string => typeof value === "string" && value !== "",
    );
  const queries = strings("dns.qry.name");
  const ipv4 = strings("dns.a");
  const ipv6 = strings("dns.aaaa");
  let questions: DnsWireQuestion[] = queries.map((query) => ({
    query,
    labels_hex: null,
  }));
  const unknown = (reason: string): DnsMessageFacts => ({
    questions,
    assigned: [],
    unattributed: [...ipv4, ...ipv6],
    incomplete: true,
    incomplete_reasons: [reason],
  });
  // The high class bit has QU/cache-flush semantics only for mDNS.
  const classValue = (value: number): number =>
    family === "mdns" ? value & 0x7fff : value;
  const messageResult = decodeMessage(raw, producer.get("dns.id_raw") ?? []);
  if (!messageResult.ok) return unknown(messageResult.error.reason);
  const message = messageResult.value;
  const u16 = (at: number): number | null =>
    at >= 0 && at + 2 <= message.length ? message.readUInt16BE(at) : null;
  const flags = u16(2)!;
  const qd = u16(4)!;
  let at = 12;
  const decodedQuestions: WireQuestion[] = [];
  for (let index = 0; index < qd; index += 1) {
    const nameResult = decodeName(message, at);
    if (!nameResult.ok) return unknown(nameResult.error.reason);
    const decoded = nameResult.value;
    if (decoded.end + 4 > message.length)
      return unknown("DNS question fields are truncated");
    decodedQuestions.push({
      name: decoded,
      type: u16(decoded.end)!,
      dnsClass: classValue(u16(decoded.end + 2)!),
    });
    at = decoded.end + 4;
  }
  if (decodedQuestions.length !== queries.length)
    return unknown(
      "Wire questions do not correspond to producer display observations",
    );
  questions = queries.map((query, index) => ({
    query,
    labels_hex: decodedQuestions[index]!.name.labels,
  }));
  const observed = [
    ...ipv4.map((value) => ({ value, type: 1 })),
    ...ipv6.map((value) => ({ value, type: 28 })),
  ].map((entry) => ({
    ...entry,
    canonical: canonicalAddress(entry.value, entry.type),
    used: false,
  }));
  const records = decodeRecords(message, at, classValue, observed);
  if (!records.ok) return unknown(records.error.reason);
  return attributeAddresses(
    questions,
    eligibleQuestion(decodedQuestions, flags),
    records.value,
    observed,
  );
};
