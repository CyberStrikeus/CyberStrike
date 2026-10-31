import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, basename, resolve } from "node:path";
const root = process.env.REA_CLEANUP_PROBE_ROOT;
const trace = process.env.REA_CLEANUP_PROBE_TRACE;
const mode = process.env.REA_CLEANUP_PROBE_MODE;
const selected = process.env.REA_CLEANUP_PROBE_INPUT;
let removals = 0;
let deniedInput = false;
const record = (value) =>
  fs.appendFileSync(trace, JSON.stringify(value) + "\n");
const rm = fs.promises.rm.bind(fs.promises);
fs.promises.rm = async (path, ...args) => {
  const value = resolve(String(path));
  if (dirname(value) !== root || !basename(value).startsWith("rea-wabt-"))
    return rm(path, ...args);
  const deny =
    (mode === "runtime-once" && removals++ === 0) ||
    (mode === "runtime-until-allowed" && !fs.existsSync(root + "/allow"));
  if (deny) {
    record({
      kind: "runtime",
      path: value,
      denied: true,
      exists: fs.existsSync(value),
    });
    throw Object.assign(new Error("authored runtime cleanup denial"), {
      code: "EACCES",
    });
  }
  await rm(path, ...args);
  record({
    kind: "runtime",
    path: value,
    denied: false,
    exists: fs.existsSync(value),
  });
};
const open = fs.promises.open.bind(fs.promises);
fs.promises.open = async (path, ...args) => {
  const handle = await open(path, ...args);
  if (mode === "input-once" && resolve(String(path)) === selected) {
    const close = handle.close.bind(handle);
    const descriptor = handle.fd;
    handle.close = async () => {
      if (!deniedInput) {
        deniedInput = true;
        record({
          kind: "input-close",
          path: selected,
          descriptor,
          denied: true,
        });
        throw Object.assign(new Error("authored descriptor cleanup denial"), {
          code: "EACCES",
        });
      }
      await close();
      record({
        kind: "input-close",
        path: selected,
        descriptor,
        denied: false,
      });
    };
  }
  return handle;
};
syncBuiltinESMExports();
