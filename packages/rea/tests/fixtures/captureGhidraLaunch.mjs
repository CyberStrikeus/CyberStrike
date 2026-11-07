#!/usr/bin/env node

import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const arguments_ = process.argv.slice(2);
const descriptorPath = arguments_.at(-1);
if (descriptorPath === undefined) process.exit(64);
const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
const runtimeRoot = dirname(descriptorPath);
const capturePath = join(runtimeRoot, "launch-capture.json");
await writeFile(
  capturePath,
  `${JSON.stringify({
    arguments: arguments_,
    environment: {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      TMPDIR: process.env.TMPDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      GHIDRA_HEADLESS_MAXMEM: process.env.GHIDRA_HEADLESS_MAXMEM,
      GHIDRA_HEADLESS_JAVA_OPTIONS: process.env.GHIDRA_HEADLESS_JAVA_OPTIONS,
      GHIDRA_JAVA_OPTIONS: process.env.GHIDRA_JAVA_OPTIONS,
      JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS,
      JDK_JAVA_OPTIONS: process.env.JDK_JAVA_OPTIONS,
      _JAVA_OPTIONS: process.env._JAVA_OPTIONS,
      JAVA_HOME: process.env.JAVA_HOME,
      PATH: process.env.PATH,
      REA_PROCESS_RUN_ID: process.env.REA_PROCESS_RUN_ID,
    },
    descriptor_mode: (await stat(descriptorPath)).mode & 0o777,
    descriptor_has_token: typeof descriptor.token === "string",
  })}\n`,
  { mode: 0o600 },
);
// A Windows private runtime retains directory handles that restrict renames.
// Publish readiness only after writeFile has closed the complete JSON capture.
await writeFile(`${capturePath}.ready`, "", { flag: "wx", mode: 0o600 });
setInterval(() => undefined, 1_000);
