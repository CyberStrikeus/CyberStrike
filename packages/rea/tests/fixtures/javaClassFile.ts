/** Build a valid minimal JVM class file, optionally with an unused UTF-8 constant. */
export const javaClassFile = (
  extraUtf8Bytes = 0,
  fatCpuLookalike = false,
): Buffer => {
  const utf8 = (value: string): Buffer => {
    const bytes = Buffer.from(value, "utf8");
    const entry = Buffer.alloc(3 + bytes.length);
    entry[0] = 1;
    entry.writeUInt16BE(bytes.length, 1);
    bytes.copy(entry, 3);
    return entry;
  };
  const constants = [
    Buffer.from([7, 0, 2]),
    utf8("Hello"),
    Buffer.from([7, 0, 4]),
    utf8("java/lang/Object"),
    ...(fatCpuLookalike ? [utf8("x"), Buffer.from([3, 0, 0, 0, 7])] : []),
    ...(extraUtf8Bytes === 0 ? [] : [utf8("x".repeat(extraUtf8Bytes))]),
  ];
  const headerAndPool = Buffer.alloc(10);
  headerAndPool.writeUInt32BE(0xcafebabe, 0);
  headerAndPool.writeUInt16BE(0, 4);
  headerAndPool.writeUInt16BE(65, 6);
  headerAndPool.writeUInt16BE(constants.length + 1, 8);
  const classBody = Buffer.alloc(14);
  [0x21, 1, 3, 0, 0, 0, 0].forEach((value, index) =>
    classBody.writeUInt16BE(value, index * 2),
  );
  return Buffer.concat([headerAndPool, ...constants, classBody]);
};
