import { readFile } from "node:fs/promises";
import { dnsResponseLayers } from "../../tests/fixtures/pcap/pcapTestTools.js";
import { expect, it } from "vitest";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { parseCapinfosOutput, parseTsharkJsonOutput } from "./PcapOutput.js";

const capture = (layers: ReadonlyArray<Record<string, unknown>>) =>
  JSON.stringify(
    layers.map((fields, index) => ({
      _source: {
        layers: {
          "frame.number": [String(index + 1)],
          "frame.protocols": ["ip:udp:dns"],
          ...fields,
        },
      },
    })),
  );

it.each([
  [[], []],
  [["", ""], []],
  [["user_dlt:data", ""], [{ protocol: "user_dlt:data", packet_count: 1 }]],
  [["", "user_dlt:data"], [{ protocol: "user_dlt:data", packet_count: 1 }]],
  [
    ["user_dlt:data", "", "user_dlt:data"],
    [{ protocol: "user_dlt:data", packet_count: 2 }],
  ],
] as const)(
  "counts every frame while aggregating only reported protocol stacks: %j",
  async (stacks, expected) => {
    const result = await parseTsharkJsonOutput(
      capture(stacks.map((stack) => ({ "frame.protocols": [stack] }))),
    );
    expect(result.packetCount).toBe(stacks.length);
    expect(result.protocolDistribution).toEqual(expected);
    expect(result.protocolCount).toBe(expected.length);
    expect(result.partial).toBe(false);
  },
);

it.each([
  { "frame.number": ["1"] },
  { "frame.number": ["1"], "frame.protocols": [] },
  { "frame.number": ["1"], "frame.protocols": ["", "ip"] },
  { "frame.number": ["1"], "frame.protocols": ["ip", "ip"] },
  { "frame.number": ["1"], "frame.protocols": [null] },
  { "frame.number": ["1"], "frame.protocols": "" },
  { "frame.protocols": [""] },
  { "frame.number": ["2"], "frame.protocols": [""] },
])("rejects malformed or ambiguous frame inventories: %j", async (layers) => {
  await expect(
    parseTsharkJsonOutput(JSON.stringify([{ _source: { layers } }])),
  ).rejects.toMatchObject({ _tag: "AnalysisProtocolError" });
});

it.each(["before", "after"] as const)(
  "retains endpoint and DNS facts with an empty stack %s the response",
  async (position) => {
    const empty = { "frame.protocols": [""] };
    const response = {
      "frame.protocols": ["eth:ethertype:ip:udp:dns"],
      "ip.src": ["192.0.2.53"],
      "ip.dst": ["192.0.2.1"],
      ...dnsResponseLayers("api.example", "203.0.113.5"),
    };
    const result = await parseTsharkJsonOutput(
      capture(position === "before" ? [empty, response] : [response, empty]),
    );
    expect(result).toMatchObject({
      packetCount: 2,
      protocolCount: 1,
      protocolDistribution: [
        { protocol: "eth:ethertype:ip:udp:dns", packet_count: 1 },
      ],
      endpointCount: 2,
      endpoints: [
        { address: "192.0.2.1", port: null, packet_count: 1 },
        { address: "192.0.2.53", port: null, packet_count: 1 },
      ],
      dnsQueryCount: 1,
      dnsQueries: [
        {
          query: "api.example",
          query_labels_hex: ["617069", "6578616d706c65"],
          response_addresses: ["203.0.113.5"],
          response_address_count: 1,
        },
      ],
      partial: false,
    });
  },
);

it("rejects duplicate frame identities even when protocol stacks are empty", async () => {
  await expect(
    parseTsharkJsonOutput(
      capture([
        { "frame.protocols": [""] },
        { "frame.number": ["1"], "frame.protocols": [""] },
      ]),
    ),
  ).rejects.toMatchObject({ _tag: "AnalysisProtocolError" });
});

it("binds interleaved DNS answers to each response packet", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      dnsResponseLayers("alpha.example", "192.0.2.10"),
      dnsResponseLayers("beta.example", "192.0.2.20"),
    ]),
  );
  expect(
    result.dnsQueries.map(({ query, response_addresses }) => ({
      query,
      response_addresses,
    })),
  ).toEqual([
    { query: "alpha.example", response_addresses: ["192.0.2.10"] },
    { query: "beta.example", response_addresses: ["192.0.2.20"] },
  ]);
  expect(result.partial).toBe(false);
});

it("retains unassignable DNS observations when wire identity is missing", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      { dns: { "dns.qry.name": ["same", "same"], "dns.a": "192.0.2.9" } },
      { dns: { "dns.aaaa": "2001:db8::9" } },
    ]),
  );
  expect(result.dnsQueries).toEqual(
    Array(2).fill({
      query: "same",
      query_labels_hex: null,
      response_addresses: [],
      response_address_count: 0,
    }),
  );
  expect(result.unattributedDnsAddresses).toEqual(["192.0.2.9", "2001:db8::9"]);
  expect(result.unattributedDnsPackets).toBe(2);
  expect(result.partial).toBe(true);
});

it("counts IPv6 endpoints once per packet and preserves every examined fact", async () => {
  const packets = Array.from({ length: 51 }, (_, index) => ({
    "ipv6.src": ["2001:db8::1"],
    "ipv6.dst": ["2001:db8::1"],
    "tls.handshake.extensions_server_name": [`host${String(index)}.example`],
    "frame.protocols": [`ipv6:protocol${String(index)}`],
  }));
  const result = await parseTsharkJsonOutput(capture(packets));
  expect(result.endpoints).toEqual([
    { address: "2001:db8::1", port: null, packet_count: 51 },
  ]);
  expect(result.tlsSniCount).toBe(51);
  expect(result.tlsSniValues).toHaveLength(51);
  expect(result.protocolCount).toBe(51);
  expect(result.protocolDistribution).toHaveLength(51);
  expect(result.partial).toBe(false);
});

it("orders equal-count endpoints and protocols by code point, not host locale", async () => {
  // Locale collation puts "fe80::1" first and, under da-DK, "aarp" after "zz".
  const result = await parseTsharkJsonOutput(
    capture([
      { "ipv6.src": ["fe80::1"], "frame.protocols": ["eth:llc:zz"] },
      { "ipv6.src": ["fe80:1::1"], "frame.protocols": ["eth:llc:aarp"] },
    ]),
  );
  expect(result.endpoints.map(({ address }) => address)).toEqual([
    "fe80:1::1",
    "fe80::1",
  ]);
  expect(result.protocolDistribution.map(({ protocol }) => protocol)).toEqual([
    "eth:llc:aarp",
    "eth:llc:zz",
  ]);
});

it("preserves all DNS addresses and their exact examined count", async () => {
  const result = await parseTsharkJsonOutput(
    capture(
      Array.from({ length: 101 }, (_, index) => ({
        ...dnsResponseLayers("rotating.example", `192.0.2.${String(index)}`),
      })),
    ),
  );
  expect(result.dnsQueries[0]?.response_addresses).toHaveLength(101);
  expect(result.dnsQueries[0]?.response_address_count).toBe(101);
  expect(result.partial).toBe(false);
});

it("accepts exact machine packet counts and rejects scaled human counts", () => {
  const prefix =
    "File type: pcap\nFile encapsulation: Ethernet\nNumber of packets: ";
  expect(parseCapinfosOutput(`${prefix}20010`).packetCount).toBe(20010);
  expect(() => parseCapinfosOutput(`${prefix}20 k`)).toThrow(
    /machine-readable/u,
  );
});

it.each([
  ["0", 0],
  ["1.250 seconds", 1.25],
  ["2 second", 2],
  ["n/a", null],
  ["-1 seconds", null],
  [`${"9".repeat(309)} seconds`, null],
] as const)(
  "retains finite capinfos duration %s and preserves other metadata",
  (duration, expected) => {
    const metadata = parseCapinfosOutput(
      `File type: pcap\nFile encapsulation: Ethernet\nNumber of packets: 2\nCapture duration: ${duration}\nPacket size limit: file hdr: 65535 bytes\n`,
    );
    expect(metadata.captureDurationSeconds).toBe(expected);
    expect(metadata.packetCount).toBe(2);
    expect(metadata.snapshotLength).toBe(65535);
  },
);

it("excludes transport credentials without normalizing observed URL bytes", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      {
        "http.request.full_uri": [
          "http://user:password@Example.com/a/../b?token=local-evidence#keep",
        ],
      },
      {
        "http.request.full_uri": [
          "http://other:secret@Example.com/a/../b?token=local-evidence#keep",
        ],
      },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://Example.com/a/../b?token=local-evidence#keep",
  ]);
  expect(result.httpRequestUriCount).toBe(2);
  expect(result.httpUriRedactionCount).toBe(2);
  expect(result.partial).toBe(true);
});

it("retains HTTP absolute-form request targets when Wireshark cannot synthesize full_uri", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      { "http.request.uri": ["http://proxy.example.test/a/../resource"] },
      { "http.request.uri": ["/relative/path"] },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://proxy.example.test/a/../resource",
  ]);
  expect(result.httpRequestUriCount).toBe(1);
  expect(result.partial).toBe(true);
});

it("marks mixed request arrays partial when a relative target has no full URI", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      {
        "http.request.uri": ["/resolved/with-host", "/unresolved/without-host"],
        "http.request.full_uri": ["http://host.example/resolved/with-host"],
      },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://host.example/resolved/with-host",
  ]);
  expect(result.partial).toBe(true);
});

it("accounts for paired full URIs and absolute-form values without inventing array joins", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      {
        "http.request.uri": ["/first", "/second", "http://proxy.example/third"],
        "http.request.full_uri": [
          "http://host.example/first",
          "http://host.example/second",
          "http://proxy.example/third",
        ],
      },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://host.example/first",
    "http://host.example/second",
    "http://proxy.example/third",
  ]);
  expect(result.partial).toBe(false);
});

it("refuses dense JSON before its expanded graph exceeds the decoding budget", async () => {
  await expect(
    parseTsharkJsonOutput(`[${"{},".repeat(600_000)}{}]`),
  ).rejects.toMatchObject({
    _tag: "AnalysisResourceConstraintError",
  });
});

it.each([
  null,
  "stopped",
  new ProviderCleanupError("caller", ["foreign-resource"], {}),
])(
  "preserves opaque cancellation while validating producer output: %s",
  async (reason) => {
    const controller = new AbortController();
    const result = parseTsharkJsonOutput(
      capture([{ "ip.src": ["192.0.2.1"] }]),
      controller.signal,
    );
    controller.abort(reason);
    const failure = await result.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    if (!(failure instanceof AnalysisCancelledError)) throw failure;
    expect(failure.cause).toBe(reason);
    expect(failure.cleanupIncomplete).toBe(false);
    expect(failure.cleanupResources).toEqual([]);
    if (reason instanceof ProviderCleanupError)
      expect(reason.cleanupIncomplete).toBe(true);
  },
);

it("includes decoded HTTP/2 URIs with shared credential handling and reports unresolved targets", async () => {
  const full = await parseTsharkJsonOutput(
    capture([
      {
        "http2.request.full_uri": [
          "http://example.test/h2",
          "https://user:pass@example.test/kept",
        ],
        "http2.headers.path": ["/h2", "/kept"],
      },
      { "http.request.full_uri": ["http://example.test/h1"] },
    ]),
  );
  expect(full.httpRequestUris).toEqual([
    "http://example.test/h2",
    "https://example.test/kept",
    "http://example.test/h1",
  ]);
  expect(full.httpRequestUriCount).toBe(3);
  expect(full.httpUriRedactionCount).toBe(1);
  expect(full.partial).toBe(false);
  expect(
    (
      await parseTsharkJsonOutput(
        capture([{ "http2.headers.path": ["/unresolved"] }]),
      )
    ).partial,
  ).toBe(true);
});

// Extracted unchanged frame, DNS and raw DNS fields from Wireshark 4.4.19
// -T json -x --no-duplicate-keys -J "frame ip ipv6 dns tls http http2".
// Locally generated five-frame capture: UDP, multiple TCP PDUs and reassembly.
// Other protocol trees and packet metadata are omitted; no external traffic.
it("parses recorded Wireshark raw trees without merging display-colliding names", async () => {
  const output = await readFile(
    new URL("../../tests/fixtures/pcap/dns-raw-tree.json", import.meta.url),
    "utf8",
  );
  const result = await parseTsharkJsonOutput(output);
  expect(result.packetCount).toBe(5);
  expect(result.dnsQueries).toEqual([
    {
      query: "a.b.example",
      query_labels_hex: ["612e62", "6578616d706c65"],
      response_addresses: ["192.0.2.9"],
      response_address_count: 1,
    },
    {
      query: "a.b.example",
      query_labels_hex: ["61", "62", "6578616d706c65"],
      response_addresses: ["192.0.2.9"],
      response_address_count: 1,
    },
  ]);
  expect(result.partial).toBe(false);
});

it("shares the decoded-graph allowance across base and DNS acquisitions", async () => {
  // Each graph is individually within 128 MiB using the decoder's conservative
  // source expansion accounting; together they must fail before the second parse.
  const padding = Array<string>(360_000).fill("");
  const base = capture([{ padding }]);
  const dns = JSON.stringify([
    {
      _source: {
        layers: {
          frame: { "frame.number": "1", "frame.protocols": "ip:udp" },
          padding,
        },
      },
    },
  ]);
  await expect(parseTsharkJsonOutput(base)).resolves.toMatchObject({
    packetCount: 1,
  });
  await expect(parseTsharkJsonOutput(dns)).resolves.toMatchObject({
    packetCount: 1,
  });
  await expect(
    parseTsharkJsonOutput(base, undefined, dns),
  ).rejects.toMatchObject({
    _tag: "AnalysisResourceConstraintError",
  });
});

it.each(["dns", "mdns", "llmnr"] as const)(
  "joins recorded %s message facts without dropping its DNS identity",
  async (family) => {
    const recorded: {
      _source: {
        layers: Record<string, unknown> & { frame: Record<string, string> };
      };
    }[] = JSON.parse(
      await readFile(
        new URL(
          "../../tests/fixtures/pcap/dns-family-tree.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    if (!Array.isArray(recorded)) throw new Error("Expected producer packets");
    const packet = recorded.find((packet) => family in packet._source.layers);
    if (packet === undefined)
      throw new Error("Expected matching producer family");
    packet._source.layers.frame["frame.number"] = "1";
    const result = await parseTsharkJsonOutput(
      capture([{ "dns.qry.name": ["a.example"], "dns.a": ["192.0.2.9"] }]),
      undefined,
      JSON.stringify([packet]),
    );
    expect(result.dnsQueries).toEqual([
      {
        query: "a.example",
        query_labels_hex: ["61", "6578616d706c65"],
        response_addresses: ["192.0.2.9"],
        response_address_count: 1,
      },
    ]);
    expect(result.partial).toBe(false);
  },
);

it("preserves selected occurrences omitted by a partial DNS message pass", async () => {
  const raw = dnsResponseLayers("same.example", "192.0.2.9");
  const base = capture([
    {
      "dns.qry.name": ["same.example", "same.example", "missing.example"],
      "dns.a": ["192.0.2.9", "192.0.2.9", "192.0.2.10"],
    },
  ]);
  const tree = JSON.stringify([
    { _source: { layers: { frame: { "frame.number": "1" }, ...raw } } },
  ]);
  const result = await parseTsharkJsonOutput(base, undefined, tree);
  expect(result.dnsQueries).toEqual([
    {
      query: "same.example",
      query_labels_hex: ["73616d65", "6578616d706c65"],
      response_addresses: ["192.0.2.9"],
      response_address_count: 1,
    },
    {
      query: "same.example",
      query_labels_hex: null,
      response_addresses: [],
      response_address_count: 0,
    },
    {
      query: "missing.example",
      query_labels_hex: null,
      response_addresses: [],
      response_address_count: 0,
    },
  ]);
  expect(result.unattributedDnsAddresses).toEqual(["192.0.2.9", "192.0.2.10"]);
  expect(result.unattributedDnsPackets).toBe(1);
  expect(result.partial).toBe(true);
  expect(result.dnsLimitations.join(" ")).toContain("occurrences");
});
