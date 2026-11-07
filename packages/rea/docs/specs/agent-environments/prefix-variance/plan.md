# Plan

1. Move tool naming (`parameterNames`, `pathTemplate`, `toolName`,
   `compareTools`) from `environmentManifestRules.ts` to a new
   `environmentManifestNames.ts`, so the rules module has room for the rule.
2. Add `prefix-variance` to `TEMPLATE_RULES`. A `prefix-variance` parameter
   records the rule it shares (`sharedRule`), which names it and keys it.
3. Add the pass after `sibling-variance`: walk positions in order, index the
   opt-in parameters at each position by their preceding parts, template
   qualifying literals, then rebucket by naming key, keeping a tool's own rule
   for each merged position.
4. Share the 32-segment split between the three comparing passes and list the
   segment-limited rules once for the limitation.
5. Document the rule in the view schema description and in
   `docs/web-network-captures.md`.
6. Tests: shared positions across methods and depths, the spelling condition,
   merges that keep a tool's own rule, pairs, format-rule positions and the
   segment limit.
