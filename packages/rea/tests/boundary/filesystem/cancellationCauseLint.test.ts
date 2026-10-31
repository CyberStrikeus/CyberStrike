import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import cancellationCauseRule from "../../../scripts/lint/cancellation-cause.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const core =
  'import { AnalysisCancelledError } from "./domain/analysisErrorCore.js";';
const options =
  'import type { ExecutionOptions } from "./application/AnalysisProvider.js";';

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" }, sourceType: "module" },
}).run("cancellation-cause", cancellationCauseRule, {
  valid: [
    // The corrected WABT pre-abort branch retains even null or object reasons.
    `${core}\n${options}\nfunction run(options?: ExecutionOptions) {
      if (options?.signal?.aborted)
        throw new AnalysisCancelledError("inspect", {
          cause: options.signal.reason,
        });
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted === true)
        return err(new AnalysisCancelledError("inspect", { cause: signal.reason }));
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted)
        throw new AnalysisCancelledError("inspect", { 'cause': signal.reason });
    }`,
    `${core}\nfunction close() {
      if (this.closed) throw new AnalysisCancelledError("inspect");
    }`,
    `${core}\nfunction run(signal?: AbortSignal, other?: boolean) {
      if (signal?.aborted || other)
        throw new AnalysisCancelledError("inspect");
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted)
        return () => new AnalysisCancelledError("inspect");
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted)
        throw new AnalysisCancelledError("inspect", { ...forwardedContext });
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted)
        throw new AnalysisCancelledError("inspect", forwardedContext);
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted)
        throw new AnalysisCancelledError("inspect", { [forwardedKey]: value });
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted) {
        const AnalysisCancelledError = Error;
        throw new AnalysisCancelledError("inspect");
      }
    }`,
    `${core}\nfunction run(signal?: AbortSignal) {
      if (signal?.aborted) throw new Error("cancelled");
    }`,
    // Names alone are insufficient: these are unrelated local structures.
    `${core}\ntype AbortSignal = { aborted: boolean };
      function run(signal: AbortSignal) {
        if (signal.aborted) throw new AnalysisCancelledError("inspect");
      }`,
    `${core}\ntype ExecutionOptions = { signal: { aborted: boolean } };
      function run(options: ExecutionOptions) {
        if (options.signal.aborted)
          throw new AnalysisCancelledError("inspect");
      }`,
    `${core}\nfunction run(signal?: unknown) {
      if (signal?.aborted) throw new AnalysisCancelledError("inspect");
    }`,
  ],
  invalid: [
    {
      code: `${core}\n${options}\nfunction run(options?: ExecutionOptions) {
        if (options?.signal?.aborted)
          throw new AnalysisCancelledError("inspect");
      }`,
      errors: [{ messageId: "missingCause" }],
    },
    {
      code: `${core}\nfunction run(signal?: AbortSignal) {
        if (signal?.aborted === true)
          return err(new AnalysisCancelledError("inspect"));
      }`,
      errors: [{ messageId: "missingCause" }],
    },
    {
      code: `${core}\nfunction run(signal?: AbortSignal) {
        if (signal?.aborted && ready)
          throw new AnalysisCancelledError("inspect", { diagnostics });
      }`,
      errors: [{ messageId: "missingCause" }],
    },
    {
      code: `import { AnalysisCancelledError as Cancelled } from
        "./domain/analysisErrorCore.js";
        function run(signal?: AbortSignal) {
          if (signal?.aborted) throw new Cancelled("inspect");
        }`,
      errors: [{ messageId: "missingCause" }],
    },
    {
      code: `${core}\n${options}\nfunction run(options?: ExecutionOptions) {
        const signal = options?.signal;
        if (signal?.aborted) throw new AnalysisCancelledError("inspect");
      }`,
      errors: [{ messageId: "missingCause" }],
    },
    {
      code: `${core}\nimport type { ExecutionOptions as Options } from
        "./application/AnalysisProvider.js";
        function run(options?: Options) {
          if (options?.signal?.aborted)
            return err(new AnalysisCancelledError("inspect"));
        }`,
      errors: [{ messageId: "missingCause" }],
    },
    {
      code: `${core}\nfunction run(signal?: AbortSignal) {
        if (signal?.aborted) {
          const failure = new AnalysisCancelledError("inspect");
          return err(failure);
        }
      }`,
      errors: [{ messageId: "missingCause" }],
    },
  ],
});
