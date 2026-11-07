/** UTF-8 JSON string bytes without serialization; above budget only establishes overflow. */
export const jsonStringByteLength = (
  value: string,
  budget = Number.POSITIVE_INFINITY,
): number => {
  let bytes = 2;
  for (let index = 0; index < value.length && bytes <= budget; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0x22 || unit === 0x5c) bytes += 2;
    else if (unit < 0x20)
      bytes +=
        unit === 0x08 ||
        unit === 0x09 ||
        unit === 0x0a ||
        unit === 0x0c ||
        unit === 0x0d
          ? 2
          : 6;
    else if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 6;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
};
