import { open } from "node:fs/promises";
import { posix } from "node:path";

/** Memory facts for the cgroup v2 group that holds this process. */
export interface LinuxCgroupMemoryState {
  /** Group path from `/proc/self/cgroup`, relative to the cgroup2 hierarchy root. */
  readonly path: string;
  /**
   * Hierarchical `oom_kill` count from `memory.events`. The kernel charges an
   * OOM kill to the victim's group and every ancestor, so a kill of any
   * process in this group or a child group raises it, whichever limit was
   * reached. Other processes can share this group.
   */
  readonly oomKills: number;
  /**
   * This group's `memory.max`: bytes, `max` when the group sets no limit, or
   * null when it could not be read. A limit on a parent group is not read.
   */
  readonly memoryMax: number | "max" | null;
}

/** One cgroup2 mount from `/proc/self/mountinfo`. */
export interface LinuxCgroup2Mount {
  /** Hierarchy path that the mount exposes at its mount point. */
  readonly root: string;
  readonly mountPoint: string;
}

const KERNEL_FILE_BYTES = 16 * 1024;
/** Hosts with many container layers publish long mount tables. */
const MOUNT_INFO_BYTES = 4 * 1024 * 1024;

/** Read the single cgroup v2 (`0::`) row of one `/proc/<pid>/cgroup` record. */
export const parseLinuxCgroupV2Path = (value: string): string | undefined => {
  let path: string | undefined;
  for (const line of value.split("\n")) {
    if (!line.startsWith("0::")) continue;
    if (path !== undefined) return undefined;
    path = line.slice(3);
  }
  if (path === undefined || !path.startsWith("/")) return undefined;
  return path.split("/").includes("..") ? undefined : path;
};

/** Read the single `oom_kill` counter of one cgroup v2 `memory.events` file. */
export const parseLinuxCgroupOomKills = (value: string): number | undefined => {
  let count: number | undefined;
  for (const line of value.split("\n")) {
    const match = /^oom_kill ([0-9]+)$/u.exec(line);
    if (match === null) continue;
    if (count !== undefined) return undefined;
    count = Number(match[1]);
  }
  return count !== undefined && Number.isSafeInteger(count) ? count : undefined;
};

/** Read one cgroup v2 `memory.max` file; `max` means no limit. */
export const parseLinuxCgroupMemoryMax = (
  value: string,
): number | "max" | undefined => {
  const token = value.trim();
  if (token === "max") return "max";
  if (!/^[0-9]+$/u.test(token)) return undefined;
  const bytes = Number(token);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
};

/** Decode the octal escapes the kernel writes for space, tab, newline and backslash. */
const mountInfoField = (value: string): string =>
  value.replace(/\\([0-7]{3})/gu, (_match, code: string) =>
    String.fromCharCode(Number.parseInt(code, 8)),
  );

/** List the cgroup2 mounts of one `/proc/<pid>/mountinfo` record. */
export const parseLinuxCgroup2Mounts = (
  value: string,
): readonly LinuxCgroup2Mount[] =>
  value.split("\n").flatMap((line) => {
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    const root = fields[3];
    const mountPoint = fields[4];
    if (
      separator < 6 ||
      fields[separator + 1] !== "cgroup2" ||
      root === undefined ||
      mountPoint === undefined
    )
      return [];
    return [
      { root: mountInfoField(root), mountPoint: mountInfoField(mountPoint) },
    ];
  });

/**
 * Locate a cgroup path below the mount whose root covers it most closely; a
 * mount that exposes only part of the hierarchy is joined from its own root.
 */
export const linuxCgroupDirectory = (
  mounts: readonly LinuxCgroup2Mount[],
  path: string,
): string | undefined => {
  let selected:
    | { readonly mount: LinuxCgroup2Mount; readonly rest: string }
    | undefined;
  for (const mount of mounts) {
    const rest =
      mount.root === "/"
        ? path
        : path === mount.root
          ? "/"
          : path.startsWith(`${mount.root}/`)
            ? path.slice(mount.root.length)
            : undefined;
    if (rest === undefined) continue;
    if (
      selected === undefined ||
      mount.root.length > selected.mount.root.length
    )
      selected = { mount, rest };
  }
  return selected === undefined
    ? undefined
    : posix.resolve(selected.mount.mountPoint, `.${selected.rest}`);
};

/**
 * Observe this process's cgroup v2 memory group. Unavailable on other
 * platforms, under cgroup v1, or when the files are unreadable.
 */
export const readLinuxCgroupMemoryState = async (
  options: {
    readonly platform?: NodeJS.Platform;
    readonly procCgroupPath?: string;
    readonly procMountInfoPath?: string;
  } = {},
): Promise<LinuxCgroupMemoryState | undefined> => {
  if ((options.platform ?? process.platform) !== "linux") return undefined;
  const membership = await readKernelFile(
    options.procCgroupPath ?? "/proc/self/cgroup",
  );
  const path =
    membership === undefined ? undefined : parseLinuxCgroupV2Path(membership);
  if (path === undefined) return undefined;
  const mountInfo = await readKernelFile(
    options.procMountInfoPath ?? "/proc/self/mountinfo",
    MOUNT_INFO_BYTES,
  );
  const group =
    mountInfo === undefined
      ? undefined
      : linuxCgroupDirectory(parseLinuxCgroup2Mounts(mountInfo), path);
  if (group === undefined) return undefined;
  const events = await readKernelFile(posix.join(group, "memory.events"));
  const oomKills =
    events === undefined ? undefined : parseLinuxCgroupOomKills(events);
  if (oomKills === undefined) return undefined;
  const limit = await readKernelFile(posix.join(group, "memory.max"));
  return {
    path,
    oomKills,
    memoryMax:
      limit === undefined ? null : (parseLinuxCgroupMemoryMax(limit) ?? null),
  };
};

/**
 * Read a kernel report to EOF within a fixed budget; procfs may return it in
 * several short reads. Absent on any failure or when the budget is exceeded.
 */
const readKernelFile = async (
  path: string,
  maxBytes = KERNEL_FILE_BYTES,
): Promise<string | undefined> => {
  try {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      let length = 0;
      for (;;) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
        if (length > maxBytes) return undefined;
      }
      return buffer.subarray(0, length).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
};
