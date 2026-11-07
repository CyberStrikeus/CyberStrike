/** Owned offline Ethernet/IPv4/TCP fixture; no traffic or external input. */
export const offlineHttpCapture = (
  uri: string,
  packets = 1,
  host: string | null = "example.test",
): Buffer => {
  if (!Number.isSafeInteger(packets) || packets < 1 || packets > 40_000)
    throw new RangeError("Offline test captures support 1..40000 packets");
  const payload = Buffer.from(
    `GET ${uri} HTTP/${host === null ? "1.0" : "1.1"}\r\n${host === null ? "" : `Host: ${host}\r\n`}Connection: close\r\n\r\n`,
  );
  const checksum = (bytes: Buffer): number => {
    let total = 0;
    for (let index = 0; index < bytes.length; index += 2)
      total += ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
    while (total >>> 16) total = (total & 0xffff) + (total >>> 16);
    return ~total & 0xffff;
  };
  const source = Buffer.from([192, 0, 2, 1]);
  const destination = Buffer.from([198, 51, 100, 2]);
  const tcp = Buffer.alloc(20);
  tcp.writeUInt16BE(44000, 0);
  tcp.writeUInt16BE(80, 2);
  tcp.writeUInt32BE(1, 4);
  tcp.writeUInt32BE(1, 8);
  tcp.writeUInt16BE(0x5018, 12);
  tcp.writeUInt16BE(65535, 14);
  const pseudo = Buffer.concat([
    source,
    destination,
    Buffer.from([0, 6, 0, 0]),
  ]);
  pseudo.writeUInt16BE(tcp.length + payload.length, 10);
  tcp.writeUInt16BE(checksum(Buffer.concat([pseudo, tcp, payload])), 16);
  const ip = Buffer.alloc(20);
  ip[0] = 0x45;
  ip.writeUInt16BE(ip.length + tcp.length + payload.length, 2);
  ip.writeUInt16BE(1, 4);
  ip[8] = 64;
  ip[9] = 6;
  source.copy(ip, 12);
  destination.copy(ip, 16);
  ip.writeUInt16BE(checksum(ip), 10);
  const ethernet = Buffer.from([2, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 1, 8, 0]);
  const frame = Buffer.concat([ethernet, ip, tcp, payload]);
  const record = Buffer.alloc(16 + frame.length);
  record.writeUInt32LE(1_700_000_000, 0);
  record.writeUInt32LE(frame.length, 8);
  record.writeUInt32LE(frame.length, 12);
  frame.copy(record, 16);
  const capture = Buffer.alloc(24 + packets * record.length);
  capture.writeUInt32LE(0xa1b2c3d4, 0);
  capture.writeUInt16LE(2, 4);
  capture.writeUInt16LE(4, 6);
  capture.writeUInt32LE(65535, 16);
  capture.writeUInt32LE(1, 20);
  for (let index = 0; index < packets; index++)
    record.copy(capture, 24 + index * record.length);
  return capture;
};
