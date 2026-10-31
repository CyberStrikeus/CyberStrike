import { describe, expect, it } from "vitest";

import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  CAPINFOS_COMMAND_ENV,
  TSHARK_COMMAND_ENV,
  locateWiresharkTool,
  parseWiresharkVersion,
  resolvePcapTools,
  selectWiresharkTool,
  wiresharkExecutableIdentity,
} from "./PcapConfiguration.js";
import { parseCapinfosOutput, parseTsharkJsonOutput } from "./PcapOutput.js";

describe("resolvePcapTools", () => {
  it("prefers absolute environment paths for both tools", () => {
    expect(
      resolvePcapTools({
        [TSHARK_COMMAND_ENV]: "/usr/bin/tshark",
        [CAPINFOS_COMMAND_ENV]: "/usr/bin/capinfos",
      }),
    ).toEqual({
      tshark: { command: "/usr/bin/tshark", source: "environment" },
      capinfos: { command: "/usr/bin/capinfos", source: "environment" },
    });
  });

  it("keeps bare PATH selections for the Windows PATH/PATHEXT launcher", () => {
    expect(resolvePcapTools({}, "win32")).toEqual({
      tshark: { command: "tshark", source: "path" },
      capinfos: { command: "capinfos", source: "path" },
    });
  });

  it("fails closed when no absolute PATH entry holds the tool", () => {
    expect(() => resolvePcapTools({ PATH: "relative-only" }, "linux")).toThrow(
      /tshark was not found in an absolute PATH entry/u,
    );
  });

  // Windows X_OK reports existence only, so executable-bit selection is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "selects the same executable as the packet tools ahead of a relative PATH entry",
    async () => {
      const root = await createTestTempDirectory("rea-wireshark-shared-");
      const decoy = join(root, "relative-decoy");
      const installed = join(root, "installed");
      for (const directory of [decoy, installed]) {
        await mkdir(directory);
        for (const tool of ["tshark", "capinfos"]) {
          await writeFile(join(directory, tool), "");
          await chmod(join(directory, tool), 0o700);
        }
      }
      const environment = {
        PATH: [relative(process.cwd(), decoy), installed].join(":"),
      };

      const pcap = resolvePcapTools(environment, "linux");
      expect(pcap).toEqual({
        tshark: { command: join(installed, "tshark"), source: "path" },
        capinfos: { command: join(installed, "capinfos"), source: "path" },
      });
      expect(pcap.tshark.command).toBe(
        locateWiresharkTool(
          selectWiresharkTool(environment, "tshark"),
          environment,
        ),
      );
    },
  );

  it("rejects a relative tshark path explicitly", () => {
    expect(() =>
      resolvePcapTools({ [TSHARK_COMMAND_ENV]: "bin/tshark" }),
    ).toThrow(/must be an absolute path/u);
  });

  it("rejects a relative capinfos path explicitly", () => {
    expect(() =>
      resolvePcapTools({ [CAPINFOS_COMMAND_ENV]: "capinfos" }),
    ).toThrow(/must be an absolute path/u);
  });
});

describe("locateWiresharkTool", () => {
  it("keeps an environment selection as the configured absolute path", () => {
    expect(
      locateWiresharkTool(
        { command: "/opt/wireshark/tshark", source: "environment" },
        { PATH: "/usr/bin" },
      ),
    ).toBe("/opt/wireshark/tshark");
  });

  // Windows X_OK reports existence only, so executable-bit selection is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "uses the first absolute PATH entry holding an executable regular file",
    async () => {
      const root = await createTestTempDirectory("rea-wireshark-path-");
      // An absolute PATH entry that does not exist must be skipped.
      const missingDirectory = join(root, "missing-directory");
      const notExecutable = join(root, "not-executable");
      const directoryEntry = join(root, "directory-entry");
      const selected = join(root, "selected");
      const later = join(root, "later");
      for (const directory of [notExecutable, directoryEntry, selected, later])
        await mkdir(directory);
      await writeFile(join(notExecutable, "tshark"), "");
      await chmod(join(notExecutable, "tshark"), 0o600);
      await mkdir(join(directoryEntry, "tshark"));
      for (const directory of [selected, later]) {
        await writeFile(join(directory, "tshark"), "");
        await chmod(join(directory, "tshark"), 0o700);
      }
      const PATH = [
        "relative-entry",
        missingDirectory,
        notExecutable,
        directoryEntry,
        selected,
        later,
      ].join(":");

      expect(
        locateWiresharkTool({ command: "tshark", source: "path" }, { PATH }),
      ).toBe(join(selected, "tshark"));
      expect(
        locateWiresharkTool(
          { command: "tshark", source: "path" },
          { PATH: [missingDirectory, notExecutable, directoryEntry].join(":") },
        ),
      ).toBeUndefined();
      expect(
        locateWiresharkTool({ command: "tshark", source: "path" }, {}),
      ).toBeUndefined();
    },
  );
});

describe("parseWiresharkVersion", () => {
  it("admits Wireshark 4.x banners for either tool and rejects other majors", () => {
    expect(
      parseWiresharkVersion(
        "\nTShark (Wireshark) 4.6.9 (Git v4.6.9 packaged as 4.6.9-1)\n",
        "tshark",
      ),
    ).toBe("TShark (Wireshark) 4.6.9 (Git v4.6.9 packaged as 4.6.9-1)");
    expect(
      parseWiresharkVersion("Capinfos (Wireshark) 4.0.17\n", "capinfos"),
    ).toBe("Capinfos (Wireshark) 4.0.17");
    expect(parseWiresharkVersion("tcpdump 4.99.4\n", "tshark")).toBeNull();
    expect(() =>
      parseWiresharkVersion("TShark (Wireshark) 3.6.2\n", "tshark"),
    ).toThrow(/requires Wireshark 4\.x/u);
  });
});

it("projects executable snapshots to compact identity facts", () => {
  const bytes = new Uint8Array(64);
  const identity = wiresharkExecutableIdentity({
    bytes,
    sha256: "a".repeat(64),
  });
  expect(identity).toEqual({ bytes: 64, sha256: "a".repeat(64) });
  expect(Object.values(identity)).not.toContain(bytes);
});

const REAL_CAPINFOS = [
  "File name:           /work/rich-capture.pcap",
  "File type:           Wireshark/tcpdump/... - pcap",
  "File encapsulation:  Linux cooked-mode capture v2",
  "Packet size limit:   file hdr: 262144 bytes",
  "Number of packets:   50",
  "File size:           23279 bytes",
  "Capture duration:    0.373473 seconds",
  "Earliest packet time: 1791728020.608505",
  "Latest packet time:   1791728020.981978",
  "SHA256:              c94f94742b3288b9a979711509ed5eab3028576301f8938319de3c22a6f5c40b",
].join("\n");

describe("parseCapinfosOutput", () => {
  it("projects metadata from real capinfos output", () => {
    expect(parseCapinfosOutput(REAL_CAPINFOS)).toEqual({
      fileType: "Wireshark/tcpdump/... - pcap",
      encapsulation: "Linux cooked-mode capture v2",
      packetCount: 50,
      captureStart: "2026-10-11T14:13:40.608505Z",
      captureEnd: "2026-10-11T14:13:40.981978Z",
      captureDurationSeconds: 0.373473,
      snapshotLength: 262144,
      sha256:
        "c94f94742b3288b9a979711509ed5eab3028576301f8938319de3c22a6f5c40b",
    });
  });

  it.each(["128 bytes", "128 bytes - 256 bytes (range)"])(
    "preserves the file-header snapshot limit alongside inferred %s",
    (inferred) => {
      const output = REAL_CAPINFOS.replace(
        "Packet size limit:   file hdr: 262144 bytes",
        `Packet size limit:   file hdr: 262144 bytes\nPacket size limit:   inferred: ${inferred}`,
      );
      expect(parseCapinfosOutput(output).snapshotLength).toBe(262144);
      expect(
        parseCapinfosOutput(
          output.replace("file hdr: 262144 bytes", "file hdr: (not set)"),
        ).snapshotLength,
      ).toBeNull();
    },
  );

  it("retains timestamps from the older capinfos labels", () => {
    const output = REAL_CAPINFOS.replace(
      "Earliest packet time",
      "First packet time",
    ).replace("Latest packet time", "Last packet time");
    const metadata = parseCapinfosOutput(output);
    expect(metadata.captureStart).toBe("2026-10-11T14:13:40.608505Z");
    expect(metadata.captureEnd).toBe("2026-10-11T14:13:40.981978Z");
  });

  it("projects epoch timestamps to UTC instants and keeps other spellings unknown", () => {
    const withTimes = (start: string, end: string): string =>
      REAL_CAPINFOS.replace("1791728020.608505", start).replace(
        "1791728020.981978",
        end,
      );
    expect(
      parseCapinfosOutput(withTimes("1791728020", "1791728020.500000")),
    ).toMatchObject({
      captureStart: "2026-10-11T14:13:40Z",
      captureEnd: "2026-10-11T14:13:40.500000Z",
    });
    // capinfos prints n/a for an empty capture, and its default wall-clock
    // spelling carries no zone, so neither names an instant.
    expect(
      parseCapinfosOutput(withTimes("n/a", "2026-10-11 14:13:40.981978")),
    ).toMatchObject({ captureStart: null, captureEnd: null });
    // a packet before the epoch prints with a leading minus; the whole seconds
    // and the fraction are borrowed so the instant stays exact
    expect(parseCapinfosOutput(withTimes("-1", "-1.250000"))).toMatchObject({
      captureStart: "1969-12-31T23:59:59Z",
      captureEnd: "1969-12-31T23:59:58.750000Z",
    });
    expect(parseCapinfosOutput(withTimes("-0.5", "0"))).toMatchObject({
      captureStart: "1969-12-31T23:59:59.5Z",
      captureEnd: "1970-01-01T00:00:00Z",
    });
    // beyond the RFC 3339 year range in either direction stays unknown
    expect(
      parseCapinfosOutput(withTimes("-62167219201", "253402300800")),
    ).toMatchObject({ captureStart: null, captureEnd: null });
  });

  it.each([
    ["0.000000001", "1970-01-01T00:00:00.000000001Z"],
    ["-0.000000001", "1969-12-31T23:59:59.999999999Z"],
    ["-1.000000", "1969-12-31T23:59:59.000000Z"],
    ["-0.000000", "1970-01-01T00:00:00.000000Z"],
    ["-62167219200.000000001", null],
    ["-62167219200", "0000-01-01T00:00:00Z"],
    ["253402300799.999999999", "9999-12-31T23:59:59.999999999Z"],
    ["253402300800", null],
    ["NaN", null],
    ["Infinity", null],
    ["1791728020.5junk", null],
    ["1e3", null],
    ["1.1234567890", null],
    ["9".repeat(1000), null],
  ])("preserves the exact instant or unknown for %s", (text, expected) => {
    const metadata = parseCapinfosOutput(
      REAL_CAPINFOS.replace("1791728020.608505", text).replace(
        "1791728020.981978",
        text,
      ),
    );
    expect(metadata.captureStart).toBe(expected);
    expect(metadata.captureEnd).toBe(expected);
  });

  it("keeps missing capture timestamps unknown", () => {
    const output = REAL_CAPINFOS.split("\n")
      .filter((line) => !line.includes("packet time:"))
      .join("\n");
    expect(parseCapinfosOutput(output)).toMatchObject({
      captureStart: null,
      captureEnd: null,
    });
  });

  it("rejects empty metadata rather than reporting complete unknown facts", () => {
    expect(() => parseCapinfosOutput("")).toThrow(/machine-readable/u);
  });
});

// Synthetic producer observations without raw DNS bytes: identity remains unknown.
const PARTIAL_TSHARK_JSON = JSON.stringify([
  {
    _source: {
      layers: {
        "frame.number": ["1"],
        "frame.protocols": ["sll:ethertype:ip:udp:dns"],
        "ip.src": ["192.168.1.1"],
        "ip.dst": ["8.8.8.8"],
        dns: {
          "dns.qry.name": "example.com",
          "dns.a": "93.184.216.34",
        },
      },
    },
  },
  {
    _source: {
      layers: {
        "frame.number": ["2"],
        "frame.protocols": ["sll:ethertype:ip:tcp:tls"],
        "ip.src": ["192.168.1.1"],
        "ip.dst": ["93.184.216.34"],
        "tls.handshake.extensions_server_name": ["example.com"],
      },
    },
  },
  {
    _source: {
      layers: {
        "frame.number": ["3"],
        "frame.protocols": ["sll:ethertype:ip:tcp:http"],
        "ip.src": ["192.168.1.1"],
        "ip.dst": ["93.184.216.34"],
        "http.request.full_uri": ["http://example.com/page"],
      },
    },
  },
]);

describe("parseTsharkJsonOutput", () => {
  it("projects endpoints, DNS, TLS SNI, protocols, and HTTP URIs", async () => {
    const result = await parseTsharkJsonOutput(PARTIAL_TSHARK_JSON);
    expect(result.endpoints).toEqual(
      expect.arrayContaining([
        { address: "192.168.1.1", port: null, packet_count: 3 },
        { address: "8.8.8.8", port: null, packet_count: 1 },
        { address: "93.184.216.34", port: null, packet_count: 2 },
      ]),
    );
    expect(result.dnsQueries).toEqual([
      {
        query: "example.com",
        query_labels_hex: null,
        response_addresses: [],
        response_address_count: 0,
      },
    ]);
    expect(result.unattributedDnsAddresses).toEqual(["93.184.216.34"]);
    expect(result.partial).toBe(true);
    expect(result.tlsSniValues).toEqual(["example.com"]);
    expect(result.httpRequestUris).toEqual(["http://example.com/page"]);
    expect(result.protocolDistribution).toEqual(
      expect.arrayContaining([
        { protocol: "sll:ethertype:ip:udp:dns", packet_count: 1 },
        { protocol: "sll:ethertype:ip:tcp:tls", packet_count: 1 },
        { protocol: "sll:ethertype:ip:tcp:http", packet_count: 1 },
      ]),
    );
  });

  it("retains every endpoint within the aggregate resource budget", async () => {
    const packets = Array.from({ length: 10 }, (_, index) => ({
      _source: {
        layers: {
          "frame.number": [String(index + 1)],
          "frame.protocols": ["ip:tcp"],
          "ip.src": [`10.0.0.${index}`],
          "ip.dst": ["10.0.1.1"],
        },
      },
    }));
    const result = await parseTsharkJsonOutput(JSON.stringify(packets));
    expect(result.endpoints).toHaveLength(11);
    expect(result.endpointCount).toBe(11); // 10 src + 1 dst
  });

  it.each([
    "",
    "not json",
    "{}",
    "null",
    "[null]",
    '[{"_source":{"layers":{"ip.src":[3]}}}]',
  ])("rejects malformed producer output %s", async (text) => {
    await expect(parseTsharkJsonOutput(text)).rejects.toMatchObject({
      _tag: "AnalysisProtocolError",
    });
  });
});

it.skipIf(process.platform === "win32")(
  "resolves Wireshark tools through native PATH traversal instead of a decoy directory",
  async () => {
    const root = await createTestTempDirectory("rea-wireshark-native-path-");
    const intended = join(root, "intended");
    await mkdir(join(intended, "nested"), { recursive: true });
    await symlink(join(intended, "nested"), join(root, "alias"));
    for (const directory of [root, intended])
      for (const tool of ["tshark", "capinfos"])
        await writeFile(join(directory, tool), "", { mode: 0o755 });
    const selected = resolvePcapTools({ PATH: `${root}/alias/..` });
    for (const tool of ["tshark", "capinfos"] as const)
      expect(await realpath(selected[tool].command)).toBe(join(intended, tool));
    expect(() => resolvePcapTools({ PATH: `${root}/missing/..` })).toThrow(
      /tshark was not found/u,
    );
  },
);
