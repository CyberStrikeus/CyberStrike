document.querySelector("#export").addEventListener("click", async () => {
  const status = document.querySelector("#status");
  try {
    const response = await fetch("./notes.json");
    if (!response.ok)
      throw new Error(`Notes request failed: ${response.status}`);
    const { notes } = await response.json();
    const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const csv =
      [
        "id,title",
        ...notes.map((note) => `${note.id},${quote(note.title)}`),
      ].join("\n") + "\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "notes.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Exported ${notes.length} notes to notes.csv.`;
  } catch (error) {
    status.textContent = error.message;
  }
});
