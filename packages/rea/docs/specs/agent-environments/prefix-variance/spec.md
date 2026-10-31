# Share templated positions across tools

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

A session usually edits one scratch entity: it creates it, then updates and
deletes it at a fixed path such as `/api/v1/collections/0RZ576QZQA5KG`. The
manifest templates a segment only when sibling routes of the same method vary
there, so those writes stay literal tools (`patch_collections_0rz576qzqa5kg`)
even though the reads of the same collection were templated as
`/api/v1/collections/{collection_id}`. A literal write tool addresses one
entity that may not exist in a later state, and nothing can model its effect.

A new opt-in template rule, `prefix-variance`, templates such a literal with
the parameter another tool already uses at that position, so the write becomes
`patch_collections_by_collection_id` on the same template as the read.

## Requirements

- `prefix-variance` applies only when listed, after every other opt-in rule, so
  it can share the parameters they produce.
- A literal at position `p` is templated when another tool on the same origin,
  of any method and any segment count, has a parameter at `p` from one of the
  other opt-in rules, after the same preceding parts. Parameters in the
  preceding parts compare by the rule that names them, so a position templated
  by `prefix-variance` matches the parameter it shares.
- The literal qualifies when it is one of the values such a parameter
  observed at that position, when it carries a digit and has the length and
  character classes (digits, lower case, upper case, each other character) of
  one of them, or when every value the parameter observed, one or more, has one
  length of eight or more characters, as generated identifiers often do, and
  the literal has that length and uses only their character classes, so an
  identifier that happens to hold no digit still qualifies. An empty literal, a
  stop word or a `v1`-style version never qualifies. Each parameter's spelling
  is summarised once, so a literal is checked without rescanning its values,
  and a value longer than 128 characters is compared only exactly, so a huge
  segment costs no classification.
- Positions templated by the four format rules are never shared, so
  `/api/teams/{numeric}` still absorbs no literal.
- Values stay with the parameter that observed them: when parameters of
  different rules share a position, the literal shares the one that observed
  it, else the earliest one it is spelled like.
- The parameter takes the name of the parameter it shares (`collection_id`,
  `uid`, a pair's `_namespace` and `_name`) and is labelled `prefix-variance`.
- Tools whose routes now match, by method and by the rule that names each
  parameter, merge. A merged parameter keeps the rule of a tool that templated
  that position itself, when one did.
- Like the sibling rules, it compares routes of at most 32 segments and says so
  in a limitation when a longer route exists.

## Non-goals

- No change to the default rules or to any other rule: manifests that do not
  list `prefix-variance` are byte-for-byte unchanged.
- No templating from response bodies, such as an id a create returned; the
  manifest reads request lines only.
- No change to which groups are excluded: a write whose response has no body
  or content type outside `/api/` is still excluded as `non-json`.
