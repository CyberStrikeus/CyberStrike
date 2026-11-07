import {
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationNode,
} from "../../domain/javascript/javascriptApplicationGraph.js";
import type {
  ApplicationEdge,
  ApplicationNode,
} from "../../domain/javascript/javascriptApplicationGraphSchemas.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";

/**
 * Own live construction nodes and deduplicate their evidence observations.
 * Consumers retain references but must not mutate the owned observations;
 * nodes() finalizes their canonical order before graph validation/output.
 */
export class JavaScriptArtifactGraphAccumulator {
  readonly #nodes = new Map<string, AccumulatedNode>();
  readonly #edges = new Map<string, ApplicationEdge>();

  /** Merge observations into a stable live node; order is finalized by nodes(). */
  addNode<Input extends DisplayableNodeInput>(input: Input): ApplicationNode {
    const created = createJavaScriptApplicationNode(displayableNode(input));
    const existing = this.#nodes.get(created.node_id);
    if (existing === undefined) {
      this.#nodes.set(created.node_id, {
        node: created,
        observationIndices: new Map(
          created.observations.map((observation, index) => [
            observation.observation_id,
            index,
          ]),
        ),
        dirty: false,
      });
      return created;
    }
    const observations = existing.node.observations;
    // The first factory input can contain duplicate IDs. As before, a later
    // merge retains only their last occurrences without replacing the array.
    if (existing.observationIndices.size !== observations.length) {
      let retained = 0;
      for (const [index, observation] of observations.entries()) {
        if (
          existing.observationIndices.get(observation.observation_id) !== index
        )
          continue;
        observations[retained] = observation;
        existing.observationIndices.set(observation.observation_id, retained);
        retained += 1;
      }
      observations.length = retained;
    }
    for (const observation of created.observations) {
      const index = existing.observationIndices.get(observation.observation_id);
      if (index === undefined) {
        existing.observationIndices.set(
          observation.observation_id,
          observations.length,
        );
        observations.push(observation);
        existing.dirty = true;
      } else observations[index] = observation;
    }
    return existing.node;
  }

  /** Create or replace one canonical edge by semantic identifier. */
  addEdge(input: unknown): ApplicationEdge {
    const edge = createJavaScriptApplicationEdge(input);
    this.#edges.set(edge.edge_id, edge);
    return edge;
  }

  /** Finalize observation order in place and return all canonical nodes. */
  nodes(): readonly ApplicationNode[] {
    return [...this.#nodes.values()].map((entry) => {
      if (entry.dirty) {
        entry.node.observations.sort((left, right) =>
          compareUnicodeCodePoints(left.observation_id, right.observation_id),
        );
        entry.observationIndices.clear();
        for (const [index, observation] of entry.node.observations.entries())
          entry.observationIndices.set(observation.observation_id, index);
        entry.dirty = false;
      }
      return entry.node;
    });
  }

  /** Return all accumulated canonical edges. */
  edges(): readonly ApplicationEdge[] {
    return [...this.#edges.values()];
  }
}

interface AccumulatedNode {
  readonly node: ApplicationNode;
  readonly observationIndices: Map<string, number>;
  dirty: boolean;
}

/** Node fields whose display form is normalized before validation. */
interface DisplayableNodeInput {
  readonly observations: readonly { readonly label: string | null }[];
}

/**
 * Static findings can carry legal empty strings, such as `fetch("")`,
 * `require("")`, or a source map's `sources: [""]`. Labels must be nonempty,
 * so an empty value has no label rather than synthetic text that a real value
 * could share; literal feature seeds match labels. Identities and observation
 * properties keep the exact value.
 */
const displayableNode = (
  input: DisplayableNodeInput,
): DisplayableNodeInput => ({
  ...input,
  observations: input.observations.map((observation) => ({
    ...observation,
    label: observation.label === "" ? null : observation.label,
  })),
});
