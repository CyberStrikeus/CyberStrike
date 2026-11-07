import type {
  AnalysisOperation,
  CapabilityDescriptor,
} from "../application/AnalysisProvider.js";
import type { ProviderRejectionCode } from "../domain/providerSelection.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";
import {
  DEFAULT_REGEX_MATCHING_DEADLINE,
  type RegexMatchingDeadline,
} from "../config/regexMatchingDeadline.js";
import {
  DEFAULT_REGEX_WORKER_HEAP_REQUEST,
  type RegexWorkerHeapRequest,
} from "../config/regexWorkerHeapRequest.js";
import { launchRegexMatchingLimitation } from "../process/RegexMatcher.js";
import { KUNA_FUNCTION_TEXT_BYTES } from "./KunaLimits.js";

/** Static identity; the observed Kuna release is reported in each analysis profile. */
export const KUNA_PROVIDER_IDENTITY = Object.freeze({
  id: KUNA_PROVIDER_ID,
  name: "Kuna",
  version: null,
});

/** Analyst outcomes Kuna's inventory and project export can answer. */
export const KUNA_OPERATIONS = Object.freeze([
  "list_documents",
  "list_procedures",
  "search_procedures",
  "list_strings",
  "search_strings",
  "procedure_address",
  "address_name",
  "procedure_pseudo_code",
  "procedure_assembly",
  "analyze_function",
  "procedure_callers",
  "procedure_callees",
  "xrefs",
] as const satisfies readonly Exclude<AnalysisOperation, "health">[]);
export type KunaOperation = (typeof KUNA_OPERATIONS)[number];

export const KUNA_RELATIONSHIP_LIMITATION =
  "Kuna reports call-kind edges between its discovered function nodes. Jump/data edges are excluded; unresolved indirect calls and targets outside that inventory remain unknown.";
export const KUNA_STRING_LIMITATION =
  "Kuna scans its mapped sections or segments for printable runs of at least five characters, including unterminated fragments. Encodings are ASCII, UTF-8 and Latin-range UTF-16LE; other text can remain undiscovered. String scanning skips references; an empty search is not proof of absence.";

export const KUNA_XREF_LIMITATION =
  "Kuna's static reference walk unifies forwarding aliases and omits references internal to that alias class. REA keeps only exact-address incoming edges; an empty result does not prove no reference exists.";

/** Whether an operation is one Kuna answers. */
export const isKunaOperation = (
  operation: AnalysisOperation,
): operation is KunaOperation =>
  (KUNA_OPERATIONS as readonly string[]).includes(operation);

/** How to read every Kuna answer. */
const KUNA_PROVENANCE =
  "Kuna static analysis: addresses and bytes are its observations, procedure entries and extents its derivations, and pseudocode its reconstruction, never original source.";

/** Entries come from Kuna's own discovery. */
const KUNA_ENTRY_LIMITATION =
  "Kuna may split one function at an entry its own analysis infers; entry extents are upper bounds.";

/** Provider text is not comparable across providers. */
const KUNA_TEXT_LIMITATION =
  "Pseudocode and assembly are exact Kuna text, not comparable as equal or different with another provider's text.";
const KUNA_TEXT_CAPACITY_LIMITATION = `Each buffered source facet admits at most ${String(KUNA_FUNCTION_TEXT_BYTES)} bytes before allocation; larger text stays accessible in the local project export.`;

/** The limitations that apply to one operation's answer, and only those. */
export const kunaLimitations = (
  operation: KunaOperation,
  deadline: RegexMatchingDeadline = DEFAULT_REGEX_MATCHING_DEADLINE,
  heapRequest: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
): readonly string[] => {
  switch (operation) {
    case "list_documents":
      return [];
    case "list_strings":
      return [KUNA_PROVENANCE, KUNA_STRING_LIMITATION];
    case "search_strings":
      return [
        KUNA_PROVENANCE,
        KUNA_STRING_LIMITATION,
        launchRegexMatchingLimitation(deadline, heapRequest),
      ];
    case "list_procedures":
    case "procedure_address":
    case "address_name":
      return [KUNA_PROVENANCE, KUNA_ENTRY_LIMITATION];
    case "search_procedures":
      return [
        KUNA_PROVENANCE,
        KUNA_ENTRY_LIMITATION,
        launchRegexMatchingLimitation(deadline, heapRequest),
      ];
    case "procedure_callers":
    case "procedure_callees":
      return [KUNA_PROVENANCE, KUNA_RELATIONSHIP_LIMITATION];
    case "xrefs":
      return [KUNA_PROVENANCE, KUNA_XREF_LIMITATION];
    case "procedure_pseudo_code":
    case "procedure_assembly":
    case "analyze_function":
      return [
        KUNA_PROVENANCE,
        KUNA_TEXT_LIMITATION,
        KUNA_TEXT_CAPACITY_LIMITATION,
      ];
  }
};

/** Pseudocode answered before the project export finishes differs from the export's. */
export const KUNA_SINGLE_FUNCTION_LIMITATION =
  "This pseudocode came from a single-function `kuna decompile` run while the project export was still building. It lacks the export's whole-program prototypes, and a later request for the same procedure can return the export's text.";

/** Advertise Kuna's static, process-launching operations truthfully. */
export const kunaCapabilities = (
  availability:
    | { readonly available: true }
    | {
        readonly available: false;
        readonly reason: string;
        readonly code: ProviderRejectionCode;
      },
  deadline: RegexMatchingDeadline = DEFAULT_REGEX_MATCHING_DEADLINE,
  heapRequest: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
): readonly CapabilityDescriptor[] =>
  KUNA_OPERATIONS.map((operation) => ({
    provider: KUNA_PROVIDER_IDENTITY,
    operation,
    ...(availability.available
      ? ({ available: true, reason: null } as const)
      : ({
          available: false,
          reason: availability.reason,
          availabilityCode: availability.code,
        } as const)),
    // Text can change when the export finishes. References own bounded session
    // reuse; generic snapshot replay must not bypass that lifecycle.
    cachePolicy: "live",
    effects: {
      mutatesArtifact: false,
      launchesProcess: true,
      mayShowUi: false,
      mayAccessNetwork: false,
      mayWriteFilesystem: true,
      changesPermissions: false,
      requiresRoot: false,
    },
    limitations: kunaLimitations(operation, deadline, heapRequest),
  }));
