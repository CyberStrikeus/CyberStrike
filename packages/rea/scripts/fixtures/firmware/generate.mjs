import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(
  process.env.REA_FIRMWARE_FIXTURE_ROOT ??
    "_reference/firmware-integration/generated",
);
for (const [command, args, purpose] of [
  [
    process.env.REA_FIRMWARE_PYTHON ?? "python3",
    ["--version"],
    "Python 3 standard-library fixture generator",
  ],
  [
    process.env.REA_FIRMWARE_CC ?? "cc",
    ["--version"],
    "host ELF fixture compiler",
  ],
]) {
  try {
    await exec(command, args);
  } catch (cause) {
    throw new Error(`fixtures:firmware requires ${purpose}: ${command}`, {
      cause,
    });
  }
}
const ext4 =
  process.env.REA_FIRMWARE_VERIFY_EXT4 === "1"
    ? [process.env.REA_FIRMWARE_MKE2FS_COMMAND ?? "mke2fs"]
    : [];
for (const command of ext4) await exec(command, ["-V"]);
const generated = await exec(process.env.REA_FIRMWARE_PYTHON ?? "python3", [
  fileURLToPath(new URL("./generate.py", import.meta.url)),
  root,
  process.env.REA_FIRMWARE_CC ?? "cc",
  ...ext4,
]);
console.log(generated.stdout.trim());
