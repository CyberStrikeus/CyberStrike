import { promises as fs } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const path = process.env.REA_TEST_EXPORT_INPUT;
const marker = process.env.REA_TEST_EXPORT_READ_MARKER;
const action = process.env.REA_TEST_EXPORT_READ_ACTION;
if (!path || !marker || !["append", "record", "fail-copy"].includes(action))
  throw new Error("Expected an explicit export input, read marker and action");

// Instrument only the selected real descriptor in this disposable CLI process.
// Reads and metadata checks remain the production filesystem operations.
const open = fs.open;
fs.open = async (...args) => {
  const handle = await open(...args);
  if (args[0] !== path) return handle;
  const read = handle.read.bind(handle);
  let recorded = false;
  let hashed = false;
  handle.read = async (...readArgs) => {
    if (action === "fail-copy" && hashed) {
      await fs.writeFile(marker, "copy");
      throw Object.assign(new Error("controlled pathless descriptor failure"), {
        code: "EIO",
        syscall: "read",
      });
    }
    const result = await read(...readArgs);
    if (action === "fail-copy") {
      hashed = result.bytesRead === 0;
      return result;
    }
    if (!recorded) {
      recorded = true;
      await fs.writeFile(marker, "read");
      if (action === "append") await fs.appendFile(path, " ");
    }
    return result;
  };
  return handle;
};
syncBuiltinESMExports();
