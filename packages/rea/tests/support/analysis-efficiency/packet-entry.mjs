import { isDeepStrictEqual, promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

export const verifyPacketPage = (first, next, oracle) => {
  if (
    first.artifact.sha256 !== oracle.sha256 ||
    next.artifact.sha256 !== oracle.sha256 ||
    first.output_window.matching_packets !== oracle.matching_packets ||
    next.output_window.matching_packets !== oracle.matching_packets ||
    !isDeepStrictEqual(
      packetFacts("postgres", first).rows,
      oracle.rows.slice(0, 12),
    ) ||
    !isDeepStrictEqual(
      packetFacts("postgres", next).rows,
      oracle.rows.slice(12, 24),
    )
  )
    throw new Error(
      "Packet pages differ from independently parsed original matches",
    );
};

export const PACKET_ARTIFACTS = {
  "wireshark-pgsql-jdbc.pcap": {
    kind: "postgres",
    fields: ["tcp.srcport", "tcp.dstport", "tcp.flags"],
    extra: ["tcp.len"],
    protocol: "tcp",
    query: "tcp.flags",
    discovered: "tcp.flags",
    filter: "tcp.port == 5432",
  },
  "wireshark-dns.cap": {
    kind: "dns",
    fields: [
      "dns.id",
      "dns.flags.response",
      "dns.flags.rcode",
      "dns.qry.name",
      "dns.qry.type",
    ],
    extra: ["dns.resp.name", "dns.resp.ttl", "udp.srcport", "udp.dstport"],
    protocol: "dns",
    query: "dns.flags.rcode",
    discovered: "dns.flags.rcode",
    filter: "dns.flags.response == 1 && dns.flags.rcode != 0",
  },
  "wireshark-dhcp.pcap": {
    kind: "dhcp",
    fields: [
      "dhcp.id",
      "dhcp.option.dhcp",
      "dhcp.ip.your",
      "dhcp.option.dhcp_server_id",
    ],
    extra: [
      "dhcp.type",
      "dhcp.ip.client",
      "dhcp.hw.mac_addr",
      "udp.srcport",
      "udp.dstport",
    ],
    protocol: "dhcp",
    query: "Option 53:",
    discovered: "dhcp.option.dhcp",
    filter: "dhcp",
  },
};

export const packetRequest = (artifact, path, selection) => {
  const descriptor = PACKET_ARTIFACTS[artifact];
  if (!descriptor) throw new Error("Unknown pinned packet question");
  const baseline = selection === "baseline";
  return {
    path,
    fields: baseline
      ? [...descriptor.fields, ...descriptor.extra]
      : descriptor.fields,
    display_filter:
      descriptor.kind === "postgres" && baseline
        ? `${descriptor.filter} && frame.number <= 2000`
        : descriptor.kind === "dns" && baseline
          ? "dns"
          : descriptor.filter,
    ...(descriptor.kind === "postgres" && !baseline
      ? { packet_limit: 2000, match_limit: 12 }
      : {}),
  };
};

const number = (row, field) => {
  const value = row[field];
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !/^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(value[0])
  )
    throw new Error(`Expected one recorded integer for ${field}`);
  const parsed = Number(value[0]);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`Unsafe recorded integer for ${field}`);
  return parsed;
};

export const packetFacts = (kind, report) => {
  let packets = report.packets;
  if (kind === "postgres") packets = packets.slice(0, 12);
  if (kind === "dns")
    packets = packets.filter(
      (row) =>
        number(row, "dns.flags.response") === 1 &&
        number(row, "dns.flags.rcode") !== 0,
    );
  return {
    kind,
    matching_packets:
      kind === "dns" ? packets.length : report.output_window.matching_packets,
    rows: packets.map((row) => {
      const frame = number(row, "frame.number");
      if (kind === "postgres")
        return {
          frame,
          source_port: number(row, "tcp.srcport"),
          destination_port: number(row, "tcp.dstport"),
          flags: number(row, "tcp.flags"),
        };
      if (kind === "dns") {
        const names = row["dns.qry.name"];
        const types = row["dns.qry.type"];
        if (
          !Array.isArray(names) ||
          names.length === 0 ||
          !Array.isArray(types) ||
          types.length !== names.length
        )
          throw new Error(
            "The fixed DNS question requires recorded names and types; missing fields are unknown",
          );
        return {
          frame,
          id: number(row, "dns.id"),
          rcode: number(row, "dns.flags.rcode"),
          names,
          types: types.map((value) => number({ type: [value] }, "type")),
        };
      }
      const server = row["dhcp.option.dhcp_server_id"];
      const address = row["dhcp.ip.your"];
      if (
        !Array.isArray(address) ||
        address.length !== 1 ||
        (server !== undefined &&
          (!Array.isArray(server) || server.length !== 1))
      )
        throw new Error("Expected recorded DHCP address scalar");
      return {
        frame,
        id: number(row, "dhcp.id"),
        message_type: number(row, "dhcp.option.dhcp"),
        your_address: address[0],
        ...(server === undefined ? {} : { server_identifier: server[0] }),
      };
    }),
  };
};

export const measurePacketEntry = async ({
  values,
  call,
  inputSha,
  catalogDefinitions,
}) => {
  const descriptor = PACKET_ARTIFACTS[values.artifact];
  const { parseEvidence } = await import(
    pathToFileURL(resolve(values["runtime-root"], "dist/domain/evidence.js"))
      .href
  );
  const { inspectPacketCaptureInputSchema, packetCaptureSchema } = await import(
    pathToFileURL(
      resolve(values["runtime-root"], "dist/domain/captures/packetCapture.js"),
    ).href
  );
  const { inspectPacketFieldsInputSchema, packetFieldsCatalogSchema } =
    await import(
      pathToFileURL(
        resolve(values["runtime-root"], "dist/domain/captures/packetFields.js"),
      ).href
    );
  const observations = [];
  const selection = values["packet-selection"];
  const checked = (evidence, operation, input, schema) => {
    parseEvidence(evidence);
    const report = schema.parse(evidence.normalized_result);
    if (
      evidence.operation !== operation ||
      !isDeepStrictEqual(evidence.parameters, input) ||
      !isDeepStrictEqual(report.selection, input)
    )
      throw new Error(
        "Packet Evidence operation or choices differs from the request",
      );
    if (
      operation === "inspect_packet_capture" &&
      (evidence.subject?.local_path !== values.path ||
        evidence.subject?.digest?.sha256 !== inputSha ||
        report.artifact.path !== values.path ||
        report.artifact.sha256 !== inputSha)
    )
      throw new Error("Packet Evidence identifies different capture bytes");
    if (
      operation === "inspect_packet_fields" &&
      (evidence.subject?.local_path !== report.tool.path ||
        evidence.subject?.digest?.sha256 !== report.tool.sha256)
    )
      throw new Error("Field discovery identifies a different executable");
    observations.push({
      evidence_id: evidence.evidence_id,
      operation,
      selection: report.selection,
      output_window: report.output_window,
      read_scope: report.read_scope ?? null,
      limitations: evidence.limitations,
    });
    return report;
  };
  if (selection === "discovery") {
    const input = inspectPacketFieldsInputSchema.parse({
      kind: "fields",
      protocol: descriptor.protocol,
      query: descriptor.query,
      limit: 1,
    });
    const found = checked(
      await call("inspect_packet_fields", input),
      "inspect_packet_fields",
      input,
      packetFieldsCatalogSchema,
    );
    if (
      !found.records.some((row) => row.abbreviation === descriptor.discovered)
    )
      throw new Error(
        "Selected installation does not advertise the required protocol field",
      );
  }
  const input = inspectPacketCaptureInputSchema.parse(
    packetRequest(values.artifact, values.path, selection),
  );
  for (const name of [
    "inspect_packet_capture",
    ...(selection === "discovery" ? ["inspect_packet_fields"] : []),
  ])
    if (!catalogDefinitions.has(name))
      throw new Error(`Missing live packet contract ${name}`);
  const report = checked(
    await call("inspect_packet_capture", input),
    "inspect_packet_capture",
    input,
    packetCaptureSchema,
  );
  const facts = packetFacts(descriptor.kind, report);
  if (selection === "pages") {
    const { stdout } = await promisify(execFile)(
      "python3",
      [
        fileURLToPath(new URL("./packet-oracle.py", import.meta.url)),
        "postgres",
        values.path,
        "--row-limit",
        "24",
      ],
      { timeout: 30_000, maxBuffer: 128 * 1024 },
    );
    const oracle = JSON.parse(stdout);
    const nextInput = inspectPacketCaptureInputSchema.parse({
      ...input,
      match_offset: 12,
    });
    const next = checked(
      await call("inspect_packet_capture", nextInput),
      "inspect_packet_capture",
      nextInput,
      packetCaptureSchema,
    );
    const repeated = checked(
      await call("inspect_packet_capture", input),
      "inspect_packet_capture",
      input,
      packetCaptureSchema,
    );
    verifyPacketPage(report, next, oracle);
    if (
      !isDeepStrictEqual(report.packets, repeated.packets) ||
      !isDeepStrictEqual(report.output_window, repeated.output_window) ||
      next.artifact.sha256 !== report.artifact.sha256 ||
      next.output_window.matching_packets !==
        report.output_window.matching_packets ||
      Number(next.packets[0]?.["frame.number"]?.[0]) <=
        Number(report.packets.at(-1)?.["frame.number"]?.[0])
    )
      throw new Error(
        "Packet page order, digest or repeated observations changed",
      );
  }
  return {
    artifact_sha256: inputSha,
    facts,
    delivery_observations: observations,
    evidence_ids: [...new Set(observations.map((row) => row.evidence_id))],
  };
};
