import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import {
  analysisSearchPredicate,
  analysisSearchQuerySchema,
} from "../domain/analysisSearch.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import { normalizeKunaAddress } from "./KunaAddress.js";
import { kunaProjectDeadline } from "./KunaConfiguration.js";
import type { KunaInstallation } from "./KunaInstallation.js";
import type { KunaPendingQuery, KunaQueryWork } from "./KunaQueryWork.js";
import { kunaQueryFailureForCaller } from "./KunaQueryErrors.js";
import { KUNA_STRING_MIN_LENGTH } from "./KunaLimits.js";
import {
  KunaStringInventoryReader,
  kunaStringsAtAddress,
  type KunaStringInventory,
  type KunaStringItem,
} from "./KunaStringInventory.js";

/** One validated scan shared by literal, regex and exact-address queries. */
export class KunaStringQueries {
  #inventory: KunaStringInventory | undefined;
  #failure: AnalysisError | undefined;
  #pending: KunaPendingQuery<KunaStringInventory> | undefined;

  constructor(private readonly work: KunaQueryWork) {}

  async execute(
    operation: "list_strings" | "search_strings",
    parameters: Readonly<Record<string, JsonValue>>,
    installation: KunaInstallation,
    signal: AbortSignal | undefined,
  ): Promise<
    Result<
      { readonly result: JsonValue; readonly source: JsonValue },
      AnalysisError
    >
  > {
    if (signal?.aborted === true)
      return err(
        new AnalysisCancelledError(operation, { cause: signal?.reason }),
      );
    const query =
      operation === "search_strings"
        ? analysisSearchQuerySchema.safeParse(parameters)
        : undefined;
    if (query !== undefined && !query.success)
      return err(
        analysisInputErrorFromIssues(operation, query.error.issues, parameters),
      );
    const address =
      operation === "list_strings" && parameters.address !== undefined
        ? normalizeKunaAddress(parameters.address)
        : undefined;
    if (
      operation === "list_strings" &&
      parameters.address !== undefined &&
      address === undefined
    )
      return err(
        new AnalysisInputError(
          operation,
          { userMessage: "Use an explicit hexadecimal u64 string address." },
          [{ path: ["address"], reason: "invalid_format" }],
        ),
      );
    const inventory = await this.#load(installation, operation, signal);
    if (!inventory.ok)
      return err(kunaQueryFailureForCaller(inventory.error, operation));
    if (this.#cancelled(signal))
      return err(
        new AnalysisCancelledError(operation, { cause: signal?.reason }),
      );
    const available = inventory.value.items;
    let items: KunaStringItem[] | undefined;
    if (address !== undefined)
      items = kunaStringsAtAddress(inventory.value, address);
    if (query?.success === true) {
      if (query.data.mode === "regex") {
        const matched = await this.work.match({
          operation,
          pattern: query.data.pattern,
          caseSensitive: query.data.case_sensitive,
          values: () => available.map((item) => item.value),
          signal,
        });
        if (!matched.ok) return matched;
        items = matched.value.map((index) => available[index]!);
      } else {
        const predicate = analysisSearchPredicate(query.data);
        items = available.filter((item) => predicate(item.value));
      }
    }
    const selected = items ?? [...available];
    return ok({
      result: selected,
      source: {
        kind: "kuna-string-inventory",
        sha256: inventory.value.sha256,
        bytes: inventory.value.bytes,
        scanned: inventory.value.scanned,
        encoding: "all",
        min_length: KUNA_STRING_MIN_LENGTH,
        termination: "any",
        xrefs: false,
        inventory_count: inventory.value.items.length,
        selected_count: selected.length,
      },
    });
  }

  async #load(
    installation: KunaInstallation,
    operation: string,
    signal: AbortSignal | undefined,
  ): Promise<Result<KunaStringInventory, AnalysisError>> {
    if (this.#inventory !== undefined) return ok(this.#inventory);
    if (this.#failure !== undefined) return err(this.#failure);
    if (this.#pending?.signal.aborted === true) {
      const stopped = await this.work.wait(this.#pending, signal, operation);
      if (!stopped.ok && !(stopped.error instanceof AnalysisCancelledError))
        return stopped;
      if (signal?.aborted === true)
        return err(
          new AnalysisCancelledError(operation, { cause: signal?.reason }),
        );
      return this.#load(installation, operation, signal);
    }
    if (this.#pending === undefined) {
      const pending = this.work.start<KunaStringInventory>(
        (producerSignal) =>
          this.work.scan(
            {
              installation,
              operation: "kuna:strings",
              arguments: (input) => [
                "strings",
                input,
                "--json",
                "--encoding",
                "all",
                "--min-length",
                String(KUNA_STRING_MIN_LENGTH),
                "--termination",
                "any",
                "--no-xrefs",
              ],
              deadline: kunaProjectDeadline(installation.configuration),
            },
            new KunaStringInventoryReader(),
            producerSignal,
            (failure) => {
              this.#failure = failure;
            },
          ),
        (value) => {
          this.#inventory = value;
        },
      );
      this.#pending = pending;
      const release = () => {
        if (this.#pending === pending) this.#pending = undefined;
      };
      void pending.promise.then(release, release);
    }
    return this.work.wait(this.#pending, signal, operation);
  }

  #cancelled(signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true;
  }

  /** Called only after session-owned work has drained. */
  clear(): void {
    this.#inventory = undefined;
    this.#failure = undefined;
    this.#pending = undefined;
  }
}
