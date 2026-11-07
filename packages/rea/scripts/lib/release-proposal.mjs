import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { requireCompleteReleaseHistory } from "./release-notes.mjs";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL("../../", import.meta.url));
const patch = fileURLToPath(
  new URL("../../patches/release-please+17.3.0.patch", import.meta.url),
);

export async function applyReleasePleasePatch(
  directory = dirname(require.resolve("release-please/package.json")),
) {
  const metadata = JSON.parse(
    await readFile(`${directory}/package.json`, "utf8"),
  );
  if (metadata.version !== "17.3.0") {
    throw new Error(
      "The release proposal patch requires release-please 17.3.0",
    );
  }
  // Git prefixes patch filenames with a slash-separated path, even on Windows.
  // Split only native separators so POSIX backslashes remain filename bytes.
  const args = [
    "--directory",
    relative(project, directory).split(sep).join("/"),
    patch,
  ];
  const check = async (reverse) => {
    try {
      await execute(
        "git",
        ["apply", "--check", ...(reverse ? ["--reverse"] : []), ...args],
        { cwd: project },
      );
      return true;
    } catch (error) {
      if (error.code === 1) return false;
      throw error;
    }
  };
  if (await check(false)) {
    await execute("git", ["apply", ...args], { cwd: project });
  } else if (!(await check(true))) {
    throw new Error(
      "The release proposal dependency patch does not match the installed source",
    );
  }
}

export async function releaseProposalSearchDepth(run, sourceSha) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha ?? "")) {
    throw new Error("Expected an exact release proposal source SHA");
  }
  await requireCompleteReleaseHistory(run);
  const text = (await run("git", ["rev-list", "--count", sourceSha])).trim();
  const count = Number(text);
  if (!/^[1-9][0-9]*$/u.test(text) || !Number.isSafeInteger(count)) {
    throw new Error("Git returned an invalid release history size");
  }
  return count;
}
