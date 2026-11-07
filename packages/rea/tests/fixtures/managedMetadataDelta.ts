import { buildManagedPeFixture } from "../../src/dotnet/ManagedPe.fixture.js";
import { readManagedPeLayout } from "../../src/dotnet/ManagedPeReader.js";

const align4 = (size: number): number => Math.ceil(size / 4) * 4;

/**
 * Authored minimal EnC metadata carried by an ordinary PE fixture shell.
 * Matches runtime v9.0.0 MetadataBuilder/MetadataSizes: #- and empty #JTD,
 * wide references despite small local tables, Module and EncMap rows.
 * MethodDef physical row 1 maps to baseline token 0x06000002. This does not
 * establish CLR loadability or execute an Edit-and-Continue operation.
 */
export const managedMetadataDelta = () => {
  const bytes = buildManagedPeFixture({ targetFramework: null });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Fixture omitted CLI metadata");
  const rootOffset = pe.rvaToOffset(
    pe.cli.metadata.rva,
    pe.cli.metadata.size,
    "fixture metadata",
  );
  const strings = Buffer.from("\0Delta.dll\0Updated\0");
  const tables = Buffer.alloc(align4(24 + 3 * 4 + 18 + 20 + 2 * 4 + 1));
  tables[4] = 2;
  tables[6] = 7;
  tables[7] = 1;
  tables.writeBigUInt64LE(1n | (1n << 6n) | (1n << 31n), 8);
  tables.writeUInt32LE(1, 24); // Module
  tables.writeUInt32LE(1, 28); // MethodDef
  tables.writeUInt32LE(2, 32); // EncMap
  tables.writeUInt16LE(1, 36); // Module.Generation
  tables.writeUInt32LE(1, 38); // Module.Name
  tables.writeUInt32LE(1, 42); // MVID
  tables.writeUInt32LE(2, 46); // EncId
  tables.writeUInt32LE(3, 50); // EncBaseId
  tables.writeUInt16LE(0x0086, 54 + 6); // MethodDef.Flags
  tables.writeUInt32LE(strings.indexOf("Updated"), 54 + 8);
  tables.writeUInt32LE(1, 54 + 12); // Signature
  tables.writeUInt32LE(1, 54 + 16); // ParamList, four bytes even with no Param rows
  tables.writeUInt32LE(0x0000_0001, 74); // EncMap: Module
  tables.writeUInt32LE(0x0600_0002, 78); // EncMap: MethodDef in baseline coordinates
  const streams = [
    { name: "#-", data: tables },
    { name: "#Strings", data: strings },
    { name: "#US", data: Buffer.from([0]) },
    { name: "#GUID", data: Buffer.alloc(48, 0x41) },
    { name: "#Blob", data: Buffer.from([0, 3, 0, 0, 1]) },
    { name: "#JTD", data: Buffer.alloc(0) },
  ];
  const headerSize =
    32 +
    streams.reduce((sum, { name }) => sum + 8 + align4(name.length + 1), 0);
  const metadata = Buffer.alloc(
    headerSize +
      streams.reduce((sum, { data }) => sum + align4(data.length), 0),
  );
  metadata.writeUInt32LE(0x424a_5342);
  metadata.writeUInt16LE(1, 4);
  metadata.writeUInt16LE(1, 6);
  metadata.writeUInt32LE(12, 12);
  metadata.write("v4.0.30319", 16);
  metadata.writeUInt16LE(streams.length, 30);
  let header = 32;
  let content = headerSize;
  let markerOffset = 0;
  for (const { name, data } of streams) {
    metadata.writeUInt32LE(content, header);
    metadata.writeUInt32LE(align4(data.length), header + 4);
    metadata.write(name, header + 8);
    metadata.set(data, content);
    if (name === "#JTD") markerOffset = rootOffset + header;
    header += 8 + align4(name.length + 1);
    content += align4(data.length);
  }
  bytes.set(metadata, rootOffset);
  bytes.writeUInt32LE(metadata.length, pe.cli.headerOffset + 12);
  return { bytes, markerOffset };
};
