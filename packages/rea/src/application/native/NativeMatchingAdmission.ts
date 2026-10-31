import { setImmediate } from "node:timers/promises";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import type { Evidence } from "../../domain/evidence.js";
import { analysisSettingLimit } from "../../domain/analysisSettingDefinitions.js";
import {
  DEFAULT_NATIVE_MATCHING_ALLOWANCE,
  nativeMatchingAllowanceRecovery,
  nativeMatchingByteAllowance,
  type NativeMatchingAllowance,
} from "../../config/nativeMatchingAllowance.js";

/** Budget the actual selected observations, before cloning or index allocation. */
export class NativeMatchingAdmission {
  readonly #maximum: number;
  readonly #source: NativeMatchingAllowance["source"];
  #remaining: number;
  #work = 0;
  readonly #seen = new WeakSet<object>();
  constructor(
    readonly operation: string,
    readonly signal?: AbortSignal,
    allowance: NativeMatchingAllowance = DEFAULT_NATIVE_MATCHING_ALLOWANCE,
  ) {
    // Read the accepted operation's value once, so the refusal reports the
    // budget this request actually ran under.
    this.#maximum = allowance.maximumBytes;
    this.#source = allowance.source;
    this.#remaining = this.#maximum;
  }
  readonly checkpoint = async (bytes = 0): Promise<void> => {
    this.#remaining -= bytes;
    if (this.#remaining < 0)
      throw new AnalysisResourceConstraintError(
        this.operation,
        "capacity",
        `Native function matching exceeds its ${nativeMatchingByteAllowance(this.#maximum)} representation allowance (native.matching_representation_bytes).`,
        { maximum_bytes: this.#maximum },
        {
          retryable: false,
          remediationAction: nativeMatchingAllowanceRecovery({
            maximumBytes: this.#maximum,
            source: this.#source,
          }),
          limit: analysisSettingLimit(
            "native.matching_representation_bytes",
            this.#maximum,
            this.#source,
          ),
        },
      );
    this.signal?.throwIfAborted();
    if (++this.#work % 256 === 0)
      await setImmediate(
        undefined,
        this.signal === undefined ? {} : { signal: this.signal },
      );
  };
  /**
   * Charge a borrowed record's envelope, which matching copies into its
   * limitations, digests and links. Its result payloads stay resident: the
   * caller charges what matching derives from them, or never parses them.
   */
  async admitBorrowed(record: Evidence): Promise<void> {
    await this.checkpoint(128);
    for (const [key, value] of Object.entries(record))
      if (key !== "raw_result" && key !== "normalized_result")
        await this.admit(value);
  }
  async admit(root: unknown): Promise<void> {
    const pending: Iterator<unknown>[] = [[root][Symbol.iterator]()];
    while (pending.length) {
      const next = pending[pending.length - 1]!.next();
      if (next.done) {
        pending.pop();
        continue;
      }
      const value = next.value;
      if (typeof value === "object" && value !== null) {
        if (this.#seen.has(value)) continue;
        this.#seen.add(value);
        await this.checkpoint(128);
        // Iterator traversal avoids a second width-sized array of child values.
        pending.push(
          (function* () {
            for (const key in value)
              if (Object.hasOwn(value, key)) {
                yield key;
                yield (value as Record<string, unknown>)[key];
              }
          })(),
        );
      } else
        await this.checkpoint(
          typeof value === "string" ? 64 + value.length * 4 : 128,
        );
    }
  }
}
