import { digestCanonicalValue } from "../canonicalDigest.js";
import type { Evidence } from "../evidence.js";
import { machoRuntimeSymbolName } from "../native/machoSymbolName.js";
import type { ManagedNativeObservationFacts } from "./managedNativeVerificationSource.js";
import type { ManagedNativeBoundaryInspection } from "./managedArtifact.js";
import type {
  ManagedNativeVerificationResult,
  NativeSymbol,
  PinvokeVerification,
} from "./managedNativeVerificationSchemas.js";

type PinvokeImport = ManagedNativeBoundaryInspection["pinvoke_imports"][number];
type VerifiedPinvoke = {
  readonly verification: PinvokeVerification;
};

export const collectNativeSymbols = (
  observations: readonly ManagedNativeObservationFacts[],
): {
  readonly symbols: readonly NativeSymbol[];
  readonly accepted: number;
  readonly unsupported: number;
  readonly moduleFormatsByEvidenceId: ReadonlyMap<string, string | null>;
} => {
  const symbols: NativeSymbol[] = [];
  const moduleFormatsByEvidenceId = new Map<string, string | null>();
  let accepted = 0;
  let unsupported = 0;
  for (const observation of observations) {
    moduleFormatsByEvidenceId.set(
      observation.evidence.evidence_id,
      observation.evidence.subject?.format ?? null,
    );
    if (!observation.supported) {
      unsupported += 1;
    } else {
      accepted += 1;
      symbols.push(...observation.symbols);
    }
  }
  return { symbols, accepted, unsupported, moduleFormatsByEvidenceId };
};

/** P/Invoke resolves a Mach-O export through dlsym, which names it without the symbol-table prefix. */
const lookupSymbolName = (native: NativeSymbol): string | null =>
  native.source === "macho-export"
    ? machoRuntimeSymbolName(native.name)
    : native.name;

const sameSymbolName = (expected: string, native: NativeSymbol): boolean =>
  expected === lookupSymbolName(native);

type ModuleCompatibility = "match" | "mismatch" | "unknown";

const moduleFilename = (
  value: string,
  caseSensitive: boolean,
  format?: string | null,
): string => {
  const separators = format === "elf" || format === "mach-o" ? /\//u : /[\\/]/u;
  const filename = value.split(separators).at(-1) ?? value;
  return caseSensitive ? filename : filename.toLowerCase();
};

const isAbsoluteModulePath = (value: string, format?: string | null): boolean =>
  value.startsWith("/") ||
  (format === "pe" &&
    (/^[a-z]:[\\/]/iu.test(value) || value.startsWith("\\\\")));

const hasModulePathSeparator = (
  value: string,
  format: string | null,
): boolean => (format === "pe" ? /[\\/]/u.test(value) : value.includes("/"));

const unixModuleCandidates = (
  value: string,
  suffix: ".so" | ".dylib",
): readonly string[] => {
  const suffixIndex = value.indexOf(suffix);
  const containsSuffix =
    suffixIndex >= 0 &&
    (suffixIndex + suffix.length === value.length ||
      value[suffixIndex + suffix.length] === ".");
  const hasPath = value.includes("/");
  const libPrefix = (name: string): string | null =>
    hasPath ? null : `lib${name}`;
  const suffixedName = `${value}${suffix}`;
  const libSuffixedName = libPrefix(suffixedName);
  const libName = libPrefix(value);
  if (containsSuffix)
    return [
      value,
      ...(libName === null ? [] : [libName]),
      suffixedName,
      ...(libSuffixedName === null ? [] : [libSuffixedName]),
    ];
  return [
    suffixedName,
    ...(libSuffixedName === null ? [] : [libSuffixedName]),
    value,
    ...(libName === null ? [] : [libName]),
  ];
};

/** Candidate module names documented for each native loader platform. */
const moduleCandidates = (
  value: string,
  format: string | null,
): readonly string[] => {
  if (isAbsoluteModulePath(value, format)) return [value];
  if (format === "pe")
    return /\.(dll|exe)$/iu.test(value) || value.endsWith(".")
      ? [value]
      : [value, `${value}.dll`];
  if (format === "elf") return unixModuleCandidates(value, ".so");
  if (format === "mach-o") return unixModuleCandidates(value, ".dylib");
  return [value];
};

const plausiblePlatformCandidates = (value: string): readonly string[] => {
  return [
    ...new Set([
      ...moduleCandidates(value, "pe"),
      ...moduleCandidates(value, "elf"),
      ...moduleCandidates(value, "mach-o"),
    ]),
  ];
};

const moduleValueCompatibility = (
  expected: string,
  observed: string,
  format: string | null,
): ModuleCompatibility => {
  const exactCandidates = moduleCandidates(expected, format);
  const expectedIsAbsolutePath = isAbsoluteModulePath(expected, format);
  if (expectedIsAbsolutePath) {
    const observedIsAbsolutePath = isAbsoluteModulePath(observed, format);
    if (!observedIsAbsolutePath) {
      const hasMatchingFilename = exactCandidates.some(
        (candidate) =>
          moduleFilename(candidate, format !== "pe", format) ===
          moduleFilename(observed, format !== "pe", format),
      );
      return hasMatchingFilename ? "unknown" : "mismatch";
    }
    const fold = format === "pe";
    const normalize = (path: string) =>
      fold ? path.replaceAll("\\", "/").toLowerCase() : path;
    return exactCandidates.some(
      (candidate) => normalize(candidate) === normalize(observed),
    )
      ? "match"
      : format !== "pe" &&
          format !== "elf" &&
          exactCandidates.some(
            (candidate) =>
              normalize(candidate).toLowerCase() ===
              normalize(observed).toLowerCase(),
          )
        ? "unknown"
        : "mismatch";
  }
  if (hasModulePathSeparator(expected, format)) {
    const isObservedAbsolute = isAbsoluteModulePath(observed, format);
    if (!isObservedAbsolute && exactCandidates.includes(observed))
      return "match";
    const normalizePath = (path: string) =>
      format === "pe" ? path.replaceAll("\\", "/").toLowerCase() : path;
    if (
      !isObservedAbsolute &&
      format === "pe" &&
      exactCandidates.some(
        (candidate) => normalizePath(candidate) === normalizePath(observed),
      )
    )
      return "match";
    if (isObservedAbsolute) {
      if (
        exactCandidates.some((candidate) =>
          normalizePath(observed).endsWith(`/${normalizePath(candidate)}`),
        )
      )
        return "match";
    }
    const sameFilename = exactCandidates.some(
      (candidate) =>
        moduleFilename(candidate, false, format) ===
        moduleFilename(observed, false, format),
    );
    return sameFilename ? "unknown" : "mismatch";
  }
  const observedFilename = moduleFilename(observed, true, format);
  if (exactCandidates.includes(observedFilename)) return "match";
  const caseFoldedCandidates = exactCandidates.map((candidate) =>
    moduleFilename(candidate, false, format),
  );
  const observedFolded = moduleFilename(observed, false, format);
  if (!caseFoldedCandidates.includes(observedFolded)) {
    if (
      format !== "pe" &&
      format !== "elf" &&
      format !== "mach-o" &&
      plausiblePlatformCandidates(expected)
        .map((candidate) => moduleFilename(candidate, false, format))
        .includes(observedFolded)
    )
      return "unknown";
    return "mismatch";
  }
  if (format === "elf") return "mismatch";
  if (format === "pe") return "match";
  return "unknown";
};

const moduleCompatibility = (
  scope: string | null,
  symbol: NativeSymbol,
  format: string | null,
): ModuleCompatibility => {
  if (
    scope === null ||
    scope.trim().length === 0 ||
    moduleFilename(scope, false, format).length === 0
  )
    return "unknown";
  const observedValues = isAbsoluteModulePath(scope, format)
    ? [symbol.module_path]
    : [symbol.module_name, symbol.module_path];
  const values = observedValues.filter(
    (value): value is string =>
      value !== null && moduleFilename(value, false, format).length > 0,
  );
  if (values.length === 0) return "unknown";
  const results = values.map((value) =>
    moduleValueCompatibility(scope, value, format),
  );
  if (results.includes("match")) return "match";
  if (results.includes("unknown")) return "unknown";
  return "mismatch";
};

const candidateNames = (
  managed: Pick<
    PinvokeImport,
    "import_name" | "char_set" | "call_convention" | "no_mangle"
  >,
  nativeFormat: string | null,
): readonly string[] => {
  if (managed.import_name.length === 0) return [];
  const names = new Set<string>([managed.import_name]);
  // Unix P/Invoke lookup uses the declared entry point directly, regardless of
  // marshalling charset or calling convention. Keep Windows decorations local
  // to PE or an unresolved native platform; metadata flags remain unchanged.
  if (
    !managed.no_mangle &&
    nativeFormat !== "elf" &&
    nativeFormat !== "mach-o"
  ) {
    if (
      managed.char_set === "unicode" ||
      (nativeFormat === "pe" && managed.char_set === "auto")
    )
      names.add(`${managed.import_name}W`);
    if (
      managed.char_set === "ansi" ||
      (nativeFormat === "pe" && managed.char_set === "not-specified")
    )
      names.add(`${managed.import_name}A`);
    if (managed.call_convention === "stdcall") {
      names.add(`_${managed.import_name}`);
      names.add(`_${managed.import_name}@0`);
    }
  }
  return [...names];
};

type PinvokeMatchField =
  | "status"
  | "basis"
  | "confidence"
  | "matched_native"
  | "candidates";
type PinvokeMatch<
  Verification extends PinvokeVerification = PinvokeVerification,
> = Verification extends PinvokeVerification
  ? Pick<Verification, PinvokeMatchField>
  : never;

interface PinvokeCandidateMatch {
  readonly match: PinvokeMatch;
}

const pinvokeCandidates = (
  managed: PinvokeImport,
  symbols: readonly NativeSymbol[],
  moduleFormatsByEvidenceId: ReadonlyMap<string, string | null>,
): readonly NativeSymbol[] => {
  const namesByFormat = new Map<string | null, readonly string[]>();
  return symbols.filter((symbol) => {
    const format = moduleFormatsByEvidenceId.get(symbol.evidence_id) ?? null;
    let names = namesByFormat.get(format);
    if (names === undefined) {
      names = candidateNames(managed, format);
      namesByFormat.set(format, names);
    }
    return names.some((name) => sameSymbolName(name, symbol));
  });
};

const matchPinvoke = (
  managed: PinvokeImport,
  symbols: readonly NativeSymbol[],
  supportedNativeEvidence: number,
  moduleFormatsByEvidenceId: ReadonlyMap<string, string | null>,
): PinvokeCandidateMatch => {
  const allCandidates = pinvokeCandidates(
    managed,
    symbols,
    moduleFormatsByEvidenceId,
  );
  const [first, ...remaining] = allCandidates;
  if (first === undefined)
    return {
      match: {
        status: "unresolved",
        basis:
          supportedNativeEvidence > 0
            ? "no-native-candidate"
            : "unsupported-native-evidence",
        confidence: "unknown",
        matched_native: null,
        candidates: [],
      },
    };

  const candidates: [NativeSymbol, ...NativeSymbol[]] = [first, ...remaining];
  const moduleRelation = (symbol: NativeSymbol) =>
    moduleCompatibility(
      managed.import_scope_name,
      symbol,
      moduleFormatsByEvidenceId.get(symbol.evidence_id) ?? null,
    );
  const exact = candidates.find(
    (symbol) =>
      managed.import_name === lookupSymbolName(symbol) &&
      moduleRelation(symbol) === "match",
  );
  const exactUnknownModule = candidates.find(
    (symbol) =>
      managed.import_name === lookupSymbolName(symbol) &&
      moduleRelation(symbol) === "unknown",
  );
  const unknownModule =
    exactUnknownModule ??
    candidates.find((symbol) => moduleRelation(symbol) === "unknown");
  const decorated = candidates.find(
    (symbol) => moduleRelation(symbol) === "match",
  );
  const selected = exact ?? decorated ?? first;
  if (exact !== undefined)
    return {
      match: {
        status: "verified",
        basis:
          selected.source === "macho-export"
            ? "exact-export-name"
            : "exact-function-name",
        confidence: "observed",
        matched_native: selected,
        candidates,
      },
    };
  // Preserve an exact-name candidate's uncertainty, but an unrelated unknown
  // module must not displace an observed module match for a decorated name.
  if (
    unknownModule !== undefined &&
    (exactUnknownModule !== undefined || decorated === undefined)
  )
    return {
      match: {
        status: "unresolved",
        basis: "module-identity-unknown",
        confidence: "unknown",
        matched_native: unknownModule,
        candidates,
      },
    };
  if (decorated !== undefined)
    return {
      match: {
        basis: "decorated-name-candidate",
        status: "inferred",
        confidence: "inferred",
        matched_native: selected,
        candidates,
      },
    };
  return {
    match: {
      status: "contradicted",
      basis: "module-mismatch",
      confidence: "unknown",
      matched_native: selected,
      candidates,
    },
  };
};

const pinvokeLimitations = (
  match: PinvokeMatch,
  managed: PinvokeImport,
): string[] => [
  ...(managed.import_scope_name === null ||
  managed.import_scope_name.trim().length === 0
    ? ["Managed declaration does not name an import scope/module."]
    : []),
  ...(match.status === "inferred"
    ? [
        "Native symbol matched a decorated candidate rather than the exact declared import name.",
      ]
    : []),
  ...(match.status === "contradicted"
    ? [
        "A symbol name candidate exists, but the supplied native Evidence module identity does not match the managed import scope.",
      ]
    : []),
  ...(match.status === "unresolved"
    ? match.basis === "module-identity-unknown"
      ? [
          "A native name candidate exists, but a required module identity is unavailable; module correspondence is unknown.",
        ]
      : [
          "No supplied native export/function Evidence matched this declared import.",
        ]
    : []),
];

interface VerifyPinvokeContext {
  readonly item: PinvokeImport;
  readonly managedEvidenceId: string;
  readonly native: {
    readonly symbols: readonly NativeSymbol[];
    readonly accepted: number;
    readonly moduleFormatsByEvidenceId: ReadonlyMap<string, string | null>;
  };
}

type PinvokeVerificationContext = Pick<
  PinvokeVerification,
  "item_id" | "managed" | "evidence_links" | "limitations"
>;

export const verifyPinvoke = ({
  item,
  managedEvidenceId,
  native,
}: VerifyPinvokeContext): VerifiedPinvoke => {
  const managed = {
    token: item.token,
    member_token: item.member_token,
    member_name: item.member_name,
    import_name: item.import_name,
    import_scope_name: item.import_scope_name,
    no_mangle: item.no_mangle,
    char_set: item.char_set,
    call_convention: item.call_convention,
    declaration_verification: item.verification,
  };
  const selection = matchPinvoke(
    item,
    native.symbols,
    native.accepted,
    native.moduleFormatsByEvidenceId,
  );
  const limitations = pinvokeLimitations(selection.match, item);
  const context: PinvokeVerificationContext = {
    item_id: `mnv_pinvoke_${digestCanonicalValue(
      {
        managedEvidenceId,
        token: item.token,
        importName: item.import_name,
        importScope: item.import_scope_name,
        candidates: selection.match.candidates,
      },
      "Managed/native verification",
    )}`,
    managed,
    evidence_links: [
      managedEvidenceId,
      ...new Set(selection.match.candidates.map(({ evidence_id: id }) => id)),
    ],
    limitations,
  };
  return {
    verification: { ...context, ...selection.match },
  };
};

const countStatuses = (
  items: readonly PinvokeVerification[],
): Pick<
  ManagedNativeVerificationResult["summary"],
  "verified" | "inferred" | "unresolved" | "contradicted"
> => ({
  verified: items.filter(({ status }) => status === "verified").length,
  inferred: items.filter(({ status }) => status === "inferred").length,
  unresolved: items.filter(({ status }) => status === "unresolved").length,
  contradicted: items.filter(({ status }) => status === "contradicted").length,
});

interface VerificationResultInput {
  readonly managedEvidence: Evidence;
  readonly managed: ManagedNativeBoundaryInspection;
  readonly native: {
    readonly symbols: readonly NativeSymbol[];
    readonly accepted: number;
    readonly unsupported: number;
  };
  readonly pinvokeImports: readonly PinvokeVerification[];
  readonly nativeObservationCount: number;
  readonly nativeEvidenceIds: readonly string[];
}

export const buildVerificationResult = ({
  managedEvidence,
  managed,
  native,
  pinvokeImports,
  nativeObservationCount,
  nativeEvidenceIds,
}: VerificationResultInput): Omit<
  ManagedNativeVerificationResult,
  "verification_id"
> => {
  const counts = countStatuses(pinvokeImports);
  const nativeBodyUnresolved = managed.native_implementations.filter(
    ({ boundary_kind: kind }) =>
      kind !== "pinvoke" && kind !== "runtime-provided",
  ).length;
  const coverage: ManagedNativeVerificationResult["coverage"] = {
    status:
      managed.coverage.state === "complete" && native.unsupported === 0
        ? "complete-within-inputs"
        : "partial",
  };
  return {
    algorithm: {
      name: "rea-managed-native-verification" as const,
      token_identity: "build-local" as const,
      token_to_address_mapping: "not-inferred" as const,
    },
    managed_boundary: {
      evidence_id: managedEvidence.evidence_id,
      artifact_sha256: managed.artifact.sha256,
      artifact_path: managed.artifact.path,
      mvid: managed.module?.mvid ?? null,
      metadata_status: managed.metadata.status,
      pinvoke_imports_total: managed.pinvoke_imports.length,
      native_implementations_total: managed.native_implementations.length,
      coverage_state: managed.coverage.state,
    },
    native_observations: {
      total: nativeObservationCount,
      accepted: native.accepted,
      unsupported: native.unsupported,
      symbols: native.symbols.length,
    },
    summary: {
      ...counts,
      native_body_unresolved: nativeBodyUnresolved,
    },
    pinvoke_imports: [...pinvokeImports],
    native_implementations: {
      runtime_provided: managed.native_implementations.filter(
        ({ boundary_kind }) => boundary_kind === "runtime-provided",
      ).length,
      unresolved: nativeBodyUnresolved,
      reason:
        "Managed metadata tokens and RVAs are not translated to native provider addresses by this workflow; C++/CLI, ReadyToRun, and native-body mappings require explicit provider-supported bridge evidence.",
    },
    coverage,
    evidence_links: [managedEvidence.evidence_id, ...nativeEvidenceIds],
    limitations: [
      "P/Invoke verification checks declared import names against supplied native export or function-name Evidence only.",
      "A matching native symbol verifies that a candidate export/function was observed; it does not prove CLR binding, marshaling behavior, call reachability, or runtime loading.",
      "Missing supplied native symbols are reported as unresolved, not proof that a dependency cannot exist.",
      "Managed metadata tokens and method RVAs are not interpreted as native addresses.",
      ...(managed.coverage.state === "complete"
        ? []
        : ["Managed boundary input is partial or unavailable."]),
      ...(native.unsupported === 0
        ? []
        : [
            "Some native Evidence operations were unsupported by this workflow.",
          ]),
    ],
  };
};
