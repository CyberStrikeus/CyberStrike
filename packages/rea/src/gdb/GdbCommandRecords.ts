/** Snapshot ordered MI records and retain their raw stream encodings. */
export const snapshotGdbCommandRecords = (records: readonly string[]) => {
  const snapshot = [...records];
  return {
    records: snapshot,
    console: snapshot.filter((line) => line.startsWith("~")).join("\n"),
    target: snapshot.filter((line) => line.startsWith("@")).join("\n"),
    log: snapshot.filter((line) => line.startsWith("&")).join("\n"),
  };
};
