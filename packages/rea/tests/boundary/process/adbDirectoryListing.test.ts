import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { adbResultSchemas } from "../../../src/domain/adb/adbDeviceAnalysis.js";
import {
  ADB_DIRECTORY_BATCH_SCRIPT,
  parseAdbDirectoryListing,
} from "../../../src/adb/AdbDirectoryListing.js";

const execFileAsync = promisify(execFile);
const itPosix = it.skipIf(process.platform === "win32");

// AOSP Toybox stat's documented %A/%U/%G/%s/%y conversions are fixed-format
// metadata fields. This shim models those fields from host lstat data; it does
// not claim to exercise an Android device's Toybox binary.
const statShim = String.raw`#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STAT_CALLS, args.slice(2).length + '\n');
const fail = process.env.STAT_FAIL_PATH;
for (const path of args.slice(2)) {
  if (path === fail) {
    process.stdout.write('-rw-r--r--|1000|1000|1|2026-10-12 00:00:00\n');
    process.exit(1);
  }
  const stat = fs.lstatSync(path);
  const kind = stat.isSymbolicLink() ? 'l' : stat.isDirectory() ? 'd' : '-';
  const permissions = kind + 'rw-r--r--';
  process.stdout.write(permissions + '|1000|1000|' + stat.size + '|2026-10-12 00:00:00\n');
}`;

const readlinkShim = String.raw`#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.READLINK_CALLS, 'called\n');
process.stdout.write(fs.readlinkSync(process.argv[3]));
`;

const makeTool = async (directory: string, name: string, contents: string) => {
  const path = join(directory, name);
  await writeFile(path, contents);
  await chmod(path, 0o755);
  return path;
};

const shellQuote = (value: string): string =>
  "'" + value.replaceAll("'", "'\\''") + "'";

const makeFakeAdb = async (
  directory: string,
  toolDirectory: string,
  calls: string,
  linkCalls: string,
) => {
  const path = join(directory, "fakeadb");
  await writeFile(
    path,
    `#!/bin/sh
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-stub\\nInstalled as %s\\n' "$0"
  exit 0
fi
if [ "$1" = -s ]; then shift 2; fi
[ "$1" = shell ] || exit 90
shift
export PATH=${shellQuote(`${toolDirectory}:` + (process.env.PATH ?? ""))}
export STAT_CALLS=${shellQuote(calls)}
export READLINK_CALLS=${shellQuote(linkCalls)}
exec /bin/sh -c "$*"
`,
    { mode: 0o755 },
  );
  await chmod(path, 0o755);
  return path;
};

const makeRawOutputFakeAdb = async (
  directory: string,
  rawOutput: Buffer,
): Promise<string> => {
  const path = join(directory, "fakeadb-raw-output");
  const encoded = rawOutput.toString("base64");
  await writeFile(
    path,
    `#!/bin/sh
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-stub\\nInstalled as %s\\n' "$0"
  exit 0
fi
if [ "$1" = -s ]; then shift 2; fi
[ "$1" = shell ] || exit 90
exec ${shellQuote(process.execPath)} -e 'process.stdout.write(Buffer.from("${encoded}", "base64"))'
`,
    { mode: 0o755 },
  );
  await chmod(path, 0o755);
  return path;
};

const runScript = async (
  script: string,
  paths: readonly string[],
  environment: NodeJS.ProcessEnv,
) => {
  const { stdout } = await execFileAsync(
    "/bin/sh",
    ["-c", script, "rea-list-directory", ...paths],
    { encoding: "buffer", env: environment, maxBuffer: 64 * 1024 },
  );
  return stdout;
};

itPosix(
  "lists adversarial names through the complete adb provider command",
  async () => {
    const root = await createTestTempDirectory("rea-adb-directory-listing-");
    const bin = join(root, "bin");
    const deviceDirectory = join(root, "device dir ' $");
    await mkdir(bin);
    await mkdir(deviceDirectory);
    const calls = join(root, "stat-calls");
    const linkCalls = join(root, "readlink-calls");
    await writeFile(calls, "");
    await writeFile(linkCalls, "");
    await makeTool(bin, "stat", statShim);
    await makeTool(bin, "readlink", readlinkShim);

    const names = [
      "line\nbreak",
      "arrow -> tick` quote' space",
      "carriage\r雪",
      "tail\n",
      ".hidden",
    ];
    const paths: string[] = [];
    for (const name of names) {
      const path = join(deviceDirectory, name);
      await writeFile(path, "x");
      paths.push(path);
    }
    const nested = join(deviceDirectory, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "ghost"), "not a direct child");
    paths.push(nested);
    const target = "target -> `quoted'\n雪\n";
    const link = join(deviceDirectory, "link\nname");
    await symlink(target, link);
    paths.push(link);
    const binary = await makeFakeAdb(root, bin, calls, linkCalls);

    const execution = await new AdbProvider({
      environment: { REA_ADB_PATH: binary },
    }).execute({
      operation: "list_adb_directory",
      input: { serial: "test-device", device_path: deviceDirectory },
    });
    if (!execution.ok) throw execution.error;
    const result = adbResultSchemas.list_adb_directory.parse(
      execution.value.result,
    );
    expect(result.device_path).toBe(deviceDirectory);
    expect(result.unparsed_lines).toEqual([]);
    expect(result.coverage).toBe("complete");
    expect(result.entries.map((entry) => entry.name).sort()).toEqual(
      [...names, "nested", "link\nname"].sort(),
    );
    expect(
      result.entries.find((entry) => entry.name === "link\nname"),
    ).toMatchObject({
      kind: "symlink",
      bytes: expect.any(Number),
      link_target: target,
    });
    expect(
      result.entries.filter((entry) => entry.kind !== "symlink"),
    ).toHaveLength(names.length + 1);
    expect(
      result.entries.some((entry) => entry.name === "." || entry.name === ".."),
    ).toBe(false);
    expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual([
      String(paths.length),
    ]);
    expect((await readFile(linkCalls, "utf8")).trim().split("\n")).toEqual([
      "called",
    ]);
  },
);

itPosix(
  "discards a failed stat batch instead of pairing shortened rows with later names",
  async () => {
    const root = await createTestTempDirectory(
      "rea-adb-directory-stat-failure-",
    );
    const bin = join(root, "bin");
    await mkdir(bin);
    const calls = join(root, "stat-calls");
    const linkCalls = join(root, "readlink-calls");
    await writeFile(calls, "");
    await writeFile(linkCalls, "");
    await makeTool(bin, "stat", statShim);
    await makeTool(bin, "readlink", readlinkShim);
    const first = join(root, "first");
    const omitted = join(root, "omitted");
    const last = join(root, "last");
    await Promise.all(
      [first, omitted, last].map((path) => writeFile(path, "x")),
    );

    const output = await runScript(
      ADB_DIRECTORY_BATCH_SCRIPT,
      [first, omitted, last],
      {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        STAT_CALLS: calls,
        READLINK_CALLS: linkCalls,
        STAT_FAIL_PATH: omitted,
      },
    ).catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        "stdout" in cause &&
        Buffer.isBuffer(cause.stdout)
      )
        return cause.stdout;
      throw cause;
    });
    expect(parseAdbDirectoryListing(output)).toEqual({
      entries: [],
      unparsedLines: { sample: [], total: 0 },
    });
    expect((await readFile(calls, "utf8")).trim()).toBe("3");
  },
);

itPosix(
  "preserves distinct invalid UTF-8 filenames as partial evidence",
  async () => {
    const root = await createTestTempDirectory(
      "rea-adb-directory-invalid-utf8-",
    );
    const deviceDirectory = join(root, "device");
    await mkdir(deviceDirectory);
    const invalidNames = [Buffer.from([0xff]), Buffer.from([0xfe])];

    // macOS rejects raw invalid-UTF-8 path bytes with EILSEQ, so fake adb
    // returns the exact producer bytes while U+FFFD remains a valid record.
    const metadata = Buffer.from(
      "-rw-r--r--|1000|1000|1|2026-10-12 00:00:00\0",
    );
    const records = [
      ...invalidNames.map((name) =>
        Buffer.concat([metadata, name, Buffer.from("\0\0")]),
      ),
      Buffer.concat([metadata, Buffer.from("\ufffd"), Buffer.from("\0\0")]),
    ];
    const rawOutput = Buffer.concat(records);
    const binary = await makeRawOutputFakeAdb(root, rawOutput);
    const execution = await new AdbProvider({
      environment: { REA_ADB_PATH: binary },
    }).execute({
      operation: "list_adb_directory",
      input: { serial: "test-device", device_path: deviceDirectory },
    });
    if (!execution.ok) throw execution.error;
    const result = adbResultSchemas.list_adb_directory.parse(
      execution.value.result,
    );

    expect(result.entries.map((entry) => entry.name)).toEqual(["\ufffd"]);
    expect(result.coverage).toBe("partial");
    expect(result.unparsed_lines).toHaveLength(2);
    for (const invalidName of invalidNames) {
      const malformedRecord = Buffer.concat([
        metadata,
        invalidName,
        Buffer.from("\0\0"),
      ]).toString("hex");
      expect(
        result.unparsed_lines.some((line) => line.includes(malformedRecord)),
      ).toBe(true);
    }
  },
);
