import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";

import { z } from "zod";

import { preflightPropertyListDecode } from "../artifacts/apple/PropertyListDecodeBudget.js";
import { decodeBinaryPlistValue } from "../artifacts/apple/BinaryPlistMaterializer.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";
import { isPathWithinRoot } from "../domain/localPath.js";
import { parseXmlPropertyList } from "../domain/propertyListKeys.js";
import { decodeXmlPlistText } from "../domain/propertyListXmlText.js";
import { hasBinaryPlistSignature } from "../domain/apple/appleArchiveFormat.js";
import type { BundleResourceRoot } from "../domain/apple/bundleResourceRoot.js";
import { openableAppleBundleExtension } from "../domain/apple/appleBundleTypes.js";
import { err, ok, type Result } from "../domain/result.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

/** Decoded representation bound for one binary Info.plist. */
const BINARY_PLIST_DECODE_BYTES = 16 * 1024 * 1024;

/** Where one app bundle layout keeps its Info.plist and program file. */
interface BundleLayout {
  readonly name: BundleResourceRoot["layout"];
  readonly plist: readonly string[];
  readonly programs: readonly string[];
  readonly programsLabel: string;
}

const BUNDLE_LAYOUTS: readonly BundleLayout[] = [
  // macOS bundles keep both under Contents.
  {
    name: "contents",
    plist: ["Contents", "Info.plist"],
    programs: ["Contents", "MacOS"],
    programsLabel: "Contents/MacOS",
  },
  // iOS-style bundles, as extracted from an IPA, keep both at the root.
  {
    name: "root",
    plist: ["Info.plist"],
    programs: [],
    programsLabel: "the bundle root",
  },
];

// A macOS framework keeps the selected version's resources and program file
// under Versions/Current; its root holds only symbolic links into it.
const VERSIONED_FRAMEWORK_LAYOUTS: readonly BundleLayout[] = [
  ...BUNDLE_LAYOUTS,
  {
    name: "versioned-framework",
    plist: ["Versions", "Current", "Resources", "Info.plist"],
    programs: ["Versions", "Current"],
    programsLabel: "Versions/Current",
  },
];

// A flattened framework, as Electron and Gecko apps ship it, is one version
// directory without the Versions wrapper: Resources/Info.plist beside the
// program file. Its Resources is a real directory, not the versioned layout's
// root link into Versions/Current, so the two layouts are never both read.
const FLATTENED_FRAMEWORK_LAYOUTS: readonly BundleLayout[] = [
  ...BUNDLE_LAYOUTS,
  {
    name: "flattened-framework",
    plist: ["Resources", "Info.plist"],
    programs: [],
    programsLabel: "the bundle root",
  },
];

/** A resolved bundle program file and the Info.plist that declared it. */
export interface ResolvedAppBundle {
  readonly executable: string;
  readonly infoPlist?: string;
}

/** Resource-only identity for an app directory; it is not a BinaryTarget. */
export interface ResolvedAppBundleResourceRoot {
  /** Path selected by the caller, retained even when it is a symlink alias. */
  readonly callerPath: string;
  /** Canonical directory whose resources are inspected. */
  readonly canonicalPath: string;
  readonly infoPlistPath: string;
  readonly layout: BundleResourceRoot["layout"];
  /** No executable was opened or hashed by resource-root discovery. */
  readonly executableSha256: string | null;
}

/** Filesystem operations used by the resolver, injectable for boundary tests. */
export interface AppBundleFileSystem {
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly realpath: (path: string) => Promise<string>;
  readonly decodeBinaryPlist?: (path: string) => Promise<string>;
}

const defaultFileSystem: AppBundleFileSystem = { readFile, realpath };

/**
 * Resolve an app bundle directory to its declared program file. macOS and
 * flat iOS-style layouts are read directly. An iOS app installed on a Mac is
 * a wrapper whose `Wrapper` directory holds the iOS bundle; that bundle is
 * found by listing `Wrapper`, never by following the `WrappedBundle` link.
 */
export const resolveAppBundleExecutable = async (
  path: string,
  fileSystem: AppBundleFileSystem = defaultFileSystem,
): Promise<Result<ResolvedAppBundle, BinaryTargetError>> => {
  try {
    const layout = await presentLayout(path);
    if (layout !== undefined)
      return await resolveLayoutExecutable(path, layout, fileSystem);
    const wrapped = await wrappedBundle(path);
    if (wrapped !== undefined) {
      const wrappedLayout = await presentLayout(wrapped);
      if (wrappedLayout !== undefined)
        return await resolveLayoutExecutable(
          wrapped,
          wrappedLayout,
          fileSystem,
        );
    }
  } catch (cause: unknown) {
    if (cause instanceof BinaryTargetError) return err(cause);
    return err(
      new BinaryTargetError(path, errorReason(cause, path), { cause }),
    );
  }
  return err(
    new BinaryTargetError(
      path,
      `app Info.plist is missing or no supported bundle layout was found: ${path}`,
      {
        cause: new Error(
          "No Contents/Info.plist, root Info.plist, or single Wrapper/*.app bundle was found",
        ),
      },
    ),
  );
};

/**
 * Resolve an extension, framework, XPC service, system extension or loadable
 * bundle directory to its declared program file. An app keeps its own
 * resolution, including the iOS-on-Mac Wrapper. Other types read the macOS
 * Contents layout or the flat root layout, and frameworks also read the
 * versioned layout. Exactly one layout may declare the bundle, and its
 * Info.plist must stay inside the bundle; the program file is never guessed.
 */
export const resolveAppleBundleExecutable = async (
  path: string,
  fileSystem: AppBundleFileSystem = defaultFileSystem,
): Promise<Result<ResolvedAppBundle, BinaryTargetError>> => {
  if (extname(path).toLowerCase() === ".app")
    return resolveAppBundleExecutable(path, fileSystem);
  try {
    const layout = await declaredBundleLayout(path, fileSystem);
    if (!layout.ok) return layout;
    if (layout.value === undefined)
      return err(
        new BinaryTargetError(
          path,
          `bundle Info.plist was not found in any supported layout: ${path}`,
          {
            constraint: "bundle_info_plist_missing",
            probedPaths: (await bundleLayouts(path)).map((candidate) =>
              join(path, ...candidate.plist),
            ),
          },
        ),
      );
    return await resolveLayoutExecutable(path, layout.value, fileSystem);
  } catch (cause: unknown) {
    if (cause instanceof BinaryTargetError) return err(cause);
    return err(
      new BinaryTargetError(path, errorReason(cause, path), { cause }),
    );
  }
};

const bundleLayouts = async (
  bundle: string,
): Promise<readonly BundleLayout[]> => {
  if (extname(bundle).toLowerCase() !== ".framework") return BUNDLE_LAYOUTS;
  return (await entryPresent(join(bundle, "Versions")))
    ? VERSIONED_FRAMEWORK_LAYOUTS
    : FLATTENED_FRAMEWORK_LAYOUTS;
};

/**
 * The one layout whose Info.plist declares a bundle other than an app, or
 * undefined when none does. A framework with Versions but no Versions/Current,
 * Info.plist files in more than one layout, or an Info.plist that leaves the
 * bundle fail closed instead of selecting a layout.
 */
const declaredBundleLayout = async (
  path: string,
  fileSystem: AppBundleFileSystem,
): Promise<Result<BundleLayout | undefined, BinaryTargetError>> => {
  const layouts = await bundleLayouts(path);
  if (layouts === VERSIONED_FRAMEWORK_LAYOUTS) {
    const current = join(path, "Versions", "Current");
    if (!(await entryPresent(current)))
      return err(
        new BinaryTargetError(
          path,
          `framework has Versions but no Versions/Current: ${current}`,
          {
            constraint: "bundle_current_version_missing",
            probedPaths: [current],
          },
        ),
      );
  }
  const present: BundleLayout[] = [];
  for (const layout of layouts)
    if (await layoutPlistPresent(join(path, ...layout.plist)))
      present.push(layout);
  const [layout, ...others] = present;
  if (layout === undefined) return ok(undefined);
  if (others.length > 0)
    return err(
      new BinaryTargetError(
        path,
        `bundle declares Info.plist in more than one layout: ${path}`,
        {
          constraint: "bundle_layout_ambiguous",
          probedPaths: present.map((candidate) =>
            join(path, ...candidate.plist),
          ),
        },
      ),
    );
  const plistPath = join(path, ...layout.plist);
  if (
    !isPathWithinRoot(
      await fileSystem.realpath(path),
      await fileSystem.realpath(plistPath),
    )
  )
    return err(
      new BinaryTargetError(path, "bundle Info.plist leaves the bundle", {
        constraint: "bundle_path_escapes",
        probedPaths: [plistPath],
      }),
    );
  return ok(layout);
};

/**
 * Resolve only the root and Info.plist layout needed for read-only resource
 * inspection. This intentionally does not require or guess CFBundleExecutable.
 */
export const findAppBundleResourceRoot = async (
  path: string,
  options: { readonly cwd?: string } = {},
): Promise<
  Result<ResolvedAppBundleResourceRoot | undefined, BinaryTargetError>
> => {
  const callerPath = absoluteCallerPath(
    path,
    options.cwd === undefined ? {} : { cwd: options.cwd },
  );
  try {
    // Admit the selected spelling before Darwin realpath can collapse file/..
    // into a different, otherwise valid bundle resource root.
    await stat(callerPath);
    const canonicalInput = await realpath(callerPath);
    const extension = extname(canonicalInput).toLowerCase();
    if (
      extension !== ".app" &&
      openableAppleBundleExtension(extension) !== undefined
    ) {
      const declared = await declaredBundleLayout(
        canonicalInput,
        defaultFileSystem,
      );
      if (!declared.ok) return declared;
      // An admitted bundle type without Info.plist is a native admission
      // failure, not an application directory for other routes.
      if (declared.value === undefined)
        return err(
          new BinaryTargetError(
            callerPath,
            `bundle Info.plist was not found in any supported layout: ${callerPath}`,
            {
              constraint: "bundle_info_plist_missing",
              probedPaths: (await bundleLayouts(canonicalInput)).map((layout) =>
                join(canonicalInput, ...layout.plist),
              ),
            },
          ),
        );
      return ok({
        callerPath,
        canonicalPath: canonicalInput,
        infoPlistPath: join(canonicalInput, ...declared.value.plist),
        layout: declared.value.name,
        executableSha256: null,
      });
    }
    const directLayout = await presentLayout(canonicalInput);
    const wrapped =
      directLayout === undefined
        ? await wrappedBundle(canonicalInput)
        : undefined;
    const root = wrapped ?? canonicalInput;
    const layout = directLayout ?? (await presentLayout(root));
    if (layout === undefined) return ok(undefined);
    const canonicalPath = await realpath(root);
    return ok({
      callerPath,
      canonicalPath,
      infoPlistPath: join(canonicalPath, ...layout.plist),
      layout: layout.name,
      executableSha256: null,
    });
  } catch (cause: unknown) {
    if (cause instanceof BinaryTargetError) return err(cause);
    return err(
      new BinaryTargetError(callerPath, errorReason(cause, callerPath), {
        cause,
      }),
    );
  }
};

/** Require a discovered bundle layout while preserving typed read failures. */
export const resolveAppBundleResourceRoot = async (
  path: string,
  options: { readonly cwd?: string } = {},
): Promise<Result<ResolvedAppBundleResourceRoot, BinaryTargetError>> => {
  const found = await findAppBundleResourceRoot(path, options);
  if (!found.ok) return found;
  if (found.value !== undefined) return ok(found.value);
  const callerPath = absoluteCallerPath(path, options);
  return err(
    new BinaryTargetError(
      callerPath,
      `app resource root has no supported Info.plist layout: ${callerPath}`,
    ),
  );
};

const presentLayout = async (
  bundle: string,
): Promise<BundleLayout | undefined> => {
  for (const layout of BUNDLE_LAYOUTS)
    if (await layoutPlistPresent(join(bundle, ...layout.plist))) return layout;
  return undefined;
};

/**
 * Whether a layout's Info.plist exists. Readable symlinks count, as they did
 * when the plist was read directly; any failure other than absence, such as
 * a permission denial, is left for the caller to report.
 */
const layoutPlistPresent = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch (cause: unknown) {
    if (isAbsence(cause)) return false;
    if (isPermissionDenied(cause))
      throw new BinaryTargetError(
        path,
        `permission denied inspecting app Info.plist ${path}`,
        { cause },
      );
    throw cause;
  }
};

/** Whether a directory entry, including a dangling link, exists. */
const entryPresent = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (cause: unknown) {
    if (isAbsence(cause)) return false;
    throw cause;
  }
};

const isAbsence = (cause: unknown): boolean => {
  const code = errorCode(cause);
  return code === "ENOENT" || code === "ENOTDIR";
};

const errorCode = (cause: unknown): unknown =>
  cause instanceof Error ? Reflect.get(cause, "code") : undefined;

const codeDescription = (cause: unknown): string => {
  const code = errorCode(cause);
  return typeof code === "string" || typeof code === "number"
    ? ` (${String(code)})`
    : "";
};

const isSystemErrorCode = (cause: unknown): boolean => {
  const code = errorCode(cause);
  return (
    typeof code === "string" &&
    /^[A-Z][A-Z0-9_]+$/u.test(code) &&
    !code.startsWith("ERR_")
  );
};

const isPermissionDenied = (cause: unknown): boolean =>
  errorCode(cause) === "EACCES" || errorCode(cause) === "EPERM";

const errorReason = (cause: unknown, path: string): string =>
  isPermissionDenied(cause)
    ? `permission denied accessing app bundle path ${path}`
    : isAbsence(cause)
      ? `app bundle path is missing: ${path}`
      : `could not inspect app bundle path ${path}`;

/** The single real `.app` directory inside an iOS-on-Mac `Wrapper`. */
const wrappedBundle = async (bundle: string): Promise<string | undefined> => {
  const wrapper = join(bundle, "Wrapper");
  try {
    if (!(await lstat(wrapper)).isDirectory()) return undefined;
  } catch (cause: unknown) {
    if (isAbsence(cause)) return undefined;
    throw cause;
  }
  let app: string | undefined;
  for await (const entry of await opendir(wrapper)) {
    if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith(".app"))
      continue;
    if (app !== undefined) return undefined;
    app = join(wrapper, entry.name);
  }
  return app;
};

const resolveLayoutExecutable = async (
  bundle: string,
  layout: BundleLayout,
  fileSystem: AppBundleFileSystem,
): Promise<Result<ResolvedAppBundle, BinaryTargetError>> => {
  const plistPath = join(bundle, ...layout.plist);
  // Reasons for an app keep their established wording.
  const noun = extname(bundle).toLowerCase() === ".app" ? "app" : "bundle";
  let plist: Buffer;
  try {
    plist = await fileSystem.readFile(plistPath);
  } catch (cause: unknown) {
    return err(
      new BinaryTargetError(
        plistPath,
        isPermissionDenied(cause)
          ? `permission denied reading ${noun} Info.plist ${plistPath}`
          : isAbsence(cause)
            ? `${noun} Info.plist is missing: ${plistPath}`
            : `could not read ${noun} Info.plist ${plistPath}${codeDescription(cause)}`,
        { cause },
      ),
    );
  }

  let name: string;
  try {
    name = hasBinaryPlistSignature(plist)
      ? await (fileSystem.decodeBinaryPlist?.(plistPath) ??
          parseBinaryPlistExecutable(plist))
      : parseXmlPlistExecutable(decodeXmlPlistText(plist));
  } catch (cause: unknown) {
    return err(
      new BinaryTargetError(
        plistPath,
        isPermissionDenied(cause)
          ? `permission denied decoding ${noun} Info.plist ${plistPath}${codeDescription(cause)}`
          : isSystemErrorCode(cause)
            ? `could not decode ${noun} Info.plist ${plistPath}${codeDescription(cause)}`
            : `${noun} Info.plist is malformed, unsupported, or lacks CFBundleExecutable: ${plistPath}${cause instanceof Error ? ` (${cause.message})` : ""}`,
        {
          cause,
          // A bundle without code, such as a resource bundle, declares no
          // program file; the open does not guess one from its contents.
          ...(cause instanceof UndeclaredBundleExecutable
            ? {
                constraint: "bundle_executable_undeclared" as const,
                infoPlist: plistPath,
              }
            : {}),
        },
      ),
    );
  }
  if (!isSafeExecutableName(name))
    return err(
      new BinaryTargetError(bundle, `${noun} has an unsafe CFBundleExecutable`),
    );
  const programs = join(bundle, ...layout.programs);
  const executable = join(programs, name);
  let canonicalBundle: string;
  try {
    canonicalBundle = await fileSystem.realpath(bundle);
  } catch (cause: unknown) {
    return err(
      new BinaryTargetError(bundle, errorReason(cause, bundle), { cause }),
    );
  }
  try {
    const canonicalPrograms = await fileSystem.realpath(programs);
    if (!isPathWithinRoot(canonicalBundle, canonicalPrograms))
      return err(
        new BinaryTargetError(
          bundle,
          `${noun} program directory leaves ${layout.programsLabel}`,
          { constraint: "bundle_path_escapes", probedPaths: [programs] },
        ),
      );
    const canonicalExecutable = await fileSystem.realpath(executable);
    if (!isPathWithinRoot(canonicalPrograms, canonicalExecutable))
      return err(
        new BinaryTargetError(
          bundle,
          `${noun} program file leaves ${layout.programsLabel}`,
          { constraint: "bundle_path_escapes", probedPaths: [executable] },
        ),
      );
    return ok({ executable: canonicalExecutable, infoPlist: plistPath });
  } catch (cause: unknown) {
    return err(
      new BinaryTargetError(
        executable,
        isPermissionDenied(cause)
          ? `permission denied resolving ${noun} program file ${executable}`
          : isAbsence(cause)
            ? `${noun} program file is missing: ${executable}`
            : `could not resolve ${noun} program file ${executable}`,
        {
          cause,
          ...(isAbsence(cause)
            ? {
                constraint: "bundle_program_missing" as const,
                infoPlist: plistPath,
                probedPaths: [executable],
              }
            : {}),
        },
      ),
    );
  }
};

/** Decode the top-level executable name with an XML parser, not a pattern. */
const parseXmlPlistExecutable = (plist: string): string => {
  // An unrelated `__proto__` entry must not make the bundle unreadable.
  const { value } = parseXmlPropertyList(plist);
  return executableName(value);
};

/** The Info.plist decoded but declares no string CFBundleExecutable. */
class UndeclaredBundleExecutable extends Error {}

const executableName = (value: unknown): string => {
  const executable = executableEntrySchema.safeParse(value);
  if (!executable.success)
    throw new UndeclaredBundleExecutable("CFBundleExecutable is missing");
  return executable.data.CFBundleExecutable;
};

const executableEntrySchema = z.looseObject({ CFBundleExecutable: z.string() });

/** Decode a binary plist in-process, so no host plist tool is required. */
const parseBinaryPlistExecutable = (plist: Buffer): string => {
  const plan = preflightPropertyListDecode(plist, BINARY_PLIST_DECODE_BYTES);
  return executableName(decodeBinaryPlistValue(plist, plan));
};

/** Names are one local path component; backslash is literal on POSIX hosts. */
const isSafeExecutableName = (name: string): boolean =>
  name.length > 0 &&
  name !== "." &&
  name !== ".." &&
  !name.includes("\0") &&
  !name.includes("/") &&
  (sep !== "\\" || !name.includes("\\"));
