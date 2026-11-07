import { buildManagedNestedTypeFixture } from "../../src/dotnet/ManagedPe.fixture.js";
import { readManagedPeLayout } from "../../src/dotnet/ManagedPeReader.js";
import {
  metadataRowOffset,
  readManagedMetadataLayout,
} from "../../src/dotnet/ManagedMetadataLayout.js";
import {
  metadataRowCursor,
  readMetadataBlob,
} from "../../src/dotnet/ManagedMetadataHeaps.js";
import { readMethodDefinitionRow } from "../../src/dotnet/ManagedMethodDefinitionRows.js";

/** Two nested Inner declarations, one with its own Fixture namespace. */
export const namespaceBearingNestedTypes = () => {
  const bytes = buildManagedNestedTypeFixture();
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Missing fixture CLI");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "fixture"),
    pe.cli.metadata.size,
  );
  const column = 4 + layout.stringIndexSize;
  const namespace = bytes.readUInt16LE(
    metadataRowOffset(layout, 2, 2) + column,
  );
  bytes.writeUInt16LE(namespace, metadataRowOffset(layout, 2, 4) + column);
  return bytes;
};

/** Same selected display, different enclosing owner, primitive signatures and CIL. */
export const distinctSelectedNestedOwners = () => {
  const left = namespaceBearingNestedTypes();
  const right = Buffer.from(left);
  for (const [index, bytes] of [left, right].entries()) {
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("Missing fixture CLI");
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "fixture"),
      pe.cli.metadata.size,
    );
    const method = readMethodDefinitionRow(bytes, layout, 1);
    if (index === 1) {
      bytes.writeUInt16LE(3, metadataRowOffset(layout, 41, 1) + 2);
      readMetadataBlob(
        bytes,
        layout,
        method.signatureIndex,
        layout.blob!.size,
      )[2] = 0x0a;
      const field = metadataRowCursor(bytes, layout, 4, 1);
      field.readUInt16();
      field.readIndex(layout.stringIndexSize);
      readMetadataBlob(
        bytes,
        layout,
        field.readIndex(layout.blobIndexSize),
        layout.blob!.size,
      )[1] = 0x0a;
    }
    // All three MethodDefs share this fixture body and signature. Tiny bodies
    // avoid unresolved MemberRefs and keep the two signatures and shapes distinct.
    const body =
      index === 0
        ? Buffer.from([0x0a, 0x17, 0x2a])
        : Buffer.from([0x2a, 0x21, 2, 0, 0, 0, 0, 0, 0, 0, 0x2a]);
    bytes.set(body, pe.rvaToOffset(method.rva, body.length, "fixture CIL"));
  }
  return { left, right };
};
