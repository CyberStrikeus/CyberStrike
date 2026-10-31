# Plan

1. Schema: optional `observed_at` (ISO date-time) on `request` events, and
   `started_at` (ISO date-time) and `elapsed_ms` (non-negative number) on
   `request-finished` and `request-failed` events.
2. Collector: stamp `observed_at` when a request is observed and copy the
   browser's `timing().startTime` and `responseEnd` into `started_at` and
   `elapsed_ms` when it reports them, admitting the strings with the other
   metadata.
3. Records: index each transaction's single finished or failed start and
   duration and give each attributable record `startedDateTime` and `time`;
   add a limitation when any record is timed.
4. Comparison: drop both fields from network evidence before fingerprinting and
   commit the rule in the built-in list and the comparison limitation.
5. Docs: the scenario contract's network evidence and the environment docs'
   browser scenario section.
6. Tests: the collector stamps both fields, records take them, the state learns
   the HAR's clock and verdicts from a timed scenario and none from an untimed
   or partly untimed one, a request that never ended or ended twice falls back
   to its observation with unknown duration omitted, an explicit zero remains
   observed, comparisons ignore the times (also against an untimed
   capture), and the real-Chrome network lane checks every request is observed
   and every finished request carries the browser's start and duration.
