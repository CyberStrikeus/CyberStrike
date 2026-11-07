import type { RuleTester } from "oxlint/plugins-dev";

declare const cancellationCauseRule: Parameters<RuleTester["run"]>[1];
export default cancellationCauseRule;
