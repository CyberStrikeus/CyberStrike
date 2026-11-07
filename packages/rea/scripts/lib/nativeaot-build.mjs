import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** NativeAOT fixtures use native toolchains, not cross-compilation. */
export function supportsNativeAotFixtureHost(platform, architecture) {
  return architecture === "x64" && ["linux", "win32"].includes(platform);
}

/** Keep network recovery separate from compilation and preserve restore failures. */
export async function buildNativeAotFixture(run, options) {
  const { dotnet, project, runtime, output } = options;
  const common = [
    project,
    "-r",
    runtime,
    "--maxcpucount:1",
    "-p:Configuration=Release",
    `-p:BaseIntermediateOutputPath=${join(output, "obj")}/`,
    `-p:BaseOutputPath=${join(output, "bin")}/`,
    `-p:NativeAotMapPath=${join(output, "NativeAotFixture.map")}`,
  ];
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.error(`NativeAOT dependency restore: attempt ${attempt}/2`);
    try {
      run(dotnet, ["restore", ...common, "--verbosity", "normal"]);
      break;
    } catch (cause) {
      if (attempt === 2)
        throw new Error(
          "NativeAOT dependency restore failed after two attempts",
          {
            cause,
          },
        );
      // Child diagnostics can contain authenticated feed URLs; keep retry logs static.
      console.error(
        "NativeAOT dependency restore failed; retrying in 1 second",
      );
      await delay(1_000);
    }
  }
  console.error("NativeAOT compilation (dependencies already restored)");
  run(dotnet, [
    "publish",
    ...common,
    "--no-restore",
    "-o",
    join(output, "symbols"),
  ]);
}

/** Sanitize child diagnostics before any retry, cause chain, or uncaught output. */
export function nativeAotCommandError(command, operation, result) {
  const diagnostic = `NativeAOT fixture lane requires/action failed ${command} ${operation}: ${result.error?.message ?? `exit ${result.status}`}\n${result.stdout ?? ""}${result.stderr ?? ""}`;
  // Only URL authority userinfo is authentication; preserve host, path, query,
  // and unrelated diagnostic values. Never retain the raw result as a cause.
  return new Error(
    diagnostic.replace(/\b(https?:\/\/)[^\\\s/?#]*@/giu, "$1[redacted]@"),
  );
}
