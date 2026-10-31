import {
  noRuntimeOverrideSentence,
  selectedCdpCommandTimeoutMs,
} from "../domain/browserDeadline.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";
import { ProviderStartupDeadline } from "../process/ProviderDeadline.js";

const MIB = 1024 * 1024;

export const CDP_SCRIPT_SOURCE_BYTES_OMISSION_REASON = `script source was omitted because the aggregate ${String(WEB_RUNTIME_LIMITS.sourceBytes)}-byte (${String(WEB_RUNTIME_LIMITS.sourceBytes / MIB)} MiB) source budget was exhausted. ${noRuntimeOverrideSentence("That source budget stays fixed.", "command_timeout_ms")}`;

/** Name command_timeout_ms on a passive script-source collection miss. */
export const cdpScriptSourceDeadlineOmissionReason = (
  timeoutMs: number,
): string =>
  `script source was omitted because the ${String(timeoutMs)} ms command_timeout_ms source collection deadline elapsed (deadlineExpired). This is not the caller observation window. ${noRuntimeOverrideSentence(`The ${String(WEB_RUNTIME_LIMITS.sourceBytes)}-byte source budget stays fixed.`, "command_timeout_ms")}`;

/** Shared admission for source text retained from passive CDP script reads. */
export class CdpScriptSourceBudget {
  readonly #deadline: ProviderStartupDeadline;
  readonly commandTimeoutMs: number;
  #retainedBytes = 0;

  constructor(
    signal?: AbortSignal,
    commandTimeoutMs: number = selectedCdpCommandTimeoutMs(undefined),
  ) {
    this.commandTimeoutMs = commandTimeoutMs;
    this.#deadline = new ProviderStartupDeadline(commandTimeoutMs, signal);
  }

  get signal(): AbortSignal {
    return this.#deadline.signal;
  }

  get timedOut(): boolean {
    return this.#deadline.interruption === "timeout";
  }

  /** Admit exact UTF-8 source bytes before building or retaining its artifact. */
  admit(text: string): boolean {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > WEB_RUNTIME_LIMITS.sourceBytes - this.#retainedBytes)
      return false;
    this.#retainedBytes += bytes;
    return true;
  }

  dispose(): void {
    this.#deadline.dispose();
  }
}
