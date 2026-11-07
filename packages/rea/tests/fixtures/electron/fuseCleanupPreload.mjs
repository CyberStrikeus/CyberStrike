import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const selected = process.env.REA_FUSE_PROBE_INPUT;
const trace = process.env.REA_FUSE_PROBE_TRACE;
const mode = process.env.REA_FUSE_PROBE_MODE;
const allow = process.env.REA_FUSE_PROBE_ALLOW;
const record = (value) =>
  fs.appendFileSync(trace, JSON.stringify(value) + "\n");
const open = fs.promises.open.bind(fs.promises);
const held = new Map();
let attempts = 0;
fs.promises.open = async (path, ...args) => {
  const handle = await open(path, ...args);
  if (String(path) !== selected) return handle;
  const descriptor = handle.fd;
  const close = handle.close.bind(handle);
  held.set(handle, { descriptor });
  record({ kind: "open", path: selected, descriptor });
  if (mode === "read-and-close-once")
    handle.read = async () => {
      throw Object.assign(new Error("authored physical read denial"), {
        code: "EACCES",
      });
    };
  handle.close = async () => {
    const denied =
      (mode.endsWith("once") && attempts++ === 0) ||
      (mode === "deny-until-allowed" && !fs.existsSync(allow));
    if (denied) {
      record({ kind: "close", descriptor, denied: true });
      throw Object.assign(new Error("authored descriptor close denial"), {
        code: "EACCES",
      });
    }
    await close();
    held.delete(handle);
    record({ kind: "close", descriptor, denied: false });
  };
  return handle;
};
syncBuiltinESMExports();
process.on("exit", () => {
  for (const [handle, { descriptor }] of held) {
    if (handle.fd !== descriptor) continue;
    fs.fstatSync(descriptor);
    record({ kind: "probe-final-release", descriptor });
    fs.closeSync(descriptor);
  }
});
