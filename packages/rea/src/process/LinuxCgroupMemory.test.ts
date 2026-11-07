import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  linuxCgroupDirectory,
  parseLinuxCgroup2Mounts,
  parseLinuxCgroupMemoryMax,
  parseLinuxCgroupOomKills,
  parseLinuxCgroupV2Path,
  readLinuxCgroupMemoryState,
} from "./LinuxCgroupMemory.js";

const events = (oomKill: number) =>
  `low 0\nhigh 0\nmax 772\noom 3\noom_kill ${String(oomKill)}\noom_group_kill 0\n`;

it("reads the cgroup v2 row and ignores v1 controller rows", () => {
  expect(
    parseLinuxCgroupV2Path(
      "12:memory:/docker/abc\n0::/system.slice/rea.service\n",
    ),
  ).toBe("/system.slice/rea.service");
  expect(parseLinuxCgroupV2Path("0::/\n")).toBe("/");
});

it.each([
  "12:memory:/docker/abc\n",
  "0::/a\n0::/b\n",
  "0::relative\n",
  "0::/a/../b\n",
])("does not infer a cgroup v2 path from %j", (value) => {
  expect(parseLinuxCgroupV2Path(value)).toBeUndefined();
});

it("reads oom_kill without confusing it with oom or oom_group_kill", () => {
  expect(parseLinuxCgroupOomKills(events(1))).toBe(1);
  expect(parseLinuxCgroupOomKills("oom 3\noom_group_kill 2\n")).toBeUndefined();
  expect(parseLinuxCgroupOomKills("oom_kill 1\noom_kill 2\n")).toBeUndefined();
  expect(
    parseLinuxCgroupOomKills("oom_kill 9007199254740992\n"),
  ).toBeUndefined();
});

it("reads a byte limit and the unlimited token", () => {
  expect(parseLinuxCgroupMemoryMax("3221225472\n")).toBe(3_221_225_472);
  expect(parseLinuxCgroupMemoryMax("max\n")).toBe("max");
  expect(parseLinuxCgroupMemoryMax("3g\n")).toBeUndefined();
});

const mountInfoRow = (root: string, mountPoint: string, type = "cgroup2") =>
  `35 24 0:30 ${root} ${mountPoint} rw,nosuid,nodev,noexec,relatime shared:9 - ${type} cgroup2 rw,nsdelegate`;

it("lists cgroup2 mounts and decodes escaped paths", () => {
  const mounts = parseLinuxCgroup2Mounts(
    [
      "22 1 259:1 / / rw,relatime shared:1 - ext4 /dev/root rw",
      mountInfoRow("/jobs", "/sys/fs/cgroup"),
      mountInfoRow("/", "/mnt/cgroup\\040root"),
      "40 24 0:31 / /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory",
    ].join("\n"),
  );
  expect(mounts).toEqual([
    { root: "/jobs", mountPoint: "/sys/fs/cgroup" },
    { root: "/", mountPoint: "/mnt/cgroup root" },
  ]);
});

it("joins a cgroup path from the root of the mount that exposes it", () => {
  const full = { root: "/", mountPoint: "/mnt/full" };
  const subtree = { root: "/jobs", mountPoint: "/sys/fs/cgroup" };
  expect(linuxCgroupDirectory([subtree], "/jobs/rea")).toBe(
    "/sys/fs/cgroup/rea",
  );
  expect(linuxCgroupDirectory([subtree], "/jobs")).toBe("/sys/fs/cgroup");
  expect(linuxCgroupDirectory([full, subtree], "/jobs/rea")).toBe(
    "/sys/fs/cgroup/rea",
  );
  expect(linuxCgroupDirectory([full], "/jobs/rea")).toBe("/mnt/full/jobs/rea");
  expect(linuxCgroupDirectory([subtree], "/jobsite/rea")).toBeUndefined();
  expect(linuxCgroupDirectory([], "/rea")).toBeUndefined();
});

/** A cgroup2 mount whose root is `/jobs`, holding this process's group `/jobs/rea`. */
const cgroupTree = async (
  files: Readonly<Record<string, string>>,
  membership = "0::/jobs/rea\n",
) => {
  const root = await createTestTempDirectory("rea-cgroup-");
  const mountPoint = join(root, "cgroup");
  await mkdir(join(mountPoint, "rea"), { recursive: true });
  for (const [name, text] of Object.entries(files))
    await writeFile(join(mountPoint, "rea", name), text);
  const procCgroupPath = join(root, "proc-self-cgroup");
  await writeFile(procCgroupPath, membership);
  const procMountInfoPath = join(root, "proc-self-mountinfo");
  await writeFile(procMountInfoPath, `${mountInfoRow("/jobs", mountPoint)}\n`);
  return { platform: "linux" as const, procCgroupPath, procMountInfoPath };
};

it("reads the process's own group below a subtree cgroup2 mount", async () => {
  const options = await cgroupTree({
    "memory.events": events(1),
    "memory.max": "3221225472\n",
  });
  await expect(readLinuxCgroupMemoryState(options)).resolves.toEqual({
    path: "/jobs/rea",
    oomKills: 1,
    memoryMax: 3_221_225_472,
  });
});

it("keeps an unlimited group apart from an unreadable limit", async () => {
  const unlimited = await cgroupTree({
    "memory.events": events(0),
    "memory.max": "max\n",
  });
  await expect(readLinuxCgroupMemoryState(unlimited)).resolves.toMatchObject({
    memoryMax: "max",
  });
  const unreadable = await cgroupTree({ "memory.events": events(0) });
  await expect(readLinuxCgroupMemoryState(unreadable)).resolves.toEqual({
    path: "/jobs/rea",
    oomKills: 0,
    memoryMax: null,
  });
});

it("is unavailable without memory.events, a covering mount, cgroup v2, or Linux", async () => {
  const noEvents = await cgroupTree({ "memory.max": "max\n" });
  await expect(readLinuxCgroupMemoryState(noEvents)).resolves.toBeUndefined();
  const outside = await cgroupTree(
    { "memory.events": events(0) },
    "0::/system.slice/rea.service\n",
  );
  await expect(readLinuxCgroupMemoryState(outside)).resolves.toBeUndefined();
  const v1 = await cgroupTree(
    { "memory.events": events(0) },
    "4:memory:/jobs/rea\n",
  );
  await expect(readLinuxCgroupMemoryState(v1)).resolves.toBeUndefined();
  const linux = await cgroupTree({ "memory.events": events(0) });
  await expect(
    readLinuxCgroupMemoryState({ ...linux, platform: "darwin" }),
  ).resolves.toBeUndefined();
});
