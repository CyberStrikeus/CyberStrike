import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseDnsMessageRaw } from "./PcapDnsWire.js";

it("preserves real TShark display collisions with distinct wire label identities", async () => {
  const packets = JSON.parse(
    await readFile(
      new URL("../../tests/fixtures/pcap/dns-raw-tree.json", import.meta.url),
      "utf8",
    ),
  ) as { _source: { layers: { dns: unknown; dns_raw: unknown } } }[];
  const recordedDnsMessages = packets.flatMap(({ _source: { layers } }) => {
    if (layers.dns === undefined) return [];
    const sources = Array.isArray(layers.dns) ? layers.dns : [layers.dns];
    const raws =
      sources.length > 1 ? (layers.dns_raw as unknown[]) : [layers.dns_raw];
    return sources.map((source, index) => ({ source, raw: raws[index] }));
  });
  const facts = recordedDnsMessages.map(({ raw, source }) =>
    parseDnsMessageRaw(raw, source),
  );
  expect(facts.map((fact) => fact.questions[0]?.query)).toEqual(
    Array(5).fill("a.b.example"),
  );
  expect(facts.map((fact) => fact.questions[0]?.labels_hex)).toEqual([
    ["612e62", "6578616d706c65"],
    ["61", "62", "6578616d706c65"],
    ["612e62", "6578616d706c65"],
    ["61", "62", "6578616d706c65"],
    ["612e62", "6578616d706c65"],
  ]);
  for (const fact of facts)
    expect(fact).toMatchObject({
      assigned: [[0, "192.0.2.9"]],
      unattributed: [],
      incomplete: false,
    });
});

const label = (...labels: readonly string[]): Buffer =>
  Buffer.concat([
    ...labels.map((hex) => {
      const bytes = Buffer.from(hex, "hex");
      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    }),
    Buffer.from([0]),
  ]);
const word = (value: number): Buffer => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
};
const rr = (owner: Buffer, type: number, data: Buffer, dnsClass = 1): Buffer =>
  Buffer.concat([
    owner,
    word(type),
    word(dnsClass),
    Buffer.alloc(4),
    word(data.length),
    data,
  ]);
const packet = (
  question: Buffer,
  answers: readonly Buffer[],
  other: readonly Buffer[] = [],
  type = 1,
): Buffer =>
  Buffer.concat([
    word(1),
    word(0x8180),
    word(1),
    word(answers.length),
    word(0),
    word(other.length),
    question,
    word(type),
    word(1),
    ...answers,
    ...other,
  ]);
const parse = (
  bytes: Buffer,
  queries: readonly string[] = ["source display"],
  addresses: readonly string[] = ["192.0.2.9"],
) =>
  parseDnsMessageRaw([bytes.toString("hex"), 42, bytes.length, 0, 1], {
    "dns.id_raw": ["0001", 42, 2, 0, 5],
    Queries: { "dns.qry.name": queries },
    Answers: { "dns.a": addresses },
  });
const pointer = Buffer.from([0xc0, 0x0c]);
const address = Buffer.from([192, 0, 2, 9]);

it("joins compressed CNAMEs using ASCII-folded bytes while retaining original labels", () => {
  const query = label("414243", "6578616d706c65");
  const alias = label("616263", "6578616d706c65");
  const target = label("00ff2e5c", "6578616d706c65");
  const facts = parse(
    packet(query, [rr(alias, 5, target), rr(target, 1, address)]),
  );
  expect(facts.questions).toEqual([
    { query: "source display", labels_hex: ["414243", "6578616d706c65"] },
  ]);
  expect(facts.assigned).toEqual([[0, "192.0.2.9"]]);
  expect(facts.incomplete).toBe(false);
});

it("does not conflate a literal label dot with a separator during address ownership", () => {
  const facts = parse(
    packet(label("612e62", "6578616d706c65"), [
      rr(label("61", "62", "6578616d706c65"), 1, address),
    ]),
  );
  expect(facts.assigned).toEqual([]);
  expect(facts.unattributed).toEqual(["192.0.2.9"]);
  expect(facts.incomplete).toBe(true);
});

it("skips unrelated RR layouts without flattened SRV or NSEC field assumptions", () => {
  const query = label("61");
  const facts = parse(
    packet(query, [
      rr(pointer, 33, Buffer.alloc(6)),
      rr(pointer, 47, Buffer.from([0, 0, 1, 0])),
      rr(pointer, 1, address),
    ]),
  );
  expect(facts.assigned).toEqual([[0, "192.0.2.9"]]);
  expect(facts.incomplete).toBe(false);
});

it.each([
  ["truncated RDATA", (bytes: Buffer) => bytes.subarray(0, bytes.length - 1)],
  [
    "compression cycle",
    (bytes: Buffer) => {
      const copy = Buffer.from(bytes);
      copy[12] = 0xc0;
      copy[13] = 12;
      return copy;
    },
  ],
  [
    "unsupported extended label",
    (bytes: Buffer) => {
      const copy = Buffer.from(bytes);
      copy[12] = 0x40;
      return copy;
    },
  ],
  [
    "extra trailing bytes",
    (bytes: Buffer) => Buffer.concat([bytes, Buffer.from([1])]),
  ],
])("preserves producer address facts after %s", (_name, mutate) => {
  const facts = parse(mutate(packet(label("61"), [rr(pointer, 1, address)])));
  expect(facts.assigned).toEqual([]);
  expect(facts.unattributed).toEqual(["192.0.2.9"]);
  expect(facts.incomplete).toBe(true);
});

it("retains known question identity when a later RR is malformed", () => {
  const bytes = packet(label("61"), [rr(pointer, 1, address)]);
  expect(parse(bytes.subarray(0, bytes.length - 1)).questions).toEqual([
    { query: "source display", labels_hex: ["61"] },
  ]);
});

it("retains each ambiguous producer question occurrence when raw identity is unavailable", () => {
  const facts = parseDnsMessageRaw(null, {
    "dns.qry.name": ["same", "same"],
    "dns.a": ["192.0.2.9"],
  });
  expect(facts.questions).toEqual([
    { query: "same", labels_hex: null },
    { query: "same", labels_hex: null },
  ]);
  expect(facts.unattributed).toEqual(["192.0.2.9"]);
});

it("keeps additional addresses observed but unattributed", () => {
  const facts = parse(packet(label("61"), [], [rr(pointer, 1, address)]));
  expect(facts.assigned).toEqual([]);
  expect(facts.unattributed).toEqual(["192.0.2.9"]);
});

it("preserves producer IPv6 formatting and masks mDNS cache-flush class bits", () => {
  const bytes = packet(
    label("61"),
    [rr(pointer, 28, Buffer.alloc(16), 0x8001)],
    [],
    28,
  );
  const facts = parseDnsMessageRaw(
    [bytes.toString("hex"), 0, bytes.length, 0, 1],
    {
      "dns.id_raw": ["0001", 0, 2, 0, 5],
      "dns.qry.name": "a",
      "dns.aaaa": "::",
      "dns.resp.cache_flush": "1",
    },
    "mdns",
  );
  expect(facts.assigned).toEqual([[0, "::"]]);
});

it("keeps a unicast high-bit class distinct from IN", () => {
  const facts = parse(packet(label("61"), [rr(pointer, 1, address, 0x8001)]));
  expect(facts.assigned).toEqual([]);
  expect(facts.unattributed).toEqual(["192.0.2.9"]);
});

it("matches producer addresses to wire bytes rather than shifted type queues", () => {
  const facts = parse(
    packet(label("61"), [
      rr(pointer, 1, Buffer.concat([label("78"), word(1)]), 3),
      rr(pointer, 1, address),
    ]),
  );
  expect(facts.assigned).toEqual([[0, "192.0.2.9"]]);
  expect(facts.incomplete).toBe(false);
  const mismatch = parse(
    packet(label("61"), [rr(pointer, 1, address)]),
    ["a"],
    ["192.0.2.99"],
  );
  expect(mismatch.assigned).toEqual([]);
  expect(mismatch.unattributed).toEqual(["192.0.2.99"]);
});

it("retains unmatched producer addresses as incomplete evidence", () => {
  const facts = parse(
    packet(label("61"), [rr(pointer, 1, address)]),
    ["a"],
    ["192.0.2.99", "192.0.2.9"],
  );
  expect(facts.assigned).toEqual([[0, "192.0.2.9"]]);
  expect(facts.unattributed).toEqual(["192.0.2.99"]);
  expect(facts.incomplete).toBe(true);
});

it.each([
  [
    rr(pointer, 5, label("62")),
    rr(pointer, 5, label("63")),
    rr(label("62"), 1, address),
  ],
  [
    rr(pointer, 5, label("62")),
    rr(label("62"), 5, pointer),
    rr(label("62"), 1, address),
  ],
])("declines conflicting or cyclic CNAME ownership", (...answers) => {
  const facts = parse(packet(label("61"), answers));
  expect(facts.assigned).toEqual([]);
  expect(facts.unattributed).toEqual(["192.0.2.9"]);
});

it.each([5, 15, 28])(
  "does not assign IPv4 data to question type %i",
  (type) => {
    const facts = parse(
      packet(label("61"), [rr(pointer, 1, address)], [], type),
    );
    expect(facts.assigned).toEqual([]);
    expect(facts.unattributed).toEqual(["192.0.2.9"]);
  },
);

it("retains multiple question identities without assigning ambiguous response ownership", () => {
  const bytes = Buffer.concat([
    word(1),
    word(0x8180),
    word(2),
    word(1),
    word(0),
    word(0),
    label("61"),
    word(1),
    word(1),
    label("62"),
    word(1),
    word(1),
    rr(pointer, 1, address),
  ]);
  const facts = parse(bytes, ["a", "b"]);
  expect(facts.questions.map((question) => question.labels_hex)).toEqual([
    ["61"],
    ["62"],
  ]);
  expect(facts.assigned).toEqual([]);
  expect(facts.unattributed).toEqual(["192.0.2.9"]);
});

// Real official Wireshark 4.4.19 output on offline UDP 53/5353/5355 frames.
// Child names remain dns.* while protocol trees/raw bytes use family names.
it("parses recorded DNS, mDNS and LLMNR trees with protocol-specific class semantics", async () => {
  const packets = JSON.parse(
    await readFile(
      new URL(
        "../../tests/fixtures/pcap/dns-family-tree.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { _source: { layers: Record<string, unknown> } }[];
  for (const [index, family] of (["dns", "mdns", "llmnr"] as const).entries()) {
    const layers = packets[index]!._source.layers;
    const facts = parseDnsMessageRaw(
      layers[`${family}_raw`],
      layers[family],
      family,
    );
    expect(facts).toMatchObject({
      questions: [{ query: "a.example", labels_hex: ["61", "6578616d706c65"] }],
      assigned: [[0, "192.0.2.9"]],
      incomplete: false,
    });
    const incomplete = parseDnsMessageRaw(null, layers[family], family);
    expect(incomplete.questions).toEqual([
      { query: "a.example", labels_hex: null },
    ]);
    expect(incomplete.assigned).toEqual([]);
    expect(incomplete.unattributed).toEqual(["192.0.2.9"]);
    expect(incomplete.incomplete).toBe(true);
    expect(incomplete.incomplete_reasons?.length).toBeGreaterThan(0);
  }
});
