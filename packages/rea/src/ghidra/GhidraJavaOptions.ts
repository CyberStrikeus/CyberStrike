import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { withArtifactRegularFile } from "../artifacts/ArtifactFileOperation.js";
import { RegularFileOperationCancelled } from "../filesystem/RegularFile.js";
import { readBoundedFileBytes } from "../process/BoundedFileBytes.js";
import { writeGhidraRuntimeFile } from "./GhidraRuntimeFile.js";

/** One launch's admitted argument-file contents and expanded environment stay within the helper capture budget. */
const OPTIONS_BYTES = 64 * 1024;

/** Environment quoting does not have the escape/comment rules of an argument file. */
export const jvmEnvironmentArguments = (value: string): readonly string[] => {
  const args: string[] = [];
  let token = "";
  let active = false;
  let quote: "'" | '"' | undefined;
  for (const character of value) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      active = true;
    } else if (/[ \t\n\r\f\v]/u.test(character)) {
      if (active) args.push(token);
      token = "";
      active = false;
    } else {
      token += character;
      active = true;
    }
  }
  if (quote !== undefined) throw new GhidraAdmissionError("unterminated_quote");
  if (active) args.push(token);
  return args;
};

export const rejectJvmPlatformOverrides = (args: readonly string[]): void => {
  if (args.some((argument) => /^-Dos\.(?:arch|name)(?:=|$)/u.test(argument)))
    throw new GhidraAdmissionError("platform_override");
};

/** Java launcher argfile grammar: quotes, escapes inside quotes, comments and line continuation are one parse. */
const argumentFileTokens = (value: string): readonly string[] => {
  const args: string[] = [];
  let prefix = "",
    segment = "";
  let quote: "'" | '"' | undefined;
  let comment = false,
    active = false;
  const finish = (): void => {
    if (active) args.push(prefix + segment);
    prefix = "";
    segment = "";
    active = false;
    quote = undefined;
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (comment) {
      if (character === "\r" || character === "\n") comment = false;
      continue;
    }
    if (quote !== undefined && character === "\\") {
      const next = value[++index];
      if (next === undefined) {
        active = false;
        break;
      }
      prefix += segment;
      segment = "";
      if (next === "\n" || next === "\r") {
        while (/[ \t\n\r\f]/u.test(value[index + 1] ?? "")) index += 1;
        if (index + 1 === value.length) {
          active = false;
          break;
        }
      } else
        prefix +=
          (
            { n: "\n", r: "\r", t: "\t", f: "\f" } as Readonly<
              Record<string, string>
            >
          )[next] ?? next;
    } else if (
      character === "\r" ||
      character === "\n" ||
      (quote === undefined && /[ \t\f]/u.test(character))
    ) {
      if (active) finish();
    } else if (quote === undefined && character === "#") {
      // Unquoted text adjoining a comment is discarded by the launcher; completed quoted fragments remain pending.
      segment = "";
      active = false;
      comment = true;
    } else if (
      (character === "'" || character === '"') &&
      (quote === undefined || quote === character)
    ) {
      prefix += segment;
      segment = "";
      active = true;
      quote = quote === undefined ? character : undefined;
    } else {
      segment += character;
      active = true;
    }
  }
  finish();
  return args;
};

const fileReference = (value: string): boolean =>
  value.startsWith("@") && !value.startsWith("@@");
/** JDK environment quotes concatenate; protect literal quote characters without shell interpretation. */
const environmentToken = (value: string): string =>
  value
    .split("'")
    .map((part) => `'${part}'`)
    .join('"\'"');

/** The file owner retains read/parse failure independently of final-close failure. */
const readArgumentFile = (
  path: string,
  resources: ArtifactResourceScope,
  signal: AbortSignal | undefined,
  remainingBytes: number,
): Promise<{
  readonly text: string;
  readonly bytes: number;
  readonly disablesExpansion: boolean;
}> =>
  withArtifactRegularFile(
    path,
    resources,
    signal,
    async ({ handle: file }) => {
      const data = await readBoundedFileBytes(file, remainingBytes, {
        signal,
        cancellationFailure: (reason) =>
          new RegularFileOperationCancelled(reason),
      });
      if (data === undefined)
        throw new GhidraAdmissionError("argument_files_exceed_bound", {
          budget_bytes: OPTIONS_BYTES,
        });
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(data);
      const tokens = argumentFileTokens(text);
      if (tokens.some(fileReference))
        throw new GhidraAdmissionError("nested_argument_file");
      rejectJvmPlatformOverrides(tokens);
      return {
        text,
        bytes: data.length,
        disablesExpansion: tokens.includes("--disable-@files"),
      };
    },
    "follow",
  ).catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      throw new GhidraAdmissionError(
        "argument_file_unreadable",
        { path },
        { cause },
      );
    throw cause;
  });

/** Freeze validated bytes under the already owned runtime root; the JVM must not reopen a mutable caller file. */
export const prepareJdkJavaOptions = async (
  value: string,
  options: {
    readonly resources?: ArtifactResourceScope;
    readonly signal?: AbortSignal;
    readonly directory?: string;
    readonly platform: NodeJS.Platform;
  },
): Promise<string | undefined> => {
  const assertActive = (): void => {
    if (options.signal?.aborted === true)
      throw new ArtifactReaderFailure(
        "cancelled",
        "JDK_JAVA_OPTIONS preparation cancelled",
        { cause: options.signal.reason },
      );
  };
  assertActive();
  const args = jvmEnvironmentArguments(value);
  rejectJvmPlatformOverrides(args);
  const disabledAt = args.indexOf("--disable-@files");
  if (
    !args.some(
      (argument, index) =>
        fileReference(argument) && (disabledAt < 0 || index < disabledAt),
    )
  )
    return undefined;
  const resources = options.resources;
  const directory = options.directory;
  if (resources === undefined || directory === undefined)
    throw new GhidraAdmissionError("argument_files_require_scope");
  const snapshots = new Map<
    string,
    {
      readonly path: string;
      readonly bytes: number;
      readonly disablesExpansion: boolean;
    }
  >();
  const prepared: string[] = [];
  let expansionEnabled = true;
  let bytes = 0,
    encodedBytes = 0;
  for (const argument of args) {
    assertActive();
    if (argument === "--disable-@files") expansionEnabled = false;
    let replacement = argument;
    if (expansionEnabled && fileReference(argument)) {
      const path = argument.slice(1);
      let snapshot = snapshots.get(path);
      if (snapshot === undefined) {
        if (path === "" || path.includes("\0"))
          throw new GhidraAdmissionError("argument_file_path_invalid", {
            check: path === "" ? "empty" : "nul",
          });
        const content = await readArgumentFile(
          path,
          resources,
          options.signal,
          OPTIONS_BYTES - bytes,
        );
        bytes += content.bytes;
        snapshot = {
          path: join(directory, `rea-jdk-options-${randomUUID()}.args`),
          bytes: content.bytes,
          disablesExpansion: content.disablesExpansion,
        };
        await writeGhidraRuntimeFile(
          snapshot.path,
          content.text,
          options.platform,
        );
        snapshots.set(path, snapshot);
      } else {
        bytes += snapshot.bytes;
        if (bytes > OPTIONS_BYTES)
          throw new GhidraAdmissionError("argument_files_exceed_bound", {
            budget_bytes: OPTIONS_BYTES,
          });
      }
      replacement = `@${snapshot.path}`;
      if (snapshot.disablesExpansion) expansionEnabled = false;
    }
    const encoded = environmentToken(replacement);
    encodedBytes +=
      Buffer.byteLength(encoded) + (prepared.length === 0 ? 0 : 1);
    if (encodedBytes > OPTIONS_BYTES)
      throw new GhidraAdmissionError("prepared_options_exceed_bound", {
        budget_bytes: OPTIONS_BYTES,
      });
    prepared.push(encoded);
  }
  assertActive();
  return prepared.join(" ");
};
