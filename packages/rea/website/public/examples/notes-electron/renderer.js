async function exportNotes() {
  const destination = await window.notes.exportCsv();
  document.querySelector("#status").textContent = `Saved to ${destination}`;
}

document.querySelector("#export").addEventListener("click", () => {
  exportNotes().catch((cause) => {
    document.querySelector("#status").textContent = "Export failed";
    console.error("Notes export failed", cause);
  });
});
