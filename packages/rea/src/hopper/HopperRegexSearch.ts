import { z } from "zod";

import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { nativeInventoryRowsSchemas } from "../domain/native/nativeInventory.js";
import { HopperRemoteError } from "../domain/hopperErrors.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import { nativeSearchInput } from "../domain/native/nativeSearch.js";
import type { HopperClient } from "./HopperClient.js";
import {
  DEFAULT_REGEX_MATCHING_DEADLINE,
  type RegexMatchingDeadline,
} from "../config/regexMatchingDeadline.js";
import {
  DEFAULT_REGEX_WORKER_HEAP_REQUEST,
  type RegexWorkerHeapRequest,
} from "../config/regexWorkerHeapRequest.js";
import { matchRegexValues } from "../process/RegexMatcher.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";

const inputSchema = z.strictObject({
  ...nativeSearchInput,
  mode: z.literal("regex"),
});
/** Match collected native facts off Hopper's API thread, with cancellable lifetime. */
export class HopperRegexSearch {
  readonly #active = new Map<
    AbortController,
    Promise<Result<JsonValue, AnalysisError>>
  >();

  constructor(
    private readonly client: Pick<HopperClient, "callTool">,
    private readonly deadline: RegexMatchingDeadline = DEFAULT_REGEX_MATCHING_DEADLINE,
    private readonly heapRequest: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
  ) {}

  execute(
    operation: "search_strings" | "search_procedures",
    parameters: Readonly<Record<string, JsonValue>>,
    options?: ExecutionOptions,
  ): Promise<Result<JsonValue, AnalysisError>> {
    const controller = new AbortController();
    const signal =
      options?.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, options.signal]);
    const pending = this.#execute(operation, parameters, {
      ...options,
      signal,
    });
    this.#active.set(controller, pending);
    void pending.then(
      () => this.#active.delete(controller),
      () => this.#active.delete(controller),
    );
    return pending;
  }

  /** Abort matching workers before their provider session closes. */
  async close(): Promise<void> {
    for (const controller of this.#active.keys()) controller.abort();
    await Promise.all(this.#active.values());
  }

  async #execute(
    operation: "search_strings" | "search_procedures",
    parameters: Readonly<Record<string, JsonValue>>,
    options: ExecutionOptions,
  ): Promise<Result<JsonValue, AnalysisError>> {
    const input = inputSchema.safeParse(parameters);
    if (!input.success)
      return err(
        new HopperRemoteError(
          -32000,
          `Invalid search arguments: ${input.error.message}`,
          { diagnosticType: "invalid_request", operation },
        ),
      );
    const inventoryOptions: ExecutionOptions = {
      ...options,
      ...(options.progress === undefined
        ? {}
        : {
            progress: {
              report: (update) =>
                options.progress?.report({
                  ...update,
                  completed:
                    update.total === null || update.total === 0
                      ? 0
                      : Math.min(0.5, update.completed / update.total / 2),
                  total: 1,
                }) ?? Promise.resolve(),
            },
          }),
    };
    const inventory = await this.client.callTool(
      operation === "search_strings" ? "list_strings" : "list_procedures",
      input.data.document === undefined
        ? {}
        : { document: input.data.document },
      inventoryOptions,
    );
    if (!inventory.ok)
      return err(
        analysisClientFailureForOperation(inventory.error, "hopper", operation),
      );
    const rows = inventory.value;
    const schema =
      operation === "search_strings"
        ? nativeInventoryRowsSchemas.strings
        : nativeInventoryRowsSchemas.names;
    const parsed = schema.safeParse(rows);
    if (!parsed.success || !Array.isArray(rows))
      return err(
        new AnalysisOutputError(
          operation,
          "Hopper search inventory is malformed",
        ),
      );
    if (options.signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, { cause: options.signal.reason }),
      );
    await options.progress
      ?.report({
        phase: "hopper_regex",
        completed: 0.5,
        total: 1,
        message: "Matching inventory in cancellable regex worker",
      })
      .catch(() => undefined);
    if (options.signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, { cause: options.signal.reason }),
      );
    const matched = await matchRegexValues({
      operation,
      pattern: input.data.pattern,
      caseSensitive: input.data.case_sensitive,
      values: parsed.data.map((item) => item.value),
      signal: options.signal,
      deadline: this.deadline,
      heapRequest: this.heapRequest,
    });
    if (!matched.ok) return matched;
    if (options.signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, { cause: options.signal.reason }),
      );
    const selected = new Set(matched.value);
    return ok(rows.filter((_, index) => selected.has(index)));
  }
}
