import type { RuleTester } from "oxlint/plugins-dev";

declare const noBufferDeepEquality: Parameters<RuleTester["run"]>[1];
export default noBufferDeepEquality;
