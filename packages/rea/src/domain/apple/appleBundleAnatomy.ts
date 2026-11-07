import { z } from "zod";

import type { ProjectedInventoryEntry } from "../mobileApplicationGraphProjection.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import { APPLE_BUNDLE_EXTENSION } from "./appleBundleTypes.js";

const pathSchema = z.string().min(1);

const MACH_O_FORMATS: readonly string[] = ["mach-o", "mach-o-universal"];

/** One application root or nested bundle classified by path convention. */
export const appleBundleSchema = z.strictObject({
  path: pathSchema,
  parent_path: pathSchema.nullable(),
  layout: z.enum(["shallow", "macos-deep", "versioned-framework"]),
  role: z.enum([
    "application",
    "app-extension",
    "xpc-service",
    "framework",
    "login-item",
    "system-extension",
    "driver-extension",
    "plug-in",
    "resource-bundle",
    "bundle",
    "helper-application",
    "nested-application",
  ]),
  role_basis: z.literal("path-convention"),
  info_plist_path: pathSchema.nullable(),
  executable_candidates: z.array(pathSchema),
  signing_paths: z.array(pathSchema),
});

type Bundle = z.infer<typeof appleBundleSchema>;

type Entry = Pick<ProjectedInventoryEntry, "path" | "kind" | "component">;

/** Report whether an inventory format is a thin or universal Mach-O. */
export const isMachOFormat = (format: string): boolean =>
  MACH_O_FORMATS.includes(format);

/** AppleDouble metadata written beside archived files (`._name`, `__MACOSX/`). */
export const isSidecar = (path: string): boolean => {
  const segments = path.split("/");
  return (
    segments.includes("__MACOSX") || (segments.at(-1) ?? "").startsWith("._")
  );
};

export const isWithin = (path: string, root: string): boolean =>
  root === "." || path === root || path.startsWith(`${root}/`);

/**
 * English (en-US) case fold used only for Apple's fixed anatomy vocabulary.
 * Reported paths keep the archive spelling. Inventory identity stays case-sensitive.
 */
export const anatomyNameIs = (actual: string, expected: string): boolean =>
  actual.toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US");

/** Directory entry that folds to one vocabulary word. The exact spelling wins. */
export const anatomyChild = (
  names: Iterable<string> | undefined,
  expected: string,
): string | null => {
  if (names === undefined) return null;
  let exact: string | undefined;
  let folded: string | undefined;
  for (const name of names) {
    if (name === expected) exact = name;
    else if (
      anatomyNameIs(name, expected) &&
      (folded === undefined || compare(name, folded) < 0)
    )
      folded = name;
  }
  return exact ?? folded ?? null;
};

/**
 * Whether `path`'s tail matches anatomy vocabulary. `*` matches one segment
 * that is not itself a vocabulary comparison.
 */
export const anatomyTailMatches = (
  path: string,
  expected: readonly string[],
): boolean => {
  const actual = path.split("/");
  if (actual.length < expected.length) return false;
  const tail = actual.slice(-expected.length);
  return expected.every((name, index) => {
    const segment = tail[index];
    if (segment === undefined || segment.length === 0) return false;
    return name === "*" || anatomyNameIs(segment, name);
  });
};

/** Interpret bundle roots and anatomy from the same directory and file indexes. */
export const projectAppleBundleAnatomy = (
  entries: readonly Entry[],
  subject: { readonly name: string; readonly format: string },
) => {
  const tree = indexTree(entries);
  const roots = applicationRoots(tree, subject);
  return { roots, bundles: detectBundles(tree, roots) };
};

/**
 * Outermost iOS (`Payload/X.app`) and macOS (`X.app/Contents/…`) applications.
 * An inventoried `.app` directory is its own root, `.`.
 */
const applicationRoots = (
  tree: Tree,
  subject: { readonly name: string; readonly format: string },
): string[] => {
  // A selected `.app` directory is the application, even when its inventory
  // is partial or lacks Contents/; coverage and limitations describe that.
  if (subject.format === "directory" && /\.app$/iu.test(subject.name))
    return ["."];
  const found = new Set<string>();
  for (const path of directoryPaths(tree)) {
    const segments = path.split("/");
    const app = segments[1];
    if (subject.format === "ipa") {
      if (
        anatomyNameIs(segments[0] ?? "", "Payload") &&
        app !== undefined &&
        /\.app$/iu.test(app)
      )
        found.add(`${segments[0]}/${app}`);
      continue;
    }
    const index = segments.findIndex(
      (segment, position) =>
        /\.app$/iu.test(segment) &&
        anatomyNameIs(segments[position + 1] ?? "", "Contents"),
    );
    if (index >= 0) found.add(segments.slice(0, index + 1).join("/"));
  }
  const roots = [...found];
  return roots
    .filter(
      (root) => !roots.some((other) => other !== root && isWithin(root, other)),
    )
    .sort(compare);
};

const detectBundles = (tree: Tree, roots: readonly string[]): Bundle[] => {
  const paths = new Set<string>(roots);
  for (const path of directoryPaths(tree)) {
    if (
      APPLE_BUNDLE_EXTENSION.test(path.split("/").at(-1) ?? "") &&
      roots.some((root) => isWithin(path, root))
    )
      paths.add(path);
  }
  return [...paths].sort(compare).map((path) => {
    const layout = bundleLayout(path, tree);
    return {
      path,
      parent_path: enclosingBundle(path, paths),
      layout,
      role: roots.includes(path) ? "application" : bundleRole(path),
      role_basis: "path-convention",
      info_plist_path: infoPlistPath(path, layout, tree),
      executable_candidates: executableCandidates(path, layout, tree),
      signing_paths: signingPaths(path, layout, tree),
    } satisfies Bundle;
  });
};

/** Keep directory identity separate from authenticated file content before name selection. */
interface Tree {
  readonly directories: ReadonlyMap<string, ReadonlySet<string>>;
  readonly files: ReadonlyMap<string, ReadonlyMap<string, Entry>>;
}

const indexTree = (entries: readonly Entry[]): Tree => {
  const directories = new Map<string, Set<string>>();
  const files = new Map<string, Map<string, Entry>>();
  for (const entry of entries) {
    const { path, kind } = entry;
    if (isSidecar(path)) continue;
    const segments = path.split("/");
    let parent = "";
    for (const [index, segment] of segments.entries()) {
      const leaf = index === segments.length - 1;
      if (!leaf || kind === "directory") {
        const names = directories.get(parent) ?? new Set<string>();
        names.add(segment);
        directories.set(parent, names);
      } else if (kind === "file") {
        const children = files.get(parent) ?? new Map<string, Entry>();
        children.set(segment, entry);
        files.set(parent, children);
      }
      parent = joinPath(parent, segment);
    }
  }
  return { directories, files };
};

function* directoryPaths(tree: Tree): Iterable<string> {
  for (const [parent, names] of tree.directories)
    for (const name of names) yield joinPath(parent, name);
}

const joinPath = (directory: string, name: string): string =>
  directory === "" ? name : `${directory}/${name}`;

const directoryOf = (bundle: string): string => (bundle === "." ? "" : bundle);

/** Inverse of joinPath: the directory part of an inventory path. */
const parentDirectory = (path: string): string =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));

const enclosingBundle = (
  path: string,
  bundles: ReadonlySet<string>,
): string | null => {
  if (path === ".") return null;
  const segments = path.split("/");
  for (let length = segments.length - 1; length > 0; length--) {
    const candidate = segments.slice(0, length).join("/");
    if (bundles.has(candidate)) return candidate;
  }
  return bundles.has(".") ? "." : null;
};

const bundleLayout = (bundle: string, tree: Tree): Bundle["layout"] => {
  const directory = directoryOf(bundle);
  if (namedDirectory(tree, directory, "Contents") !== null) return "macos-deep";
  if (namedDirectory(tree, directory, "Versions") !== null)
    return "versioned-framework";
  return "shallow";
};

const bundleRole = (bundle: string): Bundle["role"] => {
  const segments = bundle.split("/");
  const name = (segments.at(-1) ?? "").toLowerCase();
  const container = segments.at(-2);
  if (name.endsWith(".appex")) return "app-extension";
  if (name.endsWith(".xpc")) return "xpc-service";
  if (name.endsWith(".framework")) return "framework";
  if (name.endsWith(".systemextension")) return "system-extension";
  if (name.endsWith(".dext")) return "driver-extension";
  if (name.endsWith(".bundle")) {
    if (anatomyNameIs(container ?? "", "PlugIns")) return "plug-in";
    return anatomyNameIs(container ?? "", "Resources")
      ? "resource-bundle"
      : "bundle";
  }
  if (!name.endsWith(".app")) return "plug-in";
  if (
    anatomyNameIs(container ?? "", "LoginItems") &&
    anatomyNameIs(segments.at(-3) ?? "", "Library")
  )
    return "login-item";
  if (anatomyNameIs(container ?? "", "Helpers")) return "helper-application";
  return "nested-application";
};

/** Files directly inside one directory; nested bundles are deeper paths. */
const directFiles = (directory: string, tree: Tree): Entry[] =>
  [...(tree.files.get(directory)?.values() ?? [])].sort((left, right) =>
    compare(left.path, right.path),
  );

/** Content directories; `Versions/Current` is a symlink outside the inventory. */
const contentDirectories = (
  bundle: string,
  layout: Bundle["layout"],
  tree: Tree,
): string[] => {
  const directory = directoryOf(bundle);
  if (layout === "macos-deep") {
    const contents = namedDirectory(tree, directory, "Contents");
    return contents === null ? [] : [contents];
  }
  if (layout === "shallow") return [directory];
  const versions = namedDirectory(tree, directory, "Versions");
  if (versions === null) return [];
  // Only real version directories count: Current is a symlink, and files
  // such as .DS_Store are not versions.
  return [...(tree.directories.get(versions) ?? [])]
    .filter((version) => !anatomyNameIs(version, "Current"))
    .map((version) => joinPath(versions, version))
    .sort(compare);
};

/** Select applicable entry kinds before applying Apple's case preference. */
const namedDirectory = (
  tree: Tree,
  directory: string,
  expected: string,
): string | null => {
  const name = anatomyChild(tree.directories.get(directory), expected);
  return name === null ? null : joinPath(directory, name);
};

const namedFile = (
  tree: Tree,
  directory: string,
  expected: string,
): string | null => {
  const name = anatomyChild(tree.files.get(directory)?.keys(), expected);
  return name === null ? null : joinPath(directory, name);
};

const infoPlistPath = (
  bundle: string,
  layout: Bundle["layout"],
  tree: Tree,
): string | null => {
  const directories = contentDirectories(bundle, layout, tree);
  // With several real versions, Versions/Current (a symlink outside the
  // inventory) decides which plist applies, so the plist stays unknown.
  if (directories.length !== 1) return null;
  const directory = directories[0];
  if (directory === undefined) return null;
  if (layout === "macos-deep") return namedFile(tree, directory, "Info.plist");
  // A framework version keeps Info.plist in Resources/ (CoreFoundation's
  // version-0 layout). A flattened macOS framework is that directory without
  // the Versions/ wrapper; an iOS-style shallow bundle keeps it at its root,
  // which takes precedence.
  const resources = namedDirectory(tree, directory, "Resources");
  const resourcePlist =
    resources === null ? null : namedFile(tree, resources, "Info.plist");
  if (layout === "versioned-framework") return resourcePlist;
  return namedFile(tree, directory, "Info.plist") ?? resourcePlist;
};

const executableCandidates = (
  bundle: string,
  layout: Bundle["layout"],
  tree: Tree,
): string[] =>
  contentDirectories(bundle, layout, tree)
    .flatMap((directory) => {
      const executableDirectory =
        layout === "macos-deep"
          ? namedDirectory(tree, directory, "MacOS")
          : directory;
      return executableDirectory === null
        ? []
        : directFiles(executableDirectory, tree);
    })
    .filter(
      ({ component }) =>
        component !== undefined && isMachOFormat(component.format),
    )
    .map(({ path }) => path);

const signingPaths = (
  bundle: string,
  layout: Bundle["layout"],
  tree: Tree,
): string[] =>
  contentDirectories(bundle, layout, tree)
    .flatMap((directory) => {
      const signature = namedDirectory(tree, directory, "_CodeSignature");
      return [
        signature === null ? null : namedFile(tree, signature, "CodeResources"),
        namedFile(tree, directory, "embedded.provisionprofile"),
        namedFile(tree, directory, "embedded.mobileprovision"),
      ];
    })
    .filter((path): path is string => path !== null)
    .sort(compare);

/** Platforms of application roots whose layout was observed, not assumed. */
export const platformsOf = (bundles: readonly Bundle[]): ("ios" | "macos")[] =>
  [
    ...new Set(
      bundles.flatMap(({ path, role, layout, info_plist_path: plist }) => {
        if (role !== "application") return [];
        if (layout === "macos-deep") return ["macos" as const];
        // An empty or partial root has no Contents/ either. iOS bundles keep
        // Info.plist at their root, not in a Resources/ directory.
        if (
          layout === "shallow" &&
          plist !== null &&
          parentDirectory(plist) === directoryOf(path)
        )
          return ["ios" as const];
        return [];
      }),
    ),
  ].sort(compare);
