function toCsv(notes) {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return (
    [
      "id,title",
      ...notes.map((note) => `${note.id},${quote(note.title)}`),
    ].join("\n") + "\n"
  );
}

module.exports = { toCsv };
