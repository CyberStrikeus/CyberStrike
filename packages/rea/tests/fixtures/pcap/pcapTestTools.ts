import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const CAPINFOS_OUTPUT = [
  "File name:           /work/capture.pcap",
  "File type:           Wireshark/tcpdump/... - pcap",
  "File encapsulation:  Ethernet",
  "Packet size limit:   file hdr: 262144 bytes",
  "Packet size limit:   inferred: 128 bytes - 256 bytes (range)",
  "Number of packets:   3",
  "Capture duration:    0.123 seconds",
  "Earliest packet time: 1791728020.608505",
  "Latest packet time:   1791728020.981978",
].join("\n");

/** Synthetic complete UDP A response; bytes own identity, tree owns display. */
export const dnsResponseLayers = (query: string, address: string) => {
  const name = Buffer.concat([
    ...query
      .split(".")
      .map((label) =>
        Buffer.concat([
          Buffer.from([Buffer.byteLength(label)]),
          Buffer.from(label),
        ]),
      ),
    Buffer.from([0]),
  ]);
  const bytes = Buffer.concat([
    Buffer.from("000181800001000100000000", "hex"),
    name,
    Buffer.from("00010001c00c000100010000003c0004", "hex"),
    Buffer.from(address.split(".").map(Number)),
  ]);
  return {
    dns_raw: [bytes.toString("hex"), 42, bytes.length, 0, 1],
    dns: {
      "dns.id_raw": ["0001", 42, 2, 0, 5],
      Queries: { question: { "dns.qry.name": query } },
      Answers: { answer: { "dns.a": address } },
    },
  };
};

export const TSHARK_JSON = JSON.stringify([
  {
    _source: {
      layers: {
        "frame.number": ["1"],
        "frame.protocols": ["eth:ethertype:ip:udp:dns"],
        "ip.src": ["192.168.1.100"],
        "ip.dst": ["8.8.8.8"],
        "dns.qry.name": ["api.example.com"],
        "dns.a": ["93.184.216.34"],
      },
    },
  },
  {
    _source: {
      layers: {
        "frame.number": ["2"],
        "frame.protocols": ["eth:ethertype:ip:tcp:tls"],
        "ip.src": ["192.168.1.100"],
        "ip.dst": ["93.184.216.34"],
        "tls.handshake.extensions_server_name": ["api.example.com"],
      },
    },
  },
  {
    _source: {
      layers: {
        "frame.number": ["3"],
        "frame.protocols": ["eth:ethertype:ip:tcp:http"],
        "ip.src": ["192.168.1.100"],
        "ip.dst": ["93.184.216.34"],
        "http.request.full_uri": ["http://api.example.com/v1/data"],
      },
    },
  },
]);

export const TSHARK_DNS_JSON = JSON.stringify([
  {
    _source: {
      layers: {
        frame: { "frame.number": "1" },
        ...dnsResponseLayers("api.example.com", "93.184.216.34"),
      },
    },
  },
]);

export interface PcapStubToolsOptions {
  readonly failCapinfos?: boolean;
  readonly malformedDnsJson?: boolean;
  readonly dnsJson?: string;
  readonly tsharkJson?: string;
  readonly capinfosText?: string;
  readonly httpAbsoluteUriOnly?: boolean;
  readonly http2Uri?: boolean;
  readonly invalidTsharkStream?: "stdout" | "stderr";
  readonly invalidTsharkVersionStream?: "stdout" | "stderr";
  readonly invalidCapinfosStream?: "stdout" | "stderr";
  readonly invalidCapinfosVersionStream?: "stdout" | "stderr";
  readonly literalReplacement?: boolean;
  readonly literalTsharkVersion?: boolean;
}

/** Write caller-selected POSIX tool stubs for pcap provider and adapter tests. */
export const writeStubTools = async (
  root: string,
  options: PcapStubToolsOptions = {},
): Promise<{ tshark: string; capinfos: string }> => {
  const tshark = join(root, "tshark");
  const capinfos = join(root, "capinfos");
  const tsharkOutput = options.http2Uri
    ? TSHARK_JSON.replace(
        '"http.request.full_uri":["http://api.example.com/v1/data"]',
        '"http2.request.full_uri":["http://example.test/h2"],"http2.headers.path":["/h2"]',
      ).replace('eth:ethertype:ip:tcp:http"', 'eth:ethertype:ip:tcp:http2"')
    : options.literalReplacement
      ? TSHARK_JSON.replace(
          "http://api.example.com/v1/data",
          "http://api.example.com/�",
        )
      : options.httpAbsoluteUriOnly
        ? TSHARK_JSON.replace(
            '"http.request.full_uri":["http://api.example.com/v1/data"]',
            '"http.request.uri":["http://proxy.example.test/path"]',
          )
        : TSHARK_JSON;
  await writeFile(
    tshark,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'TShark (Wireshark) 4.6.6${options.literalTsharkVersion ? "�" : ""}-stub\\n'
  ${options.invalidTsharkVersionStream === "stdout" ? `printf '\\377'` : options.invalidTsharkVersionStream === "stderr" ? `printf '\\377' >&2` : ""}
  exit 0
fi
[ "$1" = "-n" ] && [ "$2" = "-r" ] && [ "$4" = "-T" ] && [ "$5" = "json" ] || exit 2
case " $* " in
  *" -x "*)
    case " $* " in *" --no-duplicate-keys "*) ;; *) exit 2 ;; esac
    case " $* " in *" -J frame dns mdns llmnr "*) ;; *) exit 2 ;; esac
    case " $* " in *" -Y dns || mdns || llmnr "*) ;; *) exit 2 ;; esac
    printf '%s' '${(options.malformedDnsJson ? "{" : (options.dnsJson ?? TSHARK_DNS_JSON)).replace(/'/gu, "'\\''")}'
    exit 0
    ;;
  *)
    case " $* " in *" -e http.request.uri "*) ;; *) exit 2 ;; esac
    case " $* " in *" -e http2.request.full_uri "*) ;; *) exit 2 ;; esac
    case " $* " in *" -e http2.headers.path "*) ;; *) exit 2 ;; esac
    ;;
esac
${options.invalidTsharkStream === "stdout" ? `printf '%s' '[{"_source":{"layers":{"frame.number":["1"],"frame.protocols":["eth:ip:tcp:http"],"http.request.full_uri":["http://example.test/'; printf '\\377'; printf '%s' '"]}}}]'` : `printf '%s' '${(options.tsharkJson ?? tsharkOutput).replace(/'/gu, "'\\''")}'`}
${options.invalidTsharkStream === "stderr" ? `printf '\\377' >&2` : ""}
exit 0
`,
    { mode: 0o755 },
  );
  await writeFile(
    capinfos,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'Capinfos (Wireshark) 4.6.6-stub\\n'
  ${options.invalidCapinfosVersionStream === "stdout" ? `printf '\\377'` : options.invalidCapinfosVersionStream === "stderr" ? `printf '\\377' >&2` : ""}
  exit 0
fi
[ "$1" = "-M" ] && [ "$2" = "-S" ] && [ "$3" = "--" ] && [ "$#" = "4" ] || exit 2
if [ "${String(options.failCapinfos === true)}" = "true" ]; then
  printf 'capinfos: The file is not a capture file' >&2; exit 1
fi
${options.invalidCapinfosStream === "stdout" ? `printf '\\377'` : options.invalidCapinfosStream === "stderr" ? `printf '\\377' >&2` : `printf '%s\\n' '${(options.capinfosText ?? CAPINFOS_OUTPUT).replace(/'/gu, "'\\''")}'`}
exit 0
`,
    { mode: 0o755 },
  );
  await chmod(tshark, 0o755);
  await chmod(capinfos, 0o755);
  return { tshark, capinfos };
};
