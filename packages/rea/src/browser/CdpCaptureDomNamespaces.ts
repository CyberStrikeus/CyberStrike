import { recordValue } from "./CdpCaptureValues.js";
import type {
  SnapshotDocumentNodes,
  SnapshotAttributes,
} from "./CdpSnapshotNodes.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
export const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

type DomSnapshotNodes = Pick<
  SnapshotDocumentNodes,
  "nodeTypes" | "nodeNames" | "parents" | "attributes"
>;

interface XmlElementNamespace {
  readonly svgElement: boolean;
  readonly elementNamespace: string | undefined;
  readonly localName: string | undefined;
  readonly xlinkHref: string | undefined;
}

interface DocumentNamespaceAncestry {
  readonly xml: boolean | undefined;
  readonly xmlElements: Map<number, XmlElementNamespace>;
}

export interface DomSvgNodeQuery {
  readonly backendNodeId: number;
  readonly nodeName: string;
}

/** Bind the browser's SVG flag to the exact snapshotted element. */
export const capturedSvgNodeKind = (
  query: DomSvgNodeQuery,
  result: unknown,
): boolean | undefined => {
  const node = recordValue(recordValue(result)?.node);
  if (
    node?.backendNodeId !== query.backendNodeId ||
    node.nodeName !== query.nodeName ||
    node.nodeType !== 1
  )
    return undefined;
  // CDP omits isSVG for non-SVG nodes. Other values are malformed, not false.
  return node.isSVG === undefined
    ? false
    : typeof node.isSVG === "boolean"
      ? node.isSVG
      : undefined;
};

interface DomXmlElement {
  readonly svgElement: boolean;
  readonly xmlDocument: boolean | undefined;
  readonly elementNamespace: string | undefined;
  readonly localName: string | undefined;
  readonly xlinkHref: string | undefined;
}

// DOMSnapshot has no namespace URI. HTML documents use uppercase `HTML` and
// the parser's local names. XML documents preserve prefixed names and xmlns
// declarations, including those on standalone SVG roots.
const xmlDocument = (nodes: DomSnapshotNodes): boolean | undefined => {
  const documentIndex = nodes.nodeTypes.findIndex((nodeType) => nodeType === 9);
  if (documentIndex < 0) return false;
  if (
    svgSourceNode(nodes, documentIndex) === undefined ||
    nodes.parents[documentIndex] !== -1
  )
    return undefined;
  for (let index = 0; index < nodes.nodeTypes.length; index += 1) {
    if (nodes.nodeTypes[index] !== 1) continue;
    if (nodes.parents[index] !== documentIndex) continue;
    const source = svgSourceNode(nodes, index);
    if (source === undefined) return undefined;
    const name = source.nodeName;
    if (name === "HTML") return false;
    if (name === "html" || name.includes(":")) return true;
    // Explicit namespaces also identify standalone SVG and other XML roots.
    // Namespace-free synthetic snapshots retain the legacy HTML behavior.
    const attributes = source.attributes;
    for (const [attributeName] of attributes)
      if (xmlnsPrefix(attributeName) !== undefined) return true;
    return false;
  }
  return false;
};

export const createDocumentNamespaceAncestry = (
  nodes: DomSnapshotNodes,
): DocumentNamespaceAncestry => {
  const xml = xmlDocument(nodes);
  return {
    xml,
    xmlElements: xml === true ? resolveXmlElements(nodes) : new Map(),
  };
};

export const domXmlElement = (
  ancestry: DocumentNamespaceAncestry,
  index: number,
): DomXmlElement => {
  if (ancestry.xml === false) {
    return {
      svgElement: false,
      xmlDocument: false,
      elementNamespace: undefined,
      localName: undefined,
      xlinkHref: undefined,
    };
  }
  if (ancestry.xml === undefined) {
    return {
      svgElement: false,
      xmlDocument: undefined,
      elementNamespace: undefined,
      localName: undefined,
      xlinkHref: undefined,
    };
  }
  const resolved = ancestry.xmlElements.get(index);
  if (resolved === undefined) {
    return {
      svgElement: false,
      xmlDocument: undefined,
      elementNamespace: undefined,
      localName: undefined,
      xlinkHref: undefined,
    };
  }
  return {
    svgElement: resolved.svgElement,
    xmlDocument: true,
    elementNamespace: resolved.elementNamespace,
    localName: resolved.localName,
    xlinkHref: resolved.xlinkHref,
  };
};

interface NamespaceRestore {
  readonly prefix: string;
  readonly previous: string | undefined;
}

type XmlWalkStep =
  | { readonly node: number }
  | { readonly restore: readonly NamespaceRestore[] };

// Walk parent-before-child with one mutable namespace environment. Restore
// declarations on exit so siblings retain their own scope. Only declarations
// on the active path are retained, rather than cumulative maps at every node.
const resolveXmlElements = (
  nodes: DomSnapshotNodes,
): Map<number, XmlElementNamespace> => {
  const children = new Map<number, number[]>();
  const pending: XmlWalkStep[] = [];
  for (let node = 0; node < nodes.nodeNames.length; node += 1) {
    const parent = nodes.parents[node];
    if (parent === undefined) continue;
    if (parent < 0) pending.push({ node });
    else {
      const siblings = children.get(parent);
      if (siblings === undefined) children.set(parent, [node]);
      else siblings.push(node);
    }
  }
  const bindings = new Map<string, string>();
  const resolved = new Map<number, XmlElementNamespace>();
  while (pending.length > 0) {
    const step = pending.pop();
    if (step === undefined) break;
    if ("restore" in step) {
      for (const { prefix, previous } of step.restore) {
        if (previous === undefined) bindings.delete(prefix);
        else bindings.set(prefix, previous);
      }
      continue;
    }
    const { node } = step;
    const source = svgSourceNode(nodes, node);
    if (source === undefined) continue;
    const attributes = source.attributes;
    const restore = applyDeclarations(bindings, attributes);
    const expandedName = elementExpandedName(source.nodeName, bindings);
    const svgElement =
      source.nodeType === 1 && expandedName?.namespace === SVG_NAMESPACE;
    resolved.set(node, {
      svgElement,
      elementNamespace: expandedName?.namespace,
      localName: expandedName?.localName,
      xlinkHref: svgElement ? xlinkHrefValue(attributes, bindings) : undefined,
    });
    pending.push({ restore });
    for (const child of children.get(node) ?? []) pending.push({ node: child });
  }
  // Cycles (including self-parents) and dangling chains cannot reach a root,
  // so remain unresolved instead of deriving URLs from an invalid ancestry.
  return resolved;
};

const applyDeclarations = (
  bindings: Map<string, string>,
  attributes: SnapshotAttributes,
): readonly NamespaceRestore[] => {
  const restore: NamespaceRestore[] = [];
  const seen = new Set<string>();
  for (const [name, value] of attributes) {
    const prefix = xmlnsPrefix(name);
    if (prefix === undefined || seen.has(prefix)) continue;
    seen.add(prefix);
    restore.push({ prefix, previous: bindings.get(prefix) });
    if (value.length === 0) bindings.delete(prefix);
    else bindings.set(prefix, value);
  }
  return restore;
};

const xmlnsPrefix = (name: string | undefined): string | undefined => {
  if (name === undefined) return undefined;
  if (name === "xmlns") return "";
  if (!name.startsWith("xmlns:")) return undefined;
  const prefix = name.slice("xmlns:".length);
  if (prefix.length === 0 || prefix === "xmlns" || prefix.includes(":"))
    return undefined;
  return prefix;
};

const elementExpandedName = (
  nodeName: string | undefined,
  bindings: ReadonlyMap<string, string>,
): { readonly namespace: string; readonly localName: string } | undefined => {
  if (nodeName === undefined) return undefined;
  const colon = nodeName.indexOf(":");
  if (colon < 0)
    return { namespace: bindings.get("") ?? "", localName: nodeName };
  const prefix = nodeName.slice(0, colon);
  const local = nodeName.slice(colon + 1);
  if (
    prefix.length === 0 ||
    local.length === 0 ||
    local.includes(":") ||
    prefix === "xmlns"
  )
    return undefined;
  const namespace = bindings.get(prefix);
  return namespace === undefined ? undefined : { namespace, localName: local };
};

// First prefixed href bound to the XLink namespace. Duplicate names keep the
// earlier value. Plain href is applied by the caller and wins even when empty.
const xlinkHrefValue = (
  attributes: SnapshotAttributes,
  bindings: ReadonlyMap<string, string>,
): string | undefined => {
  const seen = new Set<string>();
  for (const [name, value] of attributes) {
    if (seen.has(name)) continue;
    seen.add(name);
    const colon = name.indexOf(":");
    if (colon <= 0) continue;
    const prefix = name.slice(0, colon);
    const local = name.slice(colon + 1);
    if (local !== "href" || bindings.get(prefix) !== XLINK_NAMESPACE) continue;
    return value;
  }
  return undefined;
};

// Namespace interpretation needs these parsed facts even when a node value is unknown.
const svgSourceNode = (nodes: DomSnapshotNodes, index: number) => {
  const nodeType = nodes.nodeTypes[index];
  const nodeName = nodes.nodeNames[index];
  const attributes = nodes.attributes[index];
  return nodeType === undefined ||
    nodeName === undefined ||
    attributes === undefined
    ? undefined
    : { nodeType, nodeName, attributes };
};
