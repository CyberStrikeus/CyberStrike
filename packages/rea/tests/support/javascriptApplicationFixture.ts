import { reconstructJavaScriptArtifact } from "./javascriptApplicationScope.js";
import type {
  ApplicationEdge,
  ApplicationNode,
} from "../../src/domain/javascript/javascriptApplicationGraphSchemas.js";
import type { JavaScriptApplicationGraph } from "../../src/domain/javascript/javascriptApplicationGraph.js";

export { writeFixtureFiles } from "./workspace/writeFixtureFiles.js";

/** Reconstruct one JavaScript artifact fixture directory. */
export const reconstructJavaScriptFixture = (
  inputPath: string,
): Promise<Awaited<ReturnType<typeof reconstructJavaScriptArtifact>>> =>
  reconstructJavaScriptArtifact({ input_path: inputPath });

/** Find a bundler chunk node by runtime and chunk key. */
export const findChunkNode = (
  graph: JavaScriptApplicationGraph,
  runtime: string,
  chunkKey: string,
): ApplicationNode | undefined =>
  graph.nodes.find(
    ({ kind, observations }) =>
      kind === "javascript-chunk" &&
      observations.some(
        ({ properties }) =>
          properties.runtime === runtime &&
          Array.isArray(properties.chunk_keys) &&
          properties.chunk_keys.includes(chunkKey),
      ),
  );

/** Find a bundler module node by module key. */
export const findModuleNodeByKey = (
  graph: JavaScriptApplicationGraph,
  moduleKey: string,
): ApplicationNode | undefined =>
  graph.nodes.find(
    ({ kind, observations }) =>
      kind === "javascript-module" &&
      observations.some(
        ({ properties }) => properties.module_key === moduleKey,
      ),
  );

/** Find one directed edge between two application nodes. */
export const findGraphEdge = (
  graph: JavaScriptApplicationGraph,
  source: ApplicationNode | undefined,
  target: ApplicationNode | undefined,
  relation: string,
): ApplicationEdge | undefined =>
  graph.edges.find(
    ({ source_node_id, target_node_id, relation: edgeRelation }) =>
      source !== undefined &&
      target !== undefined &&
      source_node_id === source.node_id &&
      target_node_id === target.node_id &&
      edgeRelation === relation,
  );

/** Module-link facts used to query one import edge. */
export interface RelationshipQuery {
  readonly kind: string;
  readonly specifier: string;
  readonly resolvedPath?: string;
  readonly importedName?: string;
  readonly localName?: string;
  readonly exportedName?: string;
}

/** Find one module-link import edge matching the query. */
export const findRelationshipEdge = (
  graph: JavaScriptApplicationGraph,
  query: RelationshipQuery,
): ApplicationEdge | undefined =>
  graph.edges.find(
    ({ relation, properties }) =>
      relation === "imports" &&
      properties.module_link_kind === query.kind &&
      properties.specifier === query.specifier &&
      (query.resolvedPath === undefined ||
        properties.resolved_path === query.resolvedPath) &&
      (query.importedName === undefined ||
        properties.imported_name === query.importedName) &&
      (query.localName === undefined ||
        properties.local_name === query.localName) &&
      (query.exportedName === undefined ||
        properties.exported_name === query.exportedName),
  );

/** Find a source module node by logical path. */
export const findSourceModule = (
  graph: JavaScriptApplicationGraph,
  path: string,
): ApplicationNode | undefined =>
  graph.nodes.find(
    (node) =>
      node.kind === "javascript-module" &&
      node.observations.some(
        ({ properties }) => properties.logical_module_key === path,
      ),
  );

/** Find one export-binding node by module path and export name. */
export const findExportNode = (
  graph: JavaScriptApplicationGraph,
  path: string,
  name: string,
): ApplicationNode | undefined =>
  graph.nodes.find(
    (node) =>
      node.kind === "javascript-module" &&
      node.observations.some(
        ({ properties }) =>
          properties.semantic_role === "export-binding" &&
          properties.module_path === path &&
          properties.exported_name === name,
      ),
  );
