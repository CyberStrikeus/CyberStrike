const concat = (...parts: Buffer[]): Buffer => Buffer.concat(parts);

const u32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

const pad4 = (bytes: Buffer): Buffer => {
  const pad = (4 - (bytes.length % 4)) % 4;
  return pad === 0 ? bytes : concat(bytes, Buffer.alloc(pad));
};

const chunk = (name: string, payload: Buffer): Buffer =>
  concat(Buffer.from(name, "latin1"), u32(payload.length), pad4(payload));

const atoms = (names: readonly string[], utf8 = true): Buffer => {
  const body = concat(
    u32(names.length),
    ...names.map((name) => {
      const encoded = Buffer.from(name, utf8 ? "utf8" : "latin1");
      return concat(Buffer.from([encoded.length]), encoded);
    }),
  );
  return chunk(utf8 ? "AtU8" : "Atom", body);
};

const table = (name: string, rows: readonly (readonly number[])[]): Buffer => {
  const payload = concat(
    u32(rows.length),
    ...rows.flatMap((row) => row.map(u32)),
  );
  return chunk(name, payload);
};

/** Inert structural container with exact chunk payloads, not executable code. */
export const erlangBeamChunksFixture = (
  chunks: readonly (readonly [name: string, payload: Buffer])[],
): Buffer => {
  const form = concat(
    Buffer.from("BEAM", "latin1"),
    ...chunks.map(([name, payload]) => chunk(name, payload)),
  );
  return concat(Buffer.from("FOR1", "latin1"), u32(form.length), form);
};

/** Legacy atom/export container, with an optional exact AtU8 alternate payload. */
export const erlangBeamLegacyAtomsFixture = (utf8Payload?: Buffer): Buffer => {
  const chunks = concat(
    atoms(["demo", "ÿ"], false),
    utf8Payload === undefined ? Buffer.alloc(0) : chunk("AtU8", utf8Payload),
    table("ExpT", [[2, 0, 1]]),
  );
  const form = concat(Buffer.from("BEAM", "latin1"), chunks);
  return concat(Buffer.from("FOR1", "latin1"), u32(form.length), form);
};

/** Hand-authored BEAM IFF with AtU8, Code, ExpT, ImpT and FunT chunks. */
export const erlangBeamFixture = (module = "beam_fixture"): Buffer => {
  const atomNames = [
    module,
    "module_info",
    "start",
    "erlang",
    "get_module_info",
  ];
  const codeHeader = concat(
    u32(16),
    u32(0),
    u32(169),
    u32(4),
    u32(2),
    Buffer.from("code"),
  );
  const chunks = concat(
    atoms(atomNames),
    chunk("Code", codeHeader),
    table("ExpT", [
      [3, 0, 2],
      [2, 0, 1],
      [2, 1, 3],
    ]),
    table("ImpT", [[4, 5, 1]]),
    table("FunT", [[3, 1, 4, 0, 0, 42]]),
  );
  const form = concat(Buffer.from("BEAM", "latin1"), chunks);
  return concat(Buffer.from("FOR1", "latin1"), u32(form.length), form);
};

/** BEAM form that declares table counts and does not store row bodies. */
export const erlangBeamDeclaredRowsFixture = (
  counts: readonly (readonly [string, number])[],
): Buffer => {
  const chunks = concat(
    ...counts.map(([name, count]) => chunk(name, u32(count))),
  );
  const form = concat(Buffer.from("BEAM", "latin1"), chunks);
  return concat(Buffer.from("FOR1", "latin1"), u32(form.length), form);
};

/** BEAM form whose atom table exceeds a caller-selected atom budget. */
export const erlangBeamManyAtomsFixture = (count: number): Buffer => {
  const names = Array.from(
    { length: count },
    (_, index) => `a${String(index)}`,
  );
  const chunks = atoms(names);
  const form = concat(Buffer.from("BEAM", "latin1"), chunks);
  return concat(Buffer.from("FOR1", "latin1"), u32(form.length), form);
};

/**
 * Compiler-produced BEAM: `erlc +deterministic` from Erlang/OTP 29 (compiler
 * 10.0.2), which writes the OTP 28+ compact AtU8 layout. Source:
 *
 *     -module(rea_beam_fixture).
 *     -export([hello/1]).
 *     hello(Name) -> lists:reverse(Name).
 */
export const erlangBeamOtp29Fixture = (): Buffer =>
  Buffer.from(
    [
      "Rk9SMQAAAixCRUFNQXRVOAAAAE3////5CBByZWFfYmVhbV9maXh0dXJlUGhlbGxv",
      "UGxpc3RzcHJldmVyc2WwbW9kdWxlX2luZm9gZXJsYW5n8GdldF9tb2R1bGVfaW5m",
      "bwAAAENvZGUAAABFAAAAEAAAAAAAAAC1AAAABwAAAAMBEJkQAhIiEAEgThAAATCZ",
      "AAISUgABQEASA04QEAFQmQACElIQAWBAAxNAEgNOICADAAAAU3RyVAAAAABJbXBU",
      "AAAAKAAAAAMAAAADAAAABAAAAAEAAAAGAAAABwAAAAEAAAAGAAAABwAAAAJFeHBU",
      "AAAAKAAAAAMAAAAFAAAAAQAAAAYAAAAFAAAAAAAAAAQAAAACAAAAAQAAAAJNZXRh",
      "AAAALYNsAAAAAWgCdxBlbmFibGVkX2ZlYXR1cmVzbAAAAAF3Cm1heWJlX2V4cHJq",
      "agAAAExvY1QAAAAEAAAAAEF0dHIAAAAng2wAAAABaAJ3A3ZzbmwAAAABbhAAVsr2",
      "2jNBkgUGfacAt0GWcGpqAENJbmYAAAAbg2wAAAABaAJ3B3ZlcnNpb25rAAYxMC4w",
      "LjJqAERiZ2kAAABCg2gDdw1kZWJ1Z19pbmZvX3YxdxFlcmxfYWJzdHJhY3RfY29k",
      "ZWgCdwRub25lbAAAAAF3DWRldGVybWluaXN0aWNqAABMaW5lAAAAFQAAAAAAAAAA",
      "AAAAAwAAAAEAAAAAMQAAAFR5cGUAAAAKAAAABAAAAAEf/wAA",
    ].join(""),
    "base64",
  );
