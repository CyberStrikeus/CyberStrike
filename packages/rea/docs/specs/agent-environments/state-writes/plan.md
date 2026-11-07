# Implementation plan

The branch builds on the state-serving and coverage branches (merged into it).

1. **Write plan types and request bodies.** Add the plan, rule and reason types
   beside the state rules, and have the state accumulator lend extraction
   parsed request bodies under the same budget, admitted like response bodies.
2. **Field rules.** Add a module that explains an observed entity against the
   call that wrote it (echo, copy, path, slug, clock, sequence, unique,
   template and constant) and that recognises and formats clock values,
   UUIDs and tokens.
3. **Effects.** Add one apply module that both the gate and the server use. It
   applies a create, update, delete or document write to a writable state
   interface from a plan, a call and a value source: the recorded values in
   the gate, the store's generators when served.
4. **Gate.** Add a simulation that:
   - classifies every write tool;
   - builds each plan from its exemplar;
   - walks the timeline over a copy of the initial state;
   - checks state-answered reads;
   - attributes passes and mismatches;
   - learns the insert rule;
   - records verdicts.

   Extraction runs it after the read gate and returns `writes` and
   `write_clock`; the view schema and its unknowns state the write model.

5. **Serving.**
   - The loaded state carries the plans and the clock.
   - The store gains atomic mutations, the clock and the counter (all reset by
     `data/reset` and `data/add`).
   - A write answer module validates the body, applies the effect and renders
     the response.
   - Item reads of missing entities answer recorded 404s.
   - The served catalog adds served write tools, with descriptions charged to
     the discovery budget.
6. **Export.** Count served write tools in the bundle plan and README.
7. **Tests.** Domain, services, adapters and MCP-boundary coverage as the
   spec's acceptance lists.
8. **Documentation.** Document the write model in the environment-state and
   serving sections, and record the real-capture results, the AgentEnv run
   and the live comparison in `verification.md`.

There are no dependency, provider or REA tool contract changes beyond the
`environment-state` result members, and no new network activity.
