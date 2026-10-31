import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  execute,
  failedCommand,
  options,
  source,
  spell,
  tool,
} from "./esp-image-tools.mjs";

// Optional verification tools only; the runtime reader starts no tool.
const idf = process.env.REA_ESP_IDF_PATH;
const python = process.env.REA_ESPTOOL_PYTHON ?? "python3";
const generator = () =>
  join(idf, "components", "partition_table", "gen_esp32part.py");
const environment = () => ({ ...process.env, IDF_PATH: idf });

/** Check the ESP-IDF checkout before any work and report its version. */
export const checkEspIdf = async () => {
  if (idf === undefined)
    throw new Error(
      "verify:esp-flash needs an ESP-IDF checkout for gen_esp32part.py and otatool.py; set REA_ESP_IDF_PATH",
    );
  try {
    await access(generator());
    await access(join(idf, "components", "app_update", "otatool.py"));
    const version = await readFile(
      join(idf, "tools", "cmake", "version.cmake"),
      "utf8",
    );
    const part = (name) =>
      new RegExp(`IDF_VERSION_${name} (\\d+)`, "u").exec(version)?.[1];
    return `v${part("MAJOR")}.${part("MINOR")}.${part("PATCH")}`;
  } catch (failure) {
    throw new Error(
      `verify:esp-flash needs gen_esp32part.py, otatool.py and tools/cmake/version.cmake under REA_ESP_IDF_PATH (${idf}). ${failure.message}`,
      { cause: failure },
    );
  }
};

/** Build a binary table from CSV with ESP-IDF's generator. */
export const buildTable = (csv, output, flags = []) =>
  execute(python, ["-I", generator(), "--quiet", ...flags, csv, output], {
    ...options,
    env: environment(),
  });

const bytesOf = (text) => {
  const value = text.trim();
  if (value.endsWith("M")) return Number(value.slice(0, -1)) * 0x10_0000;
  if (value.endsWith("K")) return Number(value.slice(0, -1)) * 0x400;
  return Number(value);
};

/** ESP-IDF's own reading of a binary table, as the CSV it prints. */
export const decodeTable = async (binary) => {
  const { stdout } = await execute(python, ["-I", generator(), binary], {
    ...options,
    env: environment(),
  });
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => {
      const [name, type, subtype, offset, size, flags = ""] = line
        .split(",")
        .map((field) => field.trim());
      return {
        name,
        type,
        subtype,
        offset: bytesOf(offset),
        size: bytesOf(size),
        encrypted: flags.split(":").includes("encrypted"),
        readonly: flags.split(":").includes("readonly"),
      };
    });
};

/** Run otatool against a dump file through the conformance shim. */
export const otatool = async (image, flashOffset, args) => {
  const run = await execute(
    python,
    [
      "-I",
      source("flash_file_tool.py"),
      image,
      `0x${flashOffset.toString(16)}`,
      "otatool",
      ...args,
    ],
    { ...options, env: environment() },
  ).then(
    ({ stdout, stderr }) => `${stdout}${stderr}`,
    failedCommand(`otatool ${args.join(" ")}`),
  );
  return run;
};

/** The two records otatool read_otadata prints. */
export const readOtadata = async (image, flashOffset, tableOffset) => {
  const text = await otatool(image, flashOffset, [
    "--partition-table-offset",
    `0x${tableOffset.toString(16)}`,
    "read_otadata",
  ]);
  const row =
    /Firmware:\s+0x([0-9a-f]{8})\s+0x([0-9a-f]{8})\s*\|\s*0x([0-9a-f]{8})\s+0x([0-9a-f]{8})/u.exec(
      text,
    );
  assert.ok(row, `Unrecognized read_otadata output: ${text}`);
  return [
    { seq: Number.parseInt(row[1], 16), crc: Number.parseInt(row[2], 16) },
    { seq: Number.parseInt(row[3], 16), crc: Number.parseInt(row[4], 16) },
  ];
};

/** Assemble a flash image with esptool merge-bin. */
export const mergeBin = (chip, output, parts, flags = []) =>
  tool("esptool", [
    "--chip",
    chip,
    spell("merge_bin", "merge-bin"),
    "-o",
    output,
    ...flags,
    ...parts.flatMap(({ at, file }) => [`0x${at.toString(16)}`, file]),
  ]);

export const padTo = (size) => [
  spell("--fill-flash-size", "--pad-to-size"),
  size,
];
