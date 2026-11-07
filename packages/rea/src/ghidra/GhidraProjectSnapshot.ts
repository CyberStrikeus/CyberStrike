import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ghidraFileFailure } from "./GhidraFileArtifacts.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  assertArtifactReadActive,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import {
  sameRegularFileState,
  RegularFileChangedError,
} from "../filesystem/RegularFile.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { GhidraProjectSelection } from "../config/ghidraExistingProject.js";
import { ghidraProgramNameSchema } from "../config/ghidraExistingProject.js";

/** Classify file cancellation/cleanup before the generic provider boundary. */
const projectFileOperation = async <Value>(
  path: string,
  operation: string,
  work: () => Promise<Value>,
): Promise<Value> => {
  try {
    return await work();
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) throw cause;
    throw ghidraFileFailure(cause, operation, { path });
  }
};

/** The selected project content, committed before provider or snapshot admission. */
export const ghidraProjectCommitmentSchema = z.strictObject({
  configured_path: z.string().refine(isAbsolute),
  project_path: z.string().refine(isAbsolute),
  project_name: z
    .string()
    .min(1)
    .refine((name) => basename(name) === name),
  program_name: ghidraProgramNameSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type GhidraProjectCommitment = z.infer<
  typeof ghidraProjectCommitmentSchema
>;

const selectionFailure = (
  message: string,
  setting = "REA_GHIDRA_PROJECT_PATH",
  diagnostics?: Readonly<Record<string, JsonValue>>,
): ConfigurationError =>
  new ConfigurationError(message, {
    settings: [{ setting, constraint: message }],
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
const entriesFor = (name: string) => [`${name}.gpr`, `${name}.rep`] as const;

const absentProjectEntry = (cause: unknown): undefined => {
  if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
    return undefined;
  throw cause;
};

const validateProject = async (root: string, name: string): Promise<void> => {
  if (!(await lstat(root).catch(absentProjectEntry))?.isDirectory())
    throw selectionFailure(
      `Existing Ghidra project directory does not exist: ${root}`,
    );
  // Inspect both entries even when one is missing; a physical failure of the
  // other entry must not be mistaken for an invalid project selection.
  const [markerName, dataName] = entriesFor(name);
  const marker = await lstat(join(root, markerName)).catch(absentProjectEntry);
  const data = await lstat(join(root, dataName)).catch(absentProjectEntry);
  if (!marker?.isFile() || !data?.isDirectory())
    throw selectionFailure(
      `Existing Ghidra project requires a regular ${name}.gpr marker and ${name}.rep directory; restore saved .grez archives before selecting the project: ${root}`,
    );
};

/** One sorted traversal owns the exact selected pair; unrelated sibling projects are ignored. */
const visitProject = async (
  root: string,
  name: string,
  visit: (path: string, directory: boolean) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> => {
  const walk = async (path: string): Promise<void> => {
    assertArtifactReadActive(signal);
    const metadata = await lstat(join(root, path));
    if (!metadata.isFile() && !metadata.isDirectory())
      throw selectionFailure(
        `Existing Ghidra project contains a symbolic link or non-regular entry: ${join(root, path)}`,
      );
    await visit(path, metadata.isDirectory());
    if (metadata.isDirectory())
      for (const child of (await readdir(join(root, path))).sort(
        compareUnicodeCodePoints,
      ))
        await walk(join(path, child));
  };
  for (const entry of entriesFor(name)) await walk(entry);
};

/** Streaming SHA-256 bounds content buffers to 64 KiB and retains failed descriptor cleanup. */
export const fingerprintGhidraProject = async (
  root: string,
  name: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<string> => {
  assertArtifactReadActive(signal);
  await validateProject(root, name);
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  await visitProject(
    root,
    name,
    async (path, directory) => {
      hash.update(
        JSON.stringify([
          path.split(sep).join("/"),
          directory ? "directory" : "file",
        ]) + "\n",
      );
      if (directory) return;
      const file = join(root, path);
      await withArtifactRegularFile(
        file,
        resources,
        signal,
        async ({ handle, initial }) => {
          hash.update(String(initial.size) + "\n");
          for (let offset = 0; offset < initial.size;) {
            assertArtifactReadActive(signal);
            const { bytesRead } = await handle.read(
              buffer,
              0,
              Math.min(buffer.length, initial.size - offset),
              offset,
            );
            if (bytesRead === 0) throw new RegularFileChangedError(file);
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
          }
          if (!sameRegularFileState(initial, await handle.stat()))
            throw new RegularFileChangedError(file);
        },
      );
    },
    signal,
  );
  return hash.digest("hex");
};

export const resolveGhidraProject = async (
  selection: GhidraProjectSelection,
  target: Pick<BinaryTarget, "path">,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<GhidraProjectCommitment> => {
  return projectFileOperation(
    selection.path,
    "resolve_analysis_profile",
    async () => {
      assertArtifactReadActive(signal);
      // Admit the caller's exact marker before canonicalizing its parent.
      // Darwin realpath(file/..) can succeed despite native lookup rejecting
      // that traversal; hashing the canonical sibling would select a new input.
      const marker = await lstat(selection.path).catch(absentProjectEntry);
      if (marker === undefined)
        throw selectionFailure(
          `Existing Ghidra project marker does not exist: ${selection.path}`,
          "REA_GHIDRA_PROJECT_PATH",
          { system_code: "ENOENT", syscall: "lstat" },
        );
      if (!marker.isFile())
        throw selectionFailure(
          `Existing Ghidra project marker must be a regular file: ${selection.path}`,
        );
      const projectName = basename(selection.path, ".gpr");
      const projectPath = await realpath(dirname(selection.path));
      const program = ghidraProgramNameSchema.safeParse(
        selection.programName ?? basename(target.path),
      );
      if (!program.success)
        throw selectionFailure(
          program.error.message,
          "REA_GHIDRA_PROGRAM_NAME",
        );
      const programName = program.data;
      return {
        configured_path: selection.path,
        project_path: projectPath,
        project_name: projectName,
        program_name: programName,
        sha256: await fingerprintGhidraProject(
          projectPath,
          projectName,
          resources,
          signal,
        ),
      };
    },
  );
};

const pathsOverlap = (first: string, second: string): boolean => {
  const contains = (ancestor: string, descendant: string): boolean => {
    const rel = relative(ancestor, descendant);
    return (
      rel === "" ||
      (!isAbsolute(rel) &&
        rel !== ".." &&
        !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
    );
  };
  return contains(first, second) || contains(second, first);
};

/** Never open the caller project itself. Copy only the selected pair, then revalidate its committed content. */
export const copyExistingGhidraProject = async (
  sourcePath: string,
  destinationRoot: string,
  options: {
    readonly signal?: AbortSignal | undefined;
    readonly projectName?: string | undefined;
    readonly expectedSha256?: string | undefined;
    readonly resources?: ArtifactResourceScope | undefined;
  } = {},
): Promise<void> => {
  return projectFileOperation(sourcePath, "open_binary", async () => {
    const {
      signal,
      projectName = "rea-project",
      expectedSha256,
      resources,
    } = options;
    assertArtifactReadActive(signal);
    const source = await realpath(sourcePath).catch(absentProjectEntry);
    const runtime =
      (await realpath(dirname(destinationRoot)).catch(absentProjectEntry)) ??
      resolve(dirname(destinationRoot));
    if (
      source !== undefined &&
      entriesFor(projectName).some((entry) =>
        pathsOverlap(join(source, entry), runtime),
      )
    )
      throw selectionFailure(
        `Existing Ghidra project directory overlaps the REA runtime directory; select a project outside the runtime: ${sourcePath}`,
      );
    if (source === undefined)
      throw selectionFailure(
        `Existing Ghidra project directory does not exist: ${sourcePath}`,
      );
    await validateProject(source, projectName);
    await visitProject(
      source,
      projectName,
      async (path, directory) => {
        const destination = join(destinationRoot, path);
        if (directory) await mkdir(destination, { mode: 0o700 });
        else
          await cp(join(source, path), destination, {
            dereference: true,
            errorOnExist: true,
            force: false,
          });
        assertArtifactReadActive(signal);
      },
      signal,
    );
    if (expectedSha256 !== undefined) {
      if (resources === undefined)
        throw selectionFailure(
          "Existing project verification requires an owned resource scope.",
        );
      if (
        (await fingerprintGhidraProject(
          destinationRoot,
          projectName,
          resources,
          signal,
        )) !== expectedSha256
      )
        throw new RegularFileChangedError(sourcePath);
    }
  });
};
