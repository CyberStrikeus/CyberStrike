# Implementation plan

1. **Query module.** A domain module holds the roles, explains one line (trying roles by parameter name, filters and
   inert for any parameter, at most 256 combinations), merges lines, evaluates a query over entities, and renders an
   answer with counters and totals.
2. **Gate.** The list plan learns the query from the lines that are not whole, reading each body once for its listed
   identities, role choices and counts; demotes a line whose envelope or fields do not reproduce; and adds `query` to
   the view.
3. **Write gate.** A read on a query line is checked against the query over the replayed state, covering the
   collection only for sort- and page-only answers that hold every match.
4. **Serving.** Line selection moves to its own module and gains the query line; list answers choose whole,
   query or recorded members and render totals.
5. **Tests and docs.** Unit, domain and serving tests; the environment-state and agent-environment docs and the
   analysis-view tool description.
