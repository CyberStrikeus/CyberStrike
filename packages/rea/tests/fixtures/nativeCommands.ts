import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  BinaryTarget,
  HeaderArchitecture,
} from "../../src/domain/binaryTargetTypes.js";
import type { InspectSignature } from "../../src/domain/native/nativeInspection.js";
import { ok } from "../../src/domain/result.js";
import type {
  NativeCommandCapture,
  NativeCommandOptions,
  NativeCommandRunner,
  ResolvedTool,
} from "../../src/native/CommandRunner.js";

/** Resolver seam for fixtures with identical invocation and physical paths. */
export const nativeResolvedToolFixture = (
  path: string,
  sha256: string,
): ResolvedTool => ({ invocationPath: path, resolvedPath: path, sha256 });

/** Replay captured native command outputs through the production runner seam. */
export class NativeFixtureRunner implements NativeCommandRunner {
  constructor(
    private readonly overrides: Readonly<Record<string, string>> = {},
    private readonly exitCode = 0,
  ) {}

  async run(
    tool: string,
    arguments_: readonly string[],
    _options?: NativeCommandOptions,
  ) {
    const output =
      this.overrides[`${tool}:${arguments_[0] ?? ""}`] ??
      this.overrides[tool] ??
      (await outputFor(tool, arguments_));
    return ok({
      ...capture(tool, arguments_, output),
      exitCode: this.exitCode,
    });
  }
}

const outputFor = async (
  tool: string,
  arguments_: readonly string[],
): Promise<string> => {
  if (tool === "lipo") return nativeFixture("lipo-fat.txt");
  if (tool === "nm") return "_main\n_$s4Test3fooyyF\n";
  if (tool === "dyld_info")
    return nativeFixture(
      arguments_[0] === "-imports" ? "dyld-imports.txt" : "dyld-exports.txt",
    );
  if (tool === "dwarfdump")
    return `UUID: 01234567-89AB-CDEF-0123-456789ABCDEF (arm64) ${arguments_.at(-1)}\n`;
  if (tool === "file")
    return arguments_.at(-1)?.endsWith(".plist") === true
      ? "XML 1.0 document text\n"
      : "Mach-O 64-bit executable arm64\n";
  if (tool === "vtool") return "Load command 3 LC_BUILD_VERSION\n";
  if (tool === "swift-demangle") return nativeFixture("demangle.txt");
  if (tool === "plutil") return nativeFixture("plist.json");
  if (tool === "codesign") {
    if (arguments_.includes("--entitlements"))
      return nativeFixture("entitlements.xml");
    if (arguments_.includes("-r-"))
      return "designated => identifier com.example.fixture\n";
    return nativeFixture("codesign.txt");
  }
  throw new Error(`Unexpected fixture tool ${tool}`);
};

/**
 * codesign prints display diagnostics to stderr and requirements or
 * entitlements to stdout.
 */
const fixtureStreams = (
  tool: string,
  arguments_: readonly string[],
  output: string,
) => {
  const stderr =
    tool === "codesign" &&
    !arguments_.includes("-r-") &&
    !arguments_.includes("--entitlements");
  return {
    stdout: stderr ? "" : output,
    stderr: stderr ? output : "",
    stdoutBytes: Buffer.byteLength(stderr ? "" : output),
    stderrBytes: Buffer.byteLength(stderr ? output : ""),
  };
};

const capture = (
  tool: string,
  arguments_: readonly string[],
  output: string,
): NativeCommandCapture => ({
  tool,
  executable: `/usr/bin/${tool}`,
  executableSha256: "a".repeat(64),
  toolVersion: null,
  versionReason: "fixture",
  arguments: [...arguments_],
  ...fixtureStreams(tool, arguments_, output),
  exitCode: 0,
  signal: null,
});

/** Build the Mach-O target identity used by native boundary fixtures. */
export const nativeMachoTarget = (
  path: string,
  sourcePath?: string,
): BinaryTarget & {
  readonly kind: "executable";
  readonly format: "mach-o";
  readonly architecture: HeaderArchitecture;
} => ({
  path,
  ...(sourcePath === undefined ? {} : { sourcePath }),
  sha256: "0".repeat(64),
  kind: "executable",
  format: "mach-o",
  architecture: "arm64",
  availableArchitectures: ["x86_64", "arm64"],
});

/** Register the actual bytes of a filesystem-backed native test target. */
export const nativeMachoTargetForFile = async (
  path: string,
  sourcePath?: string,
): Promise<ReturnType<typeof nativeMachoTarget>> => ({
  ...nativeMachoTarget(path, sourcePath),
  sha256: createHash("sha256")
    .update(await readFile(path))
    .digest("hex"),
});

/** Load one captured native tool output. */
export const nativeFixture = (name: string): Promise<string> =>
  readFile(new URL(`./native-macos/${name}`, import.meta.url), "utf8");

/** Parsed signature facts for lifecycle controls that do not invoke native tools. */
export const signatureInspectionFixture = (): InspectSignature => ({
  signed: true,
  identifier: "rea.lifecycle-fixture",
  team_identifier: null,
  format: "Mach-O thin (arm64)",
  cdhashes: ["0123456789abcdef"],
  hash_algorithms: ["sha256"],
  authorities: [],
  designated_requirement: null,
  entitlements: null,
  timestamp: null,
  hardened_runtime: null,
  provenance: [],
  limitations: ["Controlled parsed facts; no native signing tool invoked."],
});
