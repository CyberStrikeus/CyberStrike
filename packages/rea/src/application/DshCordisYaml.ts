import { retainYamlSequenceAnnotations } from "./YamlSequenceAnnotations.js";
import { isDeepStrictEqual } from "node:util";
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Document,
  type Node,
  type YAMLMap,
  type Pair,
} from "yaml";
import { ConfigurationError } from "../domain/configurationErrors.js";

/** Expression source is never a literal value and is never evaluated by REA. */
export class CordisExpression {
  readonly kind = "cordis-expression";
  constructor(readonly source: string) {}
}

/** Immutable source graph; all alias resolution happens against this document. */
export class DshCordisYaml {
  readonly document: Document;
  readonly #values = new Map<Node, unknown>();
  readonly #visiting = new Set<Node>();

  constructor(text: string) {
    this.document = parseDocument(text, {
      customTags: [
        { tag: "tag:yaml.org,2002:js", resolve: (source: string) => source },
      ],
      logLevel: "silent",
    });
    if (this.document.errors.length > 0 || this.document.warnings.length > 0)
      throw new ConfigurationError("Invalid or unsupported Cordis YAML", {
        cause: this.document.errors[0] ?? this.document.warnings[0],
      });
    if (this.document.contents === null)
      this.document.contents = this.document.createNode([]);
    if (!isSeq(this.document.contents))
      throw new ConfigurationError(
        "Cordis patches must be a YAML operation list",
      );
    this.value(this.document.contents);
    try {
      // Retain YAML's native alias-expansion admission before copying edits.
      // This value is discarded; source nodes own every Cordis interpretation.
      this.document.toJS();
    } catch (cause) {
      throw new ConfigurationError("Unsafe Cordis YAML alias expansion", {
        cause,
      });
    }
  }

  resolve(node: unknown): unknown {
    if (!isAlias(node)) return node;
    const resolved = node.resolve(this.document);
    if (resolved === undefined)
      throw new ConfigurationError("Cordis YAML contains an unresolved alias");
    return resolved;
  }

  value(node: unknown): unknown {
    const resolved = this.resolve(node);
    if (!isNode(resolved)) return resolved;
    if (this.#values.has(resolved)) return this.#values.get(resolved);
    if (this.#visiting.has(resolved))
      throw new ConfigurationError(
        "Cyclic Cordis YAML cannot be safely edited",
      );
    this.#visiting.add(resolved);
    let value: unknown;
    if (isScalar(resolved))
      value =
        resolved.tag === "tag:yaml.org,2002:js"
          ? new CordisExpression(String(resolved.value))
          : resolved.value;
    else if (isSeq(resolved))
      value = resolved.items.map((item) => this.value(item));
    else if (isMap(resolved)) {
      const entries: [string, unknown][] = [];
      for (const pair of resolved.items) {
        entries.push([this.key(pair.key), this.value(pair.value)]);
      }
      value = Object.fromEntries(entries);
    }
    this.#visiting.delete(resolved);
    this.#values.set(resolved, value);
    return value;
  }

  key(node: unknown): string {
    const key = this.value(node);
    if (typeof key === "object" && key !== null)
      throw new ConfigurationError(
        "Cordis YAML mapping keys must be literal scalars",
      );
    // Match YAML's JS object projection while retaining the original key node.
    return key === null ? "" : String(key);
  }

  /** A case-only rename retains source key/value comments on the chosen alias. */
  renameKey(map: YAMLMap, pair: Pair, key: string): void {
    const existing = map.items.find(
      (item) => item !== pair && this.key(item.key) === key,
    );
    const replacement = existing ?? pair;
    const carry = (source: unknown, target: unknown): void => {
      if (!isNode(source) || !isNode(target) || source === target) return;
      for (const name of ["comment", "commentBefore"] as const) {
        const values = [target[name], source[name]].filter(
          (value): value is string => value !== undefined,
        );
        if (values.length > 0) target[name] = [...new Set(values)].join("\n");
      }
    };
    if (existing !== undefined) {
      carry(pair.key, existing.key);
      carry(pair.value, existing.value);
      map.items = map.items.filter((item) => item !== pair);
    } else if (this.key(pair.key) !== key) {
      const renamed = this.document.createNode(key);
      carry(pair.key, renamed);
      replacement.key = renamed;
    }
  }

  field(map: YAMLMap | undefined, key: string): unknown {
    return map?.items.findLast((pair) => this.key(pair.key) === key)?.value;
  }

  /** Preserve unchanged nodes and carry their comments when replacing values. */
  setValue(map: YAMLMap, key: string, value: unknown): void {
    const pair = map.items.findLast((item) => this.key(item.key) === key);
    const original = pair?.value;
    if (isDeepStrictEqual(this.value(original), value)) return;
    const replacement = this.document.createNode(value);
    if (isNode(original) && isNode(replacement)) {
      if (original.comment !== undefined)
        replacement.comment = original.comment;
      if (original.commentBefore !== undefined)
        replacement.commentBefore = original.commentBefore;
    }
    if (isSeq(original) && isSeq(replacement)) {
      retainYamlSequenceAnnotations(
        original,
        replacement,
        (node) => this.value(node),
        (source, target) => {
          if (source.commentBefore !== undefined)
            target.commentBefore = source.commentBefore;
          if (source.comment !== undefined) target.comment = source.comment;
          if (source.spaceBefore !== undefined)
            target.spaceBefore = source.spaceBefore;
          return target;
        },
        () => true,
      );
    }
    if (pair === undefined) map.set(key, replacement);
    else pair.value = replacement;
  }

  /** Copy from the source before edits; materialized nodes own no anchors. */
  copy(node: unknown, invalidated?: ReadonlySet<Node>): unknown {
    if (isAlias(node)) {
      const target = this.resolve(node);
      return invalidated === undefined ||
        (isNode(target) && invalidated.has(target))
        ? this.copy(target)
        : node.clone();
    }
    if (!isNode(node)) return node;
    const copied = node.clone();
    if (
      (invalidated === undefined || invalidated.has(node)) &&
      (isScalar(copied) || isMap(copied) || isSeq(copied))
    )
      delete copied.anchor;
    if (isSeq(node) && isSeq(copied))
      copied.items = node.items.map((item) =>
        this.copy(item, invalidated),
      ) as typeof copied.items;
    if (isMap(node) && isMap(copied))
      copied.items.forEach((pair, index) => {
        pair.key = this.copy(node.items[index]!.key, invalidated);
        pair.value = this.copy(node.items[index]!.value, invalidated);
      });
    return copied;
  }

  /** Replacing an anchor must not change untouched consumers of its old value. */
  detach(node: unknown, invalidated: ReadonlySet<Node>): unknown {
    const copied = this.copy(node, invalidated);
    if (isNode(copied))
      visit(copied, {
        Pair: (_key, pair) => {
          if (isAlias(pair.key)) pair.key = this.copy(this.resolve(pair.key));
        },
        Value: (_key, value) => {
          delete value.anchor;
        },
      });
    return copied;
  }

  anchors(node: unknown): readonly Node[] {
    if (!isNode(node)) return [];
    const anchors: Node[] = [];
    visit(node, {
      Value: (_key, value) => {
        if (value.anchor) anchors.push(value);
      },
    });
    return anchors;
  }
}
