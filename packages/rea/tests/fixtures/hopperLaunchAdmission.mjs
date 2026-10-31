import { readFile, writeFile } from "node:fs/promises";

// Model the native helper's external GUI handoff independently of its lifetime.
const [modePath, receiptPath] = process.argv.slice(2, 4);
const mode = await readFile(modePath, "utf8");
const bootstrapIndex = process.argv.indexOf("-Y") + 1;
if (bootstrapIndex === 0) throw new Error("Missing Hopper bootstrap argument");
const bootstrapPath = process.argv[bootstrapIndex];
await writeFile(receiptPath, bootstrapPath);
const writeDiagnostic = (text) =>
  new Promise((resolve, reject) => {
    process.stderr.write(text, (cause) => (cause ? reject(cause) : resolve()));
  });
if (mode === "denied" || mode === "denied-after-handoff") {
  await writeDiagnostic(
    "Cannot launch Hopper!\nNot authorized to send Apple events to Hopper Disassembler.\n",
  );
  if (mode === "denied-after-handoff") {
    // A real native helper can create a document before emitting this same
    // diagnostic when caller literals alter its AppleScript construction.
    await writeFile(`${receiptPath}.document-created`, "unconfirmed");
  }
  process.exit(2);
} else if (mode === "not-found") {
  // A custom wrapper can forward the native diagnostic after a handoff.
  await writeFile(`${receiptPath}.document-created`, "unconfirmed");
  await writeDiagnostic(
    "Hopper has not been found.\nPlease make sure that Spotlight is active in order for this tool to find Hopper's executable.\n",
  );
  process.exit(3);
} else if (mode === "handoff") {
  process.exit(0);
} else if (mode === "bridge") {
  await import("./fakeLauncher.mjs");
} else {
  throw new Error(`Unknown Hopper launch admission fixture mode: ${mode}`);
}
