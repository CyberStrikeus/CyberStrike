import { observeElfStringTableEntry } from "../../domain/elfStringTable.js";
import { BinaryFormatFailure } from "./BinaryContainer.js";

export const readElfString = (bytes: Buffer, offset: number): string => {
  return readElfStringBytes(bytes, offset).toString("latin1");
};

/** Read exact string-table bytes; ELF does not prescribe a character encoding. */
export const readElfStringBytes = (bytes: Buffer, offset: number): Buffer => {
  const observed = observeElfStringTableEntry(bytes, offset, 65536);
  if (observed.state === "outside")
    throw new BinaryFormatFailure(
      "malformed",
      "ELF string offset is outside its string table",
    );
  if (observed.state === "truncated")
    throw new BinaryFormatFailure(
      "malformed",
      "ELF string is unterminated or exceeds the string budget",
    );
  return observed.bytes;
};
