import type { RuleTester } from "oxlint/plugins-dev";

declare const rule: Parameters<RuleTester["run"]>[1];
export default rule;
