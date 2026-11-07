import type {
  DylibEdge as Edge,
  DylibFinding as Finding,
  MachoDependency,
  MachoSlice,
} from "./dylibResolution.js";

/** Both lazy encodings load on first use and are not process-launch dependencies. */
export const isLazyLoadCommand = (
  command: MachoDependency["command"],
): boolean =>
  command === "LC_LAZY_LOAD_DYLIB" || command === "LC_LAZY_LOAD_DYLIB_INFO";

/** One traced process root with the exact slice it was traced from. */
export interface TracedRootSlice {
  readonly image: string;
  readonly slice: MachoSlice;
}

export const deriveFindings = (
  edges: readonly Edge[],
  roots: readonly TracedRootSlice[],
): Finding[] => {
  const findings: Finding[] = [];
  edges.forEach((edge, index) => {
    if (edge.resolution.status === "unresolved")
      findings.push(unresolvedFinding(edge, index));
    const resolvedAt = edge.candidates.findIndex(
      ({ outcome }) => outcome === "resolved",
    );
    const earlier = edge.candidates
      .slice(0, Math.max(resolvedAt, 0))
      .filter(
        ({ source, outcome }) => source === "rpath" && outcome === "absent",
      )
      .map(({ path }) => path);
    if (resolvedAt > 0 && earlier.length > 0)
      findings.push({
        kind: "earlier-rpath-candidate-absent",
        edge_index: index,
        image: edge.loader,
        basis: "derived",
        explanation: `The modeled dyld search checks ${earlier.join(", ")} before ${edge.resolution.image ?? edge.install_name}. A compatible Mach-O placed at an earlier modeled path could take precedence over that fallback, subject to unmodeled search inputs and code-signing library validation; library validation is not evaluated here (see inspect_signature).${edge.loader_conditional ? " This loader loads only conditionally; if it never loads, this search never occurs." : ""}${edge.resolution.status === "conditional" ? " Unmodeled environment overrides or earlier unknown candidates may take precedence; placing an image at this rpath does not establish which image dyld will load." : ""}`,
      });
  });
  // Capability-bit variants can share an architecture name, so each
  // finding uses the slice its root was traced from, not a name lookup.
  for (const { image, slice } of roots) {
    const { architecture } = slice;
    const environment = slice.dyld_environment;
    if (environment.length > 0)
      findings.push({
        kind: "dyld-environment-present",
        edge_index: null,
        image,
        basis: "derived",
        explanation:
          slice.file_type === "execute"
            ? `${image} (${architecture}) sets dyld environment variables through LC_DYLD_ENVIRONMENT (${environment.join(", ")}); any image-selection overrides they request are not modeled. Diagnostic settings alone do not alter resolution.`
            : `${image} (${architecture}) contains LC_DYLD_ENVIRONMENT (${environment.join(", ")}). Dyld reads these commands only from the main executable; entries in this non-executable root are observations and do not alter resolution.`,
      });
  }
  return findings;
};

const unresolvedFinding = (edge: Edge, index: number): Finding => {
  const base = {
    edge_index: index,
    image: edge.loader,
    basis: "derived",
  } as const;
  const lazy = isLazyLoadCommand(edge.command);
  const missing = missingCandidateExplanation(
    edge,
    dependencyPhrase(edge, lazy),
  );
  // Below a conditional fallback, every consequence applies only if it loads.
  const when = edge.loader_conditional
    ? `. ${edge.loader} loads only conditionally; if it loads, `
    : "; ";
  if (lazy)
    return {
      ...base,
      kind: "lazy-load-unresolved",
      explanation: `${missing}${when}${lazyConsequence(edge.weak)}`,
    };
  return edge.weak
    ? {
        ...base,
        kind: "weak-load-unresolved",
        explanation: `${missing}${when}dyld continues without it.`,
      }
    : {
        ...base,
        kind: "required-load-unresolved",
        explanation: `${missing}${when}dyld would fail to load this required dependency for ${edge.root} (${edge.architecture}) unless the image is supplied elsewhere.`,
      };
};

/** Use the resolver's physical-candidate facts without rechecking source paths. */
const missingCandidateExplanation = (
  edge: Edge,
  dependency: string,
): string => {
  const present = edge.candidates.flatMap(({ outcome, resolved_path }) =>
    resolved_path === null ? [] : [{ outcome, path: resolved_path }],
  );
  if (present.length === 0)
    return `No candidate for ${dependency} exists in the analyzed root`;
  const descriptions = present.map(
    ({ outcome, path }) => `${path} (${candidateRejection(outcome)})`,
  );
  return `No usable candidate for ${dependency} exists in the analyzed root; found ${descriptions.join(", ")}`;
};

/** Explain a found candidate from the resolver's outcome, not by reopening it. */
const candidateRejection = (
  outcome: Edge["candidates"][number]["outcome"],
): string => {
  switch (outcome) {
    case "not-mach-o":
      return "not a Mach-O image";
    case "malformed":
      return "malformed";
    case "architecture-missing":
      return "missing the process architecture";
    case "not-loadable":
      return "not a loadable dylib";
    case "platform-mismatch":
      return "incompatible with the process platform";
    case "unsupported":
      return "unsupported by the parser";
    case "resolved":
      return "loadable";
    case "absent":
      return "absent";
    case "outside-target":
      return "outside the analyzed root";
    case "escapes-target":
      return "escapes the analyzed root";
    case "undetermined":
      return "of undetermined loadability";
  }
};

/** Name the dependency the way the finding's consequence treats it. */
const dependencyPhrase = (edge: Edge, lazy: boolean): string => {
  if (lazy && edge.weak)
    return `lazily loaded weak dependency ${edge.install_name}`;
  if (lazy) return `lazily loaded ${edge.install_name}`;
  if (edge.weak) return `weak dependency ${edge.install_name}`;
  return edge.install_name;
};

/**
 * A may-be-missing lazy image is optional. Every other lazy image fails
 * when first use cannot find it.
 */
const lazyConsequence = (weak: boolean): string =>
  weak
    ? "dyld loads it on first use and continues if it is absent."
    : "dyld loads it on first use, which would fail unless the image is supplied elsewhere.";

export const DYLIB_RESOLUTION_LIMITATIONS = [
  "LC_LAZY_LOAD_DYLIB and LC_LAZY_LOAD_DYLIB_INFO dependencies are resolved but not traversed, because dyld loads them only on first use.",
  "Slices are matched by dyld's graded architectures (an x86_64h process also loads x86_64). arm64e processes that disable pointer authentication can also load arm64 slices; that fallback is not modeled.",
  "Absolute install names and rpaths are outside the analyzed root and are not evaluated, including /System and /usr/lib libraries that the dyld shared cache usually provides.",
  "Leaf and relative install names depend on dyld fallback paths, DYLD_* variables, and the working directory; they are undetermined.",
  "Load order follows dyld's dependents-first traversal in load-command order. An image reached through several chains is resolved once per process, with the rpath stack and conditionality of the first chain; a later @rpath request whose install name matches an already loaded image reuses it.",
  "@loader_path uses each image's symlink-resolved path within the analyzed root.",
  "Code-signing checks that can reject a found image, such as library validation and the hardened runtime, are not evaluated.",
  "Dylib compatibility versions are not compared. Apple's linker documentation describes a load-time rejection when an image's compatibility version is older than the loader requires, but dyld on macOS 26 was observed to load such an image.",
];
