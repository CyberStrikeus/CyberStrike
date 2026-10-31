import { readFile, readdir, stat } from "node:fs/promises";
import { basename } from "node:path";

// CPython's interface option ends interpreter parsing; following values are
// script arguments. -W/-X consume either an attached value or the next operand.
// https://docs.python.org/3.12/using/cmdline.html
const pythonScriptOperand = (arguments_) => {
  for (let index = 1; index < arguments_.length; index++) {
    const option = arguments_[index];
    if (option === "--") return arguments_[index + 1];
    if (option === "-" || option === "") return undefined;
    if (!option.startsWith("-")) return option;
    if (option === "--check-hash-based-pycs") {
      index++;
      continue;
    }
    if (/^--(?:help(?:-env|-xoptions|-all)?|version)$/u.test(option))
      return undefined;
    if (option.startsWith("--"))
      throw new Error(`Unknown Python helper invocation option: ${option}`);
    for (let character = 1; character < option.length; character++) {
      const flag = option[character];
      if ("cmh?V".includes(flag)) return undefined;
      if (flag === "W" || flag === "X") {
        if (character === option.length - 1) index++;
        break;
      }
      if (!"bBdEiIOPqRsSuvx".includes(flag))
        throw new Error(`Unknown Python helper invocation option: ${option}`);
    }
  }
  return undefined;
};

/**
 * Observe leftover demo processes on a dedicated clean Linux runner, including
 * groups reparented after their launcher exits. This is not ownership proof and
 * never authorizes signaling; unrelated runtime processes also block this lane.
 */
export const assertCleanLinuxHopperRuntime = async (
  launcherPaths = [
    "/opt/hopper/bin/Hopper",
    ...(process.env.HOPPER_LAUNCHER_PATH === undefined
      ? []
      : [process.env.HOPPER_LAUNCHER_PATH]),
  ],
  procRoot = "/proc",
) => {
  const launchers = [];
  for (const path of launcherPaths) {
    try {
      launchers.push(await stat(path, { bigint: true }));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  // /proc exposes the executed file even when argv[0] names a removed symlink.
  // Compare file identity, not a display path or a process name.
  let inspectionError;
  for (const entry of await readdir(procRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    let retainedRuntime;
    try {
      // procfs preserves argument boundaries. A caller merely mentioning a
      // runtime in its script text or other arguments is not that runtime.
      const commandLine = await readFile(
        `${procRoot}/${entry.name}/cmdline`,
        "utf8",
      );
      const arguments_ = commandLine.split("\0");
      // The kernel command field identifies renamed runtime processes such
      // as Xvfb. Keep it separate from arguments so ordinary script text does
      // not count as a retained runtime.
      const kernelCommand = (
        await readFile(`${procRoot}/${entry.name}/comm`, "utf8")
      ).replace(/\n$/u, "");
      if (
        commandLine.length === 0 &&
        /^python3(?:\.\d+)?$/u.test(kernelCommand)
      )
        throw new Error(
          "Cannot identify a command-less Python process on the clean Linux runner",
        );
      retainedRuntime =
        kernelCommand === "Hopper" ||
        kernelCommand === "Xvfb" ||
        arguments_[0] === "/opt/hopper/bin/Hopper" ||
        basename(arguments_[0] ?? "") === "Xvfb" ||
        (/^python3(?:\.\d+)?$/u.test(basename(arguments_[0] ?? "")) &&
          arguments_.some(
            (value) => basename(value) === "hopper-demo-x11.py",
          ) &&
          basename(pythonScriptOperand(arguments_) ?? "") ===
            "hopper-demo-x11.py");
      if (!retainedRuntime && launchers.length > 0) {
        const executable = await stat(`${procRoot}/${entry.name}/exe`, {
          bigint: true,
        });
        retainedRuntime = launchers.some(
          ({ dev, ino }) => dev === executable.dev && ino === executable.ino,
        );
      }
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ESRCH") continue;
      // Other users' process facts may be unreadable. The setup lane launches
      // providers as the caller; unreadable caller-owned processes fail closed.
      if (error?.code === "EACCES") {
        const owner = await stat(`${procRoot}/${entry.name}`).catch((cause) => {
          if (cause?.code === "ENOENT") return undefined;
          throw cause;
        });
        if (owner === undefined || owner.uid !== process.getuid()) continue;
      }
      // Finish the inventory so an unrelated restricted process cannot mask a
      // positively identified leak. Unknown caller processes still fail closed.
      inspectionError ??= error;
      continue;
    }
    if (retainedRuntime)
      throw new Error("Clean Linux runner retained a Hopper demo process");
  }
  if (inspectionError !== undefined) throw inspectionError;
};
