import { cdpFrameRecordFacts } from "./CdpFrameIdentity.js";
import type { InspectWebPageInput } from "../domain/browserObservation.js";
import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import {
  allowedSanitizedUrl,
  admitRecords,
  numberValue,
  resourceContentSize,
  recordValue,
  recordsValue,
  requiredRecord,
  cdpStringValue,
  type UnknownRecord,
} from "./CdpCaptureValues.js";
import {
  cdpSnapshotString,
  cdpSnapshotValueString,
} from "./CdpSnapshotStrings.js";
import {
  snapshotDocumentNodes,
  snapshotNodeAt,
  type SnapshotAttributes,
} from "./CdpSnapshotNodes.js";
import type { BrowserExclusionReason } from "../domain/browserCompleteness.js";
import { exclusionReasonForUrl } from "./CdpCaptureEventHelpers.js";
import type { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import {
  createDocumentNamespaceAncestry,
  domXmlElement,
  type DomSvgNodeQuery,
  XHTML_NAMESPACE,
} from "./CdpCaptureDomNamespaces.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

export type CapturedResource = Omit<
  WebPageInspection["resources"][number],
  "resource_key"
> & { readonly rawUrl: string };

/** Normalize allowed frames and retain the enclosing tree's root identity. */
export const captureFrames = (
  result: unknown,
  allowedOrigins: ReadonlySet<string>,
  maximum?: number,
  completeness?: CdpCaptureCompleteness,
): {
  readonly items: WebPageInspection["frames"];
  readonly root: WebPageInspection["frames"][number] | undefined;
} => {
  const root = recordValue(recordValue(result)?.frameTree);
  if (root === undefined) {
    completeness?.exclude("frames", "invalid_protocol_value");
    return { items: [], root: undefined };
  }
  const items: WebPageInspection["frames"] = [];
  let rootFrame: WebPageInspection["frames"][number] | undefined;
  for (const tree of walkFrameTrees(root, (omittedCount) =>
    completeness?.exclude("frames", "invalid_protocol_value", omittedCount),
  )) {
    const frame = recordValue(tree.frame);
    const identity = cdpFrameRecordFacts(frame);
    const frameId = identity.frameId;
    const observation = observeCdpFrameUrl(frame);
    const scopeUrl =
      observation.kind === "missing" ? undefined : observation.scopeUrl;
    const facts = classifyCdpFrameUrl(observation, allowedOrigins);
    if (frameId === null) {
      completeness?.exclude("frames", "invalid_protocol_value");
      continue;
    }
    if (observation.kind === "invalid_fragment") {
      completeness?.exclude("frames", "invalid_protocol_value");
      if (facts.scope !== "approved")
        completeness?.exclude("frames", exclusionReasonForUrl(scopeUrl));
      continue;
    }
    if (facts.url === undefined || facts.origin === null) {
      completeness?.exclude("frames", exclusionReasonForUrl(scopeUrl));
      continue;
    }
    if (maximum !== undefined && items.length >= maximum) continue;
    // Only the enclosing tree's root may legitimately omit parent evidence.
    if (
      identity.parentIssue !== null ||
      (tree !== root && identity.parentRelation === "root")
    )
      completeness?.exclude("frames", "invalid_protocol_value");
    const captured = {
      frame_id: frameId,
      parent_frame_id: identity.parentId,
      url: facts.url,
      origin: facts.origin,
    };
    items.push(captured);
    if (tree === root && identity.parentRelation === "root")
      rootFrame = captured;
  }
  return { items, root: rootFrame };
};

export type CdpFrameUrlObservation =
  | {
      readonly kind: "observed";
      readonly url: string;
      readonly scopeUrl: string;
    }
  | { readonly kind: "invalid_fragment"; readonly scopeUrl: string }
  | { readonly kind: "missing" };

/** Parse identity and scope facts once; an invalid fragment cannot erase its base origin. */
export const observeCdpFrameUrl = (
  frame: UnknownRecord | undefined,
): CdpFrameUrlObservation => {
  const url = cdpStringValue(frame?.url);
  if (url === undefined) return { kind: "missing" };
  if (frame?.urlFragment === undefined)
    return { kind: "observed", url, scopeUrl: url };
  const fragment = cdpStringValue(frame.urlFragment);
  if (fragment === undefined || (fragment !== "" && !fragment.startsWith("#")))
    return { kind: "invalid_fragment", scopeUrl: url };
  return {
    kind: "observed",
    url: `${url.split("#", 1)[0] ?? ""}${fragment}`,
    scopeUrl: url,
  };
};

export const observeMainFrameUrl = (result: unknown): CdpFrameUrlObservation =>
  observeCdpFrameUrl(
    recordValue(recordValue(requiredRecord(result).frameTree)?.frame),
  );

/** Policy and readable identity are independent facts, including on malformed frames. */
export const classifyCdpFrameUrl = (
  observation: CdpFrameUrlObservation,
  allowedOrigins: ReadonlySet<string>,
): {
  readonly scope: "approved" | "outside_policy" | "unsupported" | "unknown";
  readonly origin: string | null;
  readonly url: string | undefined;
} => {
  if (observation.kind === "missing")
    return { scope: "unknown", origin: null, url: undefined };
  const base = sanitizeBrowserUrl(observation.scopeUrl);
  const scope =
    base.origin === null
      ? "unsupported"
      : allowedOrigins.has(base.origin)
        ? "approved"
        : "outside_policy";
  return {
    scope,
    origin: base.origin,
    url:
      observation.kind === "observed" && scope === "approved"
        ? sanitizeBrowserUrl(observation.url).url
        : undefined,
  };
};

/** Read the complete identity only when the protocol established it. */
export const cdpFrameUrl = (
  frame: UnknownRecord | undefined,
): string | undefined => {
  const observed = observeCdpFrameUrl(frame);
  return observed.kind === "observed" ? observed.url : undefined;
};

export const mainFrameUrl = (result: unknown): string | undefined => {
  const observed = observeMainFrameUrl(result);
  return observed.kind === "observed" ? observed.url : undefined;
};

/** Normalize every allowed resource. */
export const captureResources = (
  result: unknown,
  allowedOrigins: ReadonlySet<string>,
  completeness?: CdpCaptureCompleteness,
): {
  readonly items: readonly CapturedResource[];
} => {
  const root = recordValue(recordValue(result)?.frameTree);
  if (root === undefined) {
    completeness?.exclude("resources", "invalid_protocol_value");
    return { items: [] };
  }
  const items: CapturedResource[] = [];
  for (const resource of frameTreeResources(root, (count) =>
    completeness?.exclude("resources", "invalid_protocol_value", count),
  )) {
    const url = allowedSanitizedUrl(resource.url, allowedOrigins);
    if (url === undefined || url.origin === null) {
      completeness?.exclude(
        "resources",
        exclusionReasonForUrl(cdpStringValue(resource.url)),
      );
      continue;
    }
    const type = cdpStringValue(resource.type);
    const mimeType = cdpStringValue(resource.mimeType);
    if (type === undefined || type.length === 0 || mimeType === undefined) {
      completeness?.exclude("resources", "invalid_protocol_value");
      continue;
    }
    const contentSize = resourceContentSize(resource.contentSize);
    if (!contentSize.ok)
      completeness?.exclude("resources", "invalid_protocol_value");
    items.push({
      rawUrl: cdpStringValue(resource.url) ?? "",
      url: url.url,
      origin: url.origin,
      type,
      mime_type: mimeType,
      content_size: contentSize.ok ? contentSize.value : null,
    });
  }
  return { items };
};

/**
 * Yield resource records from every frame of a resource tree. A missing or
 * non-array `resources` list, or a non-record entry, is reported as invalid
 * rather than read as an empty frame.
 */
export const frameTreeResources = function* (
  root: UnknownRecord,
  onInvalid: (count: number | null) => void,
): Generator<UnknownRecord> {
  for (const tree of walkFrameTrees(root, onInvalid)) {
    if (!Array.isArray(tree.resources)) {
      onInvalid(null);
      continue;
    }
    for (const entry of tree.resources) {
      const resource = recordValue(entry);
      if (resource === undefined) onInvalid(1);
      else yield resource;
    }
  }
};

export const walkFrameTrees = function* (
  root: UnknownRecord,
  onMalformedChild?: (omittedCount: number | null) => void,
): Generator<UnknownRecord> {
  const pending = [root];
  while (pending.length > 0) {
    const tree = pending.pop();
    if (tree === undefined) return;
    const rawChildren = tree.childFrames;
    if (rawChildren !== undefined && !Array.isArray(rawChildren))
      onMalformedChild?.(null);
    const children = Array.isArray(rawChildren)
      ? rawChildren.flatMap((child) => {
          const parsed = recordValue(child);
          if (parsed === undefined) onMalformedChild?.(null);
          return parsed === undefined ? [] : [parsed];
        })
      : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) pending.push(child);
    }
    yield tree;
  }
};

interface DomMetadataCapture {
  readonly urls: WebPageInspection["metadata"]["dom_urls"];
  readonly agentHints: WebPageInspection["metadata"]["agent_hints"];
  readonly excludedUrls: number;
  readonly unresolvedSvgNodes: number;
}

export interface DomCapture extends DomMetadataCapture {
  readonly total: number;
  readonly nodeValueLengthUnit: "utf16-code-units";
  readonly nodes: WebPageInspection["dom"]["nodes"];
}

// Bound retained projections and outstanding CDP reads independently of page size.
// Eight leaves room for the session's other cancellation listeners.
const DOM_METADATA_BATCH_SIZE = 8;

interface PendingDomMetadata {
  readonly options: DomMetadataOptions;
  // Undefined means no query is needed; null means the candidate has no valid ID.
  readonly svgQuery: DomSvgNodeQuery | null | undefined;
}

/** Project one snapshot, requesting bounded batches of SVG identity facts. */
export function* captureDom(
  result: unknown,
  allowedOrigins: ReadonlySet<string>,
  input: InspectWebPageInput,
  completeness?: CdpCaptureCompleteness,
): Generator<
  readonly DomSvgNodeQuery[],
  DomCapture,
  readonly (boolean | undefined)[]
> {
  const root = requiredRecord(result);
  const strings = Array.isArray(root.strings)
    ? root.strings.map(cdpStringValue)
    : [];
  const nodes: WebPageInspection["dom"]["nodes"] = [];
  const urls: WebPageInspection["metadata"]["dom_urls"] = [];
  const agentHints: WebPageInspection["metadata"]["agent_hints"] = [];
  let excludedUrls = 0;
  let total = 0;
  let unresolvedSvgNodes = 0;
  if (!Array.isArray(root.strings))
    excludeDocumentEvidence(completeness, "invalid_protocol_value", null);
  for (const document of snapshotDocuments(root.documents, (count) =>
    excludeDocumentEvidence(completeness, "invalid_protocol_value", count),
  )) {
    const documentUrl = cdpSnapshotString(strings, document.documentURL);
    if (documentUrl === undefined) {
      excludeDocumentEvidence(completeness, "invalid_protocol_value");
      continue;
    }
    if (allowedSanitizedUrl(documentUrl, allowedOrigins) === undefined) {
      excludeDocumentEvidence(completeness, exclusionReasonForUrl(documentUrl));
      continue;
    }
    const baseUrlValue =
      document.baseURL === undefined
        ? documentUrl
        : cdpSnapshotValueString(strings, document.baseURL);
    if (baseUrlValue === undefined) {
      excludeDocumentEvidence(completeness, "invalid_protocol_value");
      continue;
    }
    const baseUrl = baseUrlValue || documentUrl;
    const documentNodes = snapshotDocumentNodes(document.nodes, strings);
    if (documentNodes === undefined) {
      excludeDocumentEvidence(completeness, "invalid_protocol_value");
      continue;
    }
    const { nodeTypes, backendNodeIds } = documentNodes;
    if (documentNodes.excessAttributes > 0)
      excludeDocumentEvidence(
        completeness,
        "invalid_protocol_value",
        documentNodes.excessAttributes,
      );
    const baseIndex = total;
    total += nodeTypes.length;
    const ancestry = createDocumentNamespaceAncestry(documentNodes);
    const pendingMetadata: PendingDomMetadata[] = [];
    for (let index = 0; index < nodeTypes.length; index += 1) {
      const admitted = snapshotNodeAt(documentNodes, index);
      if (!admitted.ok) {
        excludeDocumentEvidence(completeness, "invalid_protocol_value");
        continue;
      }
      const { nodeType, nodeName, nodeValue, parent, attributes } =
        admitted.value;
      const nodeIndex = baseIndex + index;
      const attributeNames = [...new Set(attributes.map(([name]) => name))];
      const domElement = domXmlElement(ancestry, index);
      const htmlTagName = domHtmlTagName(nodeName, domElement);
      if (domElement.xmlDocument === undefined)
        completeness?.exclude("metadata", "invalid_protocol_value");
      let svgQuery: DomSvgNodeQuery | null | undefined;
      if (
        domElement.xmlDocument === false &&
        nodeType === 1 &&
        attributeNames.includes("xlink:href") &&
        !attributeNames.includes("href")
      ) {
        const backendNodeId = backendNodeIds[index];
        svgQuery =
          backendNodeId !== undefined ? { backendNodeId, nodeName } : null;
      }
      nodes.push({
        index: nodeIndex,
        parent_index: parent < 0 ? -1 : baseIndex + parent,
        node_type: nodeType,
        node_name: nodeName,
        node_value_length: nodeValue.length,
        attribute_names: attributeNames,
      });
      pendingMetadata.push({
        svgQuery,
        options: {
          attributes,
          // The BASE element itself resolves against the document fallback URL.
          baseUrl: htmlTagName === "base" ? documentUrl : baseUrl,
          documentUrl,
          nodeIndex,
          htmlTagName,
          allowedOrigins,
          ...domElement,
        },
      });
      if (
        pendingMetadata.length === DOM_METADATA_BATCH_SIZE ||
        index === nodeTypes.length - 1
      ) {
        const metadata = yield* captureDomMetadata(
          pendingMetadata,
          completeness,
        );
        urls.push(...metadata.urls);
        agentHints.push(...metadata.agentHints);
        excludedUrls += metadata.excludedUrls;
        unresolvedSvgNodes += metadata.unresolvedSvgNodes;
        pendingMetadata.length = 0;
      }
    }
    if (pendingMetadata.length > 0) {
      const metadata = yield* captureDomMetadata(pendingMetadata, completeness);
      urls.push(...metadata.urls);
      agentHints.push(...metadata.agentHints);
      excludedUrls += metadata.excludedUrls;
      unresolvedSvgNodes += metadata.unresolvedSvgNodes;
      pendingMetadata.length = 0;
    }
  }
  return {
    total,
    nodeValueLengthUnit: "utf16-code-units",
    nodes,
    urls,
    agentHints,
    excludedUrls,
    unresolvedSvgNodes,
  };
}

/** Skipped document facts also make their derived URL and hint inventory incomplete. */
const excludeDocumentEvidence = (
  completeness: CdpCaptureCompleteness | undefined,
  reason: BrowserExclusionReason,
  count: number | null = 1,
): void => {
  completeness?.exclude("dom", reason, count);
  completeness?.exclude("metadata", reason, count);
};

/**
 * Read DOMSnapshot documents. A snapshot always describes at least one
 * document, so a missing or empty list is invalid rather than an empty DOM.
 */
export const snapshotDocuments = (
  value: unknown,
  onInvalid: (count: number | null) => void,
): readonly UnknownRecord[] => {
  if (!Array.isArray(value) || value.length === 0) {
    onInvalid(null);
    return [];
  }
  return value.flatMap((item) => {
    const document = recordValue(item);
    if (document === undefined) onInvalid(1);
    return document === undefined ? [] : [document];
  });
};

function* captureDomMetadata(
  pending: readonly PendingDomMetadata[],
  completeness: CdpCaptureCompleteness | undefined,
): Generator<
  readonly DomSvgNodeQuery[],
  DomMetadataCapture,
  readonly (boolean | undefined)[]
> {
  const queries = pending.flatMap(({ svgQuery }) =>
    svgQuery == null ? [] : [svgQuery],
  );
  const kinds = queries.length > 0 ? yield queries : [];
  const urls: DomMetadataCapture["urls"] = [];
  const agentHints: DomMetadataCapture["agentHints"] = [];
  let queryIndex = 0;
  let unresolvedSvgNodes = 0;
  let excludedUrls = 0;
  for (const { options, svgQuery } of pending) {
    let svgElement = options.svgElement;
    if (svgQuery !== undefined) {
      const kind = svgQuery === null ? undefined : kinds[queryIndex++];
      svgElement = kind === true;
      if (kind === undefined) {
        unresolvedSvgNodes += 1;
        completeness?.exclude("metadata", "provider_unavailable");
      }
    }
    const metadata = domMetadata({ ...options, svgElement });
    for (const url of metadata.urls) {
      urls.push(url);
      if (url.destination_scope !== "approved") {
        excludedUrls += 1;
        completeness?.exclude(
          "metadata",
          url.destination_scope === "outside_policy"
            ? "disallowed_origin"
            : "unsupported_url",
        );
      }
    }
    agentHints.push(...metadata.agentHints);
  }
  return { urls, agentHints, unresolvedSvgNodes, excludedUrls };
}

export const captureAccessibility = (
  results: readonly unknown[],
  options: {
    readonly includeText: boolean;
    readonly unavailable?: boolean;
    readonly completeness?: CdpCaptureCompleteness;
  },
): {
  readonly total: number;
  readonly nodes: WebPageInspection["accessibility"]["nodes"];
  readonly textCapture: WebPageInspection["accessibility"]["text_capture"];
  readonly hasUnobservedChildren: boolean;
} => {
  const all = results.flatMap((result) => {
    const inventory = admitRecords(requiredRecord(result).nodes);
    if (inventory === undefined) {
      options.completeness?.exclude(
        "accessibility",
        "invalid_protocol_value",
        null,
      );
      return [];
    }
    const nodes: {
      readonly nodeId: string;
      readonly parentId: string | null;
      readonly childIds: readonly string[];
      readonly ignored: boolean;
      readonly role: unknown;
      readonly name: unknown;
      readonly description: unknown;
      readonly properties: unknown;
    }[] = [];
    let malformedCount = 0;
    for (const entry of inventory) {
      const node = recordValue(entry);
      const nodeId = cdpStringValue(node?.nodeId);
      if (
        node === undefined ||
        nodeId === undefined ||
        nodeId.length === 0 ||
        typeof node.ignored !== "boolean"
      ) {
        malformedCount += 1;
        continue;
      }
      const parentId = cdpStringValue(node.parentId);
      if (
        node.parentId !== undefined &&
        (parentId === undefined || parentId.length === 0)
      )
        malformedCount += 1;
      const childIds = Array.isArray(node.childIds)
        ? node.childIds.filter(
            (childId): childId is string =>
              typeof childId === "string" && childId.length > 0,
          )
        : [];
      if (
        node.childIds !== undefined &&
        (!Array.isArray(node.childIds) ||
          childIds.length !== node.childIds.length)
      )
        malformedCount += 1;
      // Identity admission owns these facts. Projection and coverage consume
      // the same parsed IDs, including usable siblings of malformed fields.
      nodes.push({
        nodeId,
        parentId:
          parentId === undefined || parentId.length === 0 ? null : parentId,
        childIds,
        ignored: node.ignored,
        role: node.role,
        name: node.name,
        description: node.description,
        properties: node.properties,
      });
    }
    if (malformedCount > 0)
      options.completeness?.exclude(
        "accessibility",
        "invalid_protocol_value",
        malformedCount,
      );
    return nodes;
  });
  const nodeIds = new Set(all.map((node) => node.nodeId));
  let excludedFields = 0;
  const nodes = all.map((node) => {
    const captureText = (value: unknown): string | null => {
      const raw = cdpStringValue(recordValue(value)?.value);
      if (raw === undefined) return null;
      if (!options.includeText) {
        excludedFields += 1;
        return null;
      }
      return raw;
    };
    return {
      node_id: node.nodeId,
      parent_id: node.parentId,
      role: axText(node.role),
      name: captureText(node.name),
      description: captureText(node.description),
      ignored: node.ignored,
      states: accessibilityStates(node.properties),
    };
  });
  return {
    total: all.length,
    nodes,
    hasUnobservedChildren: all.some((node) =>
      node.childIds.some((childId) => !nodeIds.has(childId)),
    ),
    textCapture: {
      status: options.unavailable
        ? "unavailable"
        : !options.includeText
          ? "not_approved"
          : "included",
      retained_bytes: nodes.reduce(
        (total, node) =>
          total +
          Buffer.byteLength(node.name ?? "") +
          Buffer.byteLength(node.description ?? ""),
        0,
      ),
      excluded_fields: excludedFields,
    },
  };
};

const ACCESSIBILITY_STATE_NAMES = new Set([
  "atomic",
  "autocomplete",
  "busy",
  "checked",
  "disabled",
  "editable",
  "expanded",
  "focusable",
  "focused",
  "hasPopup",
  "hidden",
  "invalid",
  "level",
  "live",
  "modal",
  "multiline",
  "multiselectable",
  "orientation",
  "pressed",
  "readonly",
  "required",
  "selected",
  "valuemax",
  "valuemin",
]);

const accessibilityStates = (
  value: unknown,
): WebPageInspection["accessibility"]["nodes"][number]["states"] => {
  const states = new Map<string, boolean | number | string>();
  for (const property of recordsValue(value)) {
    const name = cdpStringValue(property.name);
    if (name === undefined || !ACCESSIBILITY_STATE_NAMES.has(name)) continue;
    const raw = recordValue(property.value)?.value;
    const state =
      typeof raw === "boolean"
        ? raw
        : typeof raw === "number"
          ? numberValue(raw)
          : typeof raw === "string"
            ? raw
            : undefined;
    if (state !== undefined) states.set(name, state);
  }
  return [...states]
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
    .map(([name, state]) => ({ name, value: state }));
};

const axText = (value: unknown): string | null =>
  cdpStringValue(recordValue(value)?.value) ?? null;

interface DomMetadataOptions {
  readonly attributes: SnapshotAttributes;
  readonly baseUrl: string;
  readonly documentUrl: string;
  readonly nodeIndex: number;
  readonly htmlTagName: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly svgElement: boolean;
  readonly xmlDocument: boolean | undefined;
  readonly elementNamespace: string | undefined;
  readonly localName: string | undefined;
  readonly xlinkHref: string | undefined;
}

/** Interpret the element once using its resolved namespace, not its raw prefix. */
const domHtmlTagName = (
  nodeName: string,
  element: Pick<
    DomMetadataOptions,
    "xmlDocument" | "elementNamespace" | "localName"
  >,
): string =>
  element.xmlDocument === false
    ? nodeName.toLowerCase()
    : element.xmlDocument === true &&
        element.elementNamespace === XHTML_NAMESPACE
      ? (element.localName ?? "")
      : "";

// Chrome reads an SVG XLink href only when href itself is absent, and an
// empty href still wins. HTML keeps the literal attribute name `xlink:href`.
// XML uses any prefix bound to the XLink namespace. Both are stored as href.
const hrefAttributeValue = (
  pairs: ReadonlyMap<string, string>,
  attribute: string,
  options: DomMetadataOptions,
): string | undefined => {
  const declared = pairs.get(attribute);
  if (declared !== undefined) return declared;
  if (attribute !== "href" || !options.svgElement) return undefined;
  return options.xmlDocument ? options.xlinkHref : pairs.get("xlink:href");
};

const domMetadata = (
  options: DomMetadataOptions,
): {
  readonly urls: WebPageInspection["metadata"]["dom_urls"];
  readonly agentHints: WebPageInspection["metadata"]["agent_hints"];
} => {
  const {
    attributes,
    baseUrl,
    documentUrl,
    nodeIndex,
    htmlTagName,
    allowedOrigins,
  } = options;
  const pairs = new Map<string, string>();
  for (const [name, value] of attributes) {
    // HTML keeps the first declaration; SVG/XML spelling stays case-sensitive.
    if (!pairs.has(name)) pairs.set(name, value);
  }
  const tagName = htmlTagName;
  const urls: WebPageInspection["metadata"]["dom_urls"] = [];
  for (const attribute of domUrlAttributes) {
    const value = hrefAttributeValue(pairs, attribute, options);
    if (value === undefined) continue;
    // Chrome strips HTML whitespace for FORM.action, while submit controls
    // use the document URL only for an exactly empty formaction attribute.
    const usesDocumentUrl =
      (tagName === "form" &&
        attribute === "action" &&
        /^[\t\n\f\r ]*$/u.test(value)) ||
      ((tagName === "button" || tagName === "input") &&
        attribute === "formaction" &&
        value === "");
    const destination = domDestination(
      usesDocumentUrl ? documentUrl : value,
      baseUrl,
      allowedOrigins,
    );
    urls.push({
      node_index: nodeIndex,
      attribute,
      url: destination.url,
      destination_scope: destination.scope,
    });
  }
  const rel = (pairs.get("rel") ?? "")
    .toLowerCase()
    // HTML link type tokens are separated by ASCII whitespace only.
    .split(/[\t\n\f\r ]+/u)
    .filter((value) => agentRelValues.includes(value));
  const href = urls.find(({ attribute }) => attribute === "href")?.url ?? null;
  const agentHints =
    tagName === "link" && rel.length > 0
      ? rel.map((declaration) => ({
          mechanism: "dom_link_rel" as const,
          declaration,
          url: href,
          trust: "page-declared-untrusted" as const,
        }))
      : [];
  return { urls, agentHints };
};

const domDestination = (
  value: string,
  baseUrl: string,
  allowedOrigins: ReadonlySet<string>,
): {
  readonly url: string | null;
  readonly scope: "approved" | "outside_policy" | "unsupported";
} => {
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return { url: null, scope: "unsupported" };
    if (!allowedOrigins.has(parsed.origin))
      return { url: null, scope: "outside_policy" };
    return {
      url: allowedSanitizedUrl(parsed.href, allowedOrigins)?.url ?? null,
      scope: "approved",
    };
  } catch (cause: unknown) {
    // Unparseable URLs are out of scope, not failures.
    void cause;
    return { url: null, scope: "unsupported" };
  }
};

const domUrlAttributes = [
  "href",
  "src",
  "action",
  "formaction",
  "poster",
] as const;
const agentRelValues = ["mcp", "model-context", "ai-plugin", "service-desc"];
