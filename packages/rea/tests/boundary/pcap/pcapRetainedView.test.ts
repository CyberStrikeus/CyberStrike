import { dnsResponseLayers } from "../../fixtures/pcap/pcapTestTools.js";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const createPcapToolFixture = async (root: string) => {
  const path = join(root, "caller capture.pcap");
  const bytes = Buffer.from("recording fixture bytes");
  const sha = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path, bytes);
  const tshark = join(root, "tshark");
  const capinfos = join(root, "capinfos");
  const marker = join(root, "reads");
  const frames = Array.from({ length: 132 }, (_, index) => ({
    _source: {
      layers: {
        "frame.number": [String(index + 1)],
        "frame.protocols": ["ip:udp:dns"],
        "ip.src": ["192.0.2.1"],
        "ip.dst": ["192.0.2.2"],
        "dns.qry.name": ["many.example"],
        "dns.flags.response": ["True"],
        "dns.a": [`198.51.100.${index}`],
        "dns.qry.type": ["1"],
        "dns.qry.class": ["0x0001"],
        "dns.count.queries": ["1"],
        "dns.count.answers": ["1"],
        "dns.count.auth_rr": ["0"],
        "dns.count.add_rr": ["0"],
        "dns.resp.name": ["many.example"],
        "dns.resp.type": ["1"],
        "dns.resp.class": ["0x0001"],
        "tls.handshake.extensions_server_name": [`host${index}.example`],
        "http.request.full_uri": [
          "http://user:password@example.invalid/p?q=keep",
        ],
      },
    },
  }));
  const dnsFrames = Array.from({ length: 132 }, (_, index) => ({
    _source: {
      layers: {
        frame: { "frame.number": String(index + 1) },
        ...dnsResponseLayers("many.example", `198.51.100.${index}`),
      },
    },
  }));
  await writeFile(
    tshark,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'TShark (Wireshark) 4.6.6-emulated\\n'; exit 0; fi\nprintf 'read\\n' >> ${quote(marker)}\ncase " $* " in *" -x "*) printf '%s' ${quote(JSON.stringify(dnsFrames))}; exit 0 ;; esac\nprintf '%s' ${quote(JSON.stringify(frames))}\nprintf 'retained warning' >&2\n`,
    { mode: 0o755 },
  );
  await writeFile(
    capinfos,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'Capinfos (Wireshark) 4.6.6-emulated\\n'; exit 0; fi\nprintf '%s\\n' ${quote(`File type: pcap\nFile encapsulation: Ethernet\nPacket size limit: file hdr: 262144 bytes\nPacket size limit: inferred: 128 bytes\nNumber of packets: 132\nSHA256: ${sha}`)}\n`,
    { mode: 0o755 },
  );
  const environment = {
    REA_TSHARK_COMMAND: tshark,
    REA_CAPINFOS_COMMAND: capinfos,
  };
  return { path, marker, environment };
};

// Native tools are emulated here; this proves the production CLI/MCP boundary,
// retention and paging, not Wireshark's real dissector semantics.
it.runIf(process.platform === "linux")(
  "retains every fact and pages late DNS/SNI rows after source deletion without another tool launch",
  async () => {
    const root = await createTestTempDirectory("rea-pcap-view-");
    const { path, marker, environment } = await createPcapToolFixture(root);
    const complete = await promisify(execFile)(
      process.execPath,
      [
        join(import.meta.dirname, "../../../scripts/rea.mjs"),
        "inspect-pcap-capture",
        path,
        "--json",
      ],
      { env: { ...process.env, ...environment } },
    );
    const parent = parseEvidence(JSON.parse(complete.stdout));
    expect(parent.normalized_result).toMatchObject({
      snapshot_length: 262144,
      tls_sni_count: 132,
      tls_sni_values: expect.arrayContaining(["host131.example"]),
      dns_queries: [{ query: "many.example", response_address_count: 132 }],
    });
    expect(JSON.stringify(parent)).not.toContain("user:password");
    const { call } = await connectLocalToolsMcp(environment);
    const response = await call("inspect_pcap_capture", {
      path,
      detail: "summary",
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const summary = parseEvidence(response.structuredContent).normalized_result;
    expect(summary).toMatchObject({
      parent_evidence_id: parent.evidence_id,
      summary: {
        snapshot_length: 262144,
        tls_sni_count: 132,
        dns_query_count: 1,
        retained_counts: { tls_sni_values: 132 },
        diagnostics_code_units: { tshark: 16, capinfos: 0 },
      },
    });
    expect(JSON.stringify(summary)).not.toContain("host131.example");
    await rm(path);
    const source = {
      kind: "retained-evidence",
      evidence_id: parent.evidence_id,
    };
    const before = await readFile(marker, "utf8");
    const cases = [
      [
        { kind: "pcap", facet: "endpoints", limit: 1 },
        { items: [{ address: "192.0.2.1", packet_count: 132 }] },
      ],
      [
        { kind: "pcap", facet: "dns-queries", limit: 1 },
        {
          items: [
            { query: "many.example", retained_response_address_count: 132 },
          ],
        },
      ],
      [
        {
          kind: "pcap",
          facet: "dns-addresses",
          query: "many.example",
          offset: 130,
          limit: 2,
        },
        { items: ["198.51.100.130", "198.51.100.131"] },
      ],
      [
        { kind: "pcap", facet: "tls-sni", offset: 130, limit: 2 },
        { items: ["host130.example", "host131.example"] },
      ],
      [
        { kind: "pcap", facet: "protocols" },
        { items: [{ protocol: "ip:udp:dns", packet_count: 132 }] },
      ],
      [
        { kind: "pcap", facet: "http-uris" },
        { items: ["http://example.invalid/p?q=keep"] },
      ],
      [{ kind: "pcap", facet: "unattributed-addresses" }, { items: [] }],
      [
        {
          kind: "pcap",
          facet: "diagnostics",
          stream: "tshark",
          offset: 9,
          limit: 7,
        },
        { text: "warning", status: "retained" },
      ],
    ] as const;
    for (const [view, expected] of cases) {
      const response = await call("inspect_analysis_view", { source, view });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expect(
        parseEvidence(response.structuredContent).normalized_result,
      ).toMatchObject({ page: expected, source_coverage: "complete" });
    }
    const workflow = join(root, "portable.json");
    const view = {
      kind: "pcap",
      facet: "dns-addresses",
      query: "many.example",
      offset: 130,
      limit: 2,
    };
    await writeFile(
      workflow,
      JSON.stringify({ source: { kind: "inline", evidence: parent }, view }),
    );
    const portable = await promisify(execFile)(process.execPath, [
      join(import.meta.dirname, "../../../scripts/rea.mjs"),
      "inspect-analysis-view",
      workflow,
      "--json",
    ]);
    const retained = parseEvidence(
      (await call("inspect_analysis_view", { source, view })).structuredContent,
    );
    expect(
      parseEvidence(JSON.parse(portable.stdout)).normalized_result,
    ).toEqual(retained.normalized_result);
    expect(await readFile(marker, "utf8")).toBe(before);
    expect(
      parseMcpToolError(
        await call("inspect_analysis_view", {
          source,
          view: {
            kind: "pcap",
            facet: "dns-addresses",
            query: "missing.example",
          },
        }),
      ),
    ).toMatchObject({ error: { code: "invalid_request" } });
  },
  60_000,
);
